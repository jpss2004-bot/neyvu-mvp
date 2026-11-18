// Worker-side hybrid retrieval (NEYVU_RETRIEVAL=hybrid, default site 'worker').
//
// The web service on Render cannot reach the embedding/rerank models, which run
// beside the AI worker on the Mac mini. So:
//  1. The answer lease keeps today's keyword retrieval and evidence pipeline,
//     and additionally pins a wide candidate set: the keyword hits plus other
//     in-scope current sources that have passage vectors. Each candidate carries
//     its stored passage embeddings (int8, cosine-preserving) and texts cut to
//     NEYVU_RERANK_CHARS.
//  2. The worker (scripts/worker_retrieval.py) embeds the question, scores
//     passages by cosine, fuses keyword and vector orders with RRF, reranks
//     within NEYVU_RERANK_BUDGET_MS, and posts the order (op retrieval.rank).
//  3. rankAnswerRetrieval re-pins the answer's search sources in that order
//     before generation, so citation numbers stay bound to the pinned list.
//     Only pinned candidates are accepted; excerpts always come from this
//     database, never from the worker.
// Passage vectors are written by the worker too (ops embed.lease/embed.finish).
// With the flags off nothing here runs and the lease payload is unchanged.
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {betaPool,tenant,uuid} from './db';
import {retrievalConfig,retrievalConfigFor,type RetrievalConfig} from './retrieval-config';
import {vectorColumnReady,authorityTier,type RetrievalTrace} from './hybrid-search';
import {embeddingText} from './chunking';
import {vectorLiteral} from './embedding-client';
import {excerptBetaSources,BetaConflict} from './vault';
import {excerptCoverage} from './excerpt-coverage';
import {planAnswerSourceReadings} from './answer-source-reading';
import {receiptsForSources} from './moodle-receipts';
import {workerCourse} from './course-codes';
import {lockVault} from './budget';
import {BetaHttpError} from './http';

const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
export const workerRetrievalFormat='worker-hybrid/1';
const perSource=24,embedBatch=64;

// Cosine is scale-invariant, so a per-vector int8 code keeps the ranking while
// sending 384 bytes instead of ~3 KB of JSON per passage.
export function encodeInt8(vector:number[]){
 const max=Math.max(...vector.map(n=>Math.abs(n)),1e-12);
 return Buffer.from(Int8Array.from(vector,n=>Math.max(-127,Math.min(127,Math.round(n/max*127)))).buffer).toString('base64');
}
export function decodeFloat32(b64:string,dim:number){
 const buf=Buffer.from(b64,'base64');
 if(buf.length!==dim*4)throw new BetaHttpError('Invalid embedding');
 return Array.from({length:dim},(_,i)=>buf.readFloatLE(i*4));
}

const poolSourcesSql=String.raw`SELECT s.id,s.title,s.kind,s.current_version AS version_id,(s.id=ANY($3::uuid[])) AS keyword
 FROM schoolvault.sources s JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.id=s.current_version
 WHERE s.user_id=$1 AND s.kind!='ai_draft' AND s.current_version IS NOT NULL AND NOT(s.id=ANY($5::uuid[]))
  AND (s.id=ANY($3::uuid[]) OR ($2::uuid[] IS NULL OR s.course_id=ANY($2::uuid[])) AND EXISTS(
   SELECT 1 FROM schoolvault.passages p JOIN schoolvault.passage_embeddings e ON e.user_id=p.user_id AND e.passage_id=p.id AND e.model=$4
   WHERE p.user_id=$1 AND p.source_id=s.id AND p.version_id=s.current_version))
 ORDER BY (s.id=ANY($3::uuid[])) DESC,v.observed_at DESC,s.id LIMIT $6`;
const poolPassagesSql=String.raw`SELECT * FROM (
 SELECT p.source_id,p.id,p.ordinal,p.section,p.context_header,left(p.body,$4::int) AS body,e.embedding::real[] AS embedding,
  row_number() OVER (PARTITION BY p.source_id ORDER BY p.ordinal) AS rn
 FROM jsonb_to_recordset($2::jsonb) ref(id uuid,version_id uuid)
 JOIN schoolvault.passages p ON p.user_id=$1 AND p.source_id=ref.id AND p.version_id=ref.version_id
 JOIN schoolvault.passage_embeddings e ON e.user_id=$1 AND e.passage_id=p.id AND e.model=$3) x
 WHERE rn<=${perSource} ORDER BY source_id,ordinal`;

type Candidate={source_id:string;title:string;authority:number;keyword_rank:number|null;passages:{id:string;ordinal:number;section:string|null;header:string|null;text:string;e:string}[]};

// Called at lease time. `rerankable` are the indices of `sources` that came
// from generic search (not selected, work, plan, policy or writing routes);
// only those slots may be reordered by the worker.
export async function workerRetrievalPlan(c:PoolClient,user:string,args:{question:string;sources:any[];rerankable:number[];keywordOrder:string[];scopeIds:string[]|null},cfg:RetrievalConfig=retrievalConfigFor(user)){
 // NEYVU_RETRIEVAL_CANARY is decided here, at lease time: a user outside the list gets no plan (keyword).
 if(cfg.mode!=='hybrid'||cfg.site!=='worker'||!args.rerankable.length)return null;
 const fixed=args.sources.filter((_,i)=>!args.rerankable.includes(i)).map(s=>s.id);
 const keyword=[...new Set(args.keywordOrder)].filter(id=>!fixed.includes(id));
 const rows=(await c.query(poolSourcesSql,[user,args.scopeIds,keyword,cfg.embedModel,fixed,keyword.length+cfg.poolSources])).rows;
 if(!rows.length)return null;
 const passages=(await c.query(poolPassagesSql,[user,JSON.stringify(rows.map(r=>({id:r.id,version_id:r.version_id}))),cfg.embedModel,cfg.rerankChars])).rows;
 const bySource=new Map<string,any[]>();for(const p of passages){const list=bySource.get(p.source_id)||[];list.push(p);bySource.set(p.source_id,list);}
 let budget=cfg.poolPassages;
 const candidates:Candidate[]=rows.map(r=>{
  const own=(bySource.get(r.id)||[]).slice(0,Math.max(0,budget));budget-=own.length;
  const rank=keyword.indexOf(r.id);
  return {source_id:r.id,title:String(r.title||'').slice(0,240),authority:authorityTier(r),keyword_rank:rank>=0?rank+1:null,
   passages:own.map(p=>({id:p.id,ordinal:p.ordinal,section:p.section||null,header:p.context_header||null,text:p.body,e:encodeInt8(p.embedding.map(Number))}))};
 }).filter(c=>c.keyword_rank!==null||c.passages.length);
 if(!candidates.length)return null;
 return {
  payload:{format:workerRetrievalFormat,question:args.question.slice(0,3000),model:cfg.embedModel,rerank:cfg.rerank,budget_ms:cfg.rerankBudgetMs,rerank_candidates:cfg.rerankCandidates,rerank_chars:cfg.rerankChars,rrf_k:cfg.rrfK,vector_weight:cfg.vectorWeight,authority_boost:cfg.authorityBoost,rerank_authority:cfg.rerankAuthority,fuse_limit:cfg.candidates,slots:args.rerankable.length,candidates},
  pin:{format:workerRetrievalFormat,model:cfg.embedModel,positions:args.rerankable,candidates:candidates.map(c=>({id:c.source_id,version_id:rows.find(r=>r.id===c.source_id)!.version_id,keyword_rank:c.keyword_rank}))},
 };
}

const num=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max?v:null;
const reasonCodes=['embed_unavailable','model_mismatch','no_vectors','budget_exceeded','unavailable','disabled'];

// Bounded copy of the worker's stage report (untrusted).
export function workerStages(raw:any,allowed:Set<string>){
 const ids=(v:unknown,max:number)=>(Array.isArray(v)?v:[]).filter((id:unknown):id is string=>uuid(id)&&allowed.has(id)).slice(0,max);
 const r=raw&&typeof raw==='object'?raw:{};
 const scores:Record<string,any>={};
 for(const [id,s] of Object.entries(r.scores&&typeof r.scores==='object'?r.scores:{}).slice(0,200)){
  if(!allowed.has(id)||!s||typeof s!=='object')continue;const v=s as any;
  scores[id]={vector_rank:num(v.vector_rank,1,10000),similarity:num(v.similarity,-1,1),rerank_score:num(v.rerank_score,-1e6,1e6),passage_id:uuid(v.passage_id)?v.passage_id:null,ordinal:num(v.ordinal,0,1e6),section:typeof v.section==='string'?v.section.slice(0,240):null};
 }
 const rr=r.rerank&&typeof r.rerank==='object'?r.rerank:null;
 return {
  fallback:reasonCodes.includes(r.fallback)?r.fallback as string:undefined,
  embed_ms:num(r.embed_ms,0,600000),
  vector:r.vector&&typeof r.vector==='object'?{ids:ids(r.vector.ids,200),ms:num(r.vector.ms,0,600000)??0,model:typeof r.vector.model==='string'?r.vector.model.slice(0,160):''}:undefined,
  fused:r.fused?ids(r.fused,200):undefined,
  rerank:rr?{applied:rr.applied===true,ms:num(rr.ms,0,600000)??0,...(reasonCodes.includes(rr.reason)?{reason:rr.reason}:{}),...(typeof rr.model==='string'?{model:rr.model.slice(0,160)}:{})}:undefined,
  scores,
 };
}

function leaseParts(raw:unknown){
 if(typeof raw!=='string')throw new BetaHttpError('Invalid worker lease');
 const parts=raw.split('.');if(parts.length!==3||!uuid(parts[0])||!uuid(parts[1])||!/^[A-Za-z0-9_-]{43}$/.test(parts[2]))throw new BetaHttpError('Invalid worker lease');
 return parts as [string,string,string];
}

const sourceRowSql=String.raw`SELECT s.id,s.title,s.course_id,s.kind,s.original_url,s.current_version,v.id AS version_id,v.observed_at,v.body AS full_body
 FROM schoolvault.sources s JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.id=s.current_version
 WHERE s.user_id=$1 AND s.id=$2 AND s.current_version=$3 AND s.kind!='ai_draft'`;

// op retrieval.rank: the worker's fused/reranked order for the pinned pool.
export async function rankAnswerRetrieval(raw:unknown,body:any){
 const [user,jobId]=leaseParts(raw);
 const order=Array.isArray(body?.order)?body.order.slice(0,64):[];
 return tenant(user,async c=>{
  await lockVault(c,user);
  if(!(await c.query('SELECT id FROM schoolvault.users WHERE id=$1 AND disabled_at IS NULL',[user])).rowCount)throw new BetaHttpError('Account unavailable.',403);
  const job=(await c.query('SELECT * FROM schoolvault.jobs WHERE user_id=$1 AND id=$2 FOR UPDATE',[user,jobId])).rows[0];
  if(!job||job.kind!=='answer'||job.status!=='leased'||job.lease_hash!==sha(raw as string)||Date.parse(job.lease_until)<=Date.now())throw new BetaConflict('This worker lease expired.');
  const input=job.input||{};
  if(input.retrieval_ranked_hash===sha(raw as string))return {sources:input.sources,source_readings:input.source_readings??null,ranked:true};
  const pool=input.retrieval_pool;
  if(pool?.format!==workerRetrievalFormat)throw new BetaConflict('This answer has no retrieval candidates.');
  const pinnedPool=new Map<string,{id:string;version_id:string;keyword_rank:number|null}>(pool.candidates.map((p:any)=>[p.id,p]));
  const stages=workerStages(body?.stages,new Set(pinnedPool.keys()));
  const old:any[]=input.sources||[],positions:number[]=(pool.positions||[]).filter((i:unknown)=>Number.isInteger(i)&&(i as number)>=0&&(i as number)<old.length);
  const chosen:{id:string;passage:string|null}[]=[];
  for(const o of order){
   if(!uuid(o?.source_id)||!pinnedPool.has(o.source_id)||chosen.some(x=>x.id===o.source_id))continue;
   chosen.push({id:o.source_id,passage:uuid(o.passage_id)?o.passage_id:null});
  }
  let sources=old;
  if(chosen.length){
   const byId=new Map(old.map(s=>[s.id,s]));
   const refs:any[]=[];
   const courses=(await c.query('SELECT id,code,title,moodle_id FROM schoolvault.courses WHERE user_id=$1',[user])).rows;
   const searchIds=new Set(positions.map(i=>old[i].id));
   for(const pick of chosen){
    if(refs.length>=positions.length)break;
    if(searchIds.has(pick.id)){refs.push(byId.get(pick.id));continue;}
    if(byId.has(pick.id))continue;// already present through a fixed (non-search) route
    const row=(await c.query(sourceRowSql,[user,pick.id,pinnedPool.get(pick.id)!.version_id])).rows[0];
    if(!row)continue;// changed or removed since the lease: keep only pinned versions
    const [ref]=await excerptBetaSources(c,[row],String(input.retrieval_question||input.question||''));
    if(!ref)continue;
    // A vector-only source has no keyword excerpt to speak of; quote the
    // passage the worker matched, verbatim from this version.
    const passage=pick.passage?(await c.query('SELECT body FROM schoolvault.passages WHERE user_id=$1 AND id=$2 AND source_id=$3 AND version_id=$4',[user,pick.passage,row.id,row.version_id])).rows[0]?.body:null;
    if(passage&&pinnedPool.get(pick.id)!.keyword_rank===null&&!String(ref.excerpt||'').includes(passage.trim().slice(0,200))){
     ref.excerpt=String(passage).slice(0,1800);ref.excerpt_coverage=excerptCoverage(ref,row.full_body,ref.excerpt);
    }
    const course=courses.find(x=>x.id===row.course_id);
    refs.push({...ref,historical:false,course:course?workerCourse(course):null});
   }
   const moodle=refs.filter(r=>r.kind==='moodle'&&!byId.has(r.id));
   if(moodle.length){const views=await receiptsForSources(c,user,moodle,new Date());for(const r of moodle)r.receipt=views.get(r.id)||null;}
   if(refs.length){
    const slots=[...positions].sort((a,b)=>a-b),fill=new Map(slots.map((p,i)=>[p,refs[i]]));
    sources=old.flatMap((s,i)=>!slots.includes(i)?[s]:fill.get(i)?[fill.get(i)]:[]);
   }
  }
  const changed=sources.length!==old.length||sources.some((s,i)=>s.id!==old[i]?.id||s.version_id!==old[i]?.version_id);
  const readings=changed?await planAnswerSourceReadings(c,user,job,sources,input.source_readings?.selection_revision??null,input.source_readings?.selection_basis??'moodle'):input.source_readings??null;
  const update:any={retrieval_ranked_hash:sha(raw as string),retrieval_ranked:{changed,fallback:stages.fallback??null}};
  if(changed)Object.assign(update,{sources,source_readings:readings});
  if(input.retrieval_trace)update.retrieval_trace=withWorkerStage(input.retrieval_trace,pool,stages,sources);
  await c.query('UPDATE schoolvault.jobs SET input=input||$3::jsonb,updated_at=now() WHERE user_id=$1 AND id=$2',[user,jobId,JSON.stringify(update)]);
  return {sources,source_readings:readings,ranked:true,changed};
 });
}

// Puts the worker's stages first so "Why this answer" reads the hybrid ranks.
export function withWorkerStage(trace:RetrievalTrace&{[k:string]:any},pool:any,stages:ReturnType<typeof workerStages>,sources:any[]){
 const keywordIds=(pool.candidates as any[]).filter(c=>c.keyword_rank!==null).sort((a,b)=>a.keyword_rank-b.keyword_rank).map(c=>c.id);
 const kwRank=new Map(keywordIds.map((id,i)=>[id,i+1]));
 const version=new Map((pool.candidates as any[]).map(c=>[c.id,c.version_id]));
 const ids=[...new Set([...(stages.fused||[]),...sources.map(s=>s.id).filter(id=>version.has(id))])];
 const call:RetrievalTrace['calls'][number]={question:String(trace.retrieval_question||'').slice(0,500),course_id:null,mode:'hybrid',site:'worker',...(stages.fallback?{fallback:stages.fallback}:{}),
  keyword:{ids:keywordIds,ms:0},...(stages.vector?{vector:stages.vector}:{}),...(stages.fused?{fused:stages.fused}:{}),...(stages.rerank?{rerank:stages.rerank}:{}),
  chunks:ids.map(id=>{const s=stages.scores[id]||{};return {source_id:id,version_id:version.get(id),passage_id:s.passage_id??null,ordinal:s.ordinal??null,section:s.section??null,keyword_rank:kwRank.get(id)??null,vector_rank:s.vector_rank??null,similarity:s.similarity??null,rerank_score:s.rerank_score??null};})};
 return {...trace,calls:[call,...(trace.calls||[]).filter(c=>c.site!=='worker')]};
}

// Backfill lease state lives in this (single) web process: a lease names one
// tenant's batch, and finish accepts only that batch. A leased passage that is
// not stored counts as a failure; after maxEmbedFailures it is skipped, so one
// unstorable batch cannot block the queue. Tenants are visited round-robin.
// A restart forgets this state; outstanding leases then fail and are re-leased.
const embedLeaseMs=10*60*1000,maxEmbedFailures=2,maxTrackedFailures=10000;
const embedLeases=new Map<string,{user:string;ids:Set<string>;until:number}>();
const embedFailures=new Map<string,number>();
let embedCursor='';
export function resetEmbedLeaseState(){embedLeases.clear();embedFailures.clear();embedCursor='';}
const skippedPassages=()=>[...embedFailures].filter(([,n])=>n>=maxEmbedFailures).map(([id])=>id);
function recordEmbedFailure(id:string){
 if(!embedFailures.has(id)&&embedFailures.size>=maxTrackedFailures)embedFailures.delete(embedFailures.keys().next().value!);
 embedFailures.set(id,(embedFailures.get(id)||0)+1);
}

// op embed.lease: one tenant's current passages that have no vector yet.
export async function leaseEmbeddings(cfg=retrievalConfig()){
 if(cfg.mode!=='hybrid'||cfg.site!=='worker')return null;
 const now=Date.now();
 for(const [lease,held] of embedLeases)if(held.until<=now){for(const id of held.ids)recordEmbedFailure(id);embedLeases.delete(lease);}
 const users=(await betaPool().query('SELECT id FROM schoolvault.users WHERE disabled_at IS NULL ORDER BY id')).rows.map(r=>r.id as string);
 const order=[...users.filter(id=>id>embedCursor),...users.filter(id=>id<=embedCursor)];
 const skip=skippedPassages(),held=[...embedLeases.values()].flatMap(l=>[...l.ids]);
 for(const id of order){
  const rows=await tenant(id,async c=>(await c.query(`SELECT p.id,p.body,p.context_header FROM schoolvault.passages p
   JOIN schoolvault.sources s ON s.user_id=p.user_id AND s.id=p.source_id
   WHERE p.user_id=$1 AND s.kind!='ai_draft' AND p.version_id=s.current_version AND NOT(p.id=ANY($4::uuid[]))
   AND NOT EXISTS(SELECT 1 FROM schoolvault.passage_embeddings e WHERE e.user_id=p.user_id AND e.passage_id=p.id AND e.model=$2)
   ORDER BY p.source_id,p.ordinal LIMIT $3`,[id,cfg.embedModel,embedBatch,[...skip,...held]])).rows,{readOnlySnapshot:true});
  if(!rows.length)continue;
  embedCursor=id;
  const batch=randomUUID(),lease=id+'.'+batch+'.'+randomBytes(32).toString('base64url');
  embedLeases.set(lease,{user:id,ids:new Set(rows.map(r=>r.id)),until:now+embedLeaseMs});
  return {lease,job_id:batch,user:id,model:cfg.embedModel,passages:rows.map(r=>{const text=embeddingText(r.context_header,r.body);return {id:r.id,text,sha256:sha(text)};})};
 }
 return null;
}

// op embed.finish: vectors from the worker for one leased batch. The text hash
// must match the passage as stored, so a vector can only describe it. Each
// insert has its own savepoint: one bad vector never discards the others.
export async function storeWorkerEmbeddings(body:any,cfg=retrievalConfig()){
 if(cfg.mode!=='hybrid'||cfg.site!=='worker')return {stored:0};
 const held=typeof body?.lease==='string'?embedLeases.get(body.lease):undefined;
 if(!held||held.user!==body?.user)throw new BetaConflict('This embedding lease expired.');
 embedLeases.delete(body.lease);
 const user=held.user,items=Array.isArray(body?.items)?body.items.slice(0,embedBatch):[];
 const valid=body?.model!==cfg.embedModel?[]:items.filter((i:any)=>uuid(i?.id)&&held.ids.has(i.id)&&typeof i.sha256==='string'&&/^[0-9a-f]{64}$/.test(i.sha256)&&Number.isInteger(i.dim)&&i.dim>=1&&i.dim<=4096&&typeof i.v==='string');
 const done=new Set<string>();
 if(valid.length)await tenant(user,async c=>{
  const ready=await vectorColumnReady(c);
  const rows=(await c.query("SELECT p.id,p.body,p.context_header FROM schoolvault.passages p JOIN schoolvault.sources s ON s.user_id=p.user_id AND s.id=p.source_id WHERE p.user_id=$1 AND p.id=ANY($2::uuid[]) AND s.kind!='ai_draft'",[user,valid.map((i:any)=>i.id)])).rows;
  for(const item of valid){
   const row=rows.find(r=>r.id===item.id);
   if(!row||sha(embeddingText(row.context_header,row.body))!==item.sha256)continue;
   let v:number[];try{v=decodeFloat32(item.v,item.dim);}catch{continue;}
   if(!v.every(Number.isFinite)||!v.some(n=>n!==0))continue;
   await c.query('SAVEPOINT embed_item');
   try{
    await c.query(`INSERT INTO schoolvault.passage_embeddings(user_id,passage_id,model,dim,embedding,input_sha256) VALUES($1,$2,$3,$4,$5::${ready?'vector':'real[]'},$6) ON CONFLICT DO NOTHING`,[user,item.id,cfg.embedModel,item.dim,ready?vectorLiteral(v):v,item.sha256]);
    await c.query('RELEASE SAVEPOINT embed_item');done.add(item.id);
   }catch{await c.query('ROLLBACK TO SAVEPOINT embed_item');await c.query('RELEASE SAVEPOINT embed_item');}
  }
 });
 for(const id of held.ids)if(done.has(id))embedFailures.delete(id);else recordEmbedFailure(id);
 return {stored:done.size,rejected:held.ids.size-done.size};
}

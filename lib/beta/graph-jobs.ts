// Automatic knowledge-graph extraction (build/intelligence, 2026-11-12).
//
// Saving a source version (writePassages) queues one 'graph' job for the
// source's course (migration 040; later saves join the waiting job). The worker
// leases it (op graph.lease), runs scripts/graph_worker.py over the course's
// current versions — deterministic extractors always, the local-model proposer
// on the versions that are new in this job — and returns the extraction
// (graph.finish). The server does not trust that output: every fact must be
// proved by a version of this course (or this course's platform record), every
// pinned quote must sit verbatim at its offsets in the stored body, and model
// facts stay below rule facts in confidence. Then storeExtraction keeps history
// and facts proved only by a superseded version are closed.
//
// Flag: SCHOOL_BETA_KNOWLEDGE_GRAPH=1 (default off: nothing is queued).
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {betaPool,tenant,uuid} from './db';
import {BetaHttpError} from './http';
import {knowledgeGraphEnabled,storeExtraction,type Extraction,type GraphEntity,type GraphEdge,type GraphEvidence} from './knowledge-graph';

export const graphTask='knowledge-graph-v1';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const MAX_SOURCES=200,MAX_BODY=60000,MAX_VERSIONS=500,MAX_PENDING=500;
// The model proposer reads at most this many new versions per job (~20 s each
// warm on the Mac mini), so one lease (15 minutes) always suffices; the rest
// stay queued for the next job.
export const ASSISTED_PER_JOB=20;
// graph.finish output caps. With these caps the largest valid payload is
// ~13 MiB; the worker route accepts up to 16 MiB for graph.finish only.
export const GRAPH_CAPS={entities:1500,edges:3000,evidence:3000,key:400,label:400,attrs:1000,edgeAttrs:500,quote:1000};
export const GRAPH_FINISH_MAX_BYTES=16*1024*1024;
// Rule extractors are deterministic and read fixed fields; every other
// extractor (model-assisted or unknown) stays below them in confidence.
const RULE_EXTRACTORS=new Set(['document-rules-v1','platform-v1']);
const ENTITY_KINDS=new Set(['course','section','activity','deadline','requirement','document_version','person','place','policy','service']);
const RELATIONS=new Set(['applies_to','supersedes','due_at','part_of','requires']);
const MODEL_MAX=0.9;

// Call inside the transaction that saves the version. Never fails the save.
export async function queueGraphExtraction(c:PoolClient,user:string,source:string,version:string,body:string){
 if(!knowledgeGraphEnabled()||!body.trim())return false;
 let open=false;
 try{
  await c.query('SAVEPOINT graph_queue');open=true;
  const s=(await c.query('SELECT course_id,kind FROM schoolvault.sources WHERE user_id=$1 AND id=$2',[user,source])).rows[0];
  if(!s?.course_id||s.kind==='ai_draft'){await c.query('RELEASE SAVEPOINT graph_queue');return false;}
  // Joining a waiting job appends this version and keeps the newest ${MAX_PENDING} in save order.
  await c.query(`INSERT INTO schoolvault.jobs(user_id,id,kind,request_id,input) VALUES($1,$2,'graph',$3,$4::jsonb)
   ON CONFLICT (user_id,(input->>'course_id')) WHERE kind='graph' AND status='queued'
   DO UPDATE SET input=jsonb_set(schoolvault.jobs.input,'{versions}',(SELECT coalesce(jsonb_agg(x ORDER BY o),'[]'::jsonb) FROM (
     SELECT x,o FROM jsonb_array_elements(coalesce(schoolvault.jobs.input->'versions','[]'::jsonb)||CASE WHEN coalesce(schoolvault.jobs.input->'versions','[]'::jsonb) ? $5::text THEN '[]'::jsonb ELSE jsonb_build_array($5::text) END) WITH ORDINALITY t(x,o)
     ORDER BY o DESC LIMIT ${MAX_PENDING}) newest)),updated_at=now()`,
   [user,randomUUID(),randomUUID(),JSON.stringify({task:graphTask,course_id:s.course_id,versions:[version]}),version]);
  await c.query('RELEASE SAVEPOINT graph_queue');return true;
 }catch{
  if(open){try{await c.query('ROLLBACK TO SAVEPOINT graph_queue');await c.query('RELEASE SAVEPOINT graph_queue');}catch{/* the save's own error handling decides */}}
  return false;
 }
}

const newest=(versions:string[])=>{const seen=new Set<string>(),out:string[]=[];for(const v of versions)if(typeof v==='string'&&!seen.has(v)){seen.add(v);out.push(v);}return out.slice(-MAX_PENDING);};

// Put versions back in the course's queue: join the waiting job when there is
// one (the unique index allows only one), else queue `job` itself (or a new job).
// Returns 'merged' | 'requeued' | 'inserted'.
async function requeueVersions(c:PoolClient,user:string,course:string,versions:string[],job?:{id:string;input:any}){
 const sibling=(await c.query("SELECT id,input FROM schoolvault.jobs WHERE user_id=$1 AND kind='graph' AND status='queued' AND input->>'course_id'=$2 AND id IS DISTINCT FROM $3 FOR UPDATE",[user,course,job?.id??null])).rows[0];
 if(sibling){
  await c.query("UPDATE schoolvault.jobs SET input=jsonb_set(input,'{versions}',$3::jsonb),updated_at=now() WHERE user_id=$1 AND id=$2",[user,sibling.id,JSON.stringify(newest([...versions,...(sibling.input.versions||[])]))]);
  return 'merged';
 }
 if(job){
  await c.query("UPDATE schoolvault.jobs SET status='queued',input=jsonb_set(input,'{versions}',$3::jsonb),lease_hash=NULL,lease_until=NULL,updated_at=now() WHERE user_id=$1 AND id=$2",[user,job.id,JSON.stringify(newest(versions))]);
  return 'requeued';
 }
 if(!versions.length)return 'merged';
 await c.query("INSERT INTO schoolvault.jobs(user_id,id,kind,request_id,input) VALUES($1,$2,'graph',$3,$4::jsonb)",[user,randomUUID(),randomUUID(),JSON.stringify({task:graphTask,course_id:course,versions:newest(versions)})]);
 return 'inserted';
}

async function courseMaterial(c:PoolClient,user:string,course:string){
 const courses=(await c.query('SELECT id,code,title FROM schoolvault.courses WHERE user_id=$1 AND id=$2',[user,course])).rows;
 const versions=(await c.query(`SELECT v.source_id,v.id AS version_id,s.title,s.course_id,v.observed_at FROM schoolvault.source_versions v
  JOIN schoolvault.sources s ON s.user_id=v.user_id AND s.id=v.source_id
  WHERE v.user_id=$1 AND s.course_id=$2 AND s.kind!='ai_draft' ORDER BY v.observed_at,v.id LIMIT ${MAX_VERSIONS}`,[user,course])).rows.map(r=>({...r,observed_at:new Date(r.observed_at).toISOString()}));
 const sources=(await c.query(`SELECT s.id,s.course_id,s.kind,s.title,v.id AS version_id,v.body,v.observed_at FROM schoolvault.sources s
  JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.id=s.current_version
  WHERE s.user_id=$1 AND s.course_id=$2 AND s.kind!='ai_draft' AND btrim(v.body)!='' ORDER BY s.title,s.id LIMIT ${MAX_SOURCES}`,[user,course])).rows;
 return {courses,versions,sources};
}

export async function leaseGraphExtraction(){
 if(!knowledgeGraphEnabled())return null;
 for(const user of (await betaPool().query('SELECT id,timezone FROM schoolvault.users WHERE disabled_at IS NULL ORDER BY created_at,id')).rows){
  const job=await tenant(user.id,async c=>{
   await c.query("UPDATE schoolvault.jobs SET status='failed',error='Graph extraction could not finish.',lease_hash=NULL,lease_until=NULL,updated_at=now() WHERE user_id=$1 AND kind='graph' AND status='leased' AND lease_until<now() AND attempts>=3",[user.id]);
   // An expired lease whose course already has a waiting job hands its versions to that job.
   for(const stale of (await c.query("SELECT j.id,j.input FROM schoolvault.jobs j WHERE j.user_id=$1 AND j.kind='graph' AND j.status='leased' AND j.lease_until<now() AND EXISTS(SELECT 1 FROM schoolvault.jobs q WHERE q.user_id=j.user_id AND q.kind='graph' AND q.status='queued' AND q.input->>'course_id'=j.input->>'course_id') FOR UPDATE OF j SKIP LOCKED",[user.id])).rows){
    await requeueVersions(c,user.id,stale.input.course_id,stale.input.versions||[],{id:stale.id,input:stale.input});
    await c.query("UPDATE schoolvault.jobs SET status='cancelled',error='Merged into the waiting graph job.',lease_hash=NULL,lease_until=NULL,updated_at=now() WHERE user_id=$1 AND id=$2",[user.id,stale.id]);
   }
   const j=(await c.query("SELECT * FROM schoolvault.jobs WHERE user_id=$1 AND kind='graph' AND (status='queued' OR status='leased' AND lease_until<now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",[user.id])).rows[0];
   if(!j)return null;
   const lease=user.id+'.'+j.id+'.'+randomBytes(32).toString('base64url');
   await c.query("UPDATE schoolvault.jobs SET status='leased',lease_hash=$3,lease_until=now()+interval '15 minutes',attempts=attempts+1,updated_at=now() WHERE user_id=$1 AND id=$2",[user.id,j.id,hash(lease)]);
   const m=await courseMaterial(c,user.id,j.input.course_id);
   const pending=new Set<string>(j.input.versions||[]);
   // Newest pending versions first; anything over the per-job cap is re-queued at finish.
   const assisted=m.sources.filter(s=>pending.has(s.version_id)).map(s=>s.version_id).sort((a,b)=>(j.input.versions as string[]).lastIndexOf(b)-(j.input.versions as string[]).lastIndexOf(a)).slice(0,ASSISTED_PER_JOB);
   await c.query("UPDATE schoolvault.jobs SET input=jsonb_set(input,'{assisted}',$3::jsonb) WHERE user_id=$1 AND id=$2",[user.id,j.id,JSON.stringify(assisted)]);
   return {lease,job_id:j.id,task:graphTask,course_id:j.input.course_id,timezone:user.timezone||'UTC',
    platform:{courses:m.courses,versions:m.versions},
    sources:m.sources.map(s=>({id:s.id,course_id:s.course_id,kind:s.kind,title:s.title,version_id:s.version_id,excerpt:String(s.body).slice(0,MAX_BODY),observed_at:new Date(s.observed_at).toISOString()})),
    // The model proposer reads only versions that are new since the last run.
    assisted_versions:assisted};
  });
  if(job)return job;
 }
 return null;
}

function leaseParts(raw:unknown){
 if(typeof raw!=='string')throw new BetaHttpError('Invalid lease');
 const p=raw.split('.');if(p.length!==3||!uuid(p[0])||!uuid(p[1])||!/^[A-Za-z0-9_-]{43}$/.test(p[2]))throw new BetaHttpError('Invalid lease');return p;
}

type Checked={extraction:Extraction;rejected:Record<string,number>};
// Server-side re-validation of worker output. Exported for tests.
export function checkGraphOutput(output:any,course:string,proofs:Map<string,{source_id:string;body:string|null;title?:string|null}>):Checked{
 const rejected:Record<string,number>={};const reject=(why:string)=>{rejected[why]=(rejected[why]||0)+1;};
 const arr=(v:unknown,max:number)=>Array.isArray(v)?v.slice(0,max):[];
 const num=(v:unknown)=>{const n=Number(v);return Number.isFinite(n)&&n>=0&&n<=1?n:null;};
 const proofOk=(r:any)=>{
  if(r.version_id!=null){const p=proofs.get(r.version_id);return !!p&&p.source_id===r.source_id&&r.proof_ref==null;}
  return typeof r.proof_ref==='string'&&r.proof_ref===('schoolvault.courses:'+course)&&r.source_id==null;
 };
 const confOk=(r:any)=>{const n=num(r.confidence);return n!=null&&(RULE_EXTRACTORS.has(r.extractor)||n<=MODEL_MAX);};
 const entities:GraphEntity[]=[];const keys=new Set<string>();
 for(const e of arr(output?.entities,GRAPH_CAPS.entities)){
  if(!e||typeof e.key!=='string'||e.key.length>GRAPH_CAPS.key||!ENTITY_KINDS.has(e.kind)||typeof e.label!=='string'||!e.label.trim()||e.label.length>GRAPH_CAPS.label){reject('entity_shape');continue;}
  if(e.course_id!==course||!(e.key.includes(course)||e.kind==='document_version'&&e.key==='document_version:'+e.version_id)){reject('entity_course');continue;}
  if(!['platform','document'].includes(e.authority)||typeof e.extractor!=='string'||!e.extractor||e.extractor.length>80||!confOk(e)){reject('entity_authority');continue;}
  if(!e.attrs||typeof e.attrs!=='object'||Array.isArray(e.attrs)||JSON.stringify(e.attrs).length>GRAPH_CAPS.attrs){reject('entity_attrs');continue;}
  if(!proofOk(e)){reject('entity_proof');continue;}
  if(keys.has(e.key)){reject('entity_duplicate');continue;}
  keys.add(e.key);entities.push({key:e.key,kind:e.kind,label:e.label,attrs:e.attrs,course_id:course,source_id:e.source_id??null,version_id:e.version_id??null,proof_ref:e.proof_ref??null,authority:e.authority,extractor:e.extractor,confidence:Number(e.confidence)});
 }
 const edges:GraphEdge[]=[];const edgeKeys=new Set<string>();
 for(const e of arr(output?.edges,GRAPH_CAPS.edges)){
  if(!e||!RELATIONS.has(e.relation)||typeof e.from!=='string'||typeof e.to!=='string'||e.from===e.to){reject('edge_shape');continue;}
  if(!keys.has(e.from)||!keys.has(e.to)){reject('edge_dangling');continue;}
  if(!['platform','document'].includes(e.authority)||typeof e.extractor!=='string'||!e.extractor||!confOk(e)||!e.attrs||typeof e.attrs!=='object'||Array.isArray(e.attrs)||JSON.stringify(e.attrs).length>GRAPH_CAPS.edgeAttrs){reject('edge_authority');continue;}
  if(!proofOk(e)){reject('edge_proof');continue;}
  edgeKeys.add(JSON.stringify([e.relation,e.from,e.to]));
  edges.push({relation:e.relation,from:e.from,to:e.to,attrs:e.attrs,source_id:e.source_id??null,version_id:e.version_id??null,proof_ref:e.proof_ref??null,authority:e.authority,extractor:e.extractor,confidence:Number(e.confidence)});
 }
 const evidence:GraphEvidence[]=[];
 for(const v of arr(output?.evidence,GRAPH_CAPS.evidence)){
  const target=typeof v?.entity==='string'?(keys.has(v.entity)?'entity':null):Array.isArray(v?.edge)?(edgeKeys.has(JSON.stringify(v.edge))?'edge':null):null;
  if(!target){reject('evidence_target');continue;}
  const p=proofs.get(v.version_id);
  if(!p||p.source_id!==v.source_id||p.body==null){reject('evidence_proof');continue;}
  // Workers pin against title+body; the server re-derives offsets in the stored
  // body. A quote that is only the source title is kept without offsets.
  if(typeof v.quote!=='string'||!v.quote.trim()||v.quote.length>GRAPH_CAPS.quote){reject('evidence_quote');continue;}
  const hint=Number.isSafeInteger(v.char_start)?v.char_start:-1;
  let start=p.body.slice(hint,hint+v.quote.length)===v.quote?hint:p.body.indexOf(v.quote);
  if(start<0&&v.quote.trim()!==(p.title||'').trim()){reject('evidence_quote');continue;}
  const offsets=start<0?{char_start:null,char_end:null}:{char_start:start,char_end:start+v.quote.length};
  if(typeof v.extractor!=='string'||!confOk(v)){reject('evidence_authority');continue;}
  evidence.push({...(target==='entity'?{entity:v.entity}:{edge:v.edge as [string,string,string]}),source_id:v.source_id,version_id:v.version_id,quote:v.quote,...offsets,extractor:v.extractor,confidence:Number(v.confidence)});
 }
 return {extraction:{entities,edges,evidence},rejected};
}

// Facts proved only by a version that is no longer current are closed (kept as history).
async function closeSuperseded(c:PoolClient,user:string,course:string,now:Date){
 const stale=(await c.query(`UPDATE schoolvault.kg_entities e SET valid_to=$3 FROM schoolvault.sources s
  WHERE e.user_id=$1 AND e.course_id=$2 AND e.valid_to IS NULL AND e.kind!='document_version' AND e.version_id IS NOT NULL
  AND s.user_id=e.user_id AND s.id=e.source_id AND s.current_version IS DISTINCT FROM e.version_id AND e.valid_from<$3 RETURNING e.id`,[user,course,now])).rows.map(r=>r.id);
 const edges=await c.query(`UPDATE schoolvault.kg_edges g SET valid_to=$3 WHERE g.user_id=$1 AND g.valid_to IS NULL AND g.valid_from<$3 AND (
  g.from_entity=ANY($2::uuid[]) OR g.to_entity=ANY($2::uuid[]) OR g.relation!='supersedes' AND g.version_id IS NOT NULL AND EXISTS(
   SELECT 1 FROM schoolvault.sources s WHERE s.user_id=g.user_id AND s.id=g.source_id AND s.course_id=$4 AND s.current_version IS DISTINCT FROM g.version_id))`,[user,stale,now,course]);
 return {entities_superseded:stale.length,edges_superseded:edges.rowCount??0};
}

export async function finishGraphExtraction(raw:unknown,output:any){
 const [user,id]=leaseParts(raw);
 return tenant(user,async c=>{
  const job=(await c.query('SELECT * FROM schoolvault.jobs WHERE user_id=$1 AND id=$2 FOR UPDATE',[user,id])).rows[0];
  if(!job||job.kind!=='graph'||job.status!=='leased'||job.lease_hash!==hash(raw as string)||Date.parse(job.lease_until)<=Date.now())throw new BetaHttpError('Graph lease expired.',409);
  if(output?.error){
   if(job.attempts>=3){
    await c.query("UPDATE schoolvault.jobs SET status='failed',error='Graph extraction failed.',lease_hash=NULL,lease_until=NULL,updated_at=now() WHERE user_id=$1 AND id=$2",[user,id]);
    return {saved:true,status:'failed'};
   }
   // Retry. A newer waiting job for the course takes these versions (the unique
   // index allows only one queued job per course); this one is then closed.
   const how=await requeueVersions(c,user,job.input.course_id,job.input.versions||[],{id,input:job.input});
   if(how==='merged')await c.query("UPDATE schoolvault.jobs SET status='cancelled',error='Merged into the waiting graph job.',lease_hash=NULL,lease_until=NULL,updated_at=now() WHERE user_id=$1 AND id=$2",[user,id]);
   return {saved:true,status:'retry',requeue:how};
  }
  const course=job.input.course_id as string;
  // Proof table: every version of this course; bodies for current versions only.
  const rows=(await c.query(`SELECT v.id,v.source_id,s.title,CASE WHEN s.current_version=v.id THEN v.body END AS body FROM schoolvault.source_versions v
   JOIN schoolvault.sources s ON s.user_id=v.user_id AND s.id=v.source_id WHERE v.user_id=$1 AND s.course_id=$2 AND s.kind!='ai_draft'`,[user,course])).rows;
  const proofs=new Map(rows.map(r=>[r.id as string,{source_id:r.source_id as string,body:r.body as string|null,title:r.title as string|null}]));
  const checked=checkGraphOutput(output,course,proofs);
  const now=new Date();
  const stats=await storeExtraction(c,user,checked.extraction,now);
  const superseded=await closeSuperseded(c,user,course,now);
  const assisted=output?.assisted&&typeof output.assisted==='object'?{proposer:String(output.assisted.proposer||'').slice(0,80),model:String(output.assisted.model||'').slice(0,80),versions:Number(output.assisted.versions)||0,candidates:Number(output.assisted.candidates)||0,rejected:Number(output.assisted.rejected)||0,ms:Number(output.assisted.ms)||0}:null;
  const result={task:graphTask,course_id:course,stats,...superseded,rejected:checked.rejected,assisted,entities:checked.extraction.entities.length,edges:checked.extraction.edges.length,evidence:checked.extraction.evidence.length};
  // Versions beyond this job's model-reading cap go back to the queue.
  const read=new Set<string>(job.input.assisted||[]),current=new Set(rows.filter(r=>r.body!=null).map(r=>r.id as string));
  const left=(job.input.versions||[]).filter((v:string)=>!read.has(v)&&current.has(v));
  const requeued=left.length>0&&(job.input.assisted||[]).length>=ASSISTED_PER_JOB?await requeueVersions(c,user,course,left):null;
  const stored:typeof result&{requeued_versions?:number}={...result,...(requeued?{requeued_versions:left.length}:{})};
  await c.query("UPDATE schoolvault.jobs SET status='complete',result=$3,error=NULL,lease_hash=NULL,lease_until=NULL,updated_at=now() WHERE user_id=$1 AND id=$2",[user,id,stored]);
  return {saved:true,status:'complete',result:stored};
 });
}

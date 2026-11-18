// Hybrid retrieval (workstream B3) and reranking (B4).
//
// Keyword ranking is the unchanged production SQL (search.ts). Vector ranking
// scores each current, in-scope passage against the question embedding. Both
// rankings are restricted by the same tenant, course and source-authority
// filters BEFORE ranking (SQL WHERE in a materialized CTE, plus RLS). The two
// source orders are fused with reciprocal rank fusion; an optional local
// cross-encoder then reorders the fused candidates inside a latency budget.
//
// Off by default: with NEYVU_RETRIEVAL unset this returns the keyword rows
// untouched, so production behaviour is identical. With the default worker
// site (NEYVU_RETRIEVAL_SITE unset) the web process only records the keyword
// stage here; lib/beta/worker-retrieval.ts pins the candidates and the AI
// worker adds the vector, fusion and rerank stages beside its local models.
import type {PoolClient} from 'pg';
import {searchSql} from './search';
import {retrievalConfigFor,type RetrievalConfig} from './retrieval-config';
import {embedTexts,rerankScores,vectorLiteral} from './embedding-client';
import {embeddingText} from './chunking';

export type RetrievalTrace={
 calls:{
  question:string;course_id:string|null;mode:'keyword'|'hybrid';site?:'web'|'worker';deferred?:'worker';fallback?:string;
  keyword:{ids:string[];ms:number};
  vector?:{ids:string[];ms:number;model:string};
  fused?:string[];
  rerank?:{applied:boolean;ms:number;reason?:string;model?:string};
  chunks:{source_id:string;version_id:string;passage_id:string|null;ordinal:number|null;section:string|null;keyword_rank:number|null;vector_rank:number|null;similarity:number|null;rerank_score:number|null}[];
 }[];
};
export const newRetrievalTrace=():RetrievalTrace=>({calls:[]});

// Scope first, then rank: only current versions of this tenant's in-scope,
// non-AI-draft sources are compared with the query vector.
export const vectorSearchSql=String.raw`WITH src AS MATERIALIZED (
 SELECT s.id,s.current_version FROM schoolvault.sources s
 WHERE s.user_id=$1 AND ($2::uuid IS NULL OR s.course_id=$2) AND s.kind!='ai_draft' AND s.current_version IS NOT NULL
),
cand AS MATERIALIZED (
 SELECT p.source_id,p.id AS passage_id,p.ordinal,p.section,p.body,p.context_header,e.embedding
 FROM src JOIN schoolvault.passages p ON p.user_id=$1 AND p.source_id=src.id AND p.version_id=src.current_version
 JOIN schoolvault.passage_embeddings e ON e.user_id=$1 AND e.passage_id=p.id AND e.model=$3
),
ranked AS (
 SELECT source_id,passage_id,ordinal,section,body,context_header,1-(embedding<=>$4::vector) AS similarity,
  row_number() OVER (PARTITION BY source_id ORDER BY embedding<=>$4::vector,ordinal) AS rn
 FROM cand
)
SELECT source_id,passage_id,ordinal,section,body,context_header,similarity::float8 AS similarity FROM ranked WHERE rn=1 ORDER BY similarity DESC,source_id LIMIT $5`;

// Rows in the same shape as searchSql for sources found only by the vector side.
const sourceRowsSql=String.raw`SELECT s.id,s.title,s.course_id,s.kind,s.original_url,v.id AS version_id,v.observed_at,0::float8 AS score,v.body AS full_body,
 coalesce((SELECT json_agg(json_build_object('ordinal',p.ordinal,'body',p.body) ORDER BY p.ordinal) FROM schoolvault.passages p WHERE p.user_id=$1 AND p.id=ANY($3::uuid[]) AND p.source_id=s.id),'[]') AS passages
 FROM schoolvault.sources s JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.id=s.current_version
 WHERE s.user_id=$1 AND s.id=ANY($2::uuid[]) AND s.kind!='ai_draft'`;

export function reciprocalRankFusion(orders:string[][],k=60,weights:number[]=[]){
 const score=new Map<string,number>();
 orders.forEach((order,o)=>{const w=weights[o]??1;order.forEach((id,i)=>score.set(id,(score.get(id)||0)+w/(k+i+1)));});
 return [...score.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(([id,s])=>({id,score:s}));
}

// Source authority (owner-approved Nov 12): the keyword SQL already prefers course
// material, but the vector ranking and the cross-encoder do not, so student notes
// could push the instructor's material out of the evidence. 2 = course material
// (Moodle and LMS captures, files uploaded or fetched: students upload lecture
// slides and handouts too), 1 = course email, 0 = a student note. Source kinds
// from migration 033; ai_draft never reaches retrieval. The worker receives this
// tier per candidate (worker_retrieval.py does not recompute it).
export const authorityTier=(row:{kind?:string|null})=>row.kind==='note'?0:row.kind==='email'?1:2;
// Same rule as scripts/worker_retrieval.py authority_order.
export function authorityBoosted<T extends {id:string;score:number}>(fused:T[],tiers:Map<string,number>,boost:number){
 if(!(boost>0))return fused;
 return fused.map((f,i)=>({f,s:f.score*(1+boost*(tiers.get(f.id)??2)/2),i})).sort((a,b)=>b.s-a.s||a.i-b.i).map(x=>x.f);
}
// Reranked head: score + weight*tier, then one tier-2 source kept in the first
// three when the head had one. Same rule as worker_retrieval.authority_rerank.
export function authorityRerank<T extends {kind?:string|null}>(head:T[],scores:number[],weight:number){
 const order=head.map((r,i)=>({r,s:scores[i]+weight*authorityTier(r),i})).sort((a,b)=>b.s-a.s||a.i-b.i).map(o=>o.r);
 if(weight>0&&order.length>3&&!order.slice(0,3).some(r=>authorityTier(r)===2)){
  const k=order.findIndex(r=>authorityTier(r)===2);
  if(k>2){const [official]=order.splice(k,1);order.splice(2,0,official);}
 }
 return order;
}

async function timed<T>(fn:()=>Promise<T>){const t=performance.now();const value=await fn();return {value,ms:Math.round(performance.now()-t)};}

// Returns rows in searchSql's shape and order. `question` is the student's
// wording (used for the embedding and the reranker); `ranking`/`expanded` are
// the existing keyword expansions.
let vectorReady:boolean|undefined;
export async function vectorColumnReady(c:{query:(sql:string)=>Promise<{rows:any[]}>}){
 if(vectorReady===undefined)vectorReady=(await c.query("SELECT format_type(atttypid,atttypmod)='vector' AS ready FROM pg_attribute WHERE attrelid='schoolvault.passage_embeddings'::regclass AND attname='embedding'")).rows[0]?.ready===true;
 return vectorReady;
}

export async function retrieveSourceRows(c:PoolClient,user:string,args:{question:string;ranking:string;expanded:string;courseId:string|null},trace?:RetrievalTrace,cfg:RetrievalConfig=retrievalConfigFor(user)){
 const keyword=await timed(async()=>(await c.query(searchSql,[user,args.ranking,args.courseId,args.expanded])).rows);
 const call:RetrievalTrace['calls'][number]={question:args.question.slice(0,500),course_id:args.courseId,mode:cfg.mode,keyword:{ids:keyword.value.map(r=>r.id),ms:keyword.ms},chunks:[]};
 trace?.calls.push(call);
 const finish=(rows:any[],vector?:Map<string,any>,vectorRank?:Map<string,number>,rerank?:Map<string,number>)=>{
  const kw=new Map(keyword.value.map((r,i)=>[r.id,i+1]));
  call.chunks=rows.map(r=>{const v=vector?.get(r.id);return {source_id:r.id,version_id:r.version_id,passage_id:v?.passage_id||null,ordinal:v?.ordinal??null,section:v?.section||null,keyword_rank:kw.get(r.id)||null,vector_rank:vectorRank?.get(r.id)||null,similarity:v?Math.round(v.similarity*10000)/10000:null,rerank_score:rerank?.get(r.id)??null};});
  return rows;
 };
 if(cfg.mode!=='hybrid')return finish(keyword.value);
 // Production: the web app cannot reach the embed service on the worker
 // machine. Keyword order stands here; the worker ranks the pinned pool.
 if(cfg.site==='worker'){call.site='worker';call.deferred='worker';return finish(keyword.value);}
 call.site='web';
 let queryVector:number[];
 try{queryVector=(await embedTexts([args.question],'query',cfg,3000)).vectors[0];}
 catch{call.fallback='embed_unavailable';return finish(keyword.value);}
 // Migration 030 falls back to real[] where pgvector could not be created; then
 // vector search is unavailable and the answer keeps the keyword ranking.
 if(!(await vectorColumnReady(c))){call.fallback='vector_unavailable';return finish(keyword.value);}
 const vector=await timed(async()=>(await c.query(vectorSearchSql,[user,args.courseId,cfg.embedModel,vectorLiteral(queryVector),cfg.candidates])).rows);
 call.vector={ids:vector.value.map(r=>r.source_id),ms:vector.ms,model:cfg.embedModel};
 const vectorBy=new Map(vector.value.map(r=>[r.source_id,r])),vectorRank=new Map(vector.value.map((r,i)=>[r.source_id as string,i+1]));
 const fused=reciprocalRankFusion([keyword.value.map(r=>r.id),vector.value.map(r=>r.source_id)],cfg.rrfK,[1,cfg.vectorWeight]).slice(0,cfg.candidates);
 call.fused=fused.map(f=>f.id);
 const have=new Map(keyword.value.map(r=>[r.id,r]));
 const missing=fused.filter(f=>!have.has(f.id)).map(f=>f.id);
 if(missing.length)for(const row of (await c.query(sourceRowsSql,[user,missing,missing.map(id=>vectorBy.get(id)?.passage_id).filter(Boolean)])).rows)have.set(row.id,row);
 const ordered=authorityBoosted(fused,new Map(fused.map(f=>[f.id,have.has(f.id)?authorityTier(have.get(f.id)):2])),cfg.authorityBoost);
 if(cfg.authorityBoost>0)call.fused=ordered.map(f=>f.id);
 let rows=ordered.map(f=>have.get(f.id)&&{...have.get(f.id),keyword_score:have.get(f.id).score,score:Math.round(f.score*1e6)/1e4}).filter(Boolean) as any[];
 let rerank:Map<string,number>|undefined;
 if(cfg.rerank&&rows.length>1){
  // Only the head of the fused order is reranked (CPU budget); the tail keeps its fused order.
  const head=rows.slice(0,cfg.rerankCandidates),tail=rows.slice(cfg.rerankCandidates);
  const docs=head.map(r=>{const v=vectorBy.get(r.id);const passage=v?.body||(r.passages?.[0]?.body)||r.full_body||'';return embeddingText(v?.context_header||`Document: ${r.title}`,String(passage).slice(0,cfg.rerankChars));});
  const t=performance.now();
  try{
   const scores=await rerankScores(args.question,docs,cfg,cfg.rerankBudgetMs);
   rerank=new Map(head.map((r,i)=>[r.id,Math.round(scores[i]*1e4)/1e4]));
   rows=[...authorityRerank(head,scores,cfg.rerankAuthority),...tail];
   call.rerank={applied:true,ms:Math.round(performance.now()-t),model:'local-cross-encoder'};
  }catch(error){call.rerank={applied:false,ms:Math.round(performance.now()-t),reason:error instanceof Error&&error.name==='AbortError'?'budget_exceeded':'unavailable'};}
 }
 return finish(rows,vectorBy,vectorRank,rerank);
}

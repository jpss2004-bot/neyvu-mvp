// Answer traces (workstream B6): "Why this answer". One tenant-private row per
// completed answer, written in finishAnswer when NEYVU_ANSWER_TRACE=1. Holds
// identifiers, ranks, scores, guard outcomes and timings — never prompt text.
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {retrievalConfig} from './retrieval-config';
import {uuid} from './db';

const num=(v:unknown,max=1e9)=>typeof v==='number'&&Number.isFinite(v)&&v>=-max&&v<=max?v:null;
const str=(v:unknown,max:number)=>typeof v==='string'?v.slice(0,max):null;

// Bounded, validated copy of the worker's output.trace (untrusted input).
export function workerTrace(raw:any){
 if(!raw||typeof raw!=='object'||raw.format!=='answer-trace/1')return {guards:[],timings:{}};
 const guards=(Array.isArray(raw.guards)?raw.guards:[]).slice(0,20).map((g:any)=>({guard:str(g?.guard,60),calls:num(g?.calls,1e6),changed:num(g?.changed,1e6),ms:num(g?.ms),chars_delta:num(g?.chars_delta)})).filter((g:any)=>g.guard&&/^[a-z_]+\.[a-z_]+$/.test(g.guard));
 const timings:Record<string,number>={};
 for(const [k,v] of Object.entries(raw.timings||{}).slice(0,20))if(/^[a-z_]{1,40}$/.test(k)&&num(v)!==null)timings[k]=v as number;
 return {guards,timings,model_requests:num(raw.model_requests,1000)};
}

export function buildAnswerTrace(job:any,output:any,sources:any[],result:any){
 const input=job.input||{};
 const rt=input.retrieval_trace||{calls:[]};
 const pinned=new Map<string,number>(sources.map((s:any,i:number)=>[s.id,i+1]));
 const cited=new Set<number>([...String(output.text||'').matchAll(/\[(\d{1,2})\]/g)].map(m=>Number(m[1])));
 // Chunks the retriever ranked that became the answer's numbered sources.
 const seen=new Set<string>();
 const chunks=[] as any[];
 for(const call of rt.calls||[])for(const ch of call.chunks||[]){
  if(!pinned.has(ch.source_id)||seen.has(ch.source_id))continue;seen.add(ch.source_id);
  const n=pinned.get(ch.source_id)!;
  chunks.push({...ch,source_number:n,cited:cited.has(n)});
 }
 // Sources that reached the answer by another route (selected, work, plan, policy).
 for(const [id,n] of pinned)if(!seen.has(id)){const s=sources[n-1];chunks.push({source_id:id,version_id:s.version_id||null,title:String(s.title||'').slice(0,200),source_number:n,cited:cited.has(n),route:'non_search'});}
 for(const ch of chunks)if(!ch.title){const s=sources[ch.source_number-1];ch.title=String(s?.title||'').slice(0,200);}
 const facts=[
  ...((input.work?.assessments||[]) as any[]).slice(0,40).map(a=>({kind:'assessment',source_id:a.sourceId||null,version_id:a.version||null,date:str(a.date,40),source_kind:str(a.sourceKind,40),title:str(a.title,200)})),
  ...(result.content?.calculation?[{kind:'calculation',checked:true}]:[]),
 ];
 const w=workerTrace(output.trace);
 return {
  question:String(input.question||'').slice(0,4000),
  rewritten_question:str(input.prepared_question||input.retrieval_query||rt.retrieval_question||input.retrieval_question,4000),
  retrieval:{mode:rt.calls?.[0]?.mode||'keyword',calls:(rt.calls||[]).map((c:any)=>({mode:c.mode,course_id:c.course_id,fallback:c.fallback||null,keyword:c.keyword,vector:c.vector||null,fused:c.fused||null,rerank:c.rerank||null})),retrieval_ms:num(rt.retrieval_ms)},
  chunks,facts,guards:w.guards,
  model:str(output.model,160),
  timings:{...w.timings,...(num(rt.retrieval_ms)!==null?{retrieval_ms:rt.retrieval_ms}:{}),...(w.model_requests!==null?{model_requests:w.model_requests}:{})},
  input_tokens:output.input_tokens,output_tokens:output.output_tokens,
  cost_usd:num(result.estimated_cost_usd)??0,
 };
}

export async function writeAnswerTrace(c:PoolClient,user:string,job:any,output:any,sources:any[],result:any){
 if(!retrievalConfig().trace)return null;
 const t=buildAnswerTrace(job,output,sources,result);
 const id=randomUUID();
 await c.query('SAVEPOINT answer_trace');
 try{
  await c.query(`INSERT INTO schoolvault.answer_traces(user_id,id,job_id,chat_id,question,rewritten_question,retrieval,chunks,facts,guards,model,timings,input_tokens,output_tokens,cost_usd)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT (user_id,job_id) DO NOTHING`,
   [user,id,job.id,job.chat_id,t.question,t.rewritten_question,t.retrieval,JSON.stringify(t.chunks),JSON.stringify(t.facts),JSON.stringify(t.guards),t.model,t.timings,t.input_tokens,t.output_tokens,t.cost_usd]);
  await c.query('RELEASE SAVEPOINT answer_trace');return id;
 }catch{await c.query('ROLLBACK TO SAVEPOINT answer_trace');await c.query('RELEASE SAVEPOINT answer_trace');return null;}
}

// Read for the owner only: RLS plus the explicit user filter.
export async function readAnswerTrace(c:Pick<PoolClient,'query'>,user:string,jobId:string){
 if(!uuid(jobId))throw Error('Invalid item');
 return (await c.query('SELECT job_id,question,rewritten_question,retrieval,chunks,facts,guards,model,timings,input_tokens,output_tokens,cost_usd::float8 AS cost_usd,created_at FROM schoolvault.answer_traces WHERE user_id=$1 AND job_id=$2',[user,jobId])).rows[0]||null;
}

// B6 smoke: write an answer trace for a synthetic answer job, read it back as
// the owner, and prove another tenant cannot read it under the runtime role (RLS).
//   NEYVU_TRACE_SMOKE_ADMIN_URL=postgres://postgres@127.0.0.1:55470/neyvu_retrieval_eval node_modules/.bin/tsx services/answer/retrieval/trace_smoke.ts
// Run after eval.ts (uses its synthetic tenants). Loopback only.
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {Client} from 'pg';
import {writeAnswerTrace,readAnswerTrace} from '../../../lib/beta/answer-trace';
import {searchBetaSources} from '../../../lib/beta/vault';
import {newRetrievalTrace} from '../../../lib/beta/hybrid-search';

async function main(){
 const url=new URL(process.env.NEYVU_TRACE_SMOKE_ADMIN_URL||'');
 if(!['127.0.0.1','localhost'].includes(url.hostname))throw Error('Loopback only');
 process.env.NEYVU_ANSWER_TRACE='1';
 const admin=new Client({connectionString:url.href});await admin.connect();
 await admin.query("DO $$BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='neyvu_trace_smoke') THEN CREATE ROLE neyvu_trace_smoke LOGIN IN ROLE schoolvault_web; END IF; END$$");
 const users=(await admin.query('SELECT id FROM schoolvault.users ORDER BY email')).rows.map(r=>r.id);
 const [alpha,beta]=users;
 const course=(await admin.query("SELECT id FROM schoolvault.courses WHERE user_id=$1 AND code LIKE '%1010%'",[alpha])).rows[0].id;
 const rt=url.href.replace('postgres@','neyvu_trace_smoke@');
 const c=new Client({connectionString:rt});await c.connect();
 const as=async<T>(user:string,fn:()=>Promise<T>)=>{await c.query('BEGIN');await c.query("SELECT set_config('schoolvault.user_id',$1,true)",[user]);try{const v=await fn();await c.query('COMMIT');return v;}catch(e){await c.query('ROLLBACK');throw e;}};
 const chat=randomUUID(),job=randomUUID(),question='¿Cuál es la penalización por entregar tarde un informe de laboratorio?';
 const id=await as(alpha,async()=>{
  const trace=newRetrievalTrace();
  const sources=await searchBetaSources(c as any,alpha,question,course,trace);
  await c.query('INSERT INTO schoolvault.chats(user_id,id,course_id) VALUES($1,$2,$3)',[alpha,chat,course]);
  const input={question,retrieval_question:question,retrieval_trace:{...trace,retrieval_ms:12},work:{assessments:[{sourceId:sources[0].id,version:sources[0].version_id,date:'2026-10-10',sourceKind:'syllabus',title:'Lab 3'}]}};
  await c.query("INSERT INTO schoolvault.jobs(user_id,id,chat_id,kind,request_id,input,status) VALUES($1,$2,$3,'answer',$4,$5,'leased')",[alpha,job,chat,randomUUID(),input]);
  const output={text:'Late lab reports lose 10% per day [1].',model:'synthetic-model',input_tokens:900,output_tokens:40,trace:{format:'answer-trace/1',guards:[{guard:'citecheck.sanitize',calls:1,changed:0,ms:0.4},{guard:'dateguard.mark',calls:2,changed:1,ms:1.2,chars_delta:30}],timings:{sources_read_ms:5,generation_done_ms:2100,worker_total_ms:2150},model_requests:1}};
  const pinned=sources.slice(0,3);
  return writeAnswerTrace(c as any,alpha,{id:job,chat_id:chat,input},output,pinned,{estimated_cost_usd:0});
 });
 assert.ok(id,'trace written');
 const own=await as(alpha,()=>readAnswerTrace(c,alpha,job));
 assert.ok(own&&own.chunks.length>=1&&own.chunks[0].cited===true&&own.guards.length===2&&own.timings.retrieval_ms===12);
 const other=await as(beta,()=>readAnswerTrace(c,alpha,job));
 assert.equal(other,null,'other tenant must not read the trace');
 const raw=await as(beta,async()=>(await c.query('SELECT count(*)::int AS n FROM schoolvault.answer_traces')).rows[0].n);
 assert.equal(raw,0,'RLS hides every other tenant row');
 await assert.rejects(as(beta,()=>c.query("INSERT INTO schoolvault.answer_traces(user_id,id,job_id,question) VALUES($1,$2,$3,'x')",[alpha,randomUUID(),job])),'cross-tenant insert refused');
 console.log(JSON.stringify({trace_written:true,owner_reads:true,cross_tenant_read:'blocked',cross_tenant_insert:'blocked',chunks:own.chunks.map((ch:any)=>({n:ch.source_number,title:ch.title,section:ch.section,kw:ch.keyword_rank,vec:ch.vector_rank,cited:ch.cited})),mode:own.retrieval.mode,rerank:own.retrieval.calls[0].rerank}));
 await c.end();await admin.end();
}
main().catch(e=>{console.error(e);process.exitCode=1;});

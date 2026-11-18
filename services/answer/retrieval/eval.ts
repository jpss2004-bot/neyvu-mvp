// Retrieval scorecard (B1 baseline, B3/B4 comparison) on the synthetic bilingual fixture.
//
//   NEYVU_RETRIEVAL_EVAL_ADMIN_URL=postgres://postgres@127.0.0.1:55470/postgres \
//   node_modules/.bin/tsx services/answer/retrieval/eval.ts [--chunker legacy|structure] [--modes keyword,hybrid,rerank] [--out file.json]
//
// Creates (drops and recreates) the loopback database `neyvu_retrieval_eval`,
// applies every migration, loads the fixture through the real write path
// (sourceVersion → writePassages), backfills vectors, then runs the real
// searchBetaSources for every wording. Refuses any non-loopback URL.
//
// Metrics per mode:
//  recall@5 / recall@10  relevant source within the first k retrieval candidates
//  final@5               relevant source within the first 5 sources searchBetaSources returns
//  mrr                   on retrieval candidates
//  rephrase_same_doc     share of question groups whose top-1 source is identical for all 4 wordings
//  rephrase_all_correct  share of groups whose top-1 is relevant for all 4 wordings
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {Client} from 'pg';
import {sourceVersion,searchBetaSources} from '../../../lib/beta/vault';
import {newRetrievalTrace} from '../../../lib/beta/hybrid-search';
import {backfillTenantEmbeddings} from '../../../lib/beta/embedding-backfill';
import {retrievalConfig} from '../../../lib/beta/retrieval-config';

const uid=(s:string)=>{const h=createHash('sha256').update(s).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;};
const arg=(name:string,fallback:string)=>{const i=process.argv.indexOf(name);return i>0?process.argv[i+1]:fallback;};
const here=new URL('.',import.meta.url).pathname;

async function main(){
 const admin=new URL(process.env.NEYVU_RETRIEVAL_EVAL_ADMIN_URL||'');
 if(!['127.0.0.1','localhost'].includes(admin.hostname))throw Error('Only a loopback dev cluster is permitted');
 const chunker=arg('--chunker','legacy'),modes=arg('--modes','keyword').split(','),out=arg('--out','');
 const fixtureFile=arg('--fixture',here+'fixtures/retrieval-fixture.json');
 const raw=await readFile(fixtureFile,'utf8');const fixture=JSON.parse(raw);
 if(!String(fixture.kind).startsWith('AI-authored synthetic'))throw Error('Synthetic fixtures only');
 // Fresh database every run.
 const a=new Client({connectionString:admin.href});await a.connect();
 await a.query('DROP DATABASE IF EXISTS neyvu_retrieval_eval');await a.query('CREATE DATABASE neyvu_retrieval_eval');await a.end();
 const dbUrl=new URL(admin.href);dbUrl.pathname='/neyvu_retrieval_eval';
 execFileSync('node',['scripts/migrate-beta.mjs'],{env:{...process.env,SCHOOL_BETA_MIGRATION_URL:dbUrl.href},stdio:'ignore'});
 process.env.NEYVU_CHUNKER=chunker==='structure'?'structure':'';
 process.env.NEYVU_EMBED_ON_WRITE='';
 // The eval scores the in-process ranking; production ranks on the worker (worker-retrieval.ts).
 process.env.NEYVU_RETRIEVAL_SITE='web';
 const c=new Client({connectionString:dbUrl.href});await c.connect();
 const tx=async<T>(user:string,fn:()=>Promise<T>)=>{await c.query('BEGIN');await c.query("SELECT set_config('schoolvault.user_id',$1,true)",[user]);try{const v=await fn();await c.query('COMMIT');return v;}catch(e){await c.query('ROLLBACK');throw e;}};
 const sourceIds=new Map<string,string>(),courseIds=new Map<string,string>();
 for(const [tenant,t] of Object.entries<any>(fixture.tenants)){
  const user=uid('tenant|'+tenant);
  await c.query("INSERT INTO schoolvault.users(id,google_sub,email,name) VALUES($1,$2,$3,'Synthetic')",[user,'synthetic-'+tenant,tenant+'@fixture.invalid']);
  await tx(user,async()=>{
   await c.query('INSERT INTO schoolvault.vaults(user_id) VALUES($1)',[user]);
   for(const [key,label] of Object.entries<string>(t.courses)){const id=uid(tenant+'|'+key);courseIds.set(tenant+'|'+key,id);const [code,...rest]=label.split(/ (?=[A-Z][a-z])/);await c.query('INSERT INTO schoolvault.courses(user_id,id,code,title) VALUES($1,$2,$3,$4)',[user,id,code,rest.join(' ')||label]);}
  });
 }
 let loadMs=performance.now();
 for(const d of fixture.documents){
  const user=uid('tenant|'+d.tenant),id=uid('doc|'+d.tenant+'|'+d.id);sourceIds.set(id,d.id);
  await tx(user,async()=>{
   await c.query('INSERT INTO schoolvault.sources(user_id,id,course_id,kind,title,original_url) VALUES($1,$2,$3,$4,$5,$6)',[user,id,courseIds.get(d.tenant+'|'+d.course),d.kind,d.title,d.kind==='moodle'?`https://fixture.invalid/mod/page/view.php?id=${d.id}`:null]);
   await sourceVersion(c as any,user,id,d.body);
  });
 }
 loadMs=Math.round(performance.now()-loadMs);
 const passages=Number((await c.query('SELECT count(*) FROM schoolvault.passages')).rows[0].count);
 let embedMs=0,embedded=0;
 if(modes.some(m=>m!=='keyword')){
  const t=performance.now();
  for(const tenant of Object.keys(fixture.tenants)){const user=uid('tenant|'+tenant);embedded+=(await tx(user,()=>backfillTenantEmbeddings(c as any,user,{},retrievalConfig({...process.env,NEYVU_RETRIEVAL:'hybrid'})))).stored;}
  embedMs=Math.round(performance.now()-t);
 }
 const report:any={fixture_sha256:createHash('sha256').update(raw).digest('hex'),chunker,passages,load_ms:loadMs,embedded,embed_ms:embedMs,embed_model:modes.some(m=>m!=='keyword')?retrievalConfig({...process.env,NEYVU_RETRIEVAL:'hybrid'}).embedModel:null,modes:{}};
 for(const mode of modes){
  process.env.NEYVU_RETRIEVAL=mode==='keyword'?'':'hybrid';process.env.NEYVU_RERANK=mode==='rerank'?'1':'';
  const per:any[]=[];const times:number[]=[];const byLang:Record<string,{n:number;top1:number}>={};
  for(const q of fixture.queries){
   const user=uid('tenant|'+q.tenant),course=courseIds.get(q.tenant+'|'+q.course)!;
   const allowed=new Set(fixture.documents.filter((d:any)=>d.tenant===q.tenant&&d.course===q.course).map((d:any)=>d.id));
   const tops:string[]=[];
   for(const w of q.wordings){
    const trace=newRetrievalTrace();const t=performance.now();
    const final=await tx(user,()=>searchBetaSources(c as any,user,w.text,course,trace));
    times.push(performance.now()-t);
    const candidates=trace.calls[0].chunks.map(ch=>sourceIds.get(ch.source_id)!);
    const finalIds=final.map((r:any)=>sourceIds.get(r.id)!);
    if([...candidates,...finalIds].some(id=>!allowed.has(id)))throw Error('Scope violation: a source outside the tenant/course was returned');
    const rank=candidates.findIndex(id=>q.relevant.includes(id))+1;
    per.push({group:q.group,lang:w.lang,text:w.text,rank,top:candidates[0]||null,final_top5:finalIds.slice(0,5),final_hit5:finalIds.slice(0,5).some(id=>q.relevant.includes(id)),fallback:trace.calls[0].fallback||null,rerank:trace.calls[0].rerank||null});
    tops.push(candidates[0]||'');
    const l=byLang[w.lang]??={n:0,top1:0};l.n++;l.top1+=rank===1?1:0;
   }
  }
  const groups=[...new Set(per.map(p=>p.group))];
  const n=per.length,r=(x:number)=>Math.round(x*1000)/1000;
  const sorted=times.sort((x,y)=>x-y);
  report.modes[mode]={
   queries:n,groups:groups.length,
   top1:r(per.filter(p=>p.rank===1).length/n),
   recall_at_5:r(per.filter(p=>p.rank>0&&p.rank<=5).length/n),
   recall_at_10:r(per.filter(p=>p.rank>0&&p.rank<=10).length/n),
   final_at_5:r(per.filter(p=>p.final_hit5).length/n),
   mrr:r(per.reduce((s,p)=>s+(p.rank?1/p.rank:0),0)/n),
   rephrase_same_doc:r(groups.filter(g=>new Set(per.filter(p=>p.group===g).map(p=>p.top)).size===1).length/groups.length),
   rephrase_all_correct:r(groups.filter(g=>per.filter(p=>p.group===g).every(p=>p.rank===1)).length/groups.length),
   top1_by_language:Object.fromEntries(Object.entries(byLang).map(([k,v])=>[k,r(v.top1/v.n)])),
   median_ms:Math.round(sorted[Math.floor(sorted.length/2)]),p90_ms:Math.round(sorted[Math.floor(sorted.length*0.9)]),
   fallbacks:per.filter(p=>p.fallback).length,
   rerank_skipped:per.filter(p=>p.rerank&&!p.rerank.applied).length,
   misses:per.filter(p=>p.rank!==1).map(p=>({group:p.group,lang:p.lang,text:p.text,rank:p.rank,top:p.top})),
  };
 }
 await c.end();
 const summary={...report,modes:Object.fromEntries(Object.entries<any>(report.modes).map(([k,v])=>[k,{...v,misses:v.misses.length}]))};
 console.log(JSON.stringify(summary,null,1));
 if(out)await writeFile(out,JSON.stringify(report,null,1)+'\n');
}
main().catch(e=>{console.error(e);process.exitCode=1;});

// Replays the CURRENT search SQL/query expansion against an empty, isolated
// synthetic PostgreSQL fixture. Refuses production URLs and existing schemas.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Client} from 'pg';
import {searchSql,searchQuestion,rankingQuestion} from '../lib/beta/search';

const uid=(s:string)=>{const h=createHash('sha256').update(s).digest('hex').slice(0,32);return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
async function main(){
 const url=new URL(process.env.NEYVU_RETRIEVAL_FIXTURE_DATABASE_URL||'');
 if(url.hostname!=='127.0.0.1'||url.pathname!=='/neyvu_retrieval_fixture')throw Error('Only the isolated loopback fixture is permitted');
 const [fixtureFile,outputFile]=process.argv.slice(2);if(!fixtureFile||!outputFile)throw Error('Supply fixture and output files');
 const raw=await readFile(fixtureFile,'utf8');if(raw.length>2_000_000)throw Error('Fixture budget exceeded');
 const fixture=JSON.parse(raw);if(!fixture.kind.startsWith('AI-authored synthetic'))throw Error('Only the synthetic engineering fixture is permitted');
 const c=new Client({connectionString:url.href,connectionTimeoutMillis:5000,statement_timeout:5000});await c.connect();
 try{
  if((await c.query("SELECT 1 FROM pg_namespace WHERE nspname='schoolvault'")).rowCount)throw Error('Fixture schema already exists; do not overwrite it');
  await c.query(`CREATE SCHEMA schoolvault;
   CREATE TABLE schoolvault.sources(user_id uuid,id uuid,title text,course_id uuid,kind text,original_url text,current_version uuid);
   CREATE TABLE schoolvault.source_versions(user_id uuid,id uuid,observed_at timestamptz,body text);
   CREATE TABLE schoolvault.passages(user_id uuid,source_id uuid,version_id uuid,ordinal int,body text);`);
  const lookup=new Map<string,string>();
  for(const d of fixture.documents){
   const source=uid(d.tenant+'|'+d.id),version=uid(d.tenant+'|'+d.id+'|'+d.version),user=uid(d.tenant),course=uid(d.course);
   lookup.set(source,d.id);
   await c.query('INSERT INTO schoolvault.sources VALUES($1,$2,$3,$4,$5,$6,$7)',[user,source,d.text.split('. ')[0],course,d.role==='ai_draft'?'ai_draft':'moodle',`https://fixture.example.edu/material/${d.id}`,version]);
   await c.query('INSERT INTO schoolvault.source_versions VALUES($1,$2,$3,$4)',[user,version,'2026-10-26T14:00:00Z',d.text]);
   await c.query('INSERT INTO schoolvault.passages VALUES($1,$2,$3,0,$4)',[user,source,version,d.text]);
  }
  const orders:Record<string,string[]>={};
  for(const q of fixture.queries){
   if(q.courses.length!==1)throw Error('This baseline fixture needs one selected course');
   const expanded=searchQuestion(q.query),rows=(await c.query(searchSql,[uid(q.tenant),rankingQuestion(expanded),uid(q.courses[0]),expanded])).rows;
   const allowed=new Set(fixture.documents.filter((d:{tenant:string;course:string;role:string})=>d.tenant===q.tenant&&q.courses.includes(d.course)&&d.role!=='ai_draft').map((d:{id:string})=>d.id));
   orders[q.id]=rows.map(r=>lookup.get(r.id)!);
   if(orders[q.id].some(id=>!allowed.has(id)))throw Error('SQL source scope failed');
  }
  await writeFile(outputFile,JSON.stringify({baseline:'current-production-search-SQL-on-synthetic-fixture',fixture_sha256:createHash('sha256').update(raw).digest('hex'),orders,production_changed:false},null,2)+'\n');
  console.log(JSON.stringify({queries:Object.keys(orders).length,scope_checked:true,output:outputFile}));
 }finally{await c.end();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Fixture failed');process.exitCode=1;});

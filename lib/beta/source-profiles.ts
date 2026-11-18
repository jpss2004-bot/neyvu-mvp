import {randomUUID,randomBytes} from 'node:crypto';
import type {PoolClient} from 'pg';
import {betaPool,tenant,uuid} from './db';
import {lockVault,checkHistory,HistoryLimit} from './budget';
import {BetaHttpError} from './http';
import {sourceContent} from './source-content';
import {profileAlgorithm,profileModel,profileModelDigest,profileChunk,sourceWordings,validateProfileFacts,profileQuote,textHash,type ProfileFact} from './profile-evidence';
import {contextTerms,contextScore} from './student-context';
import {currentCourseSelection} from './course-selection';
import {sourceReadingEnabled} from './config';
const failure='Reading could not finish this section. Your original and saved points are safe; retry to continue.';
async function source(c:PoolClient,user:string,id:unknown,version:unknown){
 if(!uuid(id)||version!=null&&!uuid(version))throw new BetaHttpError('Choose a saved source version.');
 const row=(await c.query('SELECT s.id,s.current_version,s.kind,s.title,s.original_url,s.course_id,v.id AS version_id,v.body,v.mime,v.object_key FROM schoolvault.sources s JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.source_id=s.id AND v.id=coalesce($3::uuid,s.current_version) WHERE s.user_id=$1 AND s.id=$2',[user,id,version??null])).rows[0];
 if(!row)throw Error('Source not found');
 const extract=row.mime?(await c.query("SELECT result FROM schoolvault.jobs WHERE user_id=$1 AND (kind='extract' OR kind='collect' AND input->>'task'='device-content-v1') AND status='complete' AND result->>'version_id'=$2 ORDER BY created_at DESC LIMIT 1",[user,row.version_id])).rows[0]?.result:null;
 row.content=sourceContent({...row,device_content:extract?.device_content,truncated:extract?.truncated===true,pdf_reading:extract?.pdf_reading});return row;
}
async function view(c:PoolClient,user:string,row:any){
 const profile=(await c.query('SELECT * FROM schoolvault.source_profiles WHERE user_id=$1 AND source_id=$2 AND version_id=$3',[user,row.id,row.version_id])).rows[0];
 const current=row.current_version===row.version_id;
 if(profile&&profile.body_sha256!==textHash(row.body))throw Error('Source profile evidence mismatch');
 const reader=(await c.query("SELECT 1 FROM schoolvault.worker_status WHERE checked_at>now()-interval '60 seconds' AND capabilities @> '{\"profiles\":true,\"protocol\":3}'::jsonb")).rowCount>0;
 return {source_id:row.id,version_id:row.version_id,current,enabled:sourceReadingEnabled(),reader_ready:sourceReadingEnabled()&&reader,authority:row.content.authority,limitations:row.content.limitations,readable:row.content.state!=='no_text',profile:profile?{state:profile.state,cursor:profile.cursor,characters:profile.characters,sections:profile.data.sections,issues:profile.data.issues,reviewed:false,algorithm:profile.algorithm,facts:(profile.data.facts as ProfileFact[]).map(fact=>profileQuote(row.body,fact)),updated_at:profile.updated_at}:null};
}
export async function getSourceProfile(user:string,id:unknown,version:unknown){return tenant(user,async c=>view(c,user,await source(c,user,id,version)));}
async function admit(c:PoolClient,user:string,row:any,automatic=false){
 const existing=(await c.query("SELECT * FROM schoolvault.jobs WHERE user_id=$1 AND kind='summary' AND input->>'task'=$2 AND input->>'version_id'=$3 FOR UPDATE",[user,profileAlgorithm,row.version_id])).rows[0];
 if(existing&&automatic)return;
 if(existing&&['queued','leased','complete'].includes(existing.status)){
  if(existing.input.automatic===true){await c.query('UPDATE schoolvault.jobs SET input=input||$3::jsonb,updated_at=now() WHERE user_id=$1 AND id=$2',[user,existing.id,JSON.stringify({automatic:false,priority:30,historical:row.current_version!==row.version_id})]);await checkHistory(c,user);}
  return;
 }
 const input={task:profileAlgorithm,source_id:row.id,version_id:row.version_id,historical:row.current_version!==row.version_id,automatic};
 if(existing){await c.query("UPDATE schoolvault.jobs SET status='queued',error=NULL,attempts=0,lease_hash=NULL,lease_until=NULL,input=$3,updated_at=now() WHERE user_id=$1 AND id=$2",[user,existing.id,input]);await c.query("UPDATE schoolvault.source_profiles SET state='queued',updated_at=now() WHERE user_id=$1 AND source_id=$2 AND version_id=$3",[user,row.id,row.version_id]);}
 else{
  const count=Number((await c.query("SELECT count(*) FROM schoolvault.jobs WHERE user_id=$1 AND kind='summary' AND input->>'task'=$2",[user,profileAlgorithm])).rows[0].count);
  if(count>=2000)throw new BetaHttpError('Your vault has reached its reading-history limit. Existing reading drafts remain available.');
  await c.query('INSERT INTO schoolvault.source_profiles(user_id,source_id,version_id,body_sha256,characters) VALUES($1,$2,$3,$4,$5)',[user,row.id,row.version_id,textHash(row.body),row.body.length]);
  await c.query("INSERT INTO schoolvault.jobs(user_id,id,kind,request_id,input) VALUES($1,$2,'summary',$3,$4)",[user,randomUUID(),randomUUID(),{...input,priority:automatic?(/\b(?:must|required|rubric|submit|optional|assignment|quiz|lab)\b/i.test(row.title+' '+row.body)?20:row.kind==='note'?5:10):30}]);
 }
 await checkHistory(c,user,60000);
}
export async function queueSourceProfile(user:string,id:unknown,version:unknown){
 if(!sourceReadingEnabled())throw new BetaHttpError('Local reading is unavailable. Your saved text, original and earlier reading drafts remain usable.',503);
 return tenant(user,async c=>{
  await lockVault(c,user);const row=await source(c,user,id,version);
  if(row.kind==='ai_draft'||row.content.state==='no_text'||!row.body.trim()||row.body.length>160000)throw new BetaHttpError('This source needs readable original text before it can be organized.');
  await admit(c,user,row);await c.query('UPDATE schoolvault.vaults SET reading_blocked_reason=NULL WHERE user_id=$1',[user]);return view(c,user,row);
 });
}
async function discover(c:PoolClient,user:string,selection:Awaited<ReturnType<typeof currentCourseSelection>>){
 const row=(await c.query(`SELECT s.id,s.kind,s.title,s.current_version,v.id AS version_id,v.body FROM schoolvault.sources s
 JOIN schoolvault.courses course ON course.user_id=s.user_id AND course.id=s.course_id
 JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.id=s.current_version
 WHERE s.user_id=$1 AND s.kind!='ai_draft' AND btrim(v.body)!='' AND char_length(v.body)<=160000
 AND (course.moodle_id IS NULL OR $2 AND course.moodle_id=ANY($3::text[]))
 AND NOT EXISTS(SELECT 1 FROM schoolvault.source_profiles p WHERE p.user_id=s.user_id AND p.version_id=v.id)
 ORDER BY (s.title||' '||substring(v.body,1,6000) ~* '\\m(must|required|rubric|submit|optional|assignment|quiz|lab)\\M') DESC,
 (s.kind='note'),v.observed_at DESC,s.id LIMIT 1`,[user,selection.confirmed,selection.moodle_ids])).rows[0];
 if(!row||row.body.length>160000)return;
 await c.query('SAVEPOINT automatic_reading');
 try{await admit(c,user,row,true);await c.query('UPDATE schoolvault.vaults SET reading_blocked_reason=NULL WHERE user_id=$1',[user]);}
 catch(e){await c.query('ROLLBACK TO SAVEPOINT automatic_reading');if(e instanceof HistoryLimit||e instanceof BetaHttpError&&e.message.includes('reading-history limit'))await c.query('UPDATE schoolvault.vaults SET reading_blocked_reason=$2 WHERE user_id=$1',[user,e instanceof HistoryLimit?'history_limit':'reading_history_limit']);else throw e;}
 finally{await c.query('RELEASE SAVEPOINT automatic_reading');}
}
export async function readingProgress(c:PoolClient,user:string){
 const selection=await currentCourseSelection(c,user);
 const rows=(await c.query(`SELECT s.id,course.moodle_id,char_length(btrim(v.body)) AS characters,p.state FROM schoolvault.sources s
 JOIN schoolvault.courses course ON course.user_id=s.user_id AND course.id=s.course_id
 JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.id=s.current_version
 LEFT JOIN schoolvault.source_profiles p ON p.user_id=s.user_id AND p.version_id=v.id
 WHERE s.user_id=$1 AND s.kind!='ai_draft' AND (course.moodle_id IS NULL OR $2 AND course.moodle_id=ANY($3::text[]))`,[user,selection.confirmed,selection.moodle_ids])).rows;
 const counts:Record<string,number>={not_started:0,waiting_text:0,limited:0,queued:0,reading:0,ready:0,partial:0,failed:0};
 for(const row of rows){const key=row.characters===0?'waiting_text':row.characters>160000?'limited':row.state&&row.state in counts?row.state:'not_started';counts[key]++;}
 const blocked=(await c.query('SELECT reading_blocked_reason FROM schoolvault.vaults WHERE user_id=$1',[user])).rows[0]?.reading_blocked_reason;
 const excluded=Number((await c.query(`SELECT count(*) FROM schoolvault.sources s JOIN schoolvault.courses course ON course.user_id=s.user_id AND course.id=s.course_id WHERE s.user_id=$1 AND s.kind!='ai_draft' AND course.moodle_id IS NOT NULL AND NOT($2 AND course.moodle_id=ANY($3::text[]))`,[user,selection.confirmed,selection.moodle_ids])).rows[0].count);
 const reader=(await c.query("SELECT 1 FROM schoolvault.worker_status WHERE checked_at>now()-interval '60 seconds' AND capabilities @> '{\"profiles\":true,\"protocol\":3}'::jsonb")).rowCount>0;
 return {reader_ready:sourceReadingEnabled()&&reader,enabled:sourceReadingEnabled(),total:rows.length,counts,blocked_reason:counts.not_started+counts.failed?blocked||null:null,selection_needed:!selection.confirmed&&excluded>0,excluded_sources:excluded};
}
export async function profileShouldYield(){
 for(const user of (await betaPool().query('SELECT id FROM schoolvault.users WHERE disabled_at IS NULL')).rows){
  if(await tenant(user.id,async c=>(await c.query("SELECT 1 FROM schoolvault.jobs WHERE user_id=$1 AND kind='answer' AND status IN('queued','leased') LIMIT 1",[user.id])).rowCount>0))return true;
 }return false;
}
async function stale(c:PoolClient,user:string,job:any,row:any){
 if(job.input.historical===true||row.current_version===row.version_id)return false;
 await c.query("UPDATE schoolvault.source_profiles SET state='stale',updated_at=now() WHERE user_id=$1 AND source_id=$2 AND version_id=$3",[user,row.id,row.version_id]);
 await c.query("UPDATE schoolvault.jobs SET status='cancelled',error='The source changed. Read the current version for current advice.',lease_hash=NULL,lease_until=NULL,updated_at=now() WHERE user_id=$1 AND id=$2",[user,job.id]);return true;
}
export async function leaseSourceProfile(){
 if(!sourceReadingEnabled()||await profileShouldYield())return null;
 for(const user of (await betaPool().query('SELECT id FROM schoolvault.users WHERE disabled_at IS NULL ORDER BY last_profile_lease_at NULLS FIRST,created_at,id')).rows){
  const leased=await tenant(user.id,async c=>{
   await lockVault(c,user.id);
   const selection=await currentCourseSelection(c,user.id);
   await c.query(`UPDATE schoolvault.jobs j SET status='queued',error=NULL,attempts=0,updated_at=now() WHERE j.user_id=$1 AND j.kind='summary' AND j.status='cancelled' AND j.input->>'automatic'='true' AND EXISTS(
    SELECT 1 FROM schoolvault.source_profiles p JOIN schoolvault.sources s ON s.user_id=p.user_id AND s.id=p.source_id JOIN schoolvault.courses course ON course.user_id=s.user_id AND course.id=s.course_id
    WHERE p.user_id=j.user_id AND p.version_id::text=j.input->>'version_id' AND p.state='paused' AND p.version_id=s.current_version AND (course.moodle_id IS NULL OR $2 AND course.moodle_id=ANY($3::text[])))`,[user.id,selection.confirmed,selection.moodle_ids]);
   await c.query(`UPDATE schoolvault.source_profiles p SET state='queued',updated_at=now() WHERE p.user_id=$1 AND p.state='paused' AND EXISTS(SELECT 1 FROM schoolvault.jobs j WHERE j.user_id=p.user_id AND j.input->>'version_id'=p.version_id::text AND j.kind='summary' AND j.status='queued')`,[user.id]);
   await c.query(`UPDATE schoolvault.source_profiles p SET state='paused',updated_at=now() FROM schoolvault.sources s JOIN schoolvault.courses course ON course.user_id=s.user_id AND course.id=s.course_id
    WHERE p.user_id=$1 AND s.user_id=p.user_id AND s.id=p.source_id AND p.state IN('queued','reading') AND course.moodle_id IS NOT NULL AND NOT($2 AND course.moodle_id=ANY($3::text[]))
    AND EXISTS(SELECT 1 FROM schoolvault.jobs j WHERE j.user_id=p.user_id AND j.kind='summary' AND j.input->>'version_id'=p.version_id::text AND j.input->>'automatic'='true')`,[user.id,selection.confirmed,selection.moodle_ids]);
   await c.query(`UPDATE schoolvault.jobs j SET status='cancelled',lease_hash=NULL,lease_until=NULL,error='Background reading paused outside your selected current courses.',updated_at=now()
    WHERE j.user_id=$1 AND j.kind='summary' AND j.status IN('queued','leased') AND j.input->>'automatic'='true'
    AND EXISTS(SELECT 1 FROM schoolvault.source_profiles p WHERE p.user_id=j.user_id AND p.version_id::text=j.input->>'version_id' AND p.state='paused')`,[user.id]);
   await c.query(`UPDATE schoolvault.jobs j SET status='queued',error=NULL,updated_at=now() WHERE j.user_id=$1 AND j.kind='summary' AND j.status='failed' AND j.input->>'automatic'='true' AND j.attempts<3 AND j.updated_at<now()-interval '5 minutes' AND EXISTS(SELECT 1 FROM schoolvault.sources s JOIN schoolvault.courses course ON course.user_id=s.user_id AND course.id=s.course_id WHERE s.user_id=j.user_id AND s.current_version::text=j.input->>'version_id' AND (course.moodle_id IS NULL OR $2 AND course.moodle_id=ANY($3::text[]))) RETURNING j.input`,[user.id,selection.confirmed,selection.moodle_ids]).then(async result=>{for(const retry of result.rows)await c.query("UPDATE schoolvault.source_profiles SET state='queued',updated_at=now() WHERE user_id=$1 AND version_id=$2",[user.id,retry.input.version_id]);});
   await discover(c,user.id,selection);
   const exhausted=(await c.query("UPDATE schoolvault.jobs SET status='failed',error=$3,lease_hash=NULL,lease_until=NULL,updated_at=now() WHERE user_id=$1 AND kind='summary' AND input->>'task'=$2 AND status='leased' AND lease_until<now() AND attempts>=3 RETURNING input",[user.id,profileAlgorithm,failure])).rows;
   for(const j of exhausted)await c.query("UPDATE schoolvault.source_profiles SET state='failed',updated_at=now() WHERE user_id=$1 AND source_id=$2 AND version_id=$3",[user.id,j.input.source_id,j.input.version_id]);
   const j=(await c.query("SELECT * FROM schoolvault.jobs WHERE user_id=$1 AND kind='summary' AND input->>'task'=$2 AND (status='queued' OR status='leased' AND lease_until<now()) ORDER BY coalesce((input->>'priority')::integer,30) DESC,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1",[user.id,profileAlgorithm])).rows[0];if(!j)return null;
   const row=await source(c,user.id,j.input.source_id,j.input.version_id);if(await stale(c,user.id,j,row))return null;
   const p=(await c.query('SELECT * FROM schoolvault.source_profiles WHERE user_id=$1 AND source_id=$2 AND version_id=$3 FOR UPDATE',[user.id,row.id,row.version_id])).rows[0];
   if(!p||p.body_sha256!==textHash(row.body)||p.cursor>=p.characters)throw Error('Invalid reading state');
   const chunk=profileChunk(row.body,p.cursor),lease=user.id+'.'+j.id+'.'+randomBytes(32).toString('base64url');
   await c.query("UPDATE schoolvault.jobs SET status='leased',attempts=attempts+1,lease_hash=$3,lease_until=now()+interval '90 seconds',input=input||$4::jsonb,updated_at=now() WHERE user_id=$1 AND id=$2",[user.id,j.id,textHash(lease),JSON.stringify({profile_cursor:p.cursor})]);
   await c.query("UPDATE schoolvault.source_profiles SET state='reading',updated_at=now() WHERE user_id=$1 AND source_id=$2 AND version_id=$3",[user.id,row.id,row.version_id]);
   await c.query('UPDATE schoolvault.users SET last_profile_lease_at=now() WHERE id=$1',[user.id]);
   return {lease,job_id:j.id,source_id:row.id,version_id:row.version_id,text_sha256:p.body_sha256,source_title:row.title,authority:row.content.authority,chunk,characters:p.characters,algorithm:profileAlgorithm};
  });if(leased)return leased;
 }return null;
}
function leaseParts(raw:unknown){if(typeof raw!=='string')throw new BetaHttpError('Invalid reading lease');const parts=raw.split('.');if(parts.length!==3||!uuid(parts[0])||!uuid(parts[1])||!/^[A-Za-z0-9_-]{43}$/.test(parts[2]))throw new BetaHttpError('Invalid reading lease');return parts;}
export async function finishSourceProfile(raw:unknown,output:any){
 if(!sourceReadingEnabled())throw new BetaHttpError('Local reading is unavailable. Earlier reading drafts remain usable.',503);
 const [user,id]=leaseParts(raw);return tenant(user,async c=>{
  await lockVault(c,user);
  if(!(await c.query('SELECT 1 FROM schoolvault.users WHERE id=$1 AND disabled_at IS NULL',[user])).rowCount)throw new BetaHttpError('Account unavailable.',403);
  const j=(await c.query('SELECT * FROM schoolvault.jobs WHERE user_id=$1 AND id=$2 FOR UPDATE',[user,id])).rows[0];
  if(!j||j.kind!=='summary'||j.input.task!==profileAlgorithm||j.status!=='leased'||j.lease_hash!==textHash(raw as string)||Date.parse(j.lease_until)<=Date.now())throw new BetaHttpError('Reading lease expired.',409);
  const row=await source(c,user,j.input.source_id,j.input.version_id);if(await stale(c,user,j,row))return {saved:true,status:'stale'};
  if(j.input.automatic===true){
   const selection=await currentCourseSelection(c,user),course=(await c.query('SELECT moodle_id FROM schoolvault.courses WHERE user_id=$1 AND id=$2',[user,row.course_id])).rows[0];
   if(course?.moodle_id&&(!selection.confirmed||!selection.moodle_ids.includes(course.moodle_id))){await c.query("UPDATE schoolvault.source_profiles SET state='paused',updated_at=now() WHERE user_id=$1 AND version_id=$2",[user,row.version_id]);await c.query("UPDATE schoolvault.jobs SET status='cancelled',lease_hash=NULL,lease_until=NULL,updated_at=now() WHERE user_id=$1 AND id=$2",[user,id]);return {saved:true,status:'paused'};}
  }
  const p=(await c.query('SELECT * FROM schoolvault.source_profiles WHERE user_id=$1 AND source_id=$2 AND version_id=$3 FOR UPDATE',[user,row.id,row.version_id])).rows[0];
  if(!p||p.body_sha256!==textHash(row.body)||p.cursor!==j.input.profile_cursor)throw new BetaHttpError('Reading evidence changed.',409);
  if(output?.yielded===true){await c.query("UPDATE schoolvault.jobs SET status='queued',attempts=greatest(0,attempts-1),lease_hash=NULL,lease_until=NULL,updated_at=now() WHERE user_id=$1 AND id=$2",[user,id]);await c.query("UPDATE schoolvault.source_profiles SET state='queued',updated_at=now() WHERE user_id=$1 AND source_id=$2 AND version_id=$3",[user,row.id,row.version_id]);return {saved:true,status:'queued'};}
  const fail=async()=>{await c.query("UPDATE schoolvault.jobs SET status='failed',error=$3,lease_hash=NULL,lease_until=NULL,updated_at=now() WHERE user_id=$1 AND id=$2",[user,id,failure]);await c.query("UPDATE schoolvault.source_profiles SET state='failed',updated_at=now() WHERE user_id=$1 AND source_id=$2 AND version_id=$3",[user,row.id,row.version_id]);return {saved:true,status:'failed'};};
  if(output?.error)return fail();
  if(output?.text_sha256!==p.body_sha256)throw new BetaHttpError('Reading evidence hash mismatch');
  if(output.model!==profileModel||output.model_digest!==profileModelDigest)throw new BetaHttpError('The source reader model does not match this pinned reading version.');
  const chunk=profileChunk(row.body,p.cursor);let checked;try{checked=validateProfileFacts(row.body,chunk,output);}catch(e){throw new BetaHttpError(e instanceof Error?e.message:'Invalid reading output');}
  const wording=sourceWordings(row.body,chunk),facts:ProfileFact[]=p.data.facts;let limited=wording.limited;
  for(const fact of [...checked.facts,...wording.facts])if(!facts.some(old=>old.start===fact.start&&old.end===fact.end)){if(facts.length<128)facts.push(fact);else limited=true;}
  const issues=[...new Set<string>([...p.data.issues,...checked.issues,...(limited?['Some additional source wording exceeds the bounded reading profile; review the full text.']:[]),...(row.content.state==='partial'?['The saved source has reading gaps or truncated content.']:[])])].slice(0,30);
  const state=chunk.end===p.characters?(issues.length?'partial':'ready'):'queued';
  await c.query('SAVEPOINT profile_section');
  try{
   await c.query('UPDATE schoolvault.source_profiles SET state=$4,cursor=$5,data=$6,updated_at=now() WHERE user_id=$1 AND source_id=$2 AND version_id=$3',[user,row.id,row.version_id,state,chunk.end,{facts,sections:p.data.sections+1,issues,model:output.model,model_digest:output.model_digest}]);
   await c.query("UPDATE schoolvault.jobs SET status=$3,result=$4,error=NULL,attempts=0,lease_hash=NULL,lease_until=NULL,updated_at=now() WHERE user_id=$1 AND id=$2",[user,id,chunk.end===p.characters?'complete':'queued',{source_id:row.id,version_id:row.version_id,profile_state:state,sections:p.data.sections+1}]);
   await checkHistory(c,user);
  }catch(e){await c.query('ROLLBACK TO SAVEPOINT profile_section');await c.query('RELEASE SAVEPOINT profile_section');if(e instanceof HistoryLimit){await c.query('UPDATE schoolvault.vaults SET reading_blocked_reason=$2 WHERE user_id=$1',[user,'history_limit']);return fail();}throw e;}
  await c.query('RELEASE SAVEPOINT profile_section');await c.query('UPDATE schoolvault.vaults SET reading_blocked_reason=NULL WHERE user_id=$1',[user]);return {saved:true,status:state,cursor:chunk.end};
 });
}
// Only original wording enters source excerpts. Interpretations may rank points,
// but cannot become new instructor evidence or silently replace another version.
export async function profileExcerpt(c:PoolClient,sourceId:string,version:string,body:string,question:string,budget:number){
 if(!sourceReadingEnabled())return null;
 if(!/\b(?:understand|instructions?|requirements?|rubric|prepare|study|review|concepts?|explain|argument)\b/i.test(question)||/\b(?:when|date|grade|permission|allowed)\b/i.test(question))return null;
 const p=(await c.query("SELECT body_sha256,data FROM schoolvault.source_profiles WHERE user_id=nullif(current_setting('schoolvault.user_id',true),'')::uuid AND source_id=$1 AND version_id=$2 AND cursor>0",[sourceId,version])).rows[0];if(!p||p.body_sha256!==textHash(body))return null;
 const terms=contextTerms(question),instruction=/\b(?:instructions?|requirements?|rubric)\b/i.test(question);
 const points=(p.data.facts as ProfileFact[]).map((fact,index)=>({quote:profileQuote(body,fact),index,score:contextScore(body.slice(fact.start,fact.end)+' '+fact.interpretation,terms)+(instruction&&['requirement','rubric','policy'].includes(fact.kind)?2:0)})).sort((a,b)=>b.score-a.score||a.index-b.index);
 const chosen:string[]=[];let used=0;for(const {quote,score} of points){if(!instruction&&!score)continue;const text=quote.context||quote.quote;if(used+text.length+2>budget)continue;chosen.push(text);used+=text.length+2;}
 return chosen.length?chosen.join('\n\n'):null;
}

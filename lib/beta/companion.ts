import {forumEvidence,saveForumObservation,type ForumEvidence} from './forum-evidence';
import {unverifiedForumSource} from './source-authority';
import {discoveredFiles,type DiscoveredFile} from './file-inventory';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {betaPool,tenant,uuid} from './db';
import {BetaHttpError} from './http';
import {sourceVersion,text} from './vault';
import {demoAllowed} from './config';
import {demoAccountLabel} from './demo-data';
import {assessmentCapture,saveAssessmentObservation,type AssessmentCapture} from './moodle-receipts';
import {activityWork} from './moodle-facts';
import {classifyMoodleContent} from './moodle-content';
import {courseCoverage} from './coverage';
import {checkObjects,checkHistory,admitCompanionDevice,lockVault} from './budget';
import {assistantStatus} from './worker';
import {currentCourseSelection,saveCurrentCourseSelection,validateCurrentCourseReview} from './course-selection';
const digest=(v:string)=>createHash('sha256').update(v).digest('hex');
const token=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
export const moodleIdentityKey=(value:string)=>value.match(/^moodle-user:([1-9]\d{0,11})(?:\s*·.*)?$/)?.[1]||value;
export async function createCompanionPairing(user:string){
 const code=randomBytes(32).toString('base64url');
 return tenant(user,async c=>{
  await c.query('SELECT user_id FROM schoolvault.vaults WHERE user_id=$1 FOR UPDATE',[user]);
  if(Number((await c.query("SELECT count(*) FROM schoolvault.companion_devices d WHERE d.user_id=$1 AND d.revoked_at IS NULL AND EXISTS(SELECT 1 FROM schoolvault.companion_tokens t WHERE t.user_id=d.user_id AND t.device_id=d.id AND t.expires_at>now())",[user])).rows[0].count)>=5)throw new BetaHttpError('Disconnect an old laptop before adding another.');
  await c.query('DELETE FROM schoolvault.companion_pairings WHERE user_id=$1',[user]);await c.query('SELECT schoolvault.purge_expired_companion_pairings()');
  await c.query("INSERT INTO schoolvault.companion_pairings VALUES($1,$2,'Windows laptop',now()+interval '10 minutes')",[digest(code),user]);
  return {code,expires_at:new Date(Date.now()+600000).toISOString()};
 });
}
export async function redeemCompanionPairing(code:unknown,replaceDevice:unknown=undefined){
 if(replaceDevice!==undefined&&!uuid(replaceDevice))throw new BetaHttpError('Invalid laptop replacement.');
 if(!token(code))throw new BetaHttpError('Invalid or expired connection code.',401);
 const found=(await betaPool().query('SELECT user_id,email,demo FROM schoolvault.companion_pairing_owner($1)',[digest(code)])).rows[0];
 if(!found||!demoAllowed(found.demo))throw new BetaHttpError('Invalid or expired connection code.',401);
 return tenant(found.user_id,async c=>{
  await c.query('SELECT user_id FROM schoolvault.vaults WHERE user_id=$1 FOR UPDATE',[found.user_id]);
  const p=(await c.query('SELECT schoolvault.consume_companion_pairing($1,$2) AS label',[digest(code),found.user_id])).rows[0];
  if(p.label===null)throw new BetaHttpError('Invalid or expired connection code.',401);
  // A fresh single-use pairing code authorizes this owner only. An inactive ID
  // is a reuse hint, never a credential or permission to replace an active laptop.
  let replacing=false;
  if(replaceDevice!==undefined){
   const previous=(await c.query('SELECT id,revoked_at FROM schoolvault.companion_devices WHERE user_id=$1 AND id=$2 FOR UPDATE',[found.user_id,replaceDevice])).rows[0];
   if(!previous)throw new BetaHttpError('This laptop belongs to a different connection. Reset the Companion before changing Neyvu accounts.',409);
   const active=(await c.query('SELECT device_id FROM schoolvault.companion_tokens WHERE user_id=$1 AND device_id=$2 AND expires_at>now()',[found.user_id,replaceDevice])).rowCount;
   if(!previous.revoked_at&&active)throw new BetaHttpError('This laptop connection is still active. Refresh its status before reconnecting.',409);
   replacing=true;
  }
  if(Number((await c.query('SELECT count(*) FROM schoolvault.companion_devices WHERE user_id=$1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR id<>$2)',[found.user_id,replacing?replaceDevice:null])).rows[0].count)>=5)throw new BetaHttpError('Too many connected laptops. Disconnect an old laptop before reconnecting.');
  await admitCompanionDevice(c,found.user_id,{replacing});
  const id=replacing?replaceDevice as string:randomUUID(),secret=randomBytes(32).toString('base64url');
  if(replacing){
   await c.query('DELETE FROM schoolvault.companion_tokens WHERE user_id=$1 AND device_id=$2',[found.user_id,id]);
   // Keep the original Moodle identity and device history pinned to this vault.
   await c.query("UPDATE schoolvault.companion_devices SET revoked_at=NULL,status='waiting',checked_at=NULL WHERE user_id=$1 AND id=$2",[found.user_id,id]);
  }else await c.query('INSERT INTO schoolvault.companion_devices(user_id,id,label) VALUES($1,$2,$3)',[found.user_id,id,p.label]);
  await c.query("INSERT INTO schoolvault.companion_tokens VALUES($1,$2,$3,now()+interval '30 days')",[digest(secret),found.user_id,id]);
  await c.query('INSERT INTO schoolvault.audit(user_id,id,action,target) VALUES($1,$2,$3,$4)',[found.user_id,randomUUID(),replacing?'companion-reconnected':'companion-connected',id]);
  await checkHistory(c,found.user_id);
  // The companion shows account_label; a demo pairing says plainly that it is synthetic.
  return {token:secret,device_id:id,account_label:found.demo?demoAccountLabel:found.email,demo:found.demo===true,expires_at:new Date(Date.now()+30*86400000).toISOString()};
 });
}
export async function companionActor(raw:unknown){
 if(!token(raw))throw new BetaHttpError('Reconnect this laptop in SchoolVault.',401);
 const r=(await betaPool().query('SELECT user_id,device_id,demo FROM schoolvault.companion_actor($1)',[digest(raw)])).rows[0];
 if(!r||!demoAllowed(r.demo))throw new BetaHttpError('Reconnect this laptop in SchoolVault.',401);
 const valid=await tenant(r.user_id,async c=>(await c.query('SELECT id FROM schoolvault.companion_devices WHERE user_id=$1 AND id=$2 AND revoked_at IS NULL',[r.user_id,r.device_id])).rowCount);
 if(!valid)throw new BetaHttpError('This laptop has been disconnected.',401);
 return {user:r.user_id as string,device:r.device_id as string};
}
export async function companionDevices(user:string){return tenant(user,async c=>(await c.query(`SELECT d.id,d.label,d.moodle_identity,d.status,d.created_at,d.checked_at,d.revoked_at,g.expires_at,CASE WHEN d.revoked_at IS NOT NULL THEN 'disconnected' WHEN g.expires_at IS NULL OR g.expires_at<=now() THEN 'expired' ELSE 'active' END AS connection_state FROM schoolvault.companion_devices d LEFT JOIN LATERAL(SELECT max(t.expires_at) AS expires_at FROM schoolvault.companion_tokens t WHERE t.user_id=d.user_id AND t.device_id=d.id) g ON true WHERE d.user_id=$1 ORDER BY d.revoked_at NULLS FIRST,d.created_at DESC LIMIT 100`,[user])).rows);}
export async function companionStatus(actor:{user:string;device:string}){
 return tenant(actor.user,async c=>{
  const device=(await c.query('SELECT moodle_identity,status,checked_at FROM schoolvault.companion_devices WHERE user_id=$1 AND id=$2 AND revoked_at IS NULL',[actor.user,actor.device])).rows[0];
  if(!device)throw new BetaHttpError('This laptop has been disconnected.',401);
  return {...device,capture_capabilities:{...(process.env.SCHOOL_BETA_LEGACY_PPT_ENABLED==='1'?{legacy_powerpoint:1}:{}),forum_evidence:1,assignment_grading:1,course_membership:1,active_labs:1,assignment_checks:1},assistant:await assistantStatus(c),current_courses:await currentCourseSelection(c,actor.user),coverage:await courseCoverage(c,actor.user)};
 });
}
export async function confirmCompanionCourses(actor:{user:string;device:string},raw:unknown){
 const review=validateCurrentCourseReview(raw);
 return tenant(actor.user,async c=>{
  await lockVault(c,actor.user);
  const account=(await c.query('SELECT demo FROM schoolvault.users WHERE id=$1 AND disabled_at IS NULL',[actor.user])).rows[0];
  if(!account||account.demo)throw new BetaHttpError('A real Moodle course review requires your own SchoolVault account.',403);
  const device=(await c.query('SELECT moodle_identity FROM schoolvault.companion_devices WHERE user_id=$1 AND id=$2 AND revoked_at IS NULL FOR UPDATE',[actor.user,actor.device])).rows[0];
  if(!device)throw new BetaHttpError('This laptop has been disconnected.',401);
  const connector=(await c.query("SELECT identity FROM schoolvault.connectors WHERE user_id=$1 AND provider='moodle' FOR UPDATE",[actor.user])).rows[0];
  if(device.moodle_identity&&moodleIdentityKey(device.moodle_identity)!==review.identity_key||connector?.identity&&moodleIdentityKey(connector.identity)!==review.identity_key)throw new BetaHttpError('The Moodle account changed. Use the vault’s original Moodle account.',409);
  const confirmed=await saveCurrentCourseSelection(c,actor.user,actor.device,review);
  // Pin an initially unbound account, without claiming course content imported.
  if(!device.moodle_identity)await c.query('UPDATE schoolvault.companion_devices SET moodle_identity=$3 WHERE user_id=$1 AND id=$2',[actor.user,actor.device,review.identity]);
  if(!connector)await c.query("INSERT INTO schoolvault.connectors(user_id,id,provider,identity,status) VALUES($1,$2,'moodle',$3,'waiting')",[actor.user,randomUUID(),review.identity]);
  else if(!connector.identity)await c.query("UPDATE schoolvault.connectors SET identity=$2 WHERE user_id=$1 AND provider='moodle'",[actor.user,review.identity]);
  return confirmed;
 });
}
export async function revokeCompanion(user:string,device:unknown){
 if(!uuid(device))throw new BetaHttpError('Invalid laptop');
 return tenant(user,async c=>{
  await lockVault(c,user);
  const found=(await c.query("UPDATE schoolvault.companion_devices SET revoked_at=now(),status='disconnected' WHERE user_id=$1 AND id=$2 RETURNING id",[user,device])).rowCount;
  if(!found)throw new BetaHttpError('Laptop not found.',404);
  await c.query('DELETE FROM schoolvault.companion_tokens WHERE user_id=$1 AND device_id=$2',[user,device]);
  await c.query('DELETE FROM schoolvault.companion_pairings WHERE user_id=$1',[user]);
  if(!(await c.query('SELECT id FROM schoolvault.companion_devices WHERE user_id=$1 AND revoked_at IS NULL',[user])).rowCount)await c.query("UPDATE schoolvault.connectors SET status='disconnected',revoked_at=now() WHERE user_id=$1 AND provider='moodle'",[user]);
  return {disconnected:true};
 });
}
export function moodleURL(value:unknown,courseOnly=false){
 if(typeof value!=='string'||value.length>500)throw new BetaHttpError('Invalid Moodle link');
 let u:URL;try{u=new URL(value);}catch{throw new BetaHttpError('Invalid Moodle link');}
 const keys=[...u.searchParams.keys()];
 const calendar=!courseOnly&&u.pathname==='/calendar/view.php'&&keys.length===2&&keys.includes('course')&&keys.includes('view')&&/^[1-9]\d{0,11}$/.test(u.searchParams.get('course')||'')&&u.searchParams.get('view')==='upcoming';
 if(calendar&&u.origin==='https://moodle.acadiau.ca'&&!u.username&&!u.password&&!u.hash)return u.href;
 const discussion=!courseOnly&&u.pathname==='/mod/forum/discuss.php',key=discussion?'d':'id';
 const chapter=!courseOnly&&u.pathname==='/mod/book/view.php'&&keys.length===2&&keys.includes('id')&&keys.includes('chapterid')&&/^[1-9]\d{0,11}$/.test(u.searchParams.get('chapterid')||'');
 const forumPage=!courseOnly&&u.pathname==='/mod/forum/view.php'&&keys.length===2&&keys.includes('id')&&keys.includes('page')&&/^(?:0|[1-9]\d{0,11})$/.test(u.searchParams.get('page')||'');
 const allowedKeys=new Set(keys).size===keys.length&&(keys.length===1&&keys[0]===key||chapter||forumPage);
 if(u.origin!=='https://moodle.acadiau.ca'||u.username||u.password||u.hash||!allowedKeys||!/^\d{1,12}$/.test(u.searchParams.get(key)||'')||!(courseOnly?u.pathname==='/course/view.php':discussion||u.pathname==='/course/view.php'||/^\/mod\/(assign|quiz|page|book|forum|folder|resource|url|lesson|workshop)\/view.php$/.test(u.pathname)))throw new BetaHttpError('Invalid Moodle link');
 return u.href;
}
export type MoodleCapture={course:{id:string;title:string;url:string};identity:string;title:string;url:string;body:string;captured_at:string;assessment?:AssessmentCapture|null;forum_evidence?:ForumEvidence|null;coverage:{scope:'visible-course'|'visible-activity';issues:string[];files?:DiscoveredFile[];files_truncated?:boolean}};
export function validateMoodleCapture(value:any):MoodleCapture{
 if(!value||typeof value!=='object'||Array.isArray(value)||'user_id' in value||'account' in value)throw new BetaHttpError('Invalid Moodle capture');
 const courseURL=moodleURL(value.course?.url,true);
 if(value.course?.id!==new URL(courseURL).searchParams.get('id'))throw new BetaHttpError('Moodle course identity did not match');
 const captured=Date.parse(value.captured_at);
 if(!Number.isFinite(captured)||captured>Date.now()+60000||captured<Date.now()-86400000)throw new BetaHttpError('This Moodle capture is too old. Refresh on the laptop.');
 if(value.coverage?.files_truncated!==undefined&&typeof value.coverage.files_truncated!=='boolean')throw new BetaHttpError('Invalid file inventory limit');
 const scope=value.coverage?.scope,issues=value.coverage?.issues;
 if(!['visible-course','visible-activity'].includes(scope)||!Array.isArray(issues)||issues.length>30||issues.some((s:unknown)=>typeof s!=='string'||s.length>300))throw new BetaHttpError('Invalid Moodle coverage');
 const url=moodleURL(value.url);
 if(new URL(url).pathname==='/calendar/view.php'&&new URL(url).searchParams.get('course')!==value.course.id)throw new BetaHttpError('Moodle Calendar belongs to a different course.');
 if((scope==='visible-course'&&url!==courseURL)||(scope==='visible-activity'&&new URL(url).pathname==='/course/view.php'))throw new BetaHttpError('Moodle coverage does not match the page');
 const identity=text(value.identity,180).trim(),title=text(value.title,180).trim(),body=text(value.body,80000);
 if(!identity||!title||!body.trim()||!text(value.course.title,180).trim())throw new BetaHttpError('Moodle content or account identity is missing');
 return {course:{id:value.course.id,title:value.course.title.trim(),url:courseURL},identity,title,url,body,captured_at:new Date(captured).toISOString(),assessment:assessmentCapture(value.assessment,url,body),forum_evidence:forumEvidence(value.forum_evidence,{url,body,identity,course:value.course,captured_at:new Date(captured).toISOString()}),coverage:{scope,issues,...(value.coverage.files!==undefined?{files:discoveredFiles(value.coverage.files),files_truncated:value.coverage.files_truncated===true}:{})}};
}
export async function importMoodleCapture(actor:{user:string;device:string},raw:unknown){
 return storeMoodleCapture(actor,validateMoodleCapture(raw),{synthetic:false});
}
// Real laptop captures only enter real vaults; server-built synthetic captures only enter
// demo vaults. A reviewer signing in to a real Moodle cannot add real material to the demo.
export async function storeMoodleCapture(actor:{user:string;device:string},data:MoodleCapture,{synthetic}:{synthetic:boolean}){
 const proof=forumEvidence(data.forum_evidence,data);
 return tenant(actor.user,async c=>{
  const account=(await c.query('SELECT demo FROM schoolvault.users WHERE id=$1 AND disabled_at IS NULL',[actor.user])).rows[0];
  if(!account)throw new BetaHttpError('Account unavailable.',403);
  if(account.demo!==synthetic)throw new BetaHttpError(account.demo?'The demo account accepts only simulated collection. No material was uploaded.':'Account unavailable.',403);
  await lockVault(c,actor.user);
  const device=(await c.query('SELECT moodle_identity FROM schoolvault.companion_devices WHERE user_id=$1 AND id=$2 AND revoked_at IS NULL FOR UPDATE',[actor.user,actor.device])).rows[0];
  if(!device)throw new BetaHttpError('This laptop has been disconnected.',401);
  if(device.moodle_identity&&moodleIdentityKey(device.moodle_identity)!==moodleIdentityKey(data.identity))throw new BetaHttpError('The Moodle account changed. Use the original Moodle account. Your existing imports are preserved.',409);
  // One vault lock orders version/quota updates and simultaneous captures from two laptops.
  await c.query('SELECT user_id FROM schoolvault.vaults WHERE user_id=$1 FOR UPDATE',[actor.user]);
  const identity=(await c.query("SELECT identity FROM schoolvault.connectors WHERE user_id=$1 AND provider='moodle' FOR UPDATE",[actor.user])).rows[0];
  if(identity?.identity&&moodleIdentityKey(identity.identity)!==moodleIdentityKey(data.identity))throw new BetaHttpError('This vault is connected to a different Moodle account. Local reset preserves that account and its imports.',409);
  const selection=await currentCourseSelection(c,actor.user);
  if(selection.confirmed&&!selection.moodle_ids.includes(data.course.id))throw new BetaHttpError('This course is outside the confirmed current course selection. Review your courses before importing it.',409);
  let course=(await c.query('SELECT id FROM schoolvault.courses WHERE user_id=$1 AND moodle_id=$2',[actor.user,data.course.id])).rows[0];
  if(!course){await checkObjects(c,actor.user,'courses');course={id:randomUUID()};await c.query('INSERT INTO schoolvault.courses(user_id,id,code,title,moodle_id,url) VALUES($1,$2,$3,$3,$4,$5)',[actor.user,course.id,data.course.title,data.course.id,data.course.url]);}
  let source=(await c.query('SELECT s.id,v.sha256 FROM schoolvault.sources s LEFT JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.id=s.current_version WHERE s.user_id=$1 AND s.course_id=$2 AND s.original_url=$3 AND s.kind=\'moodle\' FOR UPDATE OF s',[actor.user,course.id,data.url])).rows[0];
  if(source){
   const observed=(await c.query('SELECT captured_at FROM schoolvault.moodle_observations WHERE user_id=$1 AND source_id=$2',[actor.user,source.id])).rows[0];
   if(observed&&new Date(observed.captured_at).getTime()>Date.parse(data.captured_at))return {saved:true,changed:false,ignored:'older_capture',source_id:source.id,course_id:course.id};
  }
  await c.query('UPDATE schoolvault.courses SET title=$3,url=$4 WHERE user_id=$1 AND id=$2',[actor.user,course.id,data.course.title,data.course.url]);
  const changed=!source||source.sha256!==digest(data.body);
  if(!source){await checkObjects(c,actor.user,'sources');source={id:randomUUID()};await c.query("INSERT INTO schoolvault.sources(user_id,id,course_id,kind,title,original_url) VALUES($1,$2,$3,'moodle',$4,$5)",[actor.user,source.id,course.id,data.title,data.url]);}
  if(changed)await sourceVersion(c,actor.user,source.id,data.body);
  const current=(await c.query('SELECT current_version FROM schoolvault.sources WHERE user_id=$1 AND id=$2',[actor.user,source.id])).rows[0];
  const work=activityWork(data.url,data.title,data.body),old=(await c.query('SELECT evidence FROM schoolvault.tasks WHERE user_id=$1 AND course_id=$2 AND external_id=$3',[actor.user,course.id,data.url])).rows[0]?.evidence;
  if(work){
   const previous=old&&(old.due_at||old.due_date)&&(old.due_at!==work.due_at||old.due_date!==work.due_date)?{due_at:old.due_at,due_date:old.due_date,version_id:old.version_id,sha256:old.sha256,observed_at:old.observed_at}:old?.previous_due;
   const evidence={...work,title:data.title,authority:synthetic?'Synthetic example':work.confirmation==='candidate'?'Observed Moodle work candidate':work.due_at||work.due_date?'Observed Moodle deadline':'Deadline needs verification',provider:'moodle',activity_url:data.url,version_id:current.current_version,sha256:digest(data.body),observed_at:data.captured_at,timezone:'America/Halifax',...(previous?{previous_due:previous}:{})};
   await c.query('INSERT INTO schoolvault.tasks(user_id,id,course_id,source_id,external_id,evidence,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id,course_id,external_id) DO UPDATE SET source_id=excluded.source_id,evidence=excluded.evidence,observed_at=excluded.observed_at',[actor.user,randomUUID(),course.id,source.id,data.url,JSON.stringify(evidence),data.captured_at]);
  }else if(!unverifiedForumSource({original_url:data.url,title:data.title})&&old?.confirmation==='candidate'&&old.active!==false){
   const evidence={...old,active:false,completion_status:'unknown',superseded_by:current.current_version,superseded_at:data.captured_at,note:'The latest captured page no longer contains the earlier work instruction. Completion was not inferred.'};
   await c.query('UPDATE schoolvault.tasks SET evidence=$4,observed_at=$5 WHERE user_id=$1 AND course_id=$2 AND external_id=$3',[actor.user,course.id,data.url,JSON.stringify(evidence),data.captured_at]);
  }
  await c.query('UPDATE schoolvault.sources SET title=$3 WHERE user_id=$1 AND id=$2',[actor.user,source.id,data.title]);
  await saveAssessmentObservation(c,actor.user,{source:source.id,version:current.current_version,device:actor.device,identity:moodleIdentityKey(data.identity),url:data.url,body:data.body,captured_at:data.captured_at,assessment:data.assessment??null,synthetic});
  await saveForumObservation(c,actor.user,{source:source.id,version:current.current_version,device:actor.device,identity:moodleIdentityKey(data.identity),url:data.url,body:data.body,captured_at:data.captured_at,proof,synthetic});
  const content={...classifyMoodleContent({url:data.url,title:data.title,course_title:data.course.title,body:data.body}),source_version_id:current.current_version,provenance:synthetic?'synthetic_capture':'signed_in_capture'};
  await c.query('INSERT INTO schoolvault.moodle_observations(user_id,source_id,device_id,captured_at,coverage) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,source_id) DO UPDATE SET device_id=excluded.device_id,captured_at=excluded.captured_at,received_at=now(),coverage=excluded.coverage',[actor.user,source.id,actor.device,data.captured_at,JSON.stringify({...data.coverage,content})]);
  await c.query("UPDATE schoolvault.companion_devices SET moodle_identity=$3,checked_at=now(),status='connected' WHERE user_id=$1 AND id=$2",[actor.user,actor.device,data.identity]);
  await c.query("INSERT INTO schoolvault.connectors(user_id,id,provider,identity,status,checked_at) VALUES($1,$2,'moodle',$3,'connected',now()) ON CONFLICT(user_id,provider) DO UPDATE SET identity=excluded.identity,status='connected',checked_at=now(),revoked_at=NULL",[actor.user,randomUUID(),data.identity]);
  await checkHistory(c,actor.user);
  return {saved:true,changed,source_id:source.id,course_id:course.id};
 });
}

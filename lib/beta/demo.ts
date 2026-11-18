import {writePassages} from './passage-writer';
import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {writeFile,unlink} from 'node:fs/promises';
import type {PoolClient} from 'pg';
import {betaPool,tenant} from './db';
import {BetaHttpError,peerAddress} from './http';
import {digest} from './auth';
import {demoCode} from './config';
import {sourceVersion} from './vault';
import {betaFilePath} from './files';
import {storeMoodleCapture} from './companion';
import {saveCurrentCourseSelection} from './course-selection';
import {admitCompanionDevice,checkHistory} from './budget';
import {demoSeed,demoSeedVersion,demoName,demoEmail,demoIdentity,demoQuotaBytes,demoTextQuotaBytes,sampleDeviceLabel} from './demo-data';
// Reviewer demo mode. The demo account is an ordinary tenant: every read and write below runs
// in tenant(demo id), so forced row-level security confines it exactly like a student vault.
export const demoSessionSeconds=8*3600;
export const demoLimits={clientFailures:5,globalFailures:25,startsPerHour:40,resetsPerDay:3,tenantDays:14};
const tenantLock="SELECT pg_advisory_xact_lock(hashtext('schoolvault-demo-tenant'))";
const attemptLock="SELECT pg_advisory_xact_lock(hashtext('schoolvault-demo-attempts'))";
const sha=(value:string)=>createHash('sha256').update(value,'utf8').digest();
// Fixed-length digests make the comparison constant-time and independent of code length.
export function demoCodeMatches(input:unknown,configured:string){return typeof input==='string'&&input.length<=256&&timingSafeEqual(sha(input.trim()),sha(configured));}
// Per-client key from the connecting peer (hashed, never stored raw). The first
// X-Forwarded-For entry is client-supplied, so it could be rotated to dodge the limit.
export function demoClientKey(request:Request){const client=peerAddress(request);return createHash('sha256').update('schoolvault-demo-client:'+client).digest('hex');}
async function checkDemoCode(code:unknown,client:string){
 const configured=demoCode();if(!configured)throw new BetaHttpError('Demo access is not available.',404);
 return tenant(randomUUID(),async c=>{
  await c.query(attemptLock);
  await c.query("DELETE FROM schoolvault.demo_attempts WHERE created_at<now()-interval '2 days'");
  const r=(await c.query(`SELECT count(*) FILTER(WHERE kind='code' AND NOT success AND client_hash=$1 AND created_at>now()-interval '15 minutes') AS mine,
   count(*) FILTER(WHERE kind='code' AND NOT success AND created_at>now()-interval '15 minutes') AS failures,
   count(*) FILTER(WHERE kind='code' AND success AND created_at>now()-interval '1 hour') AS starts FROM schoolvault.demo_attempts`,[client])).rows[0];
  // While limited, even the right code is refused, so guessing cannot continue.
  if(Number(r.mine)>=demoLimits.clientFailures||Number(r.failures)>=demoLimits.globalFailures||Number(r.starts)>=demoLimits.startsPerHour)throw new BetaHttpError('Too many attempts. Wait 15 minutes, then try again.',429);
  const ok=demoCodeMatches(code,configured);
  await c.query('INSERT INTO schoolvault.demo_attempts(id,kind,client_hash,success) VALUES($1,$2,$3,$4)',[randomUUID(),'code',client,ok]);
  return ok;
 });
}
export async function createDemoSession(user:string){
 const raw=randomBytes(32).toString('base64url');
 await tenant(user,async c=>{
  if(!(await c.query('SELECT id FROM schoolvault.users WHERE id=$1 AND demo AND disabled_at IS NULL',[user])).rowCount)throw new BetaHttpError('The demo account is unavailable. Enter the demo code again.',409);
  await c.query('INSERT INTO schoolvault.sessions(token_hash,user_id,expires_at,demo) VALUES($1,$2,now()+make_interval(secs=>$3),true)',[digest(raw),user,demoSessionSeconds]);
 });
 return raw;
}
export async function startDemoSession(code:unknown,client:string){
 if(!await checkDemoCode(code,client))throw new BetaHttpError('That demo code is not valid.',401);
 return createDemoSession(await ensureDemoTenant());
}
async function activeDemo(c:PoolClient){return (await c.query('SELECT id,created_at FROM schoolvault.users WHERE demo AND disabled_at IS NULL')).rows[0] as {id:string;created_at:Date}|undefined;}
// Append-only history cannot be deleted, so a reset retires the tenant (its sessions and
// laptop grants stop working) and provisions a fresh one. Real accounts are never touched.
async function retireActiveDemo(c:PoolClient){
 await c.query('SELECT schoolvault.revoke_active_demo_sessions()');
 await c.query('UPDATE schoolvault.users SET disabled_at=now() WHERE demo AND disabled_at IS NULL');
}
async function provisionDemo(c:PoolClient,user:string,now:Date,written:{file?:string}){
 const seed=demoSeed(now),courses=new Map<string,string>(),sources=new Map<string,{id:string;course:string}>();
 await c.query('INSERT INTO schoolvault.users(id,google_sub,email,name,demo,created_at) VALUES($1,$2,$3,$4,true,$5)',[user,'schoolvault-demo:'+user,demoEmail,demoName,now]);
 await c.query('INSERT INTO schoolvault.vaults(user_id,quota_bytes,text_quota_bytes) VALUES($1,$2,$3)',[user,demoQuotaBytes,demoTextQuotaBytes]);
 for(const course of seed.courses){const id=randomUUID();courses.set(course.key,id);await c.query('INSERT INTO schoolvault.courses(user_id,id,code,title,kind,moodle_id,url) VALUES($1,$2,$3,$4,$5,$6,$7)',[user,id,course.code,course.title,course.kind,course.moodle_id,course.url]);}
 for(const note of seed.notes){
  const course=courses.get(note.course)!,source=randomUUID();
  await c.query("INSERT INTO schoolvault.sources(user_id,id,course_id,kind,title) VALUES($1,$2,$3,'note',$4)",[user,source,course,note.title]);
  await sourceVersion(c,user,source,note.body);
  await c.query("INSERT INTO schoolvault.notes(user_id,id,course_id,source_id,title,body,origin) VALUES($1,$2,$3,$4,$5,$6,'demo')",[user,randomUUID(),course,source,note.title,note.body]);
 }
 // A sample laptop with no token: it shows what a connected device looks like and cannot authenticate.
 const device=randomUUID();
 await c.query("INSERT INTO schoolvault.companion_devices(user_id,id,label,moodle_identity,status,checked_at) VALUES($1,$2,$3,$4,'connected',$5)",[user,device,sampleDeviceLabel,demoIdentity,seed.captured_at]);
 // The synthetic fixture represents an already selected sample lecture. Without
 // this event, Today excludes its Moodle course while retaining the manual lab.
 await saveCurrentCourseSelection(c,user,device,{identity:demoIdentity,identity_key:'1010',moodle_ids:seed.courses.flatMap(course=>course.moodle_id?[course.moodle_id]:[]),reviewed_at:now.toISOString(),selection_source:'moodle-inprogress'});
 await c.query("INSERT INTO schoolvault.connectors(user_id,id,provider,identity,status,checked_at) VALUES($1,$2,'moodle',$3,'connected',$4)",[user,randomUUID(),demoIdentity,seed.captured_at]);
 for(const page of seed.captures){
  const course=courses.get(page.course)!,id=randomUUID();sources.set(page.key,{id,course});
  await c.query("INSERT INTO schoolvault.sources(user_id,id,course_id,kind,title,original_url) VALUES($1,$2,$3,'moodle',$4,$5)",[user,id,course,page.capture.title,page.capture.url]);
  await sourceVersion(c,user,id,page.capture.body);
  await c.query('INSERT INTO schoolvault.moodle_observations(user_id,source_id,device_id,captured_at,coverage) VALUES($1,$2,$3,$4,$5)',[user,id,device,page.capture.captured_at,JSON.stringify(page.capture.coverage)]);
 }
 const file=seed.file,bytes=Buffer.from(file.body,'utf8'),fileCourse=courses.get(file.course)!,fileSource=randomUUID(),version=randomUUID(),key=randomUUID();
 // The shared byte budget counts the example file like any upload.
 if(!(await c.query('UPDATE schoolvault.storage_budget SET used_bytes=used_bytes+$1 WHERE id=true AND used_bytes+$1<=limit_bytes RETURNING used_bytes',[bytes.length])).rowCount)throw new BetaHttpError('File storage is full. The demo account could not be prepared.',409);
 const path=await betaFilePath(user,key);await writeFile(path,bytes,{mode:0o600,flag:'wx'});written.file=path;
 await c.query("INSERT INTO schoolvault.sources(user_id,id,course_id,kind,title,current_version) VALUES($1,$2,$3,'file',$4,$5)",[user,fileSource,fileCourse,file.name,version]);
 await c.query('INSERT INTO schoolvault.source_versions(user_id,id,source_id,body,sha256,object_key,mime,bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[user,version,fileSource,file.body,createHash('sha256').update(bytes).digest('hex'),key,file.mime,bytes.length]);
 await writePassages(c,user,fileSource,version,file.body);
 sources.set(file.key,{id:fileSource,course:fileCourse});
 // Tasks and class times cite a source in their own course (enforced by foreign keys too).
 for(const task of seed.tasks){const s=sources.get(task.source)!;await c.query('INSERT INTO schoolvault.tasks(user_id,id,course_id,source_id,external_id,evidence,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[user,randomUUID(),s.course,s.id,task.external_id,JSON.stringify(task.evidence),seed.captured_at]);}
 for(const meeting of seed.meetings){const s=sources.get(meeting.source)!;await c.query('INSERT INTO schoolvault.meetings(user_id,id,course_id,source_id,schedule) VALUES($1,$2,$3,$4,$5)',[user,randomUUID(),s.course,s.id,JSON.stringify(meeting.schedule)]);}
 await c.query("INSERT INTO schoolvault.audit(user_id,id,action,target,details) VALUES($1,$2,'demo-seeded',$1,$3)",[user,randomUUID(),JSON.stringify({seed_version:demoSeedVersion})]);
}
// If provisioning did not commit, remove its example file. Keep it when absence is uncertain.
async function discardUnsaved(user:string,written:{file?:string}){
 if(!written.file)return;
 try{if(!(await betaPool().query('SELECT 1 FROM schoolvault.users WHERE id=$1',[user])).rowCount)await unlink(written.file);}catch{}
}
// Idempotent: returns the active demo tenant, provisioning (and seeding) it only when none is
// active or it has aged past tenantDays. Concurrent callers serialize on an advisory lock.
export async function ensureDemoTenant(now=new Date()){
 const fresh=randomUUID(),written:{file?:string}={};
 try{
  return await tenant(fresh,async c=>{
   await c.query(tenantLock);
   const active=await activeDemo(c);
   if(active&&now.getTime()-new Date(active.created_at).getTime()<demoLimits.tenantDays*86400000)return active.id;
   await retireActiveDemo(c);await provisionDemo(c,fresh,now,written);return fresh;
  });
 }catch(error){await discardUnsaved(fresh,written);throw error;}
}
export async function resetDemoTenant(current:string,client:string,now=new Date()){
 const fresh=randomUUID(),written:{file?:string}={};
 try{
  await tenant(fresh,async c=>{
   await c.query(attemptLock);
   const recent=Number((await c.query("SELECT count(*) FROM schoolvault.demo_attempts WHERE kind='reset' AND success AND created_at>now()-interval '24 hours'")).rows[0].count);
   if(recent>=demoLimits.resetsPerDay)throw new BetaHttpError('The demo account was reset recently. Try again later, or keep using the current demo data.',429);
   await c.query(tenantLock);
   const active=await activeDemo(c);
   if(!active||active.id!==current)throw new BetaHttpError('This demo session has ended. Enter the demo code again.',401);
   await retireActiveDemo(c);await provisionDemo(c,fresh,now,written);
   await c.query("INSERT INTO schoolvault.demo_attempts(id,kind,client_hash,success) VALUES($1,'reset',$2,true)",[randomUUID(),client]);
  });
 }catch(error){await discardUnsaved(fresh,written);throw error;}
 return createDemoSession(fresh);
}
// Replays the tenant's synthetic Moodle pages through the real import path (versioning,
// observations, coverage). From the web it uses the sample laptop; from a paired companion,
// that device. Refused outright for real accounts.
export async function simulateDemoCollection(actor:{user:string;device?:string}){
 const prepared=await tenant(actor.user,async c=>{
  const account=(await c.query('SELECT created_at FROM schoolvault.users WHERE id=$1 AND demo AND disabled_at IS NULL',[actor.user])).rows[0];
  if(!account)throw new BetaHttpError('Simulated collection is only available in the demo account.',403);
  if(actor.device){
   if(!(await c.query('SELECT id FROM schoolvault.companion_devices WHERE user_id=$1 AND id=$2 AND revoked_at IS NULL',[actor.user,actor.device])).rowCount)throw new BetaHttpError('This laptop has been disconnected.',401);
   return {device:actor.device,seeded:new Date(account.created_at)};
  }
  await c.query('SELECT user_id FROM schoolvault.vaults WHERE user_id=$1 FOR UPDATE',[actor.user]);
  let device=(await c.query('SELECT id FROM schoolvault.companion_devices WHERE user_id=$1 AND label=$2 AND revoked_at IS NULL ORDER BY created_at LIMIT 1',[actor.user,sampleDeviceLabel])).rows[0]?.id as string|undefined;
  if(!device){
   await admitCompanionDevice(c,actor.user);
   if(Number((await c.query('SELECT count(*) FROM schoolvault.companion_devices WHERE user_id=$1 AND revoked_at IS NULL',[actor.user])).rows[0].count)>=5)throw new BetaHttpError('Disconnect an old laptop before running a simulated collection.');
   device=randomUUID();await c.query("INSERT INTO schoolvault.companion_devices(user_id,id,label,status) VALUES($1,$2,$3,'waiting')",[actor.user,device,sampleDeviceLabel]);
   await checkHistory(c,actor.user);
  }
  return {device,seeded:new Date(account.created_at)};
 });
 const seed=demoSeed(prepared.seeded),pages=[...seed.captures,...seed.laterCaptures];let changed=0;
 for(const page of pages)if((await storeMoodleCapture({user:actor.user,device:prepared.device},{...page.capture,captured_at:new Date().toISOString()},{synthetic:true})).changed)changed++;
 return {simulated:true,pages:pages.length,changed,coverage_issues:pages.reduce((n,p)=>n+p.capture.coverage.issues.length,0)};
}

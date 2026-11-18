// Internal server/operator orchestration only. No public route accepts verifier
// JSON, source bindings or Moodle tokens. This does not grant official authority.
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import type {PoolClient} from 'pg';
import {tenant,uuid} from './db';
import {checkHistory,lockVault} from './budget';
import {currentCourseSelection} from './course-selection';
import {forumEvidence} from './forum-evidence';
import {lockRecoveryAccount} from './recovery';

const action='moodle-api-post-check-request',finished='moodle-api-post-check-result';
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const canonical=(v:any):string=>JSON.stringify(v===null?null:Array.isArray(v)?v.map(x=>JSON.parse(canonical(x))):typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(canonical(v[k]))])):v);
const positive=(v:unknown)=>typeof v==='string'&&/^[1-9]\d{0,11}$/.test(v);
const hex=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const fail=():never=>{throw Error('Moodle API check unavailable; saved evidence and authority are unchanged.');};
export type PostBinding={user_id:string;source_id:string;version_id:string;body_sha256:string;course_id:string;viewer_id:string;discussion_id:string;activity_id:string;post_id:string;author_id:string;post_text:string;post_sha256:string;role_ids:string[]};
type Runner=(binding:PostBinding,token:string)=>Promise<unknown>;
type Snapshot={binding:PostBinding;evidence_id:string;device_id:string;proof_sha256:string;checked_at:string;course_review:string|null};

// No inherited environment/credentials, shell, argv token, redirects or browser
// session. The Python CLI additionally bounds the complete TLS operation.
export async function runMoodlePostVerifier(binding:PostBinding,token:string):Promise<unknown>{
 if(typeof token!=='string'||!/^[A-Za-z0-9]{16,128}$/.test(token))fail();
 const input=JSON.stringify({binding,token});if(Buffer.byteLength(input)>262144)fail();
 const script=fileURLToPath(new URL('../../scripts/moodle_post_verifier.py',import.meta.url));
 return new Promise((resolve,reject)=>{
  const child=spawn('/usr/bin/python3',['-I','-B',script],{env:{PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8',NODE_ENV:'production'},stdio:['pipe','pipe','pipe']});
  const chunks:Buffer[]=[];let bytes=0,failed=false,killTimer:NodeJS.Timeout|undefined;
  const stop=()=>{failed=true;if(!child.killed)child.kill('SIGTERM');killTimer??=setTimeout(()=>child.kill('SIGKILL'),500);};
  const timer=setTimeout(stop,32000);
  child.stdout.on('data',(b:Buffer)=>{bytes+=b.length;if(bytes>65536)stop();else chunks.push(b);});
  child.stderr.on('data',()=>stop());child.stdin.on('error',()=>stop());
  child.on('error',()=>{failed=true;});
  child.on('close',code=>{
   clearTimeout(timer);if(killTimer)clearTimeout(killTimer);
   try{if(failed||code!==0)fail();const output=Buffer.concat(chunks).toString('utf8');if(output.includes(token))fail();resolve(JSON.parse(output));}catch{reject(Error('Moodle API check unavailable; no credential or provider error is returned.'));}
  });
  child.stdin.end(input);
 });
}

async function snapshot(c:PoolClient,user:string,source:string,post:string):Promise<Snapshot>{
 const row=(await c.query(`SELECT s.id,s.kind,s.original_url,s.current_version,v.body,v.sha256,co.moodle_id,
  e.id AS evidence_id,e.device_id,e.identity_key,e.proof_sha256,e.body_sha256,e.proof,e.provenance,e.captured_at,
  k.captured_at AS checked_at,d.moodle_identity,cn.identity AS connector_identity
  FROM schoolvault.sources s
  JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.source_id=s.id AND v.id=s.current_version
  JOIN schoolvault.courses co ON co.user_id=s.user_id AND co.id=s.course_id
  JOIN schoolvault.users u ON u.id=s.user_id AND u.disabled_at IS NULL AND u.demo=false
  JOIN schoolvault.moodle_forum_checks k ON k.user_id=s.user_id AND k.source_id=s.id
  JOIN schoolvault.moodle_forum_evidence e ON e.user_id=k.user_id AND e.source_id=k.source_id AND e.id=k.evidence_id AND e.version_id=s.current_version
  JOIN schoolvault.companion_devices d ON d.user_id=e.user_id AND d.id=e.device_id AND d.revoked_at IS NULL
  JOIN schoolvault.connectors cn ON cn.user_id=s.user_id AND cn.provider='moodle' AND cn.revoked_at IS NULL AND cn.status='connected'
  WHERE s.user_id=$1 AND s.id=$2`,[user,source])).rows[0];
 if(!row||row.kind!=='moodle'||row.provenance!=='signed_in_capture'||!positive(row.moodle_id)||!positive(row.identity_key)||sha(row.body)!==row.sha256||row.body_sha256!==row.sha256)fail();
 const identity=(v:unknown)=>typeof v==='string'?v.match(/^moodle-user:([1-9]\d{0,11})(?:\s*·.*)?$/)?.[1]:null;
 if(identity(row.moodle_identity)!==row.identity_key||identity(row.connector_identity)!==row.identity_key)fail();
 const proof=forumEvidence(row.proof,{url:row.original_url,body:row.body,identity:'moodle-user:'+row.identity_key,course:{id:row.moodle_id},captured_at:new Date(row.captured_at).toISOString()});
 if(!proof||proof.state!=='observed_posts')fail();
 const p=proof.posts.find(p=>p.post_id===post);if(!p)fail();
 const role=proof.roles.find(r=>r.author_id===p.author_id);
 const selection=await currentCourseSelection(c,user);
 if(selection.confirmed&&!selection.moodle_ids.includes(row.moodle_id))fail();
 return {binding:{user_id:user,source_id:source,version_id:row.current_version,body_sha256:row.sha256,course_id:row.moodle_id,viewer_id:row.identity_key,discussion_id:proof.discussion_id,activity_id:proof.activity_id,post_id:p.post_id,author_id:p.author_id,post_text:row.body.slice(p.start,p.end),post_sha256:p.sha256,role_ids:(role?.roles||[]).map(r=>r.role_id)},evidence_id:row.evidence_id,device_id:row.device_id,proof_sha256:row.proof_sha256,checked_at:new Date(row.checked_at).toISOString(),course_review:selection.revision};
}
function publicSnapshot(s:Snapshot){const {post_text,...binding}=s.binding;return {...s,binding};}
function checkedResult(raw:any,s:Snapshot,started:number,token:string){
 const expected=publicSnapshot(s).binding;
 const fields=['format','state','origin','checked_at','binding','binding_sha256','provider_post_version','current_course_roles','captured_role_ids_match','content_representation','layout_verified','historical_roles_verified','source_record_verified','heading_verified','all_roles_verified','authority','official_promotion_allowed','persistence_enabled'];
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length!==fields.length||Object.keys(raw).some(k=>!fields.includes(k))||Buffer.byteLength(JSON.stringify(raw))>32768||JSON.stringify(raw).includes(token))fail();
 const now=Date.now(),at=Date.parse(raw.checked_at);
 if(raw.format!=='neyvu-moodle-api-post-check/1'||raw.origin!=='https://moodle.acadiau.ca'||!Number.isFinite(at)||at<started-1000||at>now+1000||canonical(raw.binding)!==canonical(expected)||raw.binding_sha256!==sha(canonical(expected)))fail();
 const version=raw.provider_post_version,roles=raw.current_course_roles;
 if(!version||canonical(Object.keys(version).sort())!==canonical(['post_id','author_id','discussion_id','modified','message_format','api_message_sha256'].sort())||version.post_id!==expected.post_id||version.author_id!==expected.author_id||version.discussion_id!==expected.discussion_id||!Number.isSafeInteger(version.modified)||version.modified<=0||![1,2].includes(version.message_format)||!hex(version.api_message_sha256))fail();
 if(!Array.isArray(roles)||!roles.length||roles.length>20||roles.some((r:any)=>!r||Object.keys(r).sort().join(',')!=='role_id,shortname'||!positive(r.role_id)||typeof r.shortname!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(r.shortname))||new Set(roles.map((r:any)=>r.role_id)).size!==roles.length)fail();
 const match=expected.role_ids.length>0&&canonical([...expected.role_ids].sort())===canonical(roles.map((r:any)=>r.role_id).sort());
 if(raw.captured_role_ids_match!==match||raw.state!==(match?'post_and_roles_matched':'post_matched_roles_need_review')||raw.content_representation!=='bounded_plain_text_projection'||raw.authority!=='unverified'||['layout_verified','historical_roles_verified','source_record_verified','heading_verified','all_roles_verified','official_promotion_allowed','persistence_enabled'].some(k=>raw[k]!==false))fail();
 return JSON.parse(JSON.stringify(raw));
}
async function resultFor(c:PoolClient,user:string,request:string){return (await c.query('SELECT id,details FROM schoolvault.audit WHERE user_id=$1 AND target=$2 AND action=$3 ORDER BY created_at,id LIMIT 1',[user,request,finished])).rows[0];}
async function priorReceipt(c:PoolClient,user:string,source:string,post:string,request:string){
 const old=(await c.query('SELECT action,target,details FROM schoolvault.audit WHERE user_id=$1 AND id=$2',[user,request])).rows[0];
 if(!old)return null;
 if(old.action!==action||old.target!==source||old.details?.post_id!==post)fail();const result=await resultFor(c,user,request);
 let current=false;if(result?.details?.snapshot){try{current=canonical(publicSnapshot(await snapshot(c,user,source,post)))===canonical(result.details.snapshot);}catch{}}
 return {...(result?.details||{state:'pending_or_interrupted',request_id:request,authority:'unverified',official_promotion_allowed:false}),current_at_readback:current,fresh_provider_read:false,replayed:true};
}
// Read an interrupted operation without asking for or reusing a Moodle token.
export async function inspectForumApiCheck(user:string,source:string,post:string,request:string){
 if(!uuid(user)||!uuid(source)||!uuid(request)||!positive(post))fail();
 user=user.toLowerCase();source=source.toLowerCase();request=request.toLowerCase();
 return tenant(user,async c=>{
  await lockRecoveryAccount(c,user);await lockVault(c,user);
  if(!(await c.query('SELECT 1 FROM schoolvault.users WHERE id=$1 AND disabled_at IS NULL AND demo=false',[user])).rowCount)fail();
  return await priorReceipt(c,user,source,post,request)||{state:'not_started',request_id:request,authority:'unverified',official_promotion_allowed:false,current_at_readback:false,fresh_provider_read:false,replayed:false};
 });
}

// The runner is an internal transport seam for tests/private operators, never a
// request field. Production callers must use the fixed default CLI. Request IDs
// are durable: inspect a pending/failed operation; never silently repeat it.
export async function corroborateSavedForumPost(user:string,source:string,post:string,request:string,token:string,runner:Runner=runMoodlePostVerifier){
 if(!uuid(user)||!uuid(source)||!uuid(request)||!positive(post)||typeof token!=='string'||!/^[A-Za-z0-9]{16,128}$/.test(token))fail();
 // Transport replacement is possible only against the exact disposable local
 // fixture family, never a production connection or a caller-uploaded result.
 if(runner!==runMoodlePostVerifier){
  const db=new URL(process.env.SCHOOL_BETA_DATABASE_URL||'');
  if(db.hostname!=='127.0.0.1'||db.port!=='55432'||!/^\/schoolvault_profiles_\d{8}t\d{6}z$/.test(db.pathname)||db.username!==db.pathname.slice(1)+'_runtime')fail();
 }
 user=user.toLowerCase();source=source.toLowerCase();request=request.toLowerCase();
 const started=Date.now();
 const prepared=await tenant(user,async c=>{
  await lockRecoveryAccount(c,user);await lockVault(c,user);
  if(!(await c.query('SELECT 1 FROM schoolvault.users WHERE id=$1 AND disabled_at IS NULL AND demo=false',[user])).rowCount)fail();
  const prior=await priorReceipt(c,user,source,post,request);if(prior)return {prior};
  const s=await snapshot(c,user,source,post);
  if(Number((await c.query("SELECT count(*) FROM schoolvault.audit WHERE user_id=$1 AND action=$2 AND created_at>now()-interval '1 hour'",[user,action])).rows[0].count)>=20)fail();
  await c.query('INSERT INTO schoolvault.audit(user_id,id,action,target,details) VALUES($1,$2,$3,$4,$5)',[user,request,action,source,JSON.stringify({post_id:post,snapshot:publicSnapshot(s),started_at:new Date(started).toISOString()})]);
  await checkHistory(c,user);return {snapshot:s};
 });
 if('prior' in prepared)return prepared.prior;
 const s=prepared.snapshot!;
 let result:any;
 try{
  result=checkedResult(await runner(structuredClone(s.binding),token),s,started,token);
  return await tenant(user,async c=>{
   await lockRecoveryAccount(c,user);await lockVault(c,user);
   if(Date.now()-started>40000||canonical(publicSnapshot(await snapshot(c,user,source,post)))!==canonical(publicSnapshot(s)))fail();
   if(await resultFor(c,user,request))fail();
   const receipt={state:'observed_api_match',request_id:request,saved_source_binding_verified:true,snapshot:publicSnapshot(s),provider_observation:result,authority:'unverified',official_promotion_allowed:false,checked_at:result.checked_at};
   await c.query('INSERT INTO schoolvault.audit(user_id,id,action,target,details) VALUES($1,$2,$3,$4,$5)',[user,randomUUID(),finished,request,JSON.stringify(receipt)]);
   await checkHistory(c,user);return {...receipt,current_at_readback:true,fresh_provider_read:true,replayed:false};
  });
 }catch{
  // No provider/body/token/error text is recorded. Quota or account removal may
  // also prevent this event; the durable intent then stays inspectably pending.
  await tenant(user,async c=>{await lockRecoveryAccount(c,user);await lockVault(c,user);if(await resultFor(c,user,request))return;await c.query('INSERT INTO schoolvault.audit(user_id,id,action,target,details) VALUES($1,$2,$3,$4,$5)',[user,randomUUID(),finished,request,JSON.stringify({state:'unavailable_or_changed',request_id:request,authority:'unverified',official_promotion_allowed:false})]);await checkHistory(c,user);}).catch(()=>{});
  fail();
 }
}

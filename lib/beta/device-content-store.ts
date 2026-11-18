import {writePassages} from './passage-writer';
import {createHash,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {tenant,uuid} from './db';
import {lockVault,checkHistory,checkObjects} from './budget';
import {BetaHttpError} from './http';
import {moodleIdentityKey} from './companion';
import {validateMoodleFileMetadata,type MoodleFileMetadata} from './moodle-files';
import {currentCourseSelection} from './course-selection';
import {sourceChanged} from './source-dependencies';
import {deriveFileWork} from './file-work';
import {textLimit} from './vault';
import {validateDevicePdfManifest,validateDeviceContentBatch,validateDevicePdfCommit,deviceContentNegotiation,devicePdfManifestDigest} from './device-content';
export const deviceTransferTask='device-content-v1';
export const deviceTransferLifetimeMs=60*60*1000;
type Actor={user:string;device:string;grantHash:string};
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const canonical=(v:any):string=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
function fields(value:any,keys:string[]){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k)))throw new BetaHttpError('Invalid device content operation.');}
function enabled(){if(process.env.SCHOOL_BETA_DEVICE_CONTENT!=='1')throw new BetaHttpError('Device content transfer is not enabled. Your originals and saved sources are preserved.',503);}
async function core(c:PoolClient,actor:Actor){
 if(!uuid(actor.user)||!uuid(actor.device)||! /^[a-f0-9]{64}$/.test(actor.grantHash))throw new BetaHttpError('Reconnect this Companion.',401);
 const grant=(await c.query('SELECT user_id,device_id,demo FROM schoolvault.companion_actor($1)',[actor.grantHash])).rows[0];
 if(!grant||grant.demo||grant.user_id!==actor.user||grant.device_id!==actor.device)throw new BetaHttpError('Reconnect this Companion.',401);
 const account=(await c.query('SELECT id FROM schoolvault.users WHERE id=$1 AND disabled_at IS NULL AND demo=false',[actor.user])).rows[0];if(!account)throw new BetaHttpError('Account unavailable.',403);
 const device=(await c.query('SELECT moodle_identity FROM schoolvault.companion_devices WHERE user_id=$1 AND id=$2 AND revoked_at IS NULL FOR UPDATE',[actor.user,actor.device])).rows[0];
 const connector=(await c.query("SELECT identity,revoked_at FROM schoolvault.connectors WHERE user_id=$1 AND provider='moodle' FOR UPDATE",[actor.user])).rows[0];
 if(!device)throw new BetaHttpError('This Companion was disconnected.',401);
 return {device,connector};
}
async function scope(c:PoolClient,actor:Actor,data:MoodleFileMetadata,revision?:string){
 const {device,connector}=await core(c,actor);
 if(!device.moodle_identity||!connector?.identity||connector.revoked_at||moodleIdentityKey(device.moodle_identity)!==data.identity_key||moodleIdentityKey(connector.identity)!==data.identity_key)throw new BetaHttpError('The Moodle account changed. Reconnect the original account.',409);
 const selection=await currentCourseSelection(c,actor.user);
 if(!selection.confirmed||!selection.moodle_ids.includes(data.course.id)||revision!==undefined&&selection.revision!==revision)throw new BetaHttpError('The current course review changed. Keep the original and start a new transfer after reviewing courses.',409);
 const course=(await c.query('SELECT id FROM schoolvault.courses WHERE user_id=$1 AND moodle_id=$2 AND url=$3',[actor.user,data.course.id,data.course.url])).rows[0];
 if(!course)throw new BetaHttpError('Import this current Moodle course before transferring its contents.',409);
 return {course:course.id as string,revision:selection.revision!};
}
async function prune(c:PoolClient,user:string){await c.query("UPDATE schoolvault.jobs SET status='failed',input=input-'batches'-'manifest',error='Device content transfer expired. The original and existing source are preserved.',updated_at=clock_timestamp() WHERE user_id=$1 AND kind='collect' AND input->>'task'=$2 AND status='queued' AND (input->>'expires_at')::timestamptz<=clock_timestamp()",[user,deviceTransferTask]);}
async function matches(c:PoolClient,user:string,course:string,url:string){return (await c.query(`SELECT s.id,s.current_version,v.sha256,v.bytes,v.object_key,v.mime FROM schoolvault.sources s JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.source_id=s.id AND v.id=s.current_version WHERE s.user_id=$1 AND s.course_id=$2 AND s.kind='file' AND s.original_url=$3 FOR UPDATE OF s`,[user,course,url])).rows;}
function view(job:any){const i=job.input,r=job.result;return {session_id:job.id,manifest_sha256:i.manifest_sha256,state:job.status==='queued'?'receiving':job.status==='complete'?'committed':job.status,expires_at:i.expires_at,received:(i.batches||r?.batches||[]).map((b:any)=>({index:b.index,sha256:b.sha256,bytes:b.bytes??Buffer.byteLength(b.text)})).sort((a:any,b:any)=>a.index-b.index),...(job.status==='complete'?{receipt:{source_id:r.source_id,version_id:r.version_id,manifest_sha256:r.manifest_sha256,text_sha256:r.text_sha256,original_sha256:r.original_sha256,original_cleanup_allowed:false}}:{}),...(job.error?{message:job.error}:{})};}
async function checkedView(c:PoolClient,user:string,job:any){
 const out=view(job);if(job.status!=='complete')return out;
 const r=job.result,m=r.device_content.manifest;
 const source=(await c.query('SELECT s.current_version,v.body,v.sha256,v.bytes,v.mime FROM schoolvault.sources s JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.source_id=s.id AND v.id=$3 WHERE s.user_id=$1 AND s.id=$2',[user,r.source_id,r.version_id])).rows[0];
 if(!source||source.sha256!==r.original_sha256||Number(source.bytes)!==m.original.bytes||source.mime!=='application/pdf'||hash(source.body)!==r.text_sha256||devicePdfManifestDigest(m)!==job.input.manifest_sha256)throw new BetaHttpError('The saved receipt no longer matches its immutable source. Keep the original and review this transfer.',409);
 return {...out,receipt:{...out.receipt,current_at_readback:source.current_version===r.version_id,source_binding_checked:true}};
}
async function load(c:PoolClient,actor:Actor,id:unknown,digest:unknown){
 if(!uuid(id)||typeof digest!=='string'||! /^[a-f0-9]{64}$/.test(digest))throw new BetaHttpError('Choose the saved transfer and manifest.');
 const j=(await c.query("SELECT * FROM schoolvault.jobs WHERE user_id=$1 AND id=$2 AND kind='collect' AND input->>'task'=$3 FOR UPDATE",[actor.user,id,deviceTransferTask])).rows[0];
 if(!j||j.input.device_id!==actor.device||j.input.grant_hash!==actor.grantHash)throw new BetaHttpError('Transfer not found for this Companion.',404);
 if(j.input.manifest_sha256!==digest)throw new BetaHttpError('The transfer manifest changed. Keep the original.',409);return j;
}
export async function deviceContentAction(actor:Actor,op:string,body:any){
 if(!['inspect','cancel'].includes(op))enabled();return tenant(actor.user,async c=>{
  await lockVault(c,actor.user);await core(c,actor);await prune(c,actor.user);
  if(op==='negotiate'){fields(body,[]);return {enabled:true,...deviceContentNegotiation(),session_lifetime_seconds:deviceTransferLifetimeMs/1000,max_active_sessions:3,legacy_binary_path:'separate; refuses to overwrite device-read source'};}
  if(op==='begin'){
   fields(body,['metadata','manifest']);const manifest=validateDevicePdfManifest(body.manifest),digest=devicePdfManifestDigest(manifest);
   const data=validateMoodleFileMetadata(body.metadata,'application/pdf');if(data.sha256!==manifest.original.sha256)throw new BetaHttpError('Original metadata and manifest hashes differ.',409);
   const bound=await scope(c,actor,data),intent=hash(canonical({metadata:data,manifest_sha256:digest,device:actor.device,grant:actor.grantHash}));
   const old=(await c.query('SELECT * FROM schoolvault.jobs WHERE user_id=$1 AND request_id=$2 FOR UPDATE',[actor.user,manifest.request_id])).rows[0];
   if(old){if(old.kind!=='collect'||old.input.task!==deviceTransferTask||old.input.intent_sha256!==intent)throw new BetaHttpError('This request ID was already used for different content.',409);return checkedView(c,actor.user,old);}
   const counts=(await c.query("SELECT count(*)::int AS total,count(*) FILTER(WHERE status='queued')::int AS active,count(*) FILTER(WHERE created_at>clock_timestamp()-interval '1 hour')::int AS recent FROM schoolvault.jobs WHERE user_id=$1 AND kind='collect' AND input->>'task'=$2",[actor.user,deviceTransferTask])).rows[0];
   if(counts.active>=3||counts.recent>=20||counts.total>=1000)throw new BetaHttpError('Device transfers are busy or have reached their beta limit. Finish or cancel an existing transfer first.',429);
   const saved=await matches(c,actor.user,bound.course,data.source_url);if(saved.length>1)throw new BetaHttpError('Conflicting saved originals need review. Existing sources are preserved.',409);
   if(saved.length){const last=(await c.query("SELECT details->>'captured_at' AS captured_at FROM schoolvault.audit WHERE user_id=$1 AND target=$2 AND action IN('moodle-file-collected','device-content-committed') ORDER BY created_at DESC,id DESC LIMIT 1",[actor.user,saved[0].id])).rows[0];if(last&&Date.parse(last.captured_at)>Date.parse(data.captured_at))throw new BetaHttpError('An older capture cannot replace a newer original.',409);}
   const at=(await c.query('SELECT clock_timestamp() AS now')).rows[0].now as Date;
   const input={task:deviceTransferTask,device_id:actor.device,grant_hash:actor.grantHash,course_id:bound.course,selection_revision:bound.revision,source_id:saved[0]?.id||randomUUID(),expected_version:saved[0]?.current_version||null,intent_sha256:intent,metadata:data,manifest_sha256:digest,manifest,expires_at:new Date(at.getTime()+deviceTransferLifetimeMs).toISOString(),batches:[]};
   const j=(await c.query("INSERT INTO schoolvault.jobs(user_id,id,kind,request_id,input) VALUES($1,$2,'collect',$3,$4) RETURNING *",[actor.user,randomUUID(),manifest.request_id,input])).rows[0];await checkHistory(c,actor.user);return view(j);
  }
  fields(body,op==='batch'?['session_id','manifest_sha256','batch']:['session_id','manifest_sha256']);
  const job=await load(c,actor,body.session_id,body.manifest_sha256),input=job.input;
  if(op==='inspect')return checkedView(c,actor.user,job);
  if(op==='cancel'){
   if(job.status!=='queued')return checkedView(c,actor.user,job);
   const cancelled=(await c.query("UPDATE schoolvault.jobs SET status='cancelled',input=input-'batches'-'manifest',error='Transfer cancelled. The original and saved source are preserved.',updated_at=clock_timestamp() WHERE user_id=$1 AND id=$2 RETURNING *",[actor.user,job.id])).rows[0];return view(cancelled);
  }
  if(!['batch','commit'].includes(op))throw new BetaHttpError('Unknown device content operation.');
  const bound=await scope(c,actor,input.metadata,input.selection_revision);if(bound.course!==input.course_id)throw new BetaHttpError('The source course changed.',409);
  if(job.status==='complete'){
   if(op==='batch'){const b=validateDeviceContentBatch(body.batch);if(!job.result.batches.some((r:any)=>r.index===b.index&&r.sha256===b.sha256&&r.bytes===Buffer.byteLength(b.text)))throw new BetaHttpError('A committed batch cannot change.',409);}
   return checkedView(c,actor.user,job);
  }
  if(job.status!=='queued')throw new BetaHttpError(job.error||'This transfer is no longer active. Start a new request; existing sources remain safe.',409);
  if(op==='batch'){
   const batch=validateDeviceContentBatch(body.batch),previous=input.batches.find((b:any)=>b.index===batch.index);
   if(previous){if(previous.sha256!==batch.sha256||previous.text!==batch.text)throw new BetaHttpError('A received batch cannot change. Start a new transfer.',409);return view(job);}
   if(input.batches.length>=64||input.batches.reduce((sum:number,b:any)=>sum+Buffer.byteLength(b.text),0)+Buffer.byteLength(batch.text)>input.manifest.text.bytes)throw new BetaHttpError('Transfer exceeds its declared text size.',413);
   input.batches.push(batch);const j=(await c.query('UPDATE schoolvault.jobs SET input=$3,updated_at=clock_timestamp() WHERE user_id=$1 AND id=$2 RETURNING *',[actor.user,job.id,input])).rows[0];await checkHistory(c,actor.user);return view(j);
  }
  const saved=await matches(c,actor.user,input.course_id,input.metadata.source_url);
  if(saved.length>1||input.expected_version===null&&saved.length||input.expected_version!==null&&(saved[0]?.id!==input.source_id||saved[0]?.current_version!==input.expected_version))throw new BetaHttpError('This source changed during transfer. Keep the original; start a new request for the current version.',409);
  const previous=saved[0];const retained=previous?.sha256===input.manifest.original.sha256&&Number(previous.bytes)===input.manifest.original.bytes?previous:null;
  const accepted=validateDevicePdfCommit(input.manifest,input.batches,retained?{sha256:retained.sha256,bytes:Number(retained.bytes)}:undefined);
  if(accepted.manifest_sha256!==input.manifest_sha256)throw new BetaHttpError('Stored transfer manifest mismatch.',409);
  const quota=await lockVault(c,actor.user);const used=Number((await c.query('SELECT coalesce(sum(octet_length(body)),0) AS n FROM schoolvault.source_versions WHERE user_id=$1',[actor.user])).rows[0].n);
  if(used+Buffer.byteLength(accepted.text)>textLimit(quota.text_quota_bytes))throw new BetaHttpError('Your searchable text has reached its beta limit. The original and existing source are preserved.',409);
  if(!previous)await checkObjects(c,actor.user,'sources');
  const version=randomUUID(),id=input.source_id,m=accepted.manifest;
  if(previous)await c.query('UPDATE schoolvault.sources SET current_version=$3,title=$4 WHERE user_id=$1 AND id=$2',[actor.user,id,version,input.metadata.title]);
  else await c.query("INSERT INTO schoolvault.sources(user_id,id,course_id,kind,title,current_version,original_url) VALUES($1,$2,$3,'file',$4,$5,$6)",[actor.user,id,input.course_id,input.metadata.title,version,input.metadata.source_url]);
  await c.query('INSERT INTO schoolvault.source_versions(user_id,id,source_id,body,sha256,object_key,mime,bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[actor.user,version,id,accepted.text,m.original.sha256,retained?.object_key||null,'application/pdf',m.original.bytes]);
  await writePassages(c,actor.user,id,version,accepted.text);
  const ocr=m.pages.filter(p=>p.blocks.some(b=>b.method==='ocr')).map(p=>p.number),missing=m.pages.filter(p=>p.state==='unreadable'||p.state==='unsupported'||p.state==='blank').map(p=>p.number);
  const result={source_id:id,version_id:version,text_sha256:m.text.sha256,original_sha256:m.original.sha256,manifest_sha256:accepted.manifest_sha256,batches:accepted.batches,truncated:m.pages.some(p=>p.state!=='text'&&p.state!=='blank'),pdf_reading:{method:ocr.length?'native_with_ocr':'selectable_text',total_pages:m.page_count,pages_read:m.page_count,pages_without_text:missing,visual_pages:m.pages.filter(p=>p.issues.includes('visual_unread')).map(p=>p.number),...(ocr.length?{ocr_pages:ocr}:{}),page_issues:m.pages.flatMap(p=>[{page:p.number,code:'layout_unverified'},...(p.issues.includes('equation_unverified')?[{page:p.number,code:'formula_unverified'}]:[])])},device_content:{format:m.format,manifest:m,accounting:accepted.accounting,device_id:actor.device,original_location:retained?.object_key?'cloud_and_device':'device_only',observed_at:input.metadata.captured_at}};
  const completed=(await c.query("UPDATE schoolvault.jobs SET status='complete',input=(input-'batches'-'manifest')||jsonb_build_object('source_id',$3::text),result=$4,error=NULL,updated_at=clock_timestamp() WHERE user_id=$1 AND id=$2 RETURNING *",[actor.user,job.id,id,result])).rows[0];
  await c.query("UPDATE schoolvault.jobs SET status='cancelled',lease_hash=NULL,lease_until=NULL,error='Device content was committed as a newer source version. The original is preserved.',updated_at=clock_timestamp() WHERE user_id=$1 AND kind='extract' AND status IN('queued','leased') AND input->>'source_id'=$2",[actor.user,id]);
  await c.query("INSERT INTO schoolvault.audit(user_id,id,action,target,details,created_at) VALUES($1,$2,'device-content-committed',$3,$4,clock_timestamp())",[actor.user,randomUUID(),id,{source_version_id:version,sha256:m.original.sha256,text_sha256:m.text.sha256,manifest_sha256:accepted.manifest_sha256,device_id:actor.device,captured_at:input.metadata.captured_at,provenance:'device_observed_not_independently_verified'}]);
  await deriveFileWork(c,actor.user,id,version);await sourceChanged(c,actor.user,id,version);await checkHistory(c,actor.user);return checkedView(c,actor.user,completed);
 });
}

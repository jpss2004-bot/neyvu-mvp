import {originalMimes,fileExtension,originalSignature} from './file-types';
import {createHash,randomUUID} from 'node:crypto';
import {tenant} from './db';
import {BetaHttpError} from './http';
import {moodleURL,moodleIdentityKey} from './companion';
import {currentCourseSelection} from './course-selection';
import {createBetaFile} from './files';

export type MoodleFileMetadata={identity:string;identity_key:string;course:{id:string;url:string};source_url:string;activity_url?:string;title:string;mime:string;captured_at:string;sha256?:string};

// These are files already read by the signed-in Companion. The server never
// fetches a URL or forwards a Moodle cookie. Download/cache flags identify one file.
export function moodleFileURL(value:unknown){
 if(typeof value!=='string'||value.length>2048||value.includes('\\')||value.includes('#'))throw new BetaHttpError('Invalid Moodle file link.');
 let url:URL;try{url=new URL(value);}catch{throw new BetaHttpError('Invalid Moodle file link.');}
 const keys=[...url.searchParams.keys()],rawPath=value.match(/^https:\/\/[^/]+([^?#]*)/)?.[1]||'';
 let parts:string[];try{parts=rawPath.split('/').slice(1).map(decodeURIComponent);}catch{throw new BetaHttpError('Invalid Moodle file link.');}
 if(url.origin!=='https://moodle.acadiau.ca'||url.username||url.password||!/^\/pluginfile\.php\/[1-9]\d{0,11}\/[a-z][a-z0-9_]*\/[a-z][a-z0-9_]*\/\d{1,12}\/.+/.test(url.pathname)
  ||parts.some(part=>!part||part==='.'||part==='..'||/[\/\\\x00-\x1f\x7f]/.test(part))
  ||new Set(keys).size!==keys.length||keys.some(key=>!['forcedownload','time'].includes(key))
  ||url.searchParams.has('forcedownload')&&!/^[01]$/.test(url.searchParams.get('forcedownload')||'')
  ||url.searchParams.has('time')&&!/^\d{1,16}$/.test(url.searchParams.get('time')||''))throw new BetaHttpError('Invalid Moodle file link.');
 url.search='';return url.href;
}
export function validateMoodleFileMetadata(raw:any,requestMime:string,now=Date.now()):MoodleFileMetadata{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(key=>!['identity','course','source_url','activity_url','title','mime','captured_at','sha256'].includes(key)))throw new BetaHttpError('Invalid Moodle file capture.');
 const identity=typeof raw.identity==='string'&&raw.identity.length<=180?raw.identity.match(/^moodle-user:([1-9]\d{0,11})(?:\s*·\s*[^\r\n]{1,120})?$/):null;
 if(!identity)throw new BetaHttpError('Confirm a stable Moodle account before collecting files.');
 if(!raw.course||typeof raw.course!=='object'||Array.isArray(raw.course)||Object.keys(raw.course).some(key=>!['id','url'].includes(key)))throw new BetaHttpError('Invalid Moodle file course.');
 const courseURL=moodleURL(raw.course.url,true);
 if(typeof raw.course.id!=='string'||!/^[1-9]\d{0,11}$/.test(raw.course.id)||new URL(courseURL).searchParams.get('id')!==raw.course.id)throw new BetaHttpError('Moodle file course identity did not match.');
 if(raw.mime!==requestMime||!originalMimes.includes(requestMime))throw new BetaHttpError('Choose a PDF, Word document, PowerPoint slides or readable text Moodle file.',415);
 const source_url=moodleFileURL(raw.source_url),filename=decodeURIComponent(new URL(source_url).pathname.split('/').at(-1)!);
 const activity_url=raw.activity_url===undefined?undefined:moodleURL(raw.activity_url);
 if(activity_url&&new URL(activity_url).pathname==='/calendar/view.php'&&new URL(activity_url).searchParams.get('course')!==raw.course.id)throw new BetaHttpError('Moodle Calendar belongs to a different course.');
 if(activity_url&&new URL(activity_url).pathname==='/course/view.php'&&activity_url!==courseURL)throw new BetaHttpError('Moodle file activity belongs to a different course.');
 if(!fileExtension(requestMime).test(filename))throw new BetaHttpError('The Moodle file type did not match its link.',415);
 if(typeof raw.title!=='string'||!raw.title.trim()||raw.title.length>180||/[\x00-\x1f\x7f]/.test(raw.title))throw new BetaHttpError('Invalid Moodle file title.');
 const captured=typeof raw.captured_at==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(raw.captured_at)?Date.parse(raw.captured_at):NaN;
 if(!Number.isFinite(captured)||new Date(captured).toISOString().slice(0,10)!==raw.captured_at.slice(0,10)||captured>now+60000||captured<now-86400000)throw new BetaHttpError('Refresh Moodle before collecting this file.');
 if(raw.sha256!==undefined&&(typeof raw.sha256!=='string'||!/^[a-f0-9]{64}$/.test(raw.sha256)))throw new BetaHttpError('Invalid Moodle file hash.');
 return {identity:raw.identity,identity_key:identity[1],course:{id:raw.course.id,url:courseURL},source_url,...(activity_url?{activity_url}:{}),title:raw.title.trim(),mime:requestMime as MoodleFileMetadata['mime'],captured_at:new Date(captured).toISOString(),...(raw.sha256?{sha256:raw.sha256}:{})};
}

export async function importMoodleFile(actor:{user:string;device:string},raw:unknown,requestMime:string,buffer:Buffer){
 const data=validateMoodleFileMetadata(raw,requestMime);
 if(!Buffer.isBuffer(buffer)||!buffer.length||buffer.length>10*1024*1024)throw new BetaHttpError('Choose a Moodle file up to 10 MB.',413);
 const sha256=createHash('sha256').update(buffer).digest('hex');
 if(data.sha256&&data.sha256!==sha256)throw new BetaHttpError('The Moodle file hash did not match. Refresh and try again.',409);
 if(!originalSignature(data.mime,buffer))throw new BetaHttpError('The Moodle download did not match the selected document format.',415);
 if(data.mime==='text/plain'){
  let decoded:string;try{decoded=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{throw new BetaHttpError('The Moodle text file is not readable UTF-8.',415);}
  if(/^\s*(?:<!doctype\s+html|<html\b)/i.test(decoded)||decoded.includes('\0'))throw new BetaHttpError('The Moodle download was not a readable text file.',415);
 }
 // This lookup locates a course only. All authorization is rechecked under the
 // writer lock in createBetaFile, including a revoke between lookup and upload.
 const course=await tenant(actor.user,async c=>(await c.query('SELECT id FROM schoolvault.courses WHERE user_id=$1 AND moodle_id=$2 AND url=$3',[actor.user,data.course.id,data.course.url])).rows[0]);
 if(!course)throw new BetaHttpError('Import this current Moodle course before collecting its files.',409);
 let version:string|null=null;
 const result=await createBetaFile(actor.user,course.id,data.title,data.mime,buffer,{prepare:async(c,actualHash)=>{
  const account=(await c.query('SELECT demo FROM schoolvault.users WHERE id=$1 AND disabled_at IS NULL',[actor.user])).rows[0];
  if(!account||account.demo)throw new BetaHttpError('Real Moodle files require your own SchoolVault account.',403);
  const device=(await c.query('SELECT moodle_identity FROM schoolvault.companion_devices WHERE user_id=$1 AND id=$2 AND revoked_at IS NULL FOR UPDATE',[actor.user,actor.device])).rows[0];
  if(!device)throw new BetaHttpError('This laptop has been disconnected.',401);
  const connector=(await c.query("SELECT identity,revoked_at FROM schoolvault.connectors WHERE user_id=$1 AND provider='moodle' FOR UPDATE",[actor.user])).rows[0];
  if(!device.moodle_identity||!connector?.identity||connector.revoked_at||moodleIdentityKey(device.moodle_identity)!==data.identity_key||moodleIdentityKey(connector.identity)!==data.identity_key)throw new BetaHttpError('The Moodle account changed or is not confirmed. Reconnect the original account.',409);
  const selection=await currentCourseSelection(c,actor.user);
  if(!selection.confirmed||!selection.moodle_ids.includes(data.course.id))throw new BetaHttpError('This file is outside the confirmed current course selection. Review your courses first.',409);
  if(!(await c.query('SELECT id FROM schoolvault.courses WHERE user_id=$1 AND id=$2 AND moodle_id=$3 AND url=$4',[actor.user,course.id,data.course.id,data.course.url])).rowCount)throw new BetaHttpError('Moodle file course identity changed.',409);
  const matches=(await c.query(`SELECT s.id,s.title,v.id AS version_id,v.sha256,v.body,v.bytes,v.mime,EXISTS(SELECT 1 FROM schoolvault.jobs d WHERE d.user_id=s.user_id AND d.kind='collect' AND d.status='complete' AND d.input->>'task'='device-content-v1' AND d.result->>'version_id'=v.id::text) AS device_read,
   (SELECT j.status FROM schoolvault.jobs j WHERE j.user_id=s.user_id AND j.kind='extract' AND j.input->>'source_id'=s.id::text AND (j.input->>'version_id'=v.id::text OR j.result->>'version_id'=v.id::text) ORDER BY j.created_at DESC,j.id DESC LIMIT 1) AS extraction
   FROM schoolvault.sources s JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.source_id=s.id AND v.id=s.current_version
   WHERE s.user_id=$1 AND s.course_id=$2 AND s.kind='file' AND s.original_url=$3 FOR UPDATE OF s`,[actor.user,course.id,data.source_url])).rows;
  if(matches.length>1)throw new BetaHttpError('This Moodle file has conflicting saved copies. Existing files are preserved.',409);
  const previous=matches[0];
  if(previous?.device_read)throw new BetaHttpError('This source uses device-read content. Keep the original and use an updated Companion; the legacy upload cannot overwrite it.',409);
  if(previous?.sha256===actualHash){version=previous.version_id;return {duplicate:{id:previous.id,title:previous.title,course_id:course.id,kind:'file',bytes:Number(previous.bytes),mime:previous.mime,searchable:!!previous.body.trim(),extraction:previous.body.trim()?'complete':previous.extraction||'not_indexed'}};}
  if(previous){
   const last=(await c.query("SELECT details->>'captured_at' AS captured_at FROM schoolvault.audit WHERE user_id=$1 AND target=$2 AND action='moodle-file-collected' ORDER BY created_at DESC,id DESC LIMIT 1",[actor.user,previous.id])).rows[0];
   if(last&&Date.parse(last.captured_at)>Date.parse(data.captured_at))throw new BetaHttpError('An older Moodle file capture cannot replace the newer saved file. Refresh first.',409);
  }
  return {source_id:previous?.id,original_url:data.source_url,afterStore:async(c,file)=>{
   version=file.version_id;
   await c.query("INSERT INTO schoolvault.audit(user_id,id,action,target,details,created_at) VALUES($1,$2,'moodle-file-collected',$3,$4,clock_timestamp())",[actor.user,randomUUID(),file.source_id,JSON.stringify({source_version_id:file.version_id,sha256:file.sha256,course_moodle_id:data.course.id,identity_key:data.identity_key,device_id:actor.device,captured_at:data.captured_at,source_url:data.source_url,...(data.activity_url?{activity_url:data.activity_url}:{}),role:'observed_moodle_attachment',provenance:'signed_in_capture',authority:'Observed file; requirements, dates and completion are not inferred.'})]);
  }};
 }});
 return {saved:true,changed:result.unchanged!==true,source_id:result.id,course_id:course.id,version_id:version,mime:result.mime,bytes:result.bytes,searchable:result.searchable,extraction:result.extraction};
}

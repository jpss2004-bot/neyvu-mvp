import {randomUUID} from 'node:crypto';
import {classTranscriptionView,classTranscriptionOverview} from './class-transcription';
import {reconcileClassActions,classActionSummary} from './class-actions';
import {open,unlink,readFile,lstat,statfs} from 'node:fs/promises';
import path from 'node:path';
import type {PoolClient} from 'pg';
import {tenant,uuid} from './db';
import {lockVault,checkHistory,checkObjects,storedObjects} from './budget';
import {ownedBetaCourse,text,sourceVersion,BetaConflict} from './vault';
import {betaFilePath} from './files';
import {BetaHttpError} from './http';
import {activeCaptureConsent,captureConsentEnabled} from './capture-consent';
import {recordingLimits,recordingMimes,integer,audioSignature,digest,recordingManifest,recordingDate,validateSegments,transcriptBody,type ClassSegment} from './class-recording-format';

export function classCaptureEnabled(){if(process.env.SCHOOL_BETA_CLASS_CAPTURE!=='1')throw new BetaHttpError('Class recording is not available yet.',503);}
export function classAccountMatches(request:Request,user:string,required=false){const expected=request.headers.get('x-class-account');if((required||expected)&&expected!==user)throw new BetaHttpError('Your signed-in account changed. Reload before saving a recording.',409);}

async function active(c:PoolClient,user:string){if(!(await c.query('SELECT id FROM schoolvault.users WHERE id=$1 AND disabled_at IS NULL',[user])).rowCount)throw new BetaHttpError('Please sign in.',401);}
async function session(c:PoolClient,user:string,id:unknown,locking=false){
 if(!uuid(id))throw new BetaHttpError('Invalid class session.');
 const row=(await c.query('SELECT * FROM schoolvault.class_sessions WHERE user_id=$1 AND id=$2'+(locking?' FOR UPDATE':''),[user,id])).rows[0];
 if(!row||row.taken_down_at)throw new BetaHttpError('Class session not found',404);return row;
}
async function chunks(c:PoolClient,user:string,id:string){return (await c.query('SELECT sequence,object_key,sha256,bytes FROM schoolvault.class_audio_chunks WHERE user_id=$1 AND session_id=$2 ORDER BY sequence',[user,id])).rows;}
async function audit(c:PoolClient,user:string,action:string,id:string){await c.query('INSERT INTO schoolvault.audit(user_id,id,action,target) VALUES($1,$2,$3,$4)',[user,randomUUID(),action,id]);}
// All writes hold the vault lock, including retries. Client request IDs are only
// accepted with the same canonical payload, never as a way to change old work.
export async function createClassSession(user:string,input:{request_id:unknown;course_id:unknown;title:unknown;recorded_at:unknown;timezone:unknown;permission:unknown;permission_note:unknown;mime:unknown;materials?:unknown}){
 if(!uuid(input.request_id)||!uuid(input.course_id))throw new BetaHttpError('Invalid class session.');
 if(input.permission!==true)throw new BetaHttpError('Confirm that you have permission to record this class.');
 const title=text(input.title,180).trim(),permission=text(input.permission_note,500).trim(),timezone=text(input.timezone,100);
 if(!title||!permission||title.includes('\0')||permission.includes('\0'))throw new BetaHttpError('Enter a class title and recording permission.');
 try{new Intl.DateTimeFormat('en',{timeZone:timezone});}catch{throw new BetaHttpError('Choose a valid class timezone.');}
 const date=recordingDate(input.recorded_at);
 if(typeof input.mime!=='string'||!recordingMimes.includes(input.mime as any))throw new BetaHttpError('Choose a supported audio format.',415);
 const refs=input.materials??[];if(!Array.isArray(refs)||refs.length>40||refs.some(r=>!r||!uuid(r.source_id)||!uuid(r.version_id))||new Set(refs.map(r=>r.source_id)).size!==refs.length)throw new BetaHttpError('Invalid class materials.');
 const request=digest(JSON.stringify({course:input.course_id,title,recorded_at:date.toISOString(),timezone,permission,mime:input.mime,materials:refs.map(r=>({source_id:r.source_id,version_id:r.version_id})).sort((a,b)=>a.source_id.localeCompare(b.source_id))}));
 return tenant(user,async c=>{
  await active(c,user);await lockVault(c,user);await ownedBetaCourse(c,user,input.course_id as string);
  // E5: no active per-course attestation, no recording (also blocks retries after revocation).
  const consent=captureConsentEnabled()?await activeCaptureConsent(c,user,input.course_id as string):null;
  const old=(await c.query('SELECT * FROM schoolvault.class_sessions WHERE user_id=$1 AND request_id=$2',[user,input.request_id])).rows[0];
  if(old){if(old.request_sha256!==request)throw new BetaConflict('This recording request was already used for a different class.');return old;}
  await checkObjects(c,user,'class_sessions');const materials=[];
  for(const ref of refs){const material=(await c.query(`SELECT s.id AS source_id,s.title,s.kind,v.id AS version_id,v.sha256,v.observed_at FROM schoolvault.sources s JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.source_id=s.id
   WHERE s.user_id=$1 AND s.course_id=$2 AND s.id=$3 AND v.id=$4 AND s.kind!='ai_draft'`,[user,input.course_id,ref.source_id,ref.version_id])).rows[0];if(!material)throw Error('Class material not found');materials.push(material);}
  const row=(await c.query(`INSERT INTO schoolvault.class_sessions(user_id,id,course_id,request_id,request_sha256,title,recorded_at,timezone,permission_note,mime,material_versions,consent_id)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[user,randomUUID(),input.course_id,input.request_id,request,title,date,timezone,permission,input.mime,JSON.stringify(materials),consent])).rows[0];
  await audit(c,user,'class-recording-created',row.id);await checkHistory(c,user);return row;
 });
}
export async function appendClassAudio(user:string,id:string,sequence:unknown,expectedHash:unknown,bytes:Buffer){
 const seq=integer(sequence,0,recordingLimits.chunks-1);
 if(!bytes.length||bytes.length>recordingLimits.chunkBytes)throw new BetaHttpError('Send audio chunks up to 4 MB.',413);
 const sha=digest(bytes);if(typeof expectedHash!=='string'||expectedHash!==sha)throw new BetaHttpError('The audio hash does not match. Retry the original chunk.',409);
 const key=randomUUID();let file='',written=false;
 try{return await tenant(user,async c=>{
  await active(c,user);await lockVault(c,user);const record=await session(c,user,id,true);
  const old=(await c.query('SELECT sequence,sha256,bytes FROM schoolvault.class_audio_chunks WHERE user_id=$1 AND session_id=$2 AND sequence=$3',[user,id,seq])).rows[0];
  if(old){if(old.sha256!==sha||old.bytes!==bytes.length)throw new BetaConflict('This audio chunk is already saved with different contents.');return {...old,unchanged:true};}
  if(record.state!=='capturing')throw new BetaConflict('This recording is sealed. Its original audio cannot be changed.');
  if(seq===0&&!audioSignature(record.mime,bytes))throw new BetaHttpError('The recording format does not match its audio.',415);
  if(Number(record.total_bytes)+bytes.length>recordingLimits.totalBytes)throw new BetaHttpError('This recording has reached its 128 MB limit.',413);
  const used=Number((await c.query(`SELECT coalesce(sum(bytes),0) AS used FROM (${storedObjects}) originals`,[user])).rows[0].used);
  const quota=Number((await c.query('SELECT quota_bytes FROM schoolvault.vaults WHERE user_id=$1',[user])).rows[0].quota_bytes);
  if(used+bytes.length>quota)throw new BetaHttpError('Your vault storage is full. The saved recording chunks are safe.',409);
  if(!(await c.query('UPDATE schoolvault.storage_budget SET used_bytes=used_bytes+$1 WHERE id=true AND used_bytes+$1<=limit_bytes RETURNING id',[bytes.length])).rowCount)throw new BetaHttpError('File storage is full. The saved recording chunks are safe.',409);
  file=await betaFilePath(user,key);const disk=await statfs(path.dirname(file));if(Number(disk.bavail)*Number(disk.bsize)<bytes.length+512*1024*1024)throw new BetaHttpError('File storage is full.',409);
  const handle=await open(/* turbopackIgnore: true */ file,'wx',0o600);written=true;
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  // Flush the directory entry before acknowledging the saved chunk as durable.
  // Runtime private objects must not be traced into an application build.
  const folder=path.dirname(file),directory=await open(/* turbopackIgnore: true */ folder,'r');try{await directory.sync();}finally{await directory.close();}
  await c.query('INSERT INTO schoolvault.class_audio_chunks(user_id,id,session_id,sequence,object_key,sha256,bytes) VALUES($1,$2,$3,$4,$5,$6,$7)',[user,randomUUID(),id,seq,key,sha,bytes.length]);
  await c.query('UPDATE schoolvault.class_sessions SET total_bytes=total_bytes+$3,updated_at=now() WHERE user_id=$1 AND id=$2',[user,id,bytes.length]);
  await checkHistory(c,user);return {sequence:seq,sha256:sha,bytes:bytes.length,unchanged:false};
 });}catch(error){
  // A lost COMMIT reply is ambiguous. Retain the object unless absence is known.
  if(written){try{const exists=await tenant(user,c=>c.query('SELECT 1 FROM schoolvault.class_audio_chunks WHERE user_id=$1 AND object_key=$2',[user,key]));if(!exists.rowCount)await unlink(file);}catch{/* Leave for operator reconciliation. */}}
  throw error;
 }
}
export async function sealClassRecording(user:string,id:string,count:unknown,duration:unknown,details:{capture_outcome?:unknown;duration_basis?:unknown}={}){
 const n=integer(count,1,recordingLimits.chunks),ms=integer(duration,1,recordingLimits.durationMs);
 const outcome=details.capture_outcome??'unknown',basis=details.duration_basis??'unknown';
 if(!['unknown','stopped_normally','interrupted'].includes(outcome as string)||!['unknown','capture_elapsed','media_metadata','student_reported'].includes(basis as string))throw new BetaHttpError('Invalid capture coverage.');
 return tenant(user,async c=>{
  await active(c,user);await lockVault(c,user);const record=await session(c,user,id,true),parts=await chunks(c,user,id);
  if(parts.length!==n||parts.some((p,i)=>p.sequence!==i))throw new BetaConflict('Some audio chunks are missing. Resume the upload before finishing.');
  const manifest=recordingManifest(record.mime,parts);
  if(record.state==='sealed'){if(record.manifest_sha256!==manifest||record.duration_ms!==ms||(record.capture_outcome||'unknown')!==outcome||(record.duration_basis||'unknown')!==basis)throw new BetaConflict('This recording is already sealed with a different duration or capture coverage.');return record;}
  const row=(await c.query("UPDATE schoolvault.class_sessions SET state='sealed',manifest_sha256=$3,duration_ms=$4,capture_outcome=$5,duration_basis=$6,updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING *",[user,id,manifest,ms,outcome,basis])).rows[0];
  await audit(c,user,'class-recording-sealed',id);await checkHistory(c,user);return row;
 });
}
export async function classRecording(user:string,id:string){return tenant(user,async c=>{
 await active(c,user);const record=await session(c,user,id),parts=await chunks(c,user,id);
 const transcript=record.current_transcript?(await c.query('SELECT * FROM schoolvault.class_transcripts WHERE user_id=$1 AND session_id=$2 AND id=$3',[user,id,record.current_transcript])).rows[0]:null;
 // Chunk object keys stay internal. An account can resume from sequence/hash/size.
 return {...record,actions_summary:classActionSummary(record),chunks:parts.map(({object_key,...part})=>part),transcript,transcription:await classTranscriptionView(c,user,id)};
});}
export async function listClassRecordings(user:string){return tenant(user,async c=>{await active(c,user);return classTranscriptionOverview(c,user,(await c.query('SELECT id,course_id,title,recorded_at,timezone,state,total_bytes,duration_ms,decoded_duration_ms,capture_outcome,duration_basis,current_transcript,audio_deleted_at,created_at,updated_at FROM schoolvault.class_sessions WHERE user_id=$1 AND taken_down_at IS NULL ORDER BY recorded_at DESC,id LIMIT 200',[user])).rows);});}
export async function classAudioMetadata(user:string,id:string){return tenant(user,async c=>{
 await active(c,user);const record=await session(c,user,id);if(record.audio_deleted_at)throw new BetaHttpError('This class audio was deleted after its transcript was saved. The transcript remains.',410);if(record.state!=='sealed')throw new BetaConflict('Finish saving the recording before playing it.');const parts=await chunks(c,user,id);
 if(recordingManifest(record.mime,parts)!==record.manifest_sha256||parts.reduce((n,p)=>n+Number(p.bytes),0)!==Number(record.total_bytes))throw Error('Stored recording integrity check failed');
 return {record,parts};
});}
// Read one bounded chunk at a time, checking the original before exposing bytes.
export async function* classAudioBytes(user:string,metadata:Awaited<ReturnType<typeof classAudioMetadata>>,start=0,end=Number(metadata.record.total_bytes)-1){
 let offset=0;
 for(const part of metadata.parts){const next=offset+Number(part.bytes);if(next>start&&offset<=end){
  const file=await betaFilePath(user,part.object_key),info=await lstat(file);if(info.isSymbolicLink()||!info.isFile())throw Error('Invalid file store');if(info.size!==Number(part.bytes))throw Error('Stored recording integrity check failed');const bytes=await readFile(file);
  if(bytes.length!==Number(part.bytes)||digest(bytes)!==part.sha256)throw Error('Stored recording integrity check failed');
  yield new Uint8Array(bytes.subarray(Math.max(0,start-offset),Math.min(bytes.length,end-offset+1)));
 }offset=next;if(offset>end)break;}
}
export type MachineTranscript={request_id:string;audio_manifest_sha256:string;language:string;segments:ClassSegment[];boundary_evidence?:ClassSegment[];runtime:{engine:'faster-whisper';version:string;model_sha256:string}};
// Internal worker primitive only. The student API cannot label input as machine
// transcription. Original speech stays unverified even when the job succeeds.
export async function saveClassMachineTranscript(user:string,id:string,input:MachineTranscript){
 if(!input.runtime||input.runtime.engine!=='faster-whisper'||typeof input.runtime.version!=='string'||input.runtime.version.length>64||!/^\w[\w.+-]*$/.test(input.runtime.version)||! /^[a-f0-9]{64}$/.test(input.runtime.model_sha256))throw new BetaHttpError('Invalid transcription runtime.');
 return tenant(user,c=>storeClassMachineTranscript(c,user,id,input));
}
export async function correctClassTranscript(user:string,id:string,input:{request_id:string;parent_id:string;segments:ClassSegment[]}){
 if(!uuid(input.parent_id))throw new BetaHttpError('Invalid transcript revision.');return storeTranscript(user,id,input,input.parent_id);
}
async function storeTranscript(user:string,id:string,input:any,parentId:string|null){return tenant(user,c=>storeTranscriptInTransaction(c,user,id,input,parentId));}
export async function storeClassMachineTranscript(c:PoolClient,user:string,id:string,input:MachineTranscript){
 if(!input.runtime||input.runtime.engine!=='faster-whisper'||typeof input.runtime.version!=='string'||input.runtime.version.length>64||!/^\w[\w.+-]*$/.test(input.runtime.version)||! /^[a-f0-9]{64}$/.test(input.runtime.model_sha256))throw new BetaHttpError('Invalid transcription runtime.');
 return storeTranscriptInTransaction(c,user,id,input,null);
}
async function storeTranscriptInTransaction(c:PoolClient,user:string,id:string,input:any,parentId:string|null){
 if(!uuid(input.request_id))throw new BetaHttpError('Invalid transcript request.');
  await active(c,user);await lockVault(c,user);const record=await session(c,user,id,true);
  if(record.state!=='sealed')throw new BetaConflict('Finish saving the recording before transcribing it.');
  const duration=record.decoded_duration_ms??record.duration_ms,segments=validateSegments(input.segments,duration),suppliedBoundary=parentId?[]:validateSegments(input.boundary_evidence||[],duration);if(suppliedBoundary.some(s=>!s.uncertain))throw new BetaHttpError('Boundary speech must be marked uncertain.');let boundaries=suppliedBoundary;const request=digest(JSON.stringify({parent:parentId,segments,...(!parentId?{manifest:input.audio_manifest_sha256,language:input.language,runtime:input.runtime,...(suppliedBoundary.length?{boundary_evidence:suppliedBoundary}:{})}:{})}));
  const duplicate=(await c.query('SELECT * FROM schoolvault.class_transcripts WHERE user_id=$1 AND session_id=$2 AND request_id=$3',[user,id,input.request_id])).rows[0];
  if(duplicate){if(duplicate.request_sha256!==request)throw new BetaConflict('This transcript request was already saved with different contents.');return duplicate;}
  let language=input.language,runtime=input.runtime,revision=1,source=record.transcript_source_id;
  if(parentId){
   if(record.current_transcript!==parentId)throw new BetaConflict('The transcript changed. Open the latest revision before saving your correction.');
   const parent=(await c.query('SELECT * FROM schoolvault.class_transcripts WHERE user_id=$1 AND session_id=$2 AND id=$3',[user,id,parentId])).rows[0];
   if(!parent||parent.segments.length!==segments.length||segments.some((s,i)=>s.start_ms!==parent.segments[i].start_ms||s.end_ms!==parent.segments[i].end_ms))throw new BetaHttpError('Correct the words without changing the original audio timestamps.');
   language=parent.language;runtime=parent.runtime;revision=parent.revision+1;boundaries=parent.boundary_evidence||[];
  }else{
   if(record.current_transcript)throw new BetaConflict('This recording already has a transcript. Save a correction instead.');
   if(input.audio_manifest_sha256!==record.manifest_sha256)throw new BetaConflict('The transcript belongs to a different recording.');
   if(typeof language!=='string'||! /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/.test(language))throw new BetaHttpError('Invalid transcript language.');
   await checkObjects(c,user,'sources');source=randomUUID();
   await c.query("INSERT INTO schoolvault.sources(user_id,id,course_id,kind,title) VALUES($1,$2,$3,'note',$4)",[user,source,record.course_id,record.title+' — class transcript']);
  }
  const version=await sourceVersion(c,user,source,transcriptBody(record.title,segments,{recorded_at:record.recorded_at.toISOString(),timezone:record.timezone,capture_outcome:record.capture_outcome||'unknown'},boundaries)),transcript=randomUUID();
  const row=(await c.query(`INSERT INTO schoolvault.class_transcripts(user_id,id,session_id,revision,request_id,request_sha256,audio_manifest_sha256,source_id,version_id,parent_id,language,segments,provenance,runtime,boundary_evidence)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,[user,transcript,id,revision,input.request_id,request,record.manifest_sha256,source,version,parentId,language,JSON.stringify(segments),parentId?'student_correction':'local_machine_transcript',JSON.stringify(runtime),JSON.stringify(boundaries)])).rows[0];
  await c.query('UPDATE schoolvault.class_sessions SET transcript_source_id=$3,current_transcript=$4,updated_at=now() WHERE user_id=$1 AND id=$2',[user,id,source,transcript]);
  await audit(c,user,parentId?'class-transcript-corrected':'class-transcribed',id);await checkHistory(c,user);await reconcileClassActions(c,user,id);return row;
}

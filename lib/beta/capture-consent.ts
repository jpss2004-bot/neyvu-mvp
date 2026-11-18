import {randomUUID} from 'node:crypto';
import {unlink} from 'node:fs/promises';
import type {PoolClient} from 'pg';
import {betaPool,tenant,uuid} from './db';
import {lockVault} from './budget';
import {ownedBetaCourse} from './vault';
import {betaFilePath} from './files';
import {BetaHttpError} from './http';

// E5 lecture capture consent. Recording is off per course until the learner attests one
// basis: the instructor's prior permission, or a registered accommodation. Recordings are
// for personal study only, audio is deleted once the transcript is saved, and a takedown
// route exists for instructors and classmates. Policy: docs/trust/lecture-recording-consent-policy.md.

export const captureTermsVersion='2026-11-12';
export const captureTerms=[
 'I will record only classes where I have the instructor’s prior permission or a registered accommodation.',
 'Recordings and transcripts are for my personal study only. I will not share, post or sell them.',
 'Classmates may be heard. I will stop or delete a recording if the instructor or a classmate asks.',
 'Neyvu deletes the audio after the transcript is saved. I can delete a recording at any time.',
];
// Operators may keep audio only for an explicit, documented reason (e.g. a transcription incident).
export const audioRetained=()=>process.env.SCHOOL_BETA_CLASS_AUDIO_RETAIN==='1';
// Off by default: recording behaves as on main (no per-course attestation, no automatic
// audio deletion, no public takedown form) until the consent flow is switched on.
export const captureConsentEnabled=()=>process.env.SCHOOL_BETA_CAPTURE_CONSENT==='1';

const clean=(v:unknown,max:number)=>typeof v==='string'&&v.trim()&&v.length<=max&&!v.includes('\0')?v.trim():null;
export async function captureConsents(user:string){
 return tenant(user,async c=>(await c.query(`SELECT id,course_id,basis,instructor_name,permission_date,terms_version,attested_at FROM schoolvault.class_capture_consents WHERE user_id=$1 AND revoked_at IS NULL ORDER BY attested_at DESC`,[user])).rows);
}
export async function attestCapture(user:string,input:{course_id:unknown;basis:unknown;instructor_name?:unknown;permission_date?:unknown;personal_use?:unknown;classmates?:unknown;terms_version?:unknown}){
 if(!uuid(input.course_id))throw new BetaHttpError('Choose a course.');
 if(input.basis!=='instructor_permission'&&input.basis!=='registered_accommodation')throw new BetaHttpError('Choose why you may record this course.');
 if(input.personal_use!==true||input.classmates!==true)throw new BetaHttpError('Accept the personal-use and classmate terms to turn recording on.');
 if(input.terms_version!==captureTermsVersion)throw new BetaHttpError('The recording terms changed. Reload and review them again.',409);
 let instructor=null,date=null;
 if(input.basis==='instructor_permission'){
  instructor=clean(input.instructor_name,160);date=typeof input.permission_date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(input.permission_date)?input.permission_date:null;
  if(!instructor||!date||Date.parse(date)>Date.now()+86400000)throw new BetaHttpError('Enter the instructor’s name and the date they gave permission.');
 }
 return tenant(user,async c=>{
  await lockVault(c,user);await ownedBetaCourse(c,user,input.course_id as string);
  await c.query('UPDATE schoolvault.class_capture_consents SET revoked_at=now() WHERE user_id=$1 AND course_id=$2 AND revoked_at IS NULL',[user,input.course_id]);
  const row=(await c.query(`INSERT INTO schoolvault.class_capture_consents(user_id,id,course_id,basis,instructor_name,permission_date,terms_version,personal_use_ack,classmates_ack)
   VALUES($1,$2,$3,$4,$5,$6,$7,true,true) RETURNING id,course_id,basis,instructor_name,permission_date,terms_version,attested_at`,[user,randomUUID(),input.course_id,input.basis,instructor,date,captureTermsVersion])).rows[0];
  await c.query('INSERT INTO schoolvault.audit(user_id,id,action,target,details) VALUES($1,$2,$3,$4,$5)',[user,randomUUID(),'class-capture-consent',row.id,JSON.stringify({basis:row.basis,terms:captureTermsVersion})]);
  return row;
 });
}
export async function revokeCapture(user:string,course:unknown){
 if(!uuid(course))throw new BetaHttpError('Choose a course.');
 return tenant(user,async c=>(await c.query('UPDATE schoolvault.class_capture_consents SET revoked_at=now() WHERE user_id=$1 AND course_id=$2 AND revoked_at IS NULL',[user,course])).rowCount===1);
}
// Called inside the recording transaction: no active attestation, no recording.
export async function activeCaptureConsent(c:PoolClient,user:string,course:string){
 const row=(await c.query('SELECT id FROM schoolvault.class_capture_consents WHERE user_id=$1 AND course_id=$2 AND revoked_at IS NULL AND terms_version=$3',[user,course,captureTermsVersion])).rows[0];
 if(!row)throw new BetaHttpError('Recording is off for this course. Confirm the instructor’s permission or your registered accommodation first.',403);
 return row.id as string;
}

// Removes a session's audio objects and chunk rows. Returns file keys to unlink after commit.
async function dropAudio(c:PoolClient,user:string,id:string){
 const parts=(await c.query('DELETE FROM schoolvault.class_audio_chunks WHERE user_id=$1 AND session_id=$2 RETURNING object_key,bytes',[user,id])).rows;
 const bytes=parts.reduce((n,p)=>n+Number(p.bytes),0);
 if(bytes)await c.query('UPDATE schoolvault.storage_budget SET used_bytes=greatest(0,used_bytes-$1) WHERE id=true',[bytes]);
 await c.query('UPDATE schoolvault.class_sessions SET audio_deleted_at=coalesce(audio_deleted_at,now()),updated_at=now() WHERE user_id=$1 AND id=$2',[user,id]);
 return parts.map(p=>String(p.object_key));
}
async function unlinkAll(user:string,keys:string[]){
 let failed=0;for(const key of keys){try{await unlink(await betaFilePath(user,key));}catch(e:any){if(e?.code!=='ENOENT')failed++;}}return failed;
}
// After transcription: delete audio for every sealed, transcribed session (bounded batch).
export async function purgeTranscribedAudio(limit=50){
 if(!captureConsentEnabled())return {purged:0,retained:true,disabled:true};
 if(audioRetained())return {purged:0,retained:true};
 const pending=(await betaPool().query('SELECT user_id,session_id FROM schoolvault.class_audio_pending_purge($1)',[limit])).rows;let purged=0,failed=0;
 for(const p of pending){
  const keys=await tenant(p.user_id,async c=>{await lockVault(c,p.user_id);const k=await dropAudio(c,p.user_id,p.session_id);
   await c.query('INSERT INTO schoolvault.audit(user_id,id,action,target) VALUES($1,$2,$3,$4)',[p.user_id,randomUUID(),'class-audio-deleted-after-transcript',p.session_id]);return k;});
  failed+=await unlinkAll(p.user_id,keys);purged++;
 }
 return {purged,failed,retained:false};
}
// Learner-initiated delete or an actioned takedown: audio removed, session hidden from views.
export async function takeDownClassRecording(user:string,id:unknown){
 if(!uuid(id))throw new BetaHttpError('Invalid class session.');
 const keys=await tenant(user,async c=>{
  await lockVault(c,user);
  if(!(await c.query('SELECT 1 FROM schoolvault.class_sessions WHERE user_id=$1 AND id=$2 FOR UPDATE',[user,id])).rowCount)throw new BetaHttpError('Class session not found',404);
  const k=await dropAudio(c,user,id as string);
  await c.query('UPDATE schoolvault.class_sessions SET taken_down_at=coalesce(taken_down_at,now()) WHERE user_id=$1 AND id=$2',[user,id]);
  await c.query('INSERT INTO schoolvault.audit(user_id,id,action,target) VALUES($1,$2,$3,$4)',[user,randomUUID(),'class-recording-taken-down',id]);return k;
 });
 await unlinkAll(user,keys);return {taken_down:true};
}
// Public takedown request (instructor, classmate, institution). Insert-only for the runtime.
export async function submitTakedown(input:{requester_role:unknown;contact:unknown;course:unknown;class_date?:unknown;details?:unknown}){
 if(!captureConsentEnabled())throw new BetaHttpError('Not found',404);
 const roles=['instructor','classmate','learner','institution','other'];
 const role=roles.includes(input.requester_role as string)?input.requester_role as string:null,contact=clean(input.contact,254),course=clean(input.course,200);
 if(!role||!contact||contact.length<3||!course)throw new BetaHttpError('Tell us who you are, how to reach you and which course.');
 const date=typeof input.class_date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(input.class_date)?input.class_date:null;
 const id=randomUUID();
 await betaPool().query('INSERT INTO schoolvault.capture_takedown_requests(id,requester_role,contact,course,class_date,details) VALUES($1,$2,$3,$4,$5,$6)',[id,role,contact,course,date,clean(input.details,4000)??'']);
 return {reference:id.slice(0,8),received:true};
}

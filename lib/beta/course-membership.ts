import {cancelCourseGroupAnswers} from './group-answer-invalidation';
import {createHash,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {tenant} from './db';
import {BetaHttpError} from './http';
import {checkHistory,lockVault} from './budget';
import {currentCourseSelection} from './course-selection';

export type CourseMembership={format:'moodle-own-course-groups/1';identity_key:string;course_id:string;profile_url:string;state:'observed'|'unknown'|'conflict';groups:{id:string;name:string}[];captured_at:string};
export type CourseMembershipView={state:'observed'|'unknown'|'conflict'|'stale';groups:{id:string;name:string}[];profile_url?:string;observed_at?:string;version?:string;reason:string};
const positive=(x:unknown):x is string=>typeof x==='string'&&/^[1-9]\d{0,11}$/.test(x);
export function validateCourseMembership(raw:any,now=new Date()):CourseMembership{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).sort().join(',')!=='captured_at,course_id,format,groups,identity_key,profile_url,state'||raw.format!=='moodle-own-course-groups/1'||!positive(raw.identity_key)||!positive(raw.course_id)||raw.profile_url!=='https://moodle.acadiau.ca/user/view.php?id='+raw.identity_key+'&course='+raw.course_id||!['observed','unknown','conflict'].includes(raw.state)||!Array.isArray(raw.groups)||raw.groups.length>40)throw new BetaHttpError('Invalid course membership evidence.');
 const at=typeof raw.captured_at==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(raw.captured_at)?Date.parse(raw.captured_at):NaN;
 if(!Number.isFinite(at)||new Date(at).toISOString()!==raw.captured_at||at>now.getTime()+60000||at<now.getTime()-86400000)throw new BetaHttpError('Refresh Moodle before checking groups.');
 const seen=new Set();
 const groups=raw.groups.map((g:any)=>{
  if(!g||Object.keys(g).sort().join(',')!=='id,name'||!positive(g.id)||seen.has(g.id)||typeof g.name!=='string'||g.name!==g.name.trim()||!g.name||g.name.length>180||/[\x00-\x1f\x7f]/.test(g.name)||/^(?:all groups|all participants|none|select|choose)\b/i.test(g.name))throw new BetaHttpError('Invalid course group.');
  seen.add(g.id);return {id:g.id,name:g.name};
 });
 if(raw.state==='observed'?!groups.length:!!groups.length)throw new BetaHttpError('Group state did not match its evidence.');
 return {format:raw.format,identity_key:raw.identity_key,course_id:raw.course_id,profile_url:raw.profile_url,state:raw.state,groups,captured_at:raw.captured_at};
}
const version=(proof:CourseMembership)=>createHash('sha256').update(JSON.stringify(proof)).digest('hex');
const own=(identity:unknown)=>typeof identity==='string'?identity.match(/^moodle-user:([1-9]\d{0,11})(?:\s*·.*)?$/)?.[1]:undefined;
export function courseMembershipView(raw:any,binding:{identity:string;course:string;version:string;device_active:boolean},now=new Date()):CourseMembershipView{
 const unknown:CourseMembershipView={state:'unknown',groups:[],reason:'Refresh Moodle to detect your groups for this course. A group in another course or assignment does not establish membership here.'};
 let proof:CourseMembership;
 try{proof=validateCourseMembership(raw,new Date(raw?.captured_at));}catch{return unknown;}
 if(!binding.device_active||proof.identity_key!==binding.identity||proof.course_id!==binding.course||version(proof)!==binding.version)return unknown;
 const age=now.getTime()-Date.parse(proof.captured_at);
 if(age< -60000)return unknown;
 if(age>86400000)return {...unknown,state:'stale',observed_at:proof.captured_at,reason:'Your saved group check is more than a day old. Refresh Moodle before relying on it.'};
 return {state:proof.state,groups:proof.groups,profile_url:proof.profile_url,observed_at:proof.captured_at,version:binding.version,reason:proof.state==='observed'?'Groups shown in your own profile for this course. These do not establish an activity’s group restriction, your timetable or individual submission.':proof.state==='conflict'?'The profile showed ambiguous group evidence. Refresh Moodle and review the course profile.':'Moodle did not expose a complete linked group field. Missing evidence does not mean you have no group.'};
}
export async function importCourseMembership(actor:{user:string;device:string},raw:unknown){
 const proof=validateCourseMembership(raw);
 return tenant(actor.user,async c=>{
  await lockVault(c,actor.user);
  const account=(await c.query('SELECT demo FROM schoolvault.users WHERE id=$1 AND disabled_at IS NULL',[actor.user])).rows[0];
  const device=(await c.query('SELECT moodle_identity FROM schoolvault.companion_devices WHERE user_id=$1 AND id=$2 AND revoked_at IS NULL FOR UPDATE',[actor.user,actor.device])).rows[0];
  const connector=(await c.query("SELECT identity FROM schoolvault.connectors WHERE user_id=$1 AND provider='moodle'",[actor.user])).rows[0];
  if(!account||account.demo||!device)throw new BetaHttpError('A connected real account is required for group detection.',403);
  if(own(device.moodle_identity)!==proof.identity_key||own(connector?.identity)!==proof.identity_key)throw new BetaHttpError('The Moodle account changed. No group was saved.',409);
  const selection=await currentCourseSelection(c,actor.user);
  if(!selection.confirmed||!selection.moodle_ids.includes(proof.course_id))throw new BetaHttpError('Review your current courses before detecting groups.',409);
  const course=(await c.query('SELECT id FROM schoolvault.courses WHERE user_id=$1 AND moodle_id=$2',[actor.user,proof.course_id])).rows[0];
  if(!course)throw new BetaHttpError('Save this course before detecting its groups.',409);
  const previous=(await c.query("SELECT details FROM schoolvault.audit WHERE user_id=$1 AND target=$2 AND action='moodle-course-membership' ORDER BY details->'proof'->>'captured_at' DESC NULLS LAST,created_at DESC,id DESC LIMIT 1",[actor.user,course.id])).rows[0]?.details;
  const digest=version(proof);
  if(previous&&Date.parse(previous.proof?.captured_at)>=Date.parse(proof.captured_at)){
   if(previous.proof?.captured_at===proof.captured_at&&previous.version!==digest)throw new BetaHttpError('This check time already has different group evidence.',409);
   return {saved:true,changed:false,ignored:'same_or_older_check'};
  }
  await checkHistory(c,actor.user,JSON.stringify(proof).length+1000);
  await c.query("INSERT INTO schoolvault.audit(user_id,id,action,target,details) VALUES($1,$2,'moodle-course-membership',$3,$4)",[actor.user,randomUUID(),course.id,JSON.stringify({proof,version:digest,device_id:actor.device,provenance:'signed_in_capture'})]);
  await cancelCourseGroupAnswers(c,actor.user,course.id);
  return {saved:true,changed:true};
 });
}
export async function currentCourseMembership(c:PoolClient,user:string,course:string,now=new Date()):Promise<CourseMembershipView>{
 return (await currentCourseMemberships(c,user,[course],now))[course];
}
export async function currentCourseMemberships(c:PoolClient,user:string,courses:string[],now=new Date()):Promise<Record<string,CourseMembershipView>>{
 const rows=(await c.query(`SELECT c.id,a.details,c.moodle_id,d.revoked_at,d.id AS device_id,d.moodle_identity,k.identity
 FROM schoolvault.courses c LEFT JOIN LATERAL (
 SELECT details FROM schoolvault.audit WHERE user_id=c.user_id AND target=c.id AND action='moodle-course-membership' ORDER BY details->'proof'->>'captured_at' DESC NULLS LAST,created_at DESC,id DESC LIMIT 1
 ) a ON true LEFT JOIN schoolvault.companion_devices d ON d.user_id=c.user_id AND d.id::text=a.details->>'device_id'
 LEFT JOIN schoolvault.connectors k ON k.user_id=c.user_id AND k.provider='moodle'
 WHERE c.user_id=$1 AND c.id=ANY($2::uuid[])`,[user,courses])).rows;
 const selection=await currentCourseSelection(c,user);
 return Object.fromEntries(courses.map(course=>{const row=rows.find(row=>row.id===course),identity=own(row?.identity)||'';
 return [course,courseMembershipView(row?.details?.proof,{identity,course:selection.confirmed&&selection.moodle_ids.includes(row?.moodle_id)?row.moodle_id:'',version:row?.details?.provenance==='signed_in_capture'?row.details.version:'',device_active:!!row?.device_id&&!row.revoked_at&&own(row.moodle_identity)===identity},now)];}));
}

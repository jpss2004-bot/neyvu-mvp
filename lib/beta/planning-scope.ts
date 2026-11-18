import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {tenant,uuid} from './db';
import {lockVault,checkHistory} from './budget';
import {BetaHttpError} from './http';
import {currentCourseSelection} from './course-selection';

const action='personal-planning-courses';
export type PlanningScope={confirmed:boolean;revision:string|null;binding_revision:string|null;course_ids:string[];basis:'personal_selection'|'moodle_selection'|'unconfirmed'};
// Personal scope chooses what to plan. It never asserts Moodle enrollment.
export async function planningScope(c:PoolClient,user:string):Promise<PlanningScope>{
 const courses=(await c.query('SELECT id,moodle_id FROM schoolvault.courses WHERE user_id=$1',[user])).rows;
 const saved=(await c.query('SELECT id,details FROM schoolvault.audit WHERE user_id=$1 AND action=$2 ORDER BY created_at DESC,id DESC LIMIT 1',[user,action])).rows[0];
 if(saved&&Array.isArray(saved.details?.course_ids)){
  const owned=new Set(courses.map(c=>c.id)),ids=saved.details.course_ids.filter((id:unknown)=>uuid(id)&&owned.has(id));
  if(ids.length===saved.details.course_ids.length&&ids.length)return {confirmed:true,revision:saved.id,binding_revision:saved.id,course_ids:ids,basis:'personal_selection'};
 }
 const official=await currentCourseSelection(c,user);
 return {confirmed:official.confirmed,revision:null,binding_revision:official.revision,basis:official.confirmed?'moodle_selection':'unconfirmed',course_ids:courses.filter(c=>official.confirmed?(c.moodle_id==null||official.moodle_ids.includes(c.moodle_id)):c.moodle_id==null).map(c=>c.id)};
}
export async function savePlanningScope(user:string,input:any){
 if(!uuid(input.request_id)||input.revision!==null&&!uuid(input.revision)||!Array.isArray(input.course_ids)||!input.course_ids.length||input.course_ids.length>40||input.course_ids.some((id:unknown)=>!uuid(id))||new Set(input.course_ids).size!==input.course_ids.length)throw new BetaHttpError('Choose one to forty saved courses.');
 return tenant(user,async c=>{
  await lockVault(c,user);
  const owned=(await c.query('SELECT id FROM schoolvault.courses WHERE user_id=$1 AND id=ANY($2::uuid[])',[user,input.course_ids])).rows;
  if(owned.length!==input.course_ids.length)throw new BetaHttpError('Choose courses from your own workspace.');
  const ids=[...input.course_ids].sort(),prior=(await c.query('SELECT id,details FROM schoolvault.audit WHERE user_id=$1 AND action=$2 ORDER BY created_at DESC,id DESC LIMIT 1',[user,action])).rows[0];
  if(prior?.details?.request_id===input.request_id){if(JSON.stringify(prior.details.course_ids)!==JSON.stringify(ids))throw new BetaHttpError('This request was already saved with other courses.',409);return planningScope(c,user);}
  if((prior?.id??null)!==input.revision)throw new BetaHttpError('Your planning courses changed elsewhere. Reload before saving; your choices are kept.',409);
  await c.query('INSERT INTO schoolvault.audit(user_id,id,action,details) VALUES($1,$2,$3,$4)',[user,randomUUID(),action,{course_ids:ids,request_id:input.request_id}]);
  await c.query("UPDATE schoolvault.jobs SET status='cancelled',error='Your planning courses changed. Ask again to use the updated scope.',lease_hash=NULL,lease_until=NULL,updated_at=now() WHERE user_id=$1 AND kind='answer' AND status='leased' AND input ? 'work'",[user]);
  await checkHistory(c,user);return planningScope(c,user);
 });
}

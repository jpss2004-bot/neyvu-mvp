import {courseGroupContexts} from './group-context';
import type {GroupContext} from './group-context-format';
import {personalTaskReports,type PersonalTaskReport} from './personal-task-report';
import {parseAvailability,type SavedAvailability} from './availability-format';
import {unverifiedForumSource} from './source-authority';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {tenant,uuid} from './db';
import {checkHistory,checkObjects,lockVault} from './budget';
import {BetaHttpError} from './http';
import {BetaConflict} from './vault';
import {planningScope,type PlanningScope} from './planning-scope';
import {changedSources,type ChangedSource} from './source-dependencies';
import {classActionStatus} from './class-actions-format';
import {zoneDate} from './agenda';
export type StudentProgress={task_id:string;source_id:string;version_id:string;state:string;planned_on:string|null;next_action:string;revision:number;changed_sources?:ChangedSource[];updated_at?:string};
export type StudentPlan={id:string;course_id:string;parent_id:string|null;kind:'project'|'milestone'|'class_action';title:string;source_id:string|null;version_id:string|null;state:string;planned_on:string|null;next_action:string;revision:number;changed_sources?:ChangedSource[];class_evidence?:any;class_review?:any;class_action?:ReturnType<typeof classActionStatus>};
export type PlanningState={progress:StudentProgress[];plans:StudentPlan[];current_course_ids:string[];course_scope?:PlanningScope;groups?:Record<string,GroupContext>;activity_reports?:Record<string,PersonalTaskReport>;availability?:SavedAvailability|null};
const progressFields='task_id,source_id,version_id,state,planned_on,next_action,revision,updated_at';
const planFields='id,course_id,parent_id,kind,title,source_id,version_id,state,planned_on,next_action,revision,class_evidence,class_review';
function date(value:unknown){
 if(value==null||value==='')return null;
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T12:00:00Z'))||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value)throw new BetaHttpError('Choose a valid personal planning date.');
 return value;
}
function text(value:unknown,max:number,required=false){if(typeof value!=='string'||value.trim().length>max||required&&!value.trim())throw new BetaHttpError('Enter valid planning text.');return value.trim();}
function base(input:any,states:string[]){
 if(!uuid(input.request_id)||!Number.isSafeInteger(input.revision)||input.revision<0||!states.includes(input.state))throw new BetaHttpError('Choose a valid progress state and save revision.');
 return {state:input.state,planned_on:date(input.planned_on),next_action:text(input.next_action??'',600)};
}
async function cancelPlanningAnswers(c:PoolClient,user:string){
 await c.query("UPDATE schoolvault.jobs SET status='cancelled',error='Your saved plan changed. Your question is kept; ask again for the updated plan.',lease_hash=NULL,lease_until=NULL,updated_at=now() WHERE user_id=$1 AND kind='answer' AND status='leased' AND input ? 'work'",[user]);
}
function same(row:any,values:any){return Object.entries(values).every(([k,v])=>row[k]===v);}
export async function saveStudentProgress(user:string,input:any){
 const values=base(input,['not_started','in_progress','done','not_applicable']);if(!uuid(input.task_id)||!uuid(input.version_id))throw new BetaHttpError('Choose a saved activity version.');
 return tenant(user,async c=>{
  await lockVault(c,user);
  const task=(await c.query('SELECT t.source_id,s.current_version,t.evidence FROM schoolvault.tasks t JOIN schoolvault.sources s ON s.user_id=t.user_id AND s.id=t.source_id WHERE t.user_id=$1 AND t.id=$2',[user,input.task_id])).rows[0];
  if(!task)throw Error('Activity not found');
  const old=(await c.query(`SELECT ${progressFields},request_id FROM schoolvault.student_progress WHERE user_id=$1 AND task_id=$2 FOR UPDATE`,[user,input.task_id])).rows[0];
  const stored={...values,source_id:task.source_id,version_id:input.version_id};
  if(old?.request_id===input.request_id){if(!same(old,stored))throw new BetaConflict('This save was already received with different progress. Reload before changing it.');return old;}
  if(task.current_version!==input.version_id||task.evidence?.version_id&&task.evidence.version_id!==input.version_id||task.evidence?.active===false)throw new BetaConflict('The activity changed. Review its current instructions before saving progress.');
  if((old?.revision??0)!==input.revision)throw new BetaConflict('This progress changed elsewhere. Reload it; your edit is kept.');
  const row=(await c.query(`INSERT INTO schoolvault.student_progress(user_id,task_id,source_id,version_id,request_id,state,planned_on,next_action) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
   ON CONFLICT(user_id,task_id) DO UPDATE SET source_id=excluded.source_id,version_id=excluded.version_id,request_id=excluded.request_id,state=excluded.state,planned_on=excluded.planned_on,next_action=excluded.next_action,revision=student_progress.revision+1,updated_at=now() RETURNING ${progressFields}`,[user,input.task_id,task.source_id,input.version_id,input.request_id,values.state,values.planned_on,values.next_action])).rows[0];
  await cancelPlanningAnswers(c,user);await checkHistory(c,user);return row;
 });
}
export async function saveStudentPlan(user:string,input:any){
 const values={...base(input,['not_started','in_progress','done','archived']),title:text(input.title,180,true)};
 if(!uuid(input.course_id)||input.id!=null&&!uuid(input.id)||!['project','milestone','class_action'].includes(input.kind)||input.kind==='milestone'&&!uuid(input.parent_id)||input.kind!=='milestone'&&input.parent_id!=null||input.kind==='class_action'&&!uuid(input.id))throw new BetaHttpError('Choose a course and existing plan.');
 if((input.source_id==null)!==(input.version_id==null)||input.source_id!=null&&(!uuid(input.source_id)||!uuid(input.version_id)))throw new BetaHttpError('Choose a saved source version.');
 return tenant(user,async c=>{
  await lockVault(c,user);
  if(!(await c.query('SELECT 1 FROM schoolvault.courses WHERE user_id=$1 AND id=$2',[user,input.course_id])).rowCount)throw Error('Course not found');
  const stored={...values,course_id:input.course_id,kind:input.kind,parent_id:input.parent_id??null,source_id:input.source_id??null,version_id:input.version_id??null};
  const old=input.id?(await c.query(`SELECT ${planFields},request_id FROM schoolvault.student_plans WHERE user_id=$1 AND id=$2 FOR UPDATE`,[user,input.id])).rows[0]:(await c.query(`SELECT ${planFields},request_id FROM schoolvault.student_plans WHERE user_id=$1 AND request_id=$2`,[user,input.request_id])).rows[0];
  const classAction=stored.kind==='class_action';
  if(classAction&&(!old?.class_evidence||input.class_binding!==old.class_evidence.binding||!['unreviewed','applies','not_applicable'].includes(input.class_decision)))throw new BetaConflict('Class evidence changed. Reload and review the supported words; your personal edit is kept.');
  if(classAction&&(stored.source_id!==old.source_id||stored.version_id!==old.version_id))throw new BetaConflict('A class action keeps its transcript evidence. Review the new transcript before saving.');
  if(classAction&&input.class_decision==='applies'&&old.class_evidence.status!=='current')throw new BetaConflict('This instruction was withdrawn from the current transcript. Keep personal progress or mark it not applicable.');
  if(classAction&&input.class_decision==='applies'&&old.class_evidence.activity&&!(await c.query('SELECT 1 FROM schoolvault.sources WHERE user_id=$1 AND id=$2 AND current_version=$3',[user,old.class_evidence.activity.source_id,old.class_evidence.activity.version_id])).rowCount)throw new BetaConflict('The related Moodle activity changed. Refresh this class action before confirming it.');
  if(old?.request_id===input.request_id){if(!same(old,stored)||classAction&&(old.class_review?.binding!==input.class_binding||old.class_review?.decision!==input.class_decision))throw new BetaConflict('This save was already received with a different plan. Reload before changing it.');return old;}
  if(input.id&&!old)throw Error('Plan not found');
  if((old?.revision??0)!==input.revision)throw new BetaConflict('This plan changed elsewhere. Reload it; your edit is kept.');
  if(old&&(old.course_id!==stored.course_id||old.kind!==stored.kind||old.parent_id!==stored.parent_id))throw new BetaConflict('A plan keeps its course and project. Create a new plan to move work.');
  if(stored.parent_id&&!(await c.query("SELECT 1 FROM schoolvault.student_plans WHERE user_id=$1 AND id=$2 AND course_id=$3 AND kind='project' AND state!='archived'",[user,stored.parent_id,stored.course_id])).rowCount)throw Error('Current project not found');
  if(stored.source_id&&!(await c.query('SELECT 1 FROM schoolvault.sources WHERE user_id=$1 AND id=$2 AND course_id=$3 AND current_version=$4',[user,stored.source_id,stored.course_id,stored.version_id])).rowCount)throw new BetaConflict('The source changed. Choose its current version before saving this plan.');
  if(!old)await checkObjects(c,user,'student_plans');
  const row=old?(await c.query(`UPDATE schoolvault.student_plans SET title=$3,next_action=$4,state=$5,planned_on=$6,source_id=$7,version_id=$8,request_id=$9,revision=revision+1,updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING ${planFields}`,[user,old.id,stored.title,stored.next_action,stored.state,stored.planned_on,stored.source_id,stored.version_id,input.request_id])).rows[0]:(await c.query(`INSERT INTO schoolvault.student_plans(user_id,id,course_id,parent_id,kind,title,next_action,state,planned_on,source_id,version_id,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING ${planFields}`,[user,randomUUID(),stored.course_id,stored.parent_id,stored.kind,stored.title,stored.next_action,stored.state,stored.planned_on,stored.source_id,stored.version_id,input.request_id])).rows[0];
  if(classAction){row.class_review={binding:input.class_binding,decision:input.class_decision,reviewed_at:new Date().toISOString()};await c.query('UPDATE schoolvault.student_plans SET class_review=$3 WHERE user_id=$1 AND id=$2',[user,row.id,row.class_review]);}
  await cancelPlanningAnswers(c,user);await checkHistory(c,user);return row;
 });
}
export async function planningState(c:PoolClient,user:string,options:{scope?:PlanningScope;includeGroups?:boolean}={}):Promise<PlanningState>{
 const availability=(await c.query("SELECT id,body,revision,updated_at FROM schoolvault.student_memory WHERE user_id=$1 AND kind='availability' LIMIT 1",[user])).rows[0];
 const progress=(await c.query(`SELECT ${progressFields} FROM schoolvault.student_progress WHERE user_id=$1 ORDER BY updated_at DESC,task_id`,[user])).rows;
 const plans=(await c.query(`SELECT ${planFields} FROM schoolvault.student_plans WHERE user_id=$1 ORDER BY created_at,id`,[user])).rows;
 const refs=[...progress,...plans.filter(p=>p.source_id)].map(p=>({id:p.source_id,version_id:p.version_id}));for(const p of plans)if(p.class_evidence?.activity)refs.push({id:p.class_evidence.activity.source_id,version_id:p.class_evidence.activity.version_id});const changed=await changedSources(c,user,refs);
 for(const p of [...progress,...plans])p.changed_sources=changed.filter(r=>r.id===p.source_id&&r.version_id===p.version_id||'class_evidence' in p&&p.class_evidence?.activity?.source_id===r.id&&p.class_evidence.activity.version_id===r.version_id);
 for(const p of plans){p.class_action=classActionStatus(p);if(p.class_action&&p.changed_sources.length)p.class_action.needs_review=true;}
 const activityIds=plans.flatMap(p=>p.class_evidence?.activity?[p.class_evidence.activity.source_id]:[]);
 const dates=activityIds.length?(await c.query("SELECT t.source_id,t.evidence,s.current_version,s.kind,s.title,s.original_url FROM schoolvault.tasks t JOIN schoolvault.sources s ON s.user_id=t.user_id AND s.id=t.source_id WHERE t.user_id=$1 AND t.source_id=ANY($2::uuid[]) AND coalesce(t.evidence->>'active','true')!='false' AND coalesce(t.evidence->>'confirmation','observed-activity')!='candidate'",[user,activityIds])).rows:[];
 for(const p of plans){const e=p.class_evidence,a=p.class_action;if(!a||!e.activity||!e.stated_date)continue;const current=dates.filter(d=>!unverifiedForumSource(d)&&d.source_id===e.activity.source_id&&d.current_version===e.activity.version_id&&(!d.evidence.version_id||d.evidence.version_id===e.activity.version_id));const due=[...new Set(current.map(d=>d.evidence.due_date||typeof d.evidence.due_at==='string'&&Number.isFinite(Date.parse(d.evidence.due_at))&&zoneDate(d.evidence.due_at,e.timezone)).filter(Boolean))];if(due.some(date=>date!==e.stated_date)){a.needs_review=true;a.conflict='Class wording mentions '+e.stated_date+'; the candidate Moodle activity has saved dates '+due.join(', ')+'. Confirm the activity and reconcile both sources; Moodle dates remain unchanged.';}}
 const selection=options.scope??await planningScope(c,user);
 const reports=(await c.query("SELECT id,kind,course_id,body,revision,updated_at FROM schoolvault.student_memory WHERE user_id=$1 AND kind='progress' AND chat_id IS NULL AND (course_id IS NULL OR course_id=ANY($2::uuid[])) ORDER BY updated_at DESC,id DESC LIMIT 100",[user,selection.course_ids])).rows;
 const reportCourses=reports.length||options.includeGroups!==false?(await c.query('SELECT id,code FROM schoolvault.courses WHERE user_id=$1 AND id=ANY($2::uuid[])',[user,selection.course_ids])).rows:[];
 const reportTasks=reports.length?(await c.query("SELECT t.id,t.course_id,t.source_id,t.evidence,v.observed_at AS source_observed_at FROM schoolvault.tasks t JOIN schoolvault.sources s ON s.user_id=t.user_id AND s.id=t.source_id JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.id=s.current_version WHERE t.user_id=$1 AND t.course_id=ANY($2::uuid[]) AND coalesce(t.evidence->>'active','true')!='false'",[user,selection.course_ids])).rows:[];
 const activity_reports=personalTaskReports(reportTasks,reportCourses,reports);
 const groups=options.includeGroups===false?undefined:await courseGroupContexts(c,user,reportCourses.map(course=>course.id));
 return {progress,plans,groups,availability:availability?{id:availability.id,revision:availability.revision,updated_at:availability.updated_at,...parseAvailability(availability.body)}:null,current_course_ids:selection.course_ids,course_scope:selection,activity_reports};
}

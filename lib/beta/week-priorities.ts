import {addDays,zoneDate,type BetaTask} from './agenda';
import {assessmentKey,type Assessment} from './assessments-format';
import {taskDate,workStatus} from './planning-view';
import type {PlanningState} from './student-planning';
export type WeekPriority={id:string;course_id:string;title:string;kind:'coursework'|'assessment'|'plan';date:string|null;due_at:string|null;action:string;benefit:string;basis:string;task_id?:string;plan_id?:string;source_id:string|null;version_id:string|null;assessment?:Assessment;activity_reference?:{date:string;source_id:string;version_id:string|null};rank:number};
export function priorityStep(title:string,kind:WeekPriority['kind'],ownAction=''){
 if(ownAction.trim())return {action:ownAction,benefit:'This is the next step you chose. Check its result against the current requirements before moving on.'};
 if(kind==='assessment'||/\b(test|exam|quiz|midterm)\b/i.test(title))return {action:'Check the saved test scope. Try one available review question without notes and mark the first point you cannot explain.',benefit:'This will show what you can explain and what needs review.'};
 if(/in.class/i.test(title))return {action:'Open the activity and handout to identify the first thing you must produce. If the handout is not saved, confirm it in class.',benefit:'You will know what to bring and what you need to produce.'};
 if(/written portion/i.test(title))return {action:'Check the exact activity for a submission receipt before repeating the work. If unfinished, compare the required questions with your worked file and find the first unchecked part.',benefit:'You will know whether anything still needs checking or uploading.'};
 return {action:'List the required outputs from the current instructions, then identify the first part your work does not yet include.',benefit:'You will have one concrete gap to work on and avoid redoing completed pieces.'};
}
const validDate=(s:unknown):s is string=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
// Read-only, bounded saved-state priorities. No inferred completion, clock time,
// effort estimate or official date is created from personal plans or meetings.
export function weekPriorities(tasks:BetaTask[],planning:PlanningState,assessments:Assessment[],now:Date,zone:string,options:{days?:7|14;limit?:number}={}):WeekPriority[]{
 const today=zoneDate(now,zone),end=addDays(today,(options.days||7)-1),scope=new Set(planning.current_course_ids),items:WeekPriority[]=[],represented=new Set<string>(),blocked=new Set<string>();
 const identity=(course:string,title:string)=>{const key=assessmentKey(title);return key?course+'\0'+key:null;};
 for(const task of tasks){
  if(!scope.has(task.course_id)||task.evidence?.active===false)continue;
  const progress=planning.progress.find(p=>p.task_id===task.id),title=String(task.evidence?.title||'Saved activity'),key=identity(task.course_id,title),status=workStatus(task,planning,now,zone);
  if(['submitted','attempt_finished','personal_done','missed','check_status'].includes(status.state)){if(key)blocked.add(key);continue;}
  if(task.evidence?.authority_state==='unverified_forum'||task.evidence?.requirement==='optional'&&progress?.planned_on!==today){if(key)blocked.add(key);continue;}
  const date=taskDate(task,zone),chosen=progress?.planned_on===today,changed=!!progress?.changed_sources?.length;
  if(!changed&&!chosen&&(!date||date<today||date>end))continue;
  const step=changed?{action:'Review the changed instructions before continuing your next step.',benefit:'You can check whether your existing work still fits before doing it again.'}:priorityStep(title,'coursework',progress?.next_action);
  items.push({id:'task-'+task.id,course_id:task.course_id,title,kind:'coursework',date,due_at:typeof task.evidence?.due_at==='string'?task.evidence.due_at:null,...step,basis:changed?'The saved instructions changed after your progress update.':chosen?'You chose today for this task; that is a personal target.':status.state==='submit_late'?status.reason:options.days===14?'A saved course deadline falls in the next 14 days.':'A saved course deadline falls in the next seven days.',task_id:task.id,source_id:task.source_id,version_id:typeof task.evidence?.version_id==='string'?task.evidence.version_id:null,rank:changed?0:date===today||status.state==='submit_late'?1:chosen?2:3});
  if(key)represented.add(key);
 }
 for(const a of assessments){
  const key=a.courseId+'\0'+a.key;
  if(!scope.has(a.courseId)||a.sourceKind==='student_plan'||a.range||!a.sourceId||!a.version||!validDate(a.date)||a.date<today||a.date>end||a.planState==='done'||blocked.has(key))continue;
  const match=items.find(i=>i.kind==='coursework'&&identity(i.course_id,i.title)===key);
  if(match){match.assessment=a;if(match.date&&match.date!==a.date){match.action='Compare the saved activity deadline with the quoted assessment date before choosing how to prepare.';match.benefit='You can resolve which date applies without silently replacing either source.';match.basis='Saved activity and assessment dates differ.';}continue;}
  if(represented.has(key))continue;represented.add(key);
  const other=tasks.find(t=>scope.has(t.course_id)&&t.evidence?.active!==false&&identity(t.course_id,String(t.evidence?.title||''))===key),otherDate=other?taskDate(other,zone):null;
  const activity_reference=other&&otherDate&&otherDate!==a.date?{date:otherDate,source_id:other.source_id,version_id:typeof other.evidence?.version_id==='string'?other.evidence.version_id:null}:undefined;
  const conflict=a.conflicts.length>0||!!activity_reference;
  items.push({id:'assessment-'+a.courseId+'-'+a.key,course_id:a.courseId,title:a.key.replace(/\b\w/g,c=>c.toUpperCase()),kind:'assessment',date:a.date,due_at:null,...(conflict?{action:'Compare the quoted dates in the original sources and confirm which applies before planning preparation.',benefit:'You avoid preparing for an assumed date while the saved sources disagree.'}:priorityStep(a.key,'assessment')),basis:conflict?'Saved sources disagree about this assessment date.':'An assessment date is quoted in your saved course material.',source_id:a.sourceId,version_id:a.version,assessment:a,activity_reference,rank:a.date===today?1:3});
 }
 for(const p of planning.plans){
  if(!scope.has(p.course_id)||p.planned_on!==today||['done','not_applicable','archived'].includes(p.state)||p.parent_id&&!planning.plans.some(parent=>parent.id===p.parent_id&&parent.state!=='archived')||p.class_action&&(!p.class_action.active||p.class_action.review==='not_applicable'))continue;
  const changed=!!p.changed_sources?.length||p.class_action?.needs_review;
  items.push({id:'plan-'+p.id,plan_id:p.id,course_id:p.course_id,title:p.title,kind:'plan',date:today,due_at:null,...(changed?{action:'Review the linked evidence before continuing your personal next step.',benefit:'You can keep useful work while checking whether the changed instructions affect it.'}:priorityStep(p.title,'plan',p.next_action)),basis:'You chose today for this personal plan; this is not an official deadline.',source_id:p.source_id,version_id:p.version_id,rank:changed?0:2});
 }
 return items.sort((a,b)=>a.rank-b.rank||(a.date||'9999').localeCompare(b.date||'9999')||(a.due_at&&b.due_at?Date.parse(a.due_at)-Date.parse(b.due_at):0)||a.id.localeCompare(b.id)).slice(0,Math.max(1,Math.min(12,options.limit||3)));
}

import {currentParticipation} from './participation-format';
import {currentReceipt} from './receipt-current';
import {observedAssignmentGrade} from './assignment-grade';
import {currentAssignmentGroup} from './assignment-membership';
import {zoneDate,type BetaTask} from './agenda';
import type {PlanningState} from './student-planning';
import {forumAuthorityNote} from './source-authority';

// Presentation-only decisions. These helpers do not write plans or establish completion.
const validDate=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
export function taskDate(task:BetaTask,zone:string){
 if(task.evidence?.authority_state==='unverified_forum')return null;
 const at=task.evidence?.due_at;
 if(typeof at==='string'&&Number.isFinite(Date.parse(at)))return zoneDate(new Date(at),zone);
 return validDate(task.evidence?.due_date)?task.evidence.due_date:null;
}
export function workFinished(task:BetaTask,planning:PlanningState){
 const state=planning.progress.find(p=>p.task_id===task.id)?.state;
 const receipt=task.evidence?.receipt;
 return state==='done'||state==='not_applicable'||!!(receipt?.eligible&&receipt.state==='submitted');
}
export type WorkStatus={state:'submitted'|'attempt_finished'|'personal_done'|'upcoming'|'submit_late'|'missed'|'check_status';label:string;reason:string};
// Recheck freshness as the browser clock advances; a snapshot must not stay trusted forever.
export function workStatus(task:BetaTask,planning:PlanningState,now:Date,zone:string):WorkStatus{
 const receipt=task.evidence?.receipt,current=currentReceipt(receipt,now,task.evidence);
 const membership=currentAssignmentGroup(receipt,now,task.evidence);
 if(membership.state==='observed')return {state:'check_status',label:'Group: '+membership.group+' · check submission',reason:'Moodle named this group for this assignment. It does not establish your section, group in other activities or individual submission. Check this activity’s requirements before repeating work.'};
 if(current&&receipt?.state==='submitted'){const grade=observedAssignmentGrade(receipt.proof,true,true);return {state:'submitted',label:grade.state==='released'?'Submitted · graded':'Submitted',reason:grade.state==='released'?'Moodle showed a submitted assignment with released grading feedback. Review later instructions separately.':'Moodle showed submitted for grading. This is the saved observation, not a live check.'};}
 if(current&&receipt?.state==='attempt_finished')return {state:'attempt_finished',label:'Attempt submitted',reason:'The latest numbered quiz attempt is finished. Required retakes and other requirements still need checking.'};
 const progress=planning.progress.find(p=>p.task_id===task.id);
 if(progress?.state==='done'&&(progress.changed_sources?.length||current&&['no_submission','draft','reopened'].includes(receipt!.state)))return {state:'check_status',label:'Work marked done · check source',reason:progress.changed_sources?.length?'You marked the work finished, but its instructions changed. Compare your finished work with the current instructions before deciding whether anything more is needed.':'You marked the work finished, while the saved Moodle status does not show a completed submission. Check the exact activity and receipt; do not redo finished work. Finishing work and submitting it are separate.'};
 if(progress?.state==='not_applicable'||progress?.state==='done'&&!(current&&['no_submission','draft','reopened'].includes(receipt!.state)))return {state:'personal_done',label:progress.state==='done'?'Marked done by you':'Not applicable',reason:'Your personal progress does not establish a Moodle submission.'};
 const report=planning.activity_reports?.[task.id];
 if(report&&(!progress?.updated_at||Date.parse(report.updated_at)>Date.parse(progress.updated_at))){
  const label=report.state==='submitted'?'Reported submitted by you':'Reported finished by you';
  if(report.needs_review||current&&['no_submission','draft','reopened'].includes(receipt!.state))return {state:'check_status',label:label+' · check source',reason:'Your saved personal report says you '+report.state+', but the current instructions or Moodle status need review. A report does not verify submission; check the exact activity before doing the work again.'};
  return {state:'personal_done',label,reason:'This comes from your saved personal report, not a verified Moodle receipt. Check the exact activity for official submission status.'};
 }
 const participation=task.evidence?.forum_participation;
 if(participation?.scope==='own_participation_only')return {state:'check_status',label:currentParticipation(participation,now,task.evidence)?'Own forum post observed · check requirements':'Own forum post recorded · needs refresh',reason:'Your own forum participation was observed. Do not repeat the post automatically. Check the original for any remaining replies or other requirements; this does not establish full completion, a grade, an official date or the author’s authority.'};
 if(task.evidence?.authority_state==='unverified_forum')return {state:'upcoming',label:'Author/authority unverified',reason:forumAuthorityNote};
 if(!current&&receipt&&['submitted','attempt_finished'].includes(receipt.observed_state))return {state:'check_status',label:'Submission needs refresh',reason:'A previous capture showed a submission or finished attempt. Refresh Moodle before treating it as current or doing the work again.'};
 const due=taskDate(task,zone),instant=typeof task.evidence?.due_at==='string'?Date.parse(task.evidence.due_at):NaN;
 const overdue=Number.isFinite(instant)?instant<now.getTime():!!due&&due<zoneDate(now,zone);
 const availability=current&&!receipt?.proof?.truncated?receipt?.proof?.availability:null;
 const unsubmitted=current&&['no_submission','draft','reopened'].includes(receipt!.state);
 const cutoff=receipt?.proof?.cutoff_at?Date.parse(receipt.proof.cutoff_at):NaN;
 if(unsubmitted&&(availability?.state==='closed'||Number.isFinite(cutoff)&&cutoff<=now.getTime()&&(availability?.state!=='open'||Date.parse(receipt!.observed_at)<cutoff)))return {state:'missed',label:overdue?'Missed · submissions closed':'Submissions closed',reason:'Moodle showed no completed submission and either an explicit closed status or an elapsed exact cutoff. Check Moodle for a reopening or exception.'};
 if(overdue&&unsubmitted&&availability?.state==='open')return {state:'submit_late',label:'Submit late',reason:'The deadline passed, and Moodle showed an available submission control. Check the current page before submitting. '+(receipt?.proof?.late_penalty?'Moodle stated: “'+receipt.proof.late_penalty+'”':'A late penalty has not been verified.')};
 if(overdue)return {state:'check_status',label:'Overdue · check status',reason:'The deadline passed. Submission and late availability need a current Moodle check; this is not proof of missed work.'};
 return {state:'upcoming',label:current&&receipt?.state==='draft'?'Draft · not submitted':current&&receipt?.state==='no_submission'?'Not submitted':current&&receipt?.state==='reopened'?'Submission reopened':due===zoneDate(now,zone)?'Due today':due?'Upcoming':'Date needs checking',reason:current&&receipt?.state==='draft'?'Moodle showed a draft, which has not been submitted.':'Use the current instructions and verify your submission in Moodle.'};
}
export type PlannedWork={id:string;date:string;title:string;course_id:string;source_id:string|null;state:string;next_action:string;task_id?:string};
export type ContinuingWork={id:string;kind:'task'|'plan';title:string;course_id:string;source_id:string|null;version_id:string|null;state:string;next_action:string;changed:boolean};
// Saved intentions remain discoverable without a study date. This list does not
// rank deadlines, infer submission or turn a personal plan into a requirement.
export function continuingWork(tasks:BetaTask[],planning:PlanningState):ContinuingWork[]{
 const current=new Set(planning.current_course_ids),open=(state:string)=>state==='not_started'||state==='in_progress';
 const progress=planning.progress.flatMap(p=>{
  const task=tasks.find(t=>t.id===p.task_id&&current.has(t.course_id)&&t.evidence?.active!==false);
  return task&&open(p.state)&&p.next_action.trim()?[{id:task.id,kind:'task' as const,title:String(task.evidence?.title||'Saved activity'),course_id:task.course_id,source_id:p.source_id,version_id:p.version_id,state:p.state,next_action:p.next_action,changed:!!p.changed_sources?.length}]:[];
 });
 const plans=planning.plans.filter(p=>current.has(p.course_id)&&open(p.state)&&p.next_action.trim()&&(!p.parent_id||planning.plans.some(parent=>parent.id===p.parent_id&&parent.course_id===p.course_id&&parent.state!=='archived'))&&(!p.class_action||p.class_action.active)).map(p=>({id:p.id,kind:'plan' as const,title:p.title,course_id:p.course_id,source_id:p.source_id,version_id:p.version_id,state:p.state,next_action:p.next_action,changed:!!p.changed_sources?.length}));
 return [...progress,...plans].sort((a,b)=>Number(b.state==='in_progress')-Number(a.state==='in_progress'));
}
export function plannedWork(tasks:BetaTask[],planning?:PlanningState):PlannedWork[]{
 if(!planning)return [];
 const current=new Set(planning.current_course_ids);
 const progress=planning.progress.flatMap(p=>{
  const task=tasks.find(t=>t.id===p.task_id&&current.has(t.course_id)&&t.evidence?.active!==false);
  return task&&validDate(p.planned_on)&&p.state!=='not_applicable'?[{id:'personal-'+task.id,date:p.planned_on,title:String(task.evidence?.title||'Activity'),course_id:task.course_id,source_id:task.source_id,state:p.state,next_action:p.next_action,task_id:task.id}]:[];
 });
 const plans=planning.plans.filter(p=>validDate(p.planned_on)&&current.has(p.course_id)&&p.state!=='archived'&&(!p.parent_id||planning.plans.some(parent=>parent.id===p.parent_id&&parent.state!=='archived'))&&(!p.class_action||p.class_action.active)).map(p=>({id:p.id,date:p.planned_on!,title:p.title,course_id:p.course_id,source_id:p.source_id,state:p.state,next_action:p.next_action}));
 return [...progress,...plans].sort((a,b)=>a.date.localeCompare(b.date)||a.title.localeCompare(b.title));
}
export type WorkRecommendation={task:BetaTask;reason:string;action:string;kind:'review'|'planned'|'deadline'|'undated'|'late'};
export function recommendWork(tasks:BetaTask[],planning:PlanningState,today:string,zone:string,now=new Date(today+'T12:00:00Z')):WorkRecommendation|null{
 const ranked=tasks.filter(t=>t.evidence?.active!==false&&(t.evidence?.authority_state!=='unverified_forum'||planning.progress.some(p=>p.task_id===t.id&&p.planned_on&&p.planned_on<=today))&&planning.current_course_ids.includes(t.course_id)&&(t.evidence?.requirement!=='optional'||planning.progress.some(p=>p.task_id===t.id&&p.planned_on===today))&&!['submitted','attempt_finished','personal_done','missed','check_status'].includes(workStatus(t,planning,now,zone).state)).map(task=>{
  const progress=planning.progress.find(p=>p.task_id===task.id),due=taskDate(task,zone),changed=!!progress?.changed_sources?.length;
  const rank=changed?0:workStatus(task,planning,now,zone).state==='submit_late'?1:due&&due<=today?1:progress?.planned_on===today?2:progress?.planned_on&&progress.planned_on<today?3:due?4:5;
  return {task,progress,due,changed,rank};
 }).sort((a,b)=>a.rank-b.rank||(a.due||'9999').localeCompare(b.due||'9999')||a.task.id.localeCompare(b.task.id));
 const next=ranked[0];if(!next)return null;
 const {task,progress,due,changed}=next;
 if(changed)return {task,kind:'review',action:'Review the current instructions before continuing.',reason:'The saved instructions changed after your last progress update.'};
 if(workStatus(task,planning,now,zone).state==='submit_late')return {task,kind:'late',action:'Submit late in Moodle. Review any late policy before sending.',reason:workStatus(task,planning,now,zone).reason};
 if(task.evidence?.authority_state==='unverified_forum'&&progress?.planned_on)return {task,kind:'planned',action:progress.next_action||'Review your chosen study task.',reason:'You chose '+progress.planned_on+' as a personal study day. '+forumAuthorityNote};
 if(due===today)return {task,kind:'deadline',action:progress?.next_action||'Review the instructions and choose your next step.',reason:'Its saved course deadline is today. Check the exact time and current requirements.'};
 if(progress?.planned_on===today)return {task,kind:'planned',action:progress.next_action||'Open the instructions and choose where to begin.',reason:'You chose today as your study day for this activity.'};
 if(progress?.planned_on&&progress.planned_on<today)return {task,kind:'planned',action:progress.next_action||'Review your plan and choose the next step.',reason:'Your chosen study day has passed, and your personal progress is still open. You can keep or change the plan.'};
 if(due)return {task,kind:'deadline',action:progress?.next_action||'Read the instructions and identify the first required step.',reason:'This is the nearest saved deadline among work you have not marked finished.'};
 return {task,kind:'undated',action:'Check the instructions for a date and choose your next action.',reason:'No deadline is saved for this activity. Its timing needs a source check.'};
}

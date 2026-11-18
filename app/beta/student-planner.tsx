'use client';
import {groupApplicability,type GroupContext} from '../../lib/beta/group-context-format';
import {useI18n} from "./language";

import {workIndex} from '../../lib/beta/work-index';
import {courseTone} from '../../lib/beta/course-identity';
import {weekPriorities} from '../../lib/beta/week-priorities';
import {assessmentSourceLabel} from '../../lib/beta/assessments-format';
import type {AssessmentRead} from './use-assessments';
import EvidenceChange from './evidence-change';
import PlanningCourses from './planning-courses';
import DaySchedule from './day-schedule';
import AssignmentCheck from './assignment-check';
import AssignmentMaterial from './assignment-material';
import ReceiptStatus from './receipt-status';
import ForumParticipationStatus from './forum-participation-status';
import {ProductHeading,CourseContext} from './product-ui';
import {courseLabel} from '../../lib/beta/course-label';
import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import type {PlanningState,StudentPlan,StudentProgress} from '../../lib/beta/student-planning';
import {agenda,addDays,zoneDate,type BetaTask,type BetaMeeting} from '../../lib/beta/agenda';
import {continuingWork,plannedWork,recommendWork,taskDate,workFinished,workStatus} from '../../lib/beta/planning-view';
import {CalendarDays,FileText} from 'lucide-react';
type Source={id:string;title:string;version_id?:string;course_id:string};
type Common={courseLabel?:(id:string)=>string;sources:Source[];onSave:(input:unknown)=>Promise<any>;onDirty:(key:string,dirty:boolean)=>void;onOpen:(id:string)=>void;onVersion?:(ref:any)=>void;onRecording?:(id:string,ms:number)=>void;zone:string};
const courseworkPageSize=12;
const progressStates=['not_started','in_progress','done','not_applicable'];
const states=(values:string[],ui:(text:string)=>string)=>values.map(value=><option key={value} value={value}>{ui(value.replaceAll('_',' '))}</option>);
function deadlineLabel(evidence:BetaTask['evidence'],zone:string,locale:string,ui:(text:string)=>string){
 const at=evidence?.due_at;
 if(typeof at==='string'&&Number.isFinite(Date.parse(at)))return new Intl.DateTimeFormat(locale,{timeZone:zone,dateStyle:'medium',timeStyle:'short'}).format(new Date(at))+' · '+zone.split('/').at(-1)?.replaceAll('_',' ')+' '+ui('time');
 const date=evidence?.due_date;
 if(typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date+'T12:00:00Z')))return new Intl.DateTimeFormat(locale,{timeZone:'UTC',dateStyle:'medium'}).format(new Date(date+'T12:00:00Z'))+' · '+ui('time not stated');
 return ui('date not captured');
}
function useSaveRequest(){const request=useRef<{body:string;id:string}|null>(null);return (body:unknown)=>{const value=JSON.stringify(body);if(request.current?.body!==value)request.current={body:value,id:crypto.randomUUID()};return request.current!.id;};}
export function ProgressEditor({task,progress,report,status,statusNow,groups,desk=false,suggestion='',onAsk,...common}:Common&{desk?:boolean;suggestion?:string;onAsk?:()=>void;task:BetaTask;progress?:StudentProgress;report?:NonNullable<PlanningState['activity_reports']>[string];status?:ReturnType<typeof workStatus>|null;statusNow?:Date|null;groups?:GroupContext}){
 const {t:ui,locale}=useI18n();
 const [materialOpen,setMaterialOpen]=useState(false);
 const key='task-'+task.id,[state,setState]=useState(progress?.state||(report?'done':'not_started')),[planned,setPlanned]=useState(progress?.planned_on||''),[action,setAction]=useState(progress?.next_action??suggestion),[revision,setRevision]=useState(progress?.revision||0);
 const [dirty,setDirty]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false),[reviewed,setReviewed]=useState(false),[progressChecked,setProgressChecked]=useState(false),request=useSaveRequest(),accepted=useRef<StudentProgress|null>(null);
 const source=common.sources.find(s=>s.id===task.source_id),changed=!!progress?.changed_sources?.length;

 const pastStudyDay=!!(progress?.planned_on&&statusNow&&progress.planned_on<zoneDate(statusNow,common.zone)&&!['done','not_applicable'].includes(progress.state));
 useEffect(()=>setProgressChecked(false),[progress?.planned_on]);
 useEffect(()=>{if(dirty||saving)return;const value=accepted.current&&(accepted.current.revision>(progress?.revision||0))?accepted.current:progress;setState(value?.state||(report?'done':'not_started'));setPlanned(value?.planned_on||'');setAction(value?.next_action??suggestion);setRevision(value?.revision||0);},[progress?.revision,report?.memory_id,report?.revision,dirty,saving,suggestion]);
 useEffect(()=>setReviewed(false),[source?.version_id]);
 useEffect(()=>{common.onDirty(key,dirty||saving);return()=>common.onDirty(key,false);},[common.onDirty,key,dirty,saving]);
 function edit(){setDirty(true);setSaved(false);}
 async function save(e:React.FormEvent){e.preventDefault();setSaving(true);setError('');const body={op:'progress.save',task_id:task.id,version_id:source?.version_id,revision,state,planned_on:planned||null,next_action:action};try{const row=await common.onSave({...body,request_id:request(body)});accepted.current=row;setRevision(row.revision);setDirty(false);setSaved(true);}catch(e){setError(e instanceof Error?e.message:'Progress could not save. Retry with your edit kept.');}finally{setSaving(false);}}
 const due=<p>{ui("Due:")} {deadlineLabel(task.evidence,common.zone,locale,ui)}{ui(". A personal progress update does not verify a Moodle receipt.")}</p>;
 const evidence=<>
  {report&&<p>{ui('Saved personal report:')} {ui(report.state==='submitted'?'Reported submitted by you':'Reported finished by you')}{ui('. This is separate from a Moodle receipt and does not create a progress entry.')}</p>}
  {status&&!task.evidence?.forum_participation&&<p>{ui(status.reason)}</p>}<ForumParticipationStatus zone={common.zone} participation={task.evidence?.forum_participation} now={statusNow||undefined} binding={task.evidence}/>{!task.evidence?.forum_participation&&<ReceiptStatus receipt={task.evidence?.receipt} zone={common.zone} now={statusNow||undefined} binding={task.evidence}/>}{source&&<button type="button" onClick={()=>common.onOpen(source.id)}>{ui("Open current instructions")}</button>}
  {materialOpen&&typeof task.evidence?.activity_url==='string'&&/^https:\/\/moodle\.acadiau\.ca\/mod\/assign\/view\.php\?id=[1-9]\d*$/.test(task.evidence.activity_url)&&<AssignmentCheck key={task.source_id} sourceId={task.source_id} onOpen={common.onOpen}/>}
  {onAsk&&source?.version_id&&<button type="button" disabled={dirty||saving} onClick={onAsk}>{ui('Ask about this assignment')}</button>}
  {materialOpen&&source?.version_id&&<AssignmentMaterial key={task.id+':'+source.version_id} binding={{source_id:task.source_id,version_id:source.version_id,course_id:task.course_id}} onOpen={common.onOpen}/>}
 </>;
 const applicability=statusNow?groupApplicability(task.course_id,groups,task.evidence?.receipt,statusNow,task.evidence):null;
 const body=<>
  {applicability&&<p className="beta-section-caption"><strong>{ui(applicability.state==='activity_group_observed'?'Assignment group':'Group applicability needs checking')}</strong>{applicability.group?' · '+applicability.group:''}<br/>{ui(applicability.reason)}{applicability.profile_url&&<> <a href={applicability.profile_url} target="_blank" rel="noreferrer">{ui('Review your Moodle course profile')}</a></>}</p>}
  {changed&&<p role="status">{ui("The instructions changed since your progress update. Review the current source before saving again.")}</p>}
  {pastStudyDay&&<div className="nu-progress-check" role="group" aria-label={ui('Check your progress before replanning')}><p>{ui('Your chosen study day has passed. Did you finish, partly finish or not start?')}</p><div>{[['done','Finished'],['in_progress','Partly finished'],['not_started','Did not start']].map(([value,label])=><button type="button" key={value} disabled={saving} aria-pressed={progressChecked&&state===value} onClick={()=>{setState(value);setProgressChecked(true);edit();}}>{ui(label)}</button>)}</div><small>{ui('Choose an answer before changing the study day. Save progress to keep your report; this does not verify a Moodle submission.')}</small></div>}
  <form onSubmit={save}><fieldset disabled={saving}><label>{ui("My progress")}<select aria-label={ui("My progress")} value={state} onChange={e=>{setState(e.target.value);setProgressChecked(true);edit();}}>{states(progressStates,ui)}</select></label>{state==='done'&&<p>{ui('Saving done keeps this work out of priorities. Any missing submission or changed instructions stay available under Status checks; this does not verify a Moodle submission.')}</p>}<label>{ui("My study day")}<input type="date" disabled={pastStudyDay&&!progressChecked} value={planned} onInput={e=>{setPlanned(e.currentTarget.value);edit();}} onChange={e=>{setPlanned(e.target.value);edit();}}/></label><label>{ui("My next action")}<textarea aria-label={ui("My next action")} maxLength={600} value={action} onChange={e=>{setAction(e.target.value);edit();}}/></label>
   {changed&&<label><input type="checkbox" checked={reviewed} onChange={e=>{setReviewed(e.target.checked);edit();}}/>{ui("I reviewed the current instructions")}</label>}
   <button disabled={saving||!source?.version_id||changed&&!reviewed}>{saving?ui("Saving…"):ui(desk?"Save plan":"Save progress")}</button>
   {dirty&&!saving&&<button type="button" onClick={()=>{setDirty(false);setSaved(false);setError('');}}>{ui("Reload saved progress")}</button>}
   </fieldset>{saved&&<p role="status">{ui(desk?"Plan saved.":"Progress saved.")}</p>}{error&&<p role="alert">{ui(error)}  {ui("Your edit is kept.")}</p>}
  </form></>;
 if(desk)return <div className="beta-plan-item nu-desk-progress">{due}{body}<details className="nu-desk-current" onToggle={event=>{if(event.target===event.currentTarget)setMaterialOpen(event.currentTarget.open);}}><summary>{ui('Current instructions and status')}</summary>{evidence}</details></div>;
 return <details id={"activity-"+task.id} className="beta-plan-item beta-activity-item" onToggle={event=>{if(event.target===event.currentTarget)setMaterialOpen(event.currentTarget.open);}}><summary><div className="beta-activity-main"><CourseContext code={common.courseLabel?.(task.course_id)||'Course'}/><strong>{String(task.evidence?.title||source?.title||'Saved activity')}</strong><span className="beta-activity-next">{status?.label?ui(status.label):ui("Status not checked")}{progress?.next_action?' · '+progress.next_action:''}</span></div><div className="beta-activity-facts"><span><small>{ui("Course deadline")}</small>{deadlineLabel(task.evidence,common.zone,locale,ui)}</span><span data-empty={!progress?.planned_on||undefined}><small>{ui("My study day")}</small>{progress?.planned_on?new Intl.DateTimeFormat(locale,{timeZone:'UTC',month:'short',day:'numeric'}).format(new Date(progress.planned_on+'T12:00:00Z')):ui("Not planned yet")}</span><span className="beta-activity-state" data-empty={!progress&&!report||undefined}><small>{ui("My progress")}</small>{progress?ui(progress.state.replaceAll('_',' ')):report?ui(report.state==='submitted'?'Reported submitted by you':'Reported finished by you'):ui("Not reported")}</span></div></summary>{due}{evidence}{body}</details>;
}
export function PlanEditor({plan,parent,courseId,initialDate='',studyBlock=false,compact=false,...common}:Common&{plan?:StudentPlan;parent?:StudentPlan;courseId:string;initialDate?:string;studyBlock?:boolean;compact?:boolean}){
 const {t:ui,locale}=useI18n();
 const [expanded,setExpanded]=useState(false);
 const key=plan?.id||'new-'+(parent?.id||courseId),[title,setTitle]=useState(plan?.title||''),[state,setState]=useState(plan?.state||'not_started'),[planned,setPlanned]=useState(plan?.planned_on||initialDate),[action,setAction]=useState(plan?.next_action||''),[sourceId,setSourceId]=useState(plan?.source_id||''),[revision,setRevision]=useState(plan?.revision||0);
 const [dirty,setDirty]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false),[reviewed,setReviewed]=useState(false),request=useSaveRequest(),savedId=useRef(plan?.id),accepted=useRef<StudentPlan|null>(null);
 const changed=!!plan?.changed_sources?.length,source=common.sources.find(s=>s.id===sourceId);
 const classAction=plan?.kind==='class_action',[classBinding,setClassBinding]=useState(plan?.class_evidence?.binding||''),[classVersion,setClassVersion]=useState(plan?.version_id||null),[decision,setDecision]=useState(plan?.class_review?.binding===plan?.class_evidence?.binding?plan?.class_review?.decision||'unreviewed':'unreviewed');
 useEffect(()=>{common.onDirty(key,dirty||saving);return()=>common.onDirty(key,false);},[common.onDirty,key,dirty,saving]);
 useEffect(()=>{if(dirty||saving||!plan)return;const value=accepted.current&&accepted.current.revision>plan.revision?accepted.current:plan;setTitle(value.title);setState(value.state);setPlanned(value.planned_on||'');setAction(value.next_action);setSourceId(value.source_id||'');setRevision(value.revision);setClassBinding(value.class_evidence?.binding||'');setClassVersion(value.version_id);setDecision(value.class_review?.binding===value.class_evidence?.binding?value.class_review?.decision||'unreviewed':'unreviewed');},[plan?.revision,dirty,saving]);
 useEffect(()=>setReviewed(false),[source?.version_id]);
 function edit(){setDirty(true);setSaved(false);}
 async function save(e:React.FormEvent){e.preventDefault();setSaving(true);setError('');const body={op:'plan.save',id:savedId.current,revision,course_id:plan?.course_id||parent?.course_id||courseId,parent_id:plan?.parent_id||parent?.id||null,kind:plan?.kind||(parent?'milestone':'project'),title,state,planned_on:planned||null,next_action:action,source_id:sourceId||null,version_id:classAction?classVersion:sourceId?source?.version_id:null,...(classAction?{class_binding:classBinding,class_decision:decision}:{})};try{const row=await common.onSave({...body,request_id:request(body)});accepted.current=row;savedId.current=row.id;setRevision(row.revision);setDirty(false);setSaved(true);if(!plan){setTitle('');setAction('');setPlanned(initialDate);setSourceId('');setState('not_started');savedId.current=undefined;setRevision(0);}}catch(e){setError(e instanceof Error?e.message:'Plan could not save. Retry with your edit kept.');}finally{setSaving(false);}}
 return <form id={plan?"plan-"+plan.id:undefined} className="beta-plan-editor" onSubmit={save} aria-label={plan?ui("Edit")+' '+plan.title:parent?ui("Add milestone to")+' '+parent.title:ui(studyBlock?"Add study block":"Add project")}><EvidenceChange sources={plan?.changed_sources} onOpen={ref=>common.onVersion?common.onVersion({source_id:ref.id,version_id:ref.version_id}):common.onOpen(ref.id)}/><fieldset disabled={saving} data-compact={compact||undefined}>
  {compact&&<button type="button" className="nu-plan-details-toggle" aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{ui(expanded?"Hide plan details":"Plan details")}</button>}
  {(!compact||expanded)&&<label>{classAction?ui("My action title"):parent||plan?.kind==='milestone'?ui("Milestone title"):ui(studyBlock?"Study block title":"Project title")}<input maxLength={180} required value={title} onChange={e=>{setTitle(e.target.value);edit();}}/></label>}
  {classAction&&<label>{ui("Does this apply to me?")}<select aria-label={ui("Does this apply to me?")} value={decision} onChange={e=>{setDecision(e.target.value);edit();}}><option value="unreviewed">{ui("Still needs review")}</option><option value="applies" disabled={plan.class_evidence.status!=='current'}>{ui("I confirmed it applies")}</option><option value="not_applicable">{ui("Does not apply to me")}</option></select></label>}
  {(!compact||expanded)&&<label>{ui("My progress")}<select aria-label={ui("My progress")} value={state} onChange={e=>{setState(e.target.value);edit();}}>{states(['not_started','in_progress','done','archived'],ui)}</select></label>}
  {(!compact||expanded)&&<label>{ui("Personally planned for")}<input type="date" value={planned} onInput={e=>{setPlanned(e.currentTarget.value);edit();}} onChange={e=>{setPlanned(e.target.value);edit();}}/></label>}
  <label>{ui("My next action")}<textarea aria-label={ui("My next action")} maxLength={600} value={action} onChange={e=>{setAction(e.target.value);edit();}}/></label>
  {!classAction&&(!compact||expanded)&&<label>{ui("Link current source (optional)")}<select aria-label={ui("Link current source (optional)")} value={sourceId} onChange={e=>{setSourceId(e.target.value);edit();}}><option value="">{ui("Personal plan without a source")}</option>{common.sources.filter(s=>s.course_id===(plan?.course_id||parent?.course_id||courseId)).map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select></label>}
  {changed&&<label><input type="checkbox" checked={reviewed} onChange={e=>{setReviewed(e.target.checked);edit();}}/>{ui("I reviewed the changed source")}</label>}
  <button disabled={saving||!title.trim()||changed&&!reviewed}>{saving?ui("Saving…"):plan?ui("Save plan"):parent?ui("Add milestone"):ui(studyBlock?"Add study block":"Add project")}</button>
  {dirty&&!plan&&studyBlock&&<button type="button" onClick={()=>{if(!window.confirm(ui('Discard this unsaved study block?')))return;setTitle('');setAction('');setPlanned(initialDate);setSourceId('');setState('not_started');setDirty(false);setSaved(false);setError('');}}>{ui('Discard draft')}</button>}
  {dirty&&plan&&<button type="button" onClick={()=>{setDirty(false);setSaved(false);setError('');}}>{ui("Reload saved plan")}</button>}
  </fieldset>{saved&&<p role="status">{ui("Plan saved.")}</p>}{error&&<p role="alert">{ui(error)}  {ui("Your edit is kept.")}</p>}
 </form>;
}
export default function StudentPlanner({assessmentRead,planning,tasks,courses,sources,onSave,onOpen,onVersion,onRecording,onDirtyChange,now,zone,meetings=[],onCalendar,onSelectTask,composer,coverage,coverageAtTop=false,onAskTask}:{assessmentRead:AssessmentRead;composer?:ReactNode;coverage?:ReactNode;coverageAtTop?:boolean;onAskTask?:(task:BetaTask)=>void;planning:PlanningState;tasks:BetaTask[];meetings?:BetaMeeting[];onCalendar?:()=>void;onSelectTask?:{id:string;kind?:'task'|'plan';request:number};courses:{id:string;code:string;title?:string}[];sources:Source[];onSave:Common['onSave'];onOpen:Common['onOpen'];onVersion?:Common['onVersion'];onRecording?:Common['onRecording'];onDirtyChange:(value:boolean)=>void;now:Date|null;zone:string}){
 const {t:ui,locale}=useI18n();
 const [course,setCourse]=useState(''),[activityView,setActivityView]=useState<'open'|'finished'|'attention'>('open'),[hasEdits,setHasEdits]=useState(false),dirty=useRef(new Map<string,boolean>());
 const onDirty=useCallback((key:string,value:boolean)=>{if(value)dirty.current.set(key,true);else dirty.current.delete(key);const any=[...dirty.current.values()].some(Boolean);setHasEdits(any);onDirtyChange(any);},[onDirtyChange]);
 const [rowLimit,setRowLimit]=useState(courseworkPageSize),[requestedTask,setRequestedTask]=useState<{id:string}|null>(null);
 const [continueLimit,setContinueLimit]=useState(3);
 useEffect(()=>setContinueLimit(3),[course]);
 const nextRowFocus=useRef<string|null>(null);
 const scopeDirty=useCallback((value:boolean)=>onDirty('planning-courses',value),[onDirty]);
 const current=courses.filter(c=>planning.current_course_ids.includes(c.id)),visible=course?[course]:planning.current_course_ids,common={sources,onSave,onOpen,onVersion,onRecording,onDirty,zone,courseLabel:(id:string)=>courseLabel(courses.find(c=>c.id===id))};
 const changedPlans=planning.plans.filter(p=>p.state!=='archived'&&p.changed_sources?.length&&visible.includes(p.course_id));
 const projects=planning.plans.filter(p=>p.kind==='project'&&visible.includes(p.course_id));
 const today=now?zoneDate(now,zone):null,activeTasks=tasks.filter(t=>visible.includes(t.course_id)&&t.evidence?.active!==false);
 const selectedPlanning={...planning,current_course_ids:visible};
 const continuing=continuingWork(activeTasks,selectedPlanning),workEntries=workIndex(continuing);
 const allPriorities=now?weekPriorities(activeTasks,selectedPlanning,assessmentRead.data?.assessments||[],now,zone).filter(item=>item.kind!=='plan'):[];
 const [deadlineLimit,setDeadlineLimit]=useState(3);
 const priorities=allPriorities.slice(0,deadlineLimit);
 const status=(task:BetaTask)=>now?workStatus(task,planning,now,zone):null;
 const complete=(task:BetaTask)=>['submitted','attempt_finished','personal_done'].includes(status(task)?.state||'');
 const needsCheck=(task:BetaTask)=>['missed','check_status'].includes(status(task)?.state||'');
 const chosen=plannedWork(activeTasks,selectedPlanning).filter(p=>p.date===today&&p.state!=='done'&&(!p.task_id||!complete(activeTasks.find(t=>t.id===p.task_id)!)&&!needsCheck(activeTasks.find(t=>t.id===p.task_id)!)));
 const day=now&&today?agenda(activeTasks.filter(t=>!complete(t)),[],today,today,zone):[];
 const ordered=[...activeTasks].sort((a,b)=>(taskDate(a,zone)||'9999').localeCompare(taskDate(b,zone)||'9999')||a.id.localeCompare(b.id));
 const hasReport=(task:BetaTask)=>{const report=planning.activity_reports?.[task.id],progress=planning.progress.find(p=>p.task_id===task.id);return task.evidence?.forum_participation?.scope==='own_participation_only'||progress?.state==='done'||!!report&&(!progress?.updated_at||Date.parse(report.updated_at)>Date.parse(progress.updated_at));};
 const shown=ordered.filter(t=>activityView==='finished'?(complete(t)||hasReport(t)):activityView==='attention'?needsCheck(t):!complete(t)&&!needsCheck(t));
 const visibleRows=shown.slice(0,rowLimit),requestedRow=requestedTask&&shown.find(t=>t.id===requestedTask.id);
 if(requestedRow&&!visibleRows.some(t=>t.id===requestedRow.id))visibleRows.unshift(requestedRow);
 const nextRows=shown.slice(rowLimit,rowLimit+courseworkPageSize).filter(t=>t.id!==requestedRow?.id);
 const upcoming=today?activeTasks.filter(t=>!complete(t)&&!needsCheck(t)&&taskDate(t,zone)!==null&&(taskDate(t,zone)||'')>=today&&(taskDate(t,zone)||'')<=addDays(today,6)).length:0;
 function reviewTask(id:string){if(hasEdits)return;const task=tasks.find(t=>t.id===id);if(!task)return;setActivityView(complete(task)?'finished':needsCheck(task)?'attention':'open');setRequestedTask({id});}
 function chooseView(view:typeof activityView){setActivityView(view);setRequestedTask(null);setRowLimit(courseworkPageSize);}
 useEffect(()=>{if(!requestedTask)return;const el=document.getElementById('activity-'+requestedTask.id);if(el instanceof HTMLDetailsElement){let parent=el.parentElement;while(parent){if(parent instanceof HTMLDetailsElement)parent.open=true;parent=parent.parentElement;}el.open=true;const frame=requestAnimationFrame(()=>{el.scrollIntoView({block:'start'});el.querySelector('summary')?.focus({preventScroll:true});});return()=>cancelAnimationFrame(frame);}},[requestedTask]);
 useEffect(()=>{if(!nextRowFocus.current)return;const summary=document.getElementById('activity-'+nextRowFocus.current)?.querySelector('summary');nextRowFocus.current=null;summary?.focus();},[rowLimit]);
 function reviewPlan(id:string){const el=document.getElementById('plan-'+id);if(!el)return;let parent=el.parentElement;while(parent){if(parent instanceof HTMLDetailsElement)parent.open=true;parent=parent.parentElement;}requestAnimationFrame(()=>{el.scrollIntoView({block:'start'});(el.querySelector<HTMLTextAreaElement>('textarea')||el.querySelector<HTMLInputElement>('input'))?.focus({preventScroll:true});});}
 useEffect(()=>{if(!onSelectTask)return;setCourse('');if(onSelectTask.kind!=='plan'){reviewTask(onSelectTask.id);return;}const frame=requestAnimationFrame(()=>reviewPlan(onSelectTask.id));return()=>cancelAnimationFrame(frame);},[onSelectTask?.request]);
 function dayStatus(id:string){const task=activeTasks.find(t=>t.id===id),value=task?status(task):null;return value?<span className="nu-work-status" data-state={value.state}>{ui(value.label)}</span>:null;}
 const dayClock=(time:string)=>new Intl.DateTimeFormat(locale,{timeZone:'UTC',hour:'numeric',minute:'2-digit'}).format(new Date('2000-01-01T'+time+':00Z'));
 return <section className="beta-student-planner beta-today-planner"><ProductHeading title={ui("Today")} description={ui("Understand your courses. Find what matters next.")}><div className="beta-today-tools"><span className="beta-today-date">{now?new Intl.DateTimeFormat(locale,{timeZone:zone,weekday:'long',month:'long',day:'numeric'}).format(now):ui("Loading your local date…")}</span><label>{ui("Course")}<select aria-label={ui("Planning course")} disabled={hasEdits} value={course} onChange={e=>{setCourse(e.target.value);setRequestedTask(null);setRowLimit(courseworkPageSize);}}><option value="">{ui("All planning courses")}</option>{current.map(c=><option key={c.id} value={c.id}>{courseLabel(c)}</option>)}</select></label></div></ProductHeading>
  {coverageAtTop&&coverage}
  {composer}
  {changedPlans.length>0&&<section className="beta-evidence-change" aria-label={ui('Plans affected by changed instructions')}>
   <h2>{ui('Instructions changed')}</h2><p>{ui('Your saved plans are kept. Review what changed before continuing.')}</p>
   {changedPlans.slice(0,3).map(plan=><div key={plan.id}><strong>{plan.title}</strong><p>{plan.next_action}</p><div className="beta-profile-actions"><button type="button" disabled={hasEdits} onClick={()=>reviewPlan(plan.id)}>{ui('Review your plan')}</button>{plan.changed_sources?.map(source=><button key={source.id} type="button" onClick={()=>onVersion?onVersion({source_id:source.id,version_id:source.current_version}):onOpen(source.id)}>{ui('Open changed instructions')}</button>)}</div></div>)}
   {changedPlans.length>3&&<p>{ui('{count} more plans need review',{count:changedPlans.length-3})}</p>}
  </section>}
  {hasEdits&&<p role="status">{ui("Save or reload your edits to change the course filter.")}</p>}
  {!current.length&&<p>{ui("Connect your courses to ask about their saved material.")}</p>}
  <section className="nu-today-focus nu-research-deadlines">
  <section className="nu-week-priorities nu-work-first-priorities" aria-label={ui('Your priorities')}>
   <div className="beta-section-heading"><div><h2>{ui('Approaching deadlines')}</h2></div></div>
   <p className="nu-priority-saved-notice" role="note">{ui('Based on saved material. Submission status may have changed.')}</p>
   {assessmentRead.loading&&<p className="nu-search-activity" role="status"><span aria-hidden="true"/>{ui('Checking saved test dates. These priorities may change when that finishes.')}</p>}
   {assessmentRead.error&&<p className="beta-alert" role="alert">{ui('Saved test dates could not be loaded. Coursework remains available; this list may omit tests.')} <button type="button" onClick={assessmentRead.retry}>{ui('Retry saved test dates')}</button></p>}
   {priorities.length?<ol role="list">{priorities.map((item,index)=><li key={item.id}>
    <div className="nu-priority-number" aria-hidden="true">{index+1}</div><div className="nu-priority-content">
     <div className="nu-priority-title"><div><CourseContext code={common.courseLabel(item.course_id)}/><h3>{item.title}</h3></div><p>{item.kind==='plan'?ui('Your target: '):item.kind==='assessment'?ui('Saved assessment date: '):ui('Saved deadline: ')}{item.date?deadlineLabel({due_at:item.due_at||undefined,due_date:item.date},zone,locale,ui):ui('Date not captured')}</p></div>
     <div className="nu-priority-guidance"><div><h4>{ui('Next step')}</h4><p>{ui(item.action)}</p></div></div>
     {item.assessment&&item.assessment.conflicts.length>0&&<p className="beta-assessment-conflict" role="note">{ui('Saved source dates disagree:')} {[...new Set([item.date,item.assessment.date,...item.assessment.conflicts.map(c=>c.date)])].join(', ')}{ui('. Check the originals before relying on a date.')}</p>}
     {item.assessment&&item.kind==='coursework'&&item.date!==item.assessment.date&&<p className="beta-assessment-conflict" role="note">{ui('The saved assessment date differs from this activity deadline:')} {item.assessment.date}{ui('. Check which date applies; neither source was changed.')}</p>}
     {item.activity_reference&&<p className="beta-assessment-conflict" role="note">{ui('A matching saved activity has a different deadline:')} {item.activity_reference.date}{ui('. Check which date applies; neither source was changed.')}{onVersion&&item.activity_reference.version_id&&<button type="button" onClick={()=>onVersion({source_id:item.activity_reference!.source_id,version_id:item.activity_reference!.version_id!})}>{ui('Open activity source')}</button>}</p>}
     <div className="nu-priority-actions">{onAskTask&&item.task_id&&<button type="button" disabled={hasEdits} onClick={()=>{const task=tasks.find(task=>task.id===item.task_id);if(task)onAskTask(task);}}>{ui('Ask about this assignment')}</button>}{(item.task_id||item.plan_id)&&<button type="button" disabled={hasEdits} onClick={()=>{if(item.task_id){reviewTask(item.task_id);}else reviewPlan(item.plan_id!);}}>{ui(item.task_id?'Review task':'Review your plan')}</button>}{item.source_id&&<button type="button" onClick={()=>item.version_id&&onVersion?onVersion({source_id:item.source_id!,version_id:item.version_id}):onOpen(item.source_id!)}>{ui('Open saved source')}</button>}
      <details><summary>{ui('Why this is here and supporting evidence')}</summary><p>{ui(item.benefit)}</p><p>{ui(item.basis)}</p>{item.assessment&&<><blockquote>{item.assessment.quote}</blockquote><p>{ui(assessmentSourceLabel[item.assessment.sourceKind])} · {item.assessment.title}{item.assessment.observedAt?' · '+ui('saved ')+new Date(item.assessment.observedAt).toLocaleDateString(locale,{timeZone:zone}):''}</p>{item.assessment.conflicts.map((c,i)=><div key={i}><p>{c.date} · {ui(assessmentSourceLabel[c.sourceKind])}{c.olderSyllabusVersion?' · '+ui('older syllabus version'):''}</p><blockquote>{c.quote}</blockquote>{c.sourceId&&c.version&&onVersion&&<button type="button" onClick={()=>onVersion({source_id:c.sourceId!,version_id:c.version!})}>{ui('Open conflicting source')}</button>}</div>)}</>}</details>
     </div></div>
   </li>)}</ol>:<p>{ui(continuing.length?'No approaching deadlines are supported by the saved evidence.':'No deadlines are captured for the next seven days. You can still ask about your course material; this is not an all-clear.')}</p>}
   <p className="beta-section-caption">{ui('Next steps are suggestions, not additional assignment requirements. Personal plans do not change official deadlines or verify submission.')}</p>
  </section>
  {allPriorities.length>deadlineLimit&&<button type="button" onClick={()=>setDeadlineLimit(n=>n+3)}>{ui("Show more deadlines")}</button>}
  </section>
  <details className="nu-today-focus"><summary>{ui("Your day and timetable")}</summary>
  <div className="beta-today-overview">
  <section className="beta-day-preview" aria-label={ui("Your day")}><div className="beta-section-heading"><h2>{ui("Your day")}</h2>{onCalendar&&<button disabled={hasEdits} onClick={onCalendar}><CalendarDays size={16} aria-hidden="true"/>{ui("Open calendar")}</button>}</div><p className="beta-section-caption">{zone.split('/').at(-1)?.replaceAll('_',' ')}  {ui("time")}</p><DaySchedule meetings={meetings} courseIds={visible} now={now} zone={zone} courseLabel={common.courseLabel} onOpen={onOpen} onVersion={onVersion}/>{(day.length>0||chosen.length>0)&&<h3>{ui('Deadlines and your study plans')}</h3>}{day.length||chosen.length?<ul>{day.map(item=><li key={item.id}><button onClick={()=>onOpen(item.source_id)}><span className="beta-day-time">{item.kind==='deadline'?ui("Due")+' '+(item.time?dayClock(item.time):ui("time not stated")):dayClock(item.time)+(item.end_time?'–'+dayClock(item.end_time):'')}</span><CourseContext code={common.courseLabel(item.course_id)}/><strong>{item.title}</strong><small>{item.kind==='deadline'?ui("Course deadline"):item.kind==='lab'?ui("Lab"):ui("Class")}{item.location?' · '+item.location:''}</small>{dayStatus(item.id)}</button></li>)}{chosen.map(p=><li key={p.id}><button disabled={hasEdits} onClick={()=>{if(p.task_id){setActivityView(p.state==='done'?'finished':'open');requestAnimationFrame(()=>reviewTask(p.task_id!));}else reviewPlan(p.id);}}><span className="beta-day-time">{ui("Your study plan")}</span><CourseContext code={common.courseLabel(p.course_id)}/><strong>{p.title}</strong><small>{p.next_action||ui("No next action saved yet.")}</small><small>{ui("My progress:")} {p.state.replaceAll('_',' ')}</small></button></li>)}</ul>:<div className="beta-plan-empty"><p>{ui("No open deadlines or study plans saved for today.")}</p><small>{ui("This is what is saved, rather than a guarantee that your day is free.")}</small></div>}</section></div>
  </details>
  <details className="nu-optional-plans"><summary>{ui("Saved next steps")} <small>{workEntries.length}</small></summary><p className="beta-section-caption">{ui("Optional plans you chose to keep. No progress updates are needed to ask a question.")}</p>
  {workEntries.length>0&&<section className="nu-continue-work" aria-label={ui('Continue your work')}>
   <h2>{ui('Continue your work')}</h2>
   <p className="nu-continue-caption">{ui('Pick up where you left off.')}</p>
   <ul>{workEntries.slice(0,continueLimit).map(({work:item,related},index)=><li key={item.kind+item.id} data-course-tone={courseTone(common.courseLabel(item.course_id))}>
    <div className="nu-work-course">{common.courseLabel(item.course_id)}</div>
    <div className="nu-continue-copy"><h3>{item.title}</h3><p><span className="nu-next-label">{ui('Next step')}: </span>{item.next_action}</p>
     {item.changed&&<small className="nu-continue-change">{ui('Instructions changed · review before continuing')}</small>}
     {item.kind==='task'&&<div className="nu-work-facts">{dayStatus(item.id)}<small>{ui('Course deadline')}: {deadlineLabel(activeTasks.find(t=>t.id===item.id)?.evidence,zone,locale,ui)}</small></div>}
     {related.length>0&&<details className="nu-related-plans"><summary>{ui('Related saved plans')} ({related.length})</summary>{related.map(plan=><div key={plan.id}><strong>{plan.title}</strong><p>{plan.next_action}</p><button type="button" disabled={hasEdits} onClick={()=>reviewPlan(plan.id)}>{ui('Edit plan')}</button></div>)}</details>}
    </div>
    <div className="nu-continue-actions"><button type="button" className={index===0?'beta-primary':'nu-continue-secondary'} disabled={hasEdits} onClick={()=>{const task=item.kind==='task'?activeTasks.find(t=>t.id===item.id):undefined;if(task&&onAskTask)onAskTask(task);else if(item.source_id)onOpen(item.source_id);else reviewPlan(item.id);}}>{ui('Continue')}</button>
     <button type="button" disabled={hasEdits} onClick={()=>item.kind==='task'?reviewTask(item.id):reviewPlan(item.id)}>{ui('Edit plan')}</button>
     {item.source_id&&<button type="button" onClick={()=>item.version_id&&onVersion?onVersion({source_id:item.source_id!,version_id:item.version_id}):onOpen(item.source_id!)}>{ui('Open saved source')}</button>}
    </div>
   </li>)}</ul>
   {workEntries.length>continueLimit&&<button type="button" disabled={hasEdits} onClick={()=>setContinueLimit(n=>n+3)}>{ui('Show {count} more',{count:Math.min(3,workEntries.length-continueLimit)})}</button>}
  </section>}
  </details>
  {!coverageAtTop&&coverage}
  <details className="nu-today-all-work"><summary><span>{ui("All coursework and plans")}</span><small>{ui(hasEdits?"Unsaved plan changes":"Browse work, check status or edit a plan")}</small></summary>
  {today&&<section aria-label={ui("Upcoming coursework")}><h2>{ui("Next seven days")}</h2>{ordered.filter(t=>!complete(t)&&!needsCheck(t)&&taskDate(t,zone)&&taskDate(t,zone)!>=today&&taskDate(t,zone)!<=addDays(today,6)).map(t=><p key={t.id}><CourseContext code={common.courseLabel(t.course_id)}/><button disabled={hasEdits} onClick={()=>reviewTask(t.id)}>{String(t.evidence?.title||'Course activity')}</button> · {deadlineLabel(t.evidence,zone,locale,ui)}</p>)}{!upcoming&&<p>{ui("No verified dated work is saved for the next seven days. Check your course materials for tests and quizzes that are not yet captured.")}</p>}</section>}
  <div className="beta-section-heading beta-coursework-heading"><div><h2>{ui("Coursework")}</h2><p className="beta-section-caption">{upcoming?upcoming+' '+(upcoming===1?ui('saved deadline'):ui('saved deadlines'))+' '+ui('in the next seven days.'):ui("Keep your next action and study day beside the deadline.")}</p></div><div className="beta-view-switch" role="group" aria-label={ui("Coursework view")}><button aria-pressed={activityView==='open'} disabled={hasEdits} onClick={()=>chooseView('open')}>{ui("Open work")}</button><button aria-pressed={activityView==='attention'} disabled={hasEdits} onClick={()=>chooseView('attention')}>{ui("Status checks (")}{activeTasks.filter(needsCheck).length})</button><button aria-pressed={activityView==='finished'} disabled={hasEdits} onClick={()=>chooseView('finished')}>{ui("Finished and reported")}</button></div></div>
  {activityView==='attention'&&<p>{ui("Overdue does not necessarily mean missed. Refresh Moodle to confirm your submission and whether late work is accepted.")}</p>}
  {visibleRows.map(t=><div key={t.id}><ProgressEditor {...common} onAsk={onAskTask&&!hasEdits?()=>onAskTask(t):undefined} statusNow={now} groups={planning.groups?.[t.course_id]} status={status(t)} report={planning.activity_reports?.[t.id]} task={t} progress={planning.progress.find(p=>p.task_id===t.id)}/>{t.evidence?.receipt?.activity_url&&<a className="beta-text-link" href={t.evidence.receipt.activity_url} target="_blank" rel="noopener noreferrer">{status(t)?.state==='submit_late'?ui("Submit late in Moodle"):ui("Check in Moodle")}</a>}</div>)}
  {shown.length>courseworkPageSize&&<div className="nu-coursework-more"><span role="status">{ui('Showing {shown} of {total} activities',{shown:visibleRows.length,total:shown.length})}</span>{nextRows.length>0&&<button type="button" onClick={()=>{nextRowFocus.current=nextRows[0].id;setRowLimit(limit=>limit+courseworkPageSize);}}>{ui('Show {count} more',{count:nextRows.length})}</button>}</div>}
  {activityView==='finished'&&<p>{ui('Saved personal reports remain separate from verified Moodle receipts. Reports needing review also appear in Status checks.')}</p>}
  {!shown.length&&<p>{activityView==='finished'?ui("No saved finished work or personal reports in this view."):ui("No open saved activities in this view.")}</p>}
  <p className="beta-section-caption">{ui("Personal progress is your report. It stays separate from collected Moodle receipts.")}</p>
  {planning.plans.some(p=>p.kind==='class_action'&&visible.includes(p.course_id))&&<section aria-label={ui("Class-derived actions")}><h2>{ui("From your classes")}</h2><p>{ui("Review the recorded words, who they apply to and any stated timing. These items do not establish an official Moodle deadline or submission.")}</p>{planning.plans.filter(p=>p.kind==='class_action'&&visible.includes(p.course_id)).map(p=>{const e=p.class_evidence,a=p.class_action;return <details key={p.id} className="beta-plan-item"><summary>{p.title} <small>{e.status!=='current'?ui("Withdrawn wording · personal work kept"):a?.needs_review?ui("Review class evidence"):a?.review==='not_applicable'?ui("You marked not applicable"):ui("You confirmed applicability")} · {p.state.replaceAll('_',' ')}</small></summary><blockquote>{e.quote}</blockquote><p>{ui("Unidentified speaker")}{e.optional?ui("· Optional or suggested wording"):''}{e.conditional?ui("· Conditional: check who it applies to"):''}{e.ambiguous?ui("· Speech or context needs review"):''}</p><p>{ui("Class timing:")} {e.date_phrase||ui("not stated")}{e.stated_date?' · '+e.stated_date:''}{ui(". Your Do-on date remains your choice.")}</p>{a?.conflict&&<p className="beta-alert">{a.conflict}</p>}{e.status!=='current'&&<p>{e.withdrawal_reason}</p>}<details><summary>{ui("Surrounding class context")}</summary><p>{e.context}</p></details><div className="beta-class-actions">{onRecording&&<button disabled={hasEdits} onClick={()=>onRecording(e.session_id,e.segments[0]?.start_ms||0)}>{ui("Review recording")}</button>}{onVersion&&<button onClick={()=>onVersion({source_id:e.source_id,version_id:e.version_id})}>{ui("Open supporting transcript")}</button>}{e.activity&&onVersion&&<button onClick={()=>onVersion(e.activity)}>{ui("Open related Moodle activity")}</button>}</div><PlanEditor {...common} plan={p} courseId={p.course_id}/></details>;})}</section>}
  <PlanningCourses courses={courses} scope={planning.course_scope} onSave={onSave} onDirty={scopeDirty}/>
  <h2>{ui("Projects and milestones")}</h2><p>{ui("Keep longer work here even when its deadline is beyond this week.")}</p>
  {projects.map(p=><details key={p.id} className="beta-plan-item"><summary>{p.title} <small>{p.state.replaceAll('_',' ')}</small></summary><PlanEditor {...common} plan={p} courseId={p.course_id}/>{p.state!=='archived'&&<>{planning.plans.filter(m=>m.parent_id===p.id).map(m=><details key={m.id} className="beta-plan-item"><summary>{m.title}</summary><PlanEditor {...common} plan={m} courseId={m.course_id}/></details>)}<details><summary>{ui("Add milestone")}</summary><PlanEditor {...common} parent={p} courseId={p.course_id}/></details></>}</details>)}
  {(course?[course]:current.map(c=>c.id)).map(id=><details key={id}><summary>{ui("Add project for")} {courseLabel(courses.find(c=>c.id===id))}</summary><PlanEditor {...common} courseId={id}/></details>)}
 </details>
 </section>;
}

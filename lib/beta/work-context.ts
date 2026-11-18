import {ownerParticipations} from './owner-forum-participation';
import {prioritizeWeeklyEvidence} from './weekly-evidence';
import {sourceBoundTask} from './source-authority';
import {receiptsForSources} from './moodle-receipts';
import type {PoolClient} from 'pg';
import {zoneDate,agenda,addDays} from './agenda';
import {nextDeadlineQuestion,workWindow} from './chat-intent';
import {fileWorkDerivation} from './file-work';
import {activityDeadline,workKind} from './moodle-facts';
import {planningState} from './student-planning';
import type {PlanningScope} from './planning-scope';
import {classTextBound} from './class-actions-format';
import {workStatus} from './planning-view';
import {assessmentClaims,reconcileAssessments} from './assessments';

// Work evidence is separate from a ranked answer excerpt. A search miss cannot
// establish that a student has nothing to do; completion is unknown by default.
export async function savedWorkContext(c:PoolClient,user:string,courseIds:string[],question:string,now:Date,zone:string,confirmed:boolean,label:string,scope?:PlanningScope){
 const window=workWindow(question,now,zone),deadlineOnly=nextDeadlineQuestion(question);
 const rows=(await c.query(`SELECT t.id,t.course_id,t.source_id,t.evidence,t.observed_at,
 s.title AS source_title,s.kind AS source_kind,s.original_url,s.current_version,v.id AS version_id,v.body,v.observed_at AS version_observed_at,
 CASE WHEN o.coverage->'content'->>'source_version_id'=v.id::text AND o.coverage->'content'->>'provenance'='signed_in_capture' THEN o.captured_at END AS activity_captured_at
 FROM schoolvault.tasks t JOIN schoolvault.sources s ON s.user_id=t.user_id AND s.id=t.source_id
 JOIN schoolvault.source_versions v ON v.user_id=t.user_id AND v.source_id=t.source_id
 AND v.id::text=coalesce(t.evidence->>'version_id',s.current_version::text)
 LEFT JOIN schoolvault.moodle_observations o ON $3::boolean AND o.user_id=s.user_id AND o.source_id=s.id
 WHERE t.user_id=$1 AND t.course_id=ANY($2::uuid[]) AND s.kind!='ai_draft'
 AND coalesce(t.evidence->>'active','true')!='false'
 ORDER BY t.observed_at DESC,t.id LIMIT 201`,[user,courseIds,deadlineOnly])).rows.map(row=>sourceBoundTask(row,{kind:row.source_kind,title:row.source_title,original_url:row.original_url}));
 const date=(e:any)=>{
  if(typeof e?.due_at==='string'&&Number.isFinite(Date.parse(e.due_at)))return zoneDate(Date.parse(e.due_at),zone);
  return typeof e?.due_date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(e.due_date)?e.due_date:null;
 };
 const personal=await planningState(c,user,{scope,includeGroups:false}),receipts=await receiptsForSources(c,user,rows.map(r=>({id:r.source_id,version_id:r.version_id})),now);
 const participation=await ownerParticipations(c,user,rows.map(r=>({id:r.source_id,version_id:r.version_id})),now);
 const dayFocus=/^(?:next )?(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/.test(window.label);
 const includeEarlier=!dayFocus&&!/\b(?:today|tomorrow|this week|next week)\b/i.test(question);
 // A study-day follow-up may prepare for an upcoming deadline; it does not
 // move that deadline onto the chosen day. Keep the ordinary 14-day bound.
 const taskEnd=dayFocus?addDays(window.end,13):window.end;
 const inWindow=rows.filter(row=>{
  const d=date(row.evidence);
  if(deadlineOnly){
   if(!d||d<window.start||d>window.end||row.source_kind!=='moodle'||row.version_id!==row.current_version||row.evidence?.confirmation!=='activity_observed'||row.evidence?.requirement==='optional')return false;
   const due=activityDeadline(row.original_url,row.body);
   return due?.due_date===row.evidence.due_date&&due?.due_at===row.evidence.due_at&&(!due.due_at||Date.parse(due.due_at)>=now.getTime());
  }
  const planned=personal.progress.find(p=>p.task_id===row.id)?.planned_on;
  return !d||(d>=window.start&&d<=taskEnd)||(includeEarlier&&d<window.start)||planned&&planned>=window.start&&planned<=window.end;
 });
 const selected=prioritizeWeeklyEvidence(inWindow,window,zone,personal.progress);
 const selectedRows=inWindow.filter(row=>selected.has(row.source_id+':'+row.version_id));
 const expanded=selectedRows.flatMap(row=>{
  const e=row.evidence||{},excerpts=Array.isArray(e.instruction_excerpts)?e.instruction_excerpts.filter((v:unknown)=>typeof v==='string').slice(0,6):[];
  const instructions=e.confirmation==='candidate'&&excerpts.length?excerpts:[excerpts.join(' ')||e.instruction||e.instruction_excerpt||''];
  return instructions.map((instruction:string,index:number)=>({
   id:row.id+(instructions.length>1?':'+index:''),course_id:row.course_id,source_id:row.source_id,version_id:row.version_id,
   title:String(e.title||row.source_title).slice(0,180),kind:String(e.derivation===fileWorkDerivation?workKind(instruction):e.obligation_kind||e.kind||'activity').slice(0,60),
   due_at:e.due_at||null,due_date:e.due_date||null,authority:e.authority||'Observed course activity',note:String(e.note||'').slice(0,300),
   ...(deadlineOnly?{activity_captured_at:row.activity_captured_at?new Date(row.activity_captured_at).toISOString():null}:{}),
   forum_participation:participation.get(row.source_id)||null,instruction:String(instruction).slice(0,700),completion:receipts.get(row.source_id)?.eligible?receipts.get(row.source_id)!.state==='submitted'?'submitted':receipts.get(row.source_id)!.state==='attempt_finished'?'attempt_finished':'unknown':'unknown',receipt:receipts.get(row.source_id)||null,personal_progress:personal.progress.find(p=>p.task_id===row.id)||null,personal_report:personal.activity_reports?.[row.id]||null,
   personal_report_evaluated:true,planning_status:workStatus({...row,evidence:{...e,receipt:receipts.get(row.source_id)||null,forum_participation:participation.get(row.source_id)||null}},personal,now,zone),
   confirmation:e.confirmation==='candidate'?'candidate':'observed-activity',requirement:e.requirement||'unknown'
  }));
 });
 const tasks=expanded.slice(0,60);
 // Bring the matching original brief/checklist into planning, not just its
 // Moodle dropbox. Personal drafts remain separate from course instructions.
 const preparationTargets=(deadlineOnly?[]:tasks).filter(t=>['upcoming','today','overdue'].includes(t.planning_status.state)&&/\b(?:assignment|quiz|test)\s*\d+\b/i.test(t.title)).slice(0,12)
  .map(t=>({course_id:t.course_id,key:t.title.match(/\b(?:assignment|quiz|test)\s*\d+\b/i)![0]}));
 const preparation=preparationTargets.length?(await c.query(`SELECT DISTINCT ON(s.id) s.id,s.title,s.course_id,s.kind,s.original_url,s.current_version,v.id AS version_id,v.observed_at,v.body AS full_body
 FROM schoolvault.sources s JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.id=s.current_version
 JOIN jsonb_to_recordset($2::jsonb) wanted(course_id uuid,key text) ON wanted.course_id=s.course_id
 WHERE s.user_id=$1 AND s.kind='file' AND s.title ~* ('\\m'||replace(wanted.key,' ','[ _-]*')||'\\M')
 AND s.title !~* 'answer|solution|review|workbook|submission|receipt' AND length(v.body)>150
 ORDER BY s.id,v.observed_at DESC LIMIT 8`,[user,JSON.stringify(preparationTargets)])).rows:[];
 const capture=(await c.query(`SELECT max(o.captured_at) AS last_capture,count(*)::int AS source_count,
 coalesce(sum(jsonb_array_length(o.coverage->'issues')),0)::int AS issue_count
 FROM schoolvault.moodle_observations o JOIN schoolvault.sources s ON s.user_id=o.user_id AND s.id=o.source_id
 WHERE o.user_id=$1 AND s.course_id=ANY($2::uuid[])`,[user,courseIds])).rows[0];
 const limitations=['Saved collection is partial: hidden content, unuploaded files and in-class instructions may be missing.','A saved activity or deadline does not show whether you completed or submitted it.'];
 if(!confirmed)limitations.push('Current courses have not been confirmed. Choose your current courses in the Companion or select a course here.');
 if(Number(capture?.issue_count)>0)limitations.push('The latest saved pages include collection gaps.');
 if(includeEarlier&&inWindow.some(row=>{const d=date(row.evidence);return !!d&&d<window.start;}))limitations.push('Earlier dated work is included because its completion has not been verified; a passed deadline does not prove it remains unfinished.');
 if(rows.length>200||selectedRows.length<inWindow.length||expanded.length>60)limitations.push('This summary is bounded; more saved work exists than fits in one answer.');
 const sources=[...selected.values()].map(row=>({id:row.source_id,title:row.source_title,course_id:row.course_id,kind:row.source_kind,original_url:row.original_url,version_id:row.version_id,observed_at:row.version_observed_at,full_body:row.body}));
 for(const item of [...preparation].reverse())if(!sources.some(s=>s.id===item.id&&s.version_id===item.version_id))sources.unshift(item);
 // Calendar's confirmed meetings and reconciled assessment claims must reach
 // weekly conversations too. Their exact source versions remain pinned.
 const meetingRows=confirmed&&!deadlineOnly?(await c.query('SELECT * FROM schoolvault.meetings WHERE user_id=$1 AND course_id=ANY($2::uuid[])',[user,courseIds])).rows:[];
 const meetings=agenda([],meetingRows,window.start,window.end,zone).slice(0,30).map(m=>({...m,version_id:meetingRows.find(row=>m.id.startsWith(row.id+':'))?.schedule?.version_id||null}));
 const assessments=confirmed&&!deadlineOnly?reconcileAssessments((await assessmentClaims(c,user)).filter(a=>courseIds.includes(a.courseId)&&a.sourceKind!=='student_plan'))
  .filter(a=>a.sourceKind!=='student_plan'&&a.allDates.some(d=>d>=window.start&&d<=window.end)).slice(0,20):[];
 const datedRefs=[...meetings.map(m=>({id:m.source_id,version_id:m.version_id})),...assessments.flatMap(a=>[a,...a.conflicts].filter(s=>s.sourceId&&s.version).map(s=>({id:s.sourceId,version_id:s.version})))];
 if(datedRefs.length){
  const dated=(await c.query(`SELECT s.id,s.title,s.course_id,s.kind,s.original_url,s.current_version,v.id AS version_id,v.observed_at,v.body AS full_body FROM jsonb_to_recordset($2::jsonb) ref(id uuid,version_id uuid)
   JOIN schoolvault.sources s ON s.user_id=$1 AND s.id=ref.id JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.source_id=s.id AND v.id=coalesce(ref.version_id,s.current_version)
   WHERE s.course_id=ANY($3::uuid[])`,[user,JSON.stringify(datedRefs),courseIds])).rows;
  // Dated evidence takes priority over undated inventory at the worker's cap.
  for(const row of dated.reverse())if(!sources.some(s=>s.id===row.id&&s.version_id===row.version_id))sources.unshift(row);
 }
 const allPlans=(deadlineOnly?[]:personal.plans).filter(p=>courseIds.includes(p.course_id)&&p.state!=='archived'&&(!p.parent_id||personal.plans.some(parent=>parent.id===p.parent_id&&parent.state!=='archived')));
 const plans=[...allPlans.filter(p=>p.kind!=='class_action').slice(0,40),...allPlans.filter(p=>p.kind==='class_action').sort((a,b)=>Number(b.class_action?.active)-Number(a.class_action?.active)).slice(0,30)].map(p=>p.kind==='class_action'?{...p,class_evidence:{...p.class_evidence,segments:p.class_evidence.segments.slice(0,1),context:classTextBound(p.class_evidence.context,1200),context_partial:p.class_evidence.context.length>1200}}:p);
 if(plans.length<allPlans.length)limitations.push('More personal/class plans exist than fit this answer. Select a course and inspect Today for the full list.');
 const actionRefs=plans.filter(p=>p.kind==='class_action').slice(0,30).map(p=>({id:p.class_evidence.source_id,version_id:p.class_evidence.version_id}));
 if(actionRefs.length){const extra=(await c.query(`SELECT s.id,s.title,s.course_id,s.kind,s.original_url,v.id AS version_id,v.observed_at,v.body AS full_body,true AS class_recording FROM jsonb_to_recordset($2::jsonb) ref(id uuid,version_id uuid) JOIN schoolvault.sources s ON s.user_id=$1 AND s.id=ref.id JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.source_id=s.id AND v.id=ref.version_id WHERE s.course_id=ANY($3::uuid[])`,[user,JSON.stringify(actionRefs),courseIds])).rows;for(const row of extra)if(!sources.some(s=>s.id===row.id&&s.version_id===row.version_id))sources.push(row);}
 if(plans.some(p=>p.kind==='class_action'))limitations.push('Class-derived actions are partial transcript candidates, not official Moodle assignments; review speakers, applicability and stated dates.');
 return {work:{plan_format:1,tasks,plans,meetings,assessments,availability:personal.availability||null,coverage:{complete:false,last_collection_at:capture?.last_capture||null,source_count:Number(capture?.source_count)||0,task_count:rows.length,undated_count:tasks.filter(t=>!date(t)).length,limitations},window,scope:{course_ids:courseIds,confirmed,label,basis:personal.course_scope?.basis||null,clarification:null as string|null}},sources};
}

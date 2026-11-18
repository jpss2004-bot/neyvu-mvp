import {ownerSnapshotReceipt} from './owner-snapshot-status';
import {localAccountAvailable} from './config';
import {observedAssignmentGrade,type AssignmentGrading,type AssignmentGrade} from './assignment-grade';
import {activityDeadline} from './moodle-facts';
import {observedAssignmentGroup,type AssignmentMembership} from './assignment-membership';
import {randomUUID,createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {BetaHttpError} from './http';import {BetaConflict} from './vault';
export type AssessmentCapture={kind:'assignment'|'quiz';layout:string;rows:{label:string;value:string;classes:string[]}[];attempts:{number:string;state:string}[];truncated:boolean;grading?:AssignmentGrading;availability?:{state:'open'|'closed';label:string};late_penalty?:string;cutoff_at?:string};
export type ReceiptState='submitted'|'draft'|'no_submission'|'reopened'|'group_submission'|'attempt_finished'|'attempt_in_progress'|'attempt_overdue'|'attempt_abandoned'|'unknown'|'conflict';
export type ReceiptView={id:string;state:ReceiptState;observed_state:ReceiptState;eligible:boolean;reason:string;observed_at:string;version_id:string;activity_url:string;proof:AssessmentCapture|null;grade?:AssignmentGrade;membership?:AssignmentMembership;provenance:'signed_in_capture'|'synthetic_capture'|'owner_snapshot'};
const canonical=(v:any):string=>JSON.stringify(v===null?null:Array.isArray(v)?v.map(item=>JSON.parse(canonical(item))):typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(canonical(v[k]))])):v);
const normalized=(s:string)=>s.replace(/\s+/g,' ').trim();
export function assessmentCapture(raw:any,url:string,body:string):AssessmentCapture|null{
 if(raw==null)return null;
 const match=url.match(/^https:\/\/moodle\.acadiau\.ca\/mod\/(assign|quiz)\/view\.php\?id=[1-9]\d{0,11}$/);
 if(!match||!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!['kind','layout','rows','attempts','truncated','grading','availability','late_penalty','cutoff'].includes(k))||raw.kind!==(match[1]==='assign'?'assignment':'quiz')||typeof raw.truncated!=='boolean'||!['assign-status-table','quiz-attempt-table','quiz-attempt-cards','unavailable'].includes(raw.layout)||!Array.isArray(raw.rows)||raw.rows.length>16||!Array.isArray(raw.attempts)||raw.attempts.length>20)throw new BetaHttpError('Invalid Moodle status evidence.');
 if(raw.kind==='assignment'&&(!['assign-status-table','unavailable'].includes(raw.layout)||raw.attempts.length)||raw.kind==='quiz'&&(!['quiz-attempt-table','quiz-attempt-cards','unavailable'].includes(raw.layout)||raw.rows.length))throw new BetaHttpError('Moodle status layout did not match the activity.');
 const text=normalized(body),field=(value:any,max:number)=>{if(typeof value!=='string'||!value.trim()||value.length>max||!text.includes(normalized(value)))throw new BetaHttpError('Moodle status evidence is missing from its saved page.');return value.trim();};
 const rows=raw.rows.map((r:any)=>{if(!r||Object.keys(r).some(k=>!['label','value','classes'].includes(k))||!Array.isArray(r.classes)||r.classes.length>8||r.classes.some((s:any)=>typeof s!=='string'||!/^[a-zA-Z][\w-]{0,79}$/.test(s)))throw new BetaHttpError('Invalid Moodle status row.');return {label:field(r.label,80),value:field(r.value,1200),classes:r.classes};});
 const attempts=raw.attempts.map((a:any)=>{if(!a||Object.keys(a).some(k=>!['number','state'].includes(k)))throw new BetaHttpError('Invalid Moodle attempt evidence.');return {number:field(a.number,40),state:field(a.state,400)};});
 let grading:AssignmentGrading|undefined;
 if(raw.grading!==undefined){
  const g=raw.grading;
  if(raw.kind!=='assignment'||raw.layout!=='assign-status-table'||!g||typeof g!=='object'||Array.isArray(g)||Object.keys(g).some(k=>!['layout','attempt','status','rows','truncated'].includes(k))||!['assign-feedback-table','assign-no-feedback','unavailable'].includes(g.layout)||typeof g.truncated!=='boolean'||!Array.isArray(g.rows)||g.rows.length>4)throw new BetaHttpError('Invalid assignment grading evidence.');
  const row=(r:any,expected:RegExp,max:number,classes=false)=>{
   if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).some(k=>!(classes?['label','value','classes']:['label','value']).includes(k)))throw new BetaHttpError('Invalid grading row.');
   const label=field(r.label,80),value=field(r.value,max);if(!expected.test(label))throw new BetaHttpError('Unsupported grading label.');
   return {label,value};
  };
  const attempt=row(g.attempt,/^Attempt number$/i,160),status=row(g.status,/^Grading status$/i,120,true);
  if(!Array.isArray(g.status.classes)||g.status.classes.length>8||g.status.classes.some((s:any)=>typeof s!=='string'||!/^[a-zA-Z][\w-]{0,79}$/.test(s)))throw new BetaHttpError('Invalid grading classes.');
  const rows=g.rows.map((r:any)=>row(r,/^(?:Grade|Graded on)$/i,240));
  if(g.layout==='assign-no-feedback'&&rows.length)throw new BetaHttpError('Grading layout did not match its rows.');
  grading={layout:g.layout,attempt,status:{...status,classes:g.status.classes},rows,truncated:g.truncated};
 }
 let availability:AssessmentCapture['availability'];
 if(raw.availability!==undefined){
  const a=raw.availability;
  if(raw.kind!=='assignment'||raw.layout!=='assign-status-table'||!a||Object.keys(a).some(k=>!['state','label'].includes(k))||!['open','closed'].includes(a.state))throw new BetaHttpError('Invalid submission availability.');
  const label=field(a.label,180);
  if(a.state==='open'&&!/^(Add submission|Edit submission)$/i.test(label)||a.state==='closed'&&!/^No more submissions are accepted\.?$/i.test(label))throw new BetaHttpError('Unsupported submission availability.');
  availability={state:a.state,label};
 }
 let late_penalty:string|undefined,cutoff_at:string|undefined;
 if(raw.late_penalty!==undefined){const quote=field(raw.late_penalty,400);if(raw.kind!=='assignment'||!/^Late submission penalty:\s+\S/i.test(quote))throw new BetaHttpError('Invalid late policy quote.');late_penalty=quote;}
 if(raw.cutoff!==undefined){const quote=field(raw.cutoff,240);if(raw.kind!=='assignment'||!/^Cut-off date:\s+\S/i.test(quote))throw new BetaHttpError('Invalid cutoff quote.');const parsed=activityDeadline(url,quote.replace(/^Cut-off date:/i,'Due date:'));if(parsed?.due_at)cutoff_at=parsed.due_at;}
 return {kind:raw.kind,layout:raw.layout,rows,attempts,truncated:raw.truncated,...(grading?{grading}:{}),...(availability?{availability}:{}),...(late_penalty?{late_penalty}:{}),...(cutoff_at?{cutoff_at}:{})};
}
export function assessmentState(proof:AssessmentCapture|null):{state:ReceiptState;reason:string}{
 if(!proof||proof.layout==='unavailable')return {state:'unknown',reason:'The standard Moodle status region was not captured.'};
 if(proof.truncated)return {state:'unknown',reason:'The status region exceeded its capture bound; latest status is uncertain.'};
 if(proof.kind==='assignment'){
  const rows=proof.rows.filter(r=>normalized(r.label).toLowerCase()==='submission status');
  if(rows.length!==1)return {state:rows.length?'conflict':'unknown',reason:'A single submission-status row was not found.'};
  const row=rows[0],value=normalized(row.value).toLowerCase();
  if(proof.rows.some(r=>/^(?:group|members who need to submit|members who have not submitted)$/i.test(normalized(r.label))))return {state:'group_submission',reason:'This is group evidence; an individual submission step may still be required.'};
  const states:[ReceiptState,string,string?][]=[['submitted','submitted for grading','submissionstatussubmitted'],['draft','draft (not submitted)','submissionstatusdraft'],['no_submission','no submission'],['reopened','reopened','submissionstatusreopened']];
  const found=states.find(([,label,cls])=>value===label&&(!cls||row.classes.includes(cls)));
  const classStates=row.classes.filter(c=>/^submissionstatus(?:submitted|draft|reopened)$/.test(c));
  if(classStates.length>1)return {state:'conflict',reason:'The status row contains conflicting state classes.'};
  if(!found||classStates.some(c=>c!==found[2]))return {state:'unknown',reason:'The labelled status is unsupported or disagrees with its state class.'};
  return {state:found[0],reason:'Observed in the assignment submission-status table; not a fresh server check.'};
 }
 const attempts=proof.attempts.map(a=>({number:Number(a.number.match(/^(?:Attempt\s+)?([1-9]\d{0,5})$/i)?.[1]),state:normalized(a.state)}));
 if(!attempts.length||attempts.some(a=>!Number.isSafeInteger(a.number)||a.number<1))return {state:'unknown',reason:'No numbered student attempt was captured.'};
 if(new Set(attempts.map(a=>a.number)).size!==attempts.length)return {state:'conflict',reason:'Duplicate attempt numbers make the latest attempt uncertain.'};
 const latest=attempts.sort((a,b)=>b.number-a.number)[0];
 const state:ReceiptState=/^Finished(?: Submitted .+)?$/i.test(latest.state)?'attempt_finished':/^In progress$/i.test(latest.state)?'attempt_in_progress':/^Overdue(?: .+)?$/i.test(latest.state)?'attempt_overdue':/^Never submitted$/i.test(latest.state)?'attempt_abandoned':'unknown';
 return {state,reason:state==='attempt_finished'?'Latest numbered attempt is finished. Its grade, required retakes and other course work are not established.':'Latest numbered attempt status; not a grade or proof of completing every requirement.'};
}
export async function saveAssessmentObservation(c:PoolClient,user:string,data:{source:string;version:string;device:string;identity:string;url:string;body:string;captured_at:string;assessment:AssessmentCapture|null;synthetic:boolean}){
 if(!/^[1-9]\d{0,11}$/.test(data.identity))return;
 if(!/^https:\/\/moodle\.acadiau\.ca\/mod\/(assign|quiz)\/view\.php\?id=[1-9]\d{0,11}$/.test(data.url))return;
 const status=assessmentState(data.assessment),sha256=createHash('sha256').update(data.body).digest('hex'),provenance=data.synthetic?'synthetic_capture':'signed_in_capture';
 // The vault writer lock serializes source and receipt checks. Immutable history
 // records evidence transitions; one source-bound pointer records repeat checks.
 const previous=(await c.query(`SELECT r.*,coalesce(k.captured_at,r.captured_at) AS checked_at
  FROM schoolvault.moodle_receipts r LEFT JOIN schoolvault.moodle_receipt_checks k
   ON k.user_id=r.user_id AND k.source_id=r.source_id AND k.receipt_id=r.id
  WHERE r.user_id=$1 AND r.source_id=$2 ORDER BY r.captured_at DESC,r.id DESC LIMIT 1`,[user,data.source])).rows[0];
 const same=(row:any)=>row&&row.version_id===data.version&&row.state===status.state&&row.body_sha256===sha256&&row.device_id===data.device&&row.identity_key===data.identity&&row.activity_url===data.url&&row.provenance===provenance&&canonical(row.proof)===canonical(data.assessment);
 const old=(await c.query('SELECT * FROM schoolvault.moodle_receipts WHERE user_id=$1 AND source_id=$2 AND captured_at=$3',[user,data.source,data.captured_at])).rows[0];
 if(old&&!same(old))throw new BetaConflict('This capture time already has different status evidence. Refresh the Moodle page.');
 if(previous&&Date.parse(data.captured_at)<=new Date(previous.checked_at).getTime()){
  if(Date.parse(data.captured_at)===new Date(previous.checked_at).getTime()&&!same(previous))throw new BetaConflict('This capture time already has different status evidence. Refresh the Moodle page.');
  return;
 }
 const unchanged=same(previous),id=unchanged?previous.id:randomUUID();
 if(!unchanged)await c.query('INSERT INTO schoolvault.moodle_receipts(user_id,id,source_id,version_id,device_id,identity_key,activity_url,body_sha256,captured_at,state,reason,proof,provenance) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[user,id,data.source,data.version,data.device,data.identity,data.url,sha256,data.captured_at,status.state,status.reason,data.assessment?JSON.stringify(data.assessment):null,provenance]);
 await c.query(`INSERT INTO schoolvault.moodle_receipt_checks(user_id,source_id,receipt_id,captured_at) VALUES($1,$2,$3,$4)
  ON CONFLICT(user_id,source_id) DO UPDATE SET receipt_id=excluded.receipt_id,captured_at=excluded.captured_at,received_at=clock_timestamp()
  WHERE schoolvault.moodle_receipt_checks.captured_at<excluded.captured_at`,[user,data.source,id,data.captured_at]);
 if(unchanged&&Date.now()-new Date(previous.checked_at).getTime()<=86400000)return;
 // Status metadata can change even when visible page text is unchanged.
 await c.query("UPDATE schoolvault.jobs SET status='cancelled',error='Moodle status was refreshed. Your question is saved; ask again for current evidence.',lease_hash=NULL,lease_until=NULL,updated_at=now() WHERE user_id=$1 AND kind='answer' AND status='leased' AND (input ? 'work' OR EXISTS(SELECT 1 FROM jsonb_array_elements(input->'sources') s WHERE s->>'id'=$2))",[user,data.source]);
}
export async function receiptsForSources(c:PoolClient,user:string,refs:{id:string;version_id:string}[],now=new Date()):Promise<Map<string,ReceiptView>>{
 if(!refs.length)return new Map();
 // Use the latest-receipt index before joining source history. The receipt
 // foreign key guarantees its source version, and capture time is unique
 // within an activity. Keep newer negative evidence ahead of older positives.
 const rows=(await c.query(`WITH latest AS MATERIALIZED (
  SELECT r.* FROM unnest($2::uuid[]) AS wanted(id)
  CROSS JOIN LATERAL (
   SELECT r.* FROM schoolvault.moodle_receipts r
   WHERE r.user_id=$1 AND r.source_id=wanted.id ORDER BY r.captured_at DESC LIMIT 1
  ) r
 )
 SELECT r.*,coalesce(k.captured_at,r.captured_at) AS checked_at,s.current_version,s.original_url,v.sha256 AS version_sha256
 FROM latest r LEFT JOIN schoolvault.moodle_receipt_checks k ON k.user_id=r.user_id AND k.source_id=r.source_id AND k.receipt_id=r.id
 JOIN schoolvault.sources s ON s.user_id=r.user_id AND s.id=r.source_id
 JOIN schoolvault.source_versions v ON v.user_id=r.user_id AND v.source_id=r.source_id AND v.id=r.version_id
 ORDER BY r.source_id`,[user,[...new Set(refs.map(r=>r.id))]])).rows;
 const result=new Map(rows.map(row=>{const current=refs.some(r=>r.id===row.source_id&&r.version_id===row.version_id)&&row.current_version===row.version_id&&row.body_sha256===row.version_sha256,age=now.getTime()-new Date(row.checked_at).getTime(),fresh=age>=-60000&&age<=86400000,real=row.provenance==='signed_in_capture',eligible=current&&fresh&&real&&!['unknown','conflict','group_submission'].includes(row.state);return [row.source_id,{id:row.id,state:eligible?row.state:'unknown',observed_state:row.state,eligible,reason:!current?'The saved source changed after this status observation.':!fresh?'This saved status is more than a day old; refresh Moodle before treating it as current.':!real?'Synthetic example, not a real Moodle receipt.':row.reason,observed_at:new Date(row.checked_at).toISOString(),version_id:row.version_id,activity_url:row.activity_url,proof:row.proof,membership:observedAssignmentGroup(row.proof,current&&fresh&&real&&row.original_url===row.activity_url),grade:observedAssignmentGrade(row.proof,eligible,row.state==='submitted'),provenance:row.provenance} as ReceiptView];}));
 if(localAccountAvailable()&&user===process.env.SCHOOL_LOCAL_USER_ID){
  const own=(await c.query(`SELECT t.source_id,t.evidence,s.current_version,s.original_url,c.code,v.id AS version_id,v.body,t.observed_at FROM schoolvault.tasks t JOIN schoolvault.sources s ON s.user_id=t.user_id AND s.id=t.source_id JOIN schoolvault.courses c ON c.user_id=t.user_id AND c.id=t.course_id JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.source_id=s.id AND v.id::text=t.evidence->>'version_id' WHERE t.user_id=$1 AND t.source_id=ANY($2::uuid[]) AND t.evidence ? 'owner_snapshot_status'`,[user,refs.map(r=>r.id)])).rows;
  for(const row of own){if(!row.evidence.owner_snapshot_status||!refs.some(r=>r.id===row.source_id&&r.version_id===row.version_id))continue;const view=ownerSnapshotReceipt(row.evidence.owner_snapshot_status,row.body,row.version_id,row.current_version,new Date(row.observed_at).toISOString(),row.original_url,row.code,now),previous=result.get(row.source_id);if(view&&(!previous||Date.parse(view.observed_at)>Date.parse(previous.observed_at)))result.set(row.source_id,view);}
 }
 return result;

}

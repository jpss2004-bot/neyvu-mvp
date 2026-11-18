'use client';
import {useI18n} from "./language";

import {currentAssignmentGroup} from '../../lib/beta/assignment-membership';
import {currentReceipt} from '../../lib/beta/receipt-current';
import type {BetaTask} from '../../lib/beta/agenda';
import {observedAssignmentGrade} from '../../lib/beta/assignment-grade';
import type {ReceiptView} from '../../lib/beta/moodle-receipts';
const labels:Record<string,string>={submitted:'Submitted for grading',draft:'Draft — not submitted',no_submission:'No submission',reopened:'Reopened',group_submission:'Group submission — your individual step is uncertain',attempt_finished:'Latest quiz attempt finished',attempt_in_progress:'Latest quiz attempt in progress',attempt_overdue:'Latest quiz attempt overdue',attempt_abandoned:'Latest quiz attempt never submitted',unknown:'Status not established',conflict:'Conflicting status evidence'};
export default function ReceiptStatus({receipt,zone,now=new Date(),binding}:{receipt?:ReceiptView|null;zone:string;now?:Date;binding?:BetaTask['evidence']}){
 const {t:ui,locale}=useI18n();
 if(!receipt)return <p className="beta-receipt-status">{ui("Moodle receipt not collected. Personal progress and deadlines do not verify submission.")}</p>;
 const showGrade=receipt.proof?.kind==='assignment'||/\/mod\/assign\//.test(receipt.activity_url);
 const membership=currentAssignmentGroup(receipt,now,binding);
 const current=currentReceipt(receipt,now,binding),grade=observedAssignmentGrade(receipt.proof,current,receipt.state==='submitted');
 const observed=Number.isFinite(Date.parse(receipt.observed_at))?new Intl.DateTimeFormat(locale,{timeZone:zone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(receipt.observed_at)):ui('Collection time not established');
 return <div className="beta-receipt-status">{receipt.provenance==='owner_snapshot'&&<p>{ui("Saved owner snapshot · not a live Moodle check")}</p>}<p><strong>{current?ui("Observed in Moodle:")+' '+ui(labels[receipt.state]):ui("Current Moodle status not established")}</strong><br/><small>{current?ui("Collected")+' ':ui("Last collected:")+' '+ui(labels[receipt.observed_state])+' · '}{observed}</small></p><p>{ui(current?receipt.reason:'Refresh Moodle before treating this saved submission status as current.')}</p>
  {membership.state==='observed'&&<p><strong>{ui('Group observed for this assignment: {group}',{group:membership.group!})}</strong><br/><small>{ui('This group applies to this assignment only. Your section, other groups and individual submission remain separate.')}</small></p>}
  {showGrade&&(grade.state==='released'?<p><strong>{ui('Released grade observed: {value}',{value:grade.value!})}</strong><br/>{ui('Attempt {number}',{number:grade.attempt_number!})} · {ui('Graded on:')} {grade.graded_on}<br/><small>{ui('A released grade does not establish whether a later instruction requires action.')}</small></p>:grade.state==='not_graded'?<p>{ui('Moodle showed this submitted attempt as not graded.')}</p>:<p>{ui(grade.reason)}</p>)}
  {receipt.proof&&<details><summary>{ui("View collected status evidence")}</summary>{receipt.proof.rows.map((r,i)=><p key={i}><strong>{r.label}</strong><br/>{r.value}</p>)}{receipt.proof.attempts.map((a,i)=><p key={i}><strong>{/^Attempt/i.test(a.number)?a.number:ui("Attempt")+' '+a.number}</strong><br/>{a.state}</p>)}{receipt.proof.grading&&<><p><strong>{receipt.proof.grading.attempt.label}</strong><br/>{receipt.proof.grading.attempt.value}</p><p><strong>{receipt.proof.grading.status.label}</strong><br/>{receipt.proof.grading.status.value}</p>{receipt.proof.grading.rows.map((r,i)=><p key={'grade-'+i}><strong>{r.label}</strong><br/>{r.value}</p>)}</>}<p>{ui("A saved status is not a fresh server check. Grades and any required retakes remain separate.")}</p></details>}
 </div>;
}

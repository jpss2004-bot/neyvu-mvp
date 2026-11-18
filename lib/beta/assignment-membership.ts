import type {AssessmentCapture,ReceiptView} from './moodle-receipts';

export type AssignmentMembership={state:'observed'|'unknown'|'conflict';scope:'assignment';group:string|null};
// Moodle's own assignment submission table supplies a group for this activity.
// A roster, selector, title, student report or another course cannot supply it.
export function observedAssignmentGroup(proof:AssessmentCapture|null,checked:boolean):AssignmentMembership{
 const unknown:AssignmentMembership={state:'unknown',scope:'assignment',group:null};
 if(!checked||proof?.kind!=='assignment'||proof.layout!=='assign-status-table'||proof.truncated)return unknown;
 const rows=proof.rows.filter(row=>row.label.replace(/\s+/g,' ').trim().toLowerCase()==='group');
 if(rows.length>1)return {...unknown,state:'conflict'};
 if(rows.length!==1)return unknown;
 const group=rows[0].value.trim();
 if(!group||group.length>180||/[\r\n\x00-\x1f\x7f]/.test(group)||/^(?:no groups?|none|not (?:a member|in a group)|all (?:participants|groups)|choose|select)(?:\b|$)/i.test(group))return unknown;
 return {state:'observed',scope:'assignment',group};
}
export function currentAssignmentGroup(receipt:ReceiptView|null|undefined,now:Date,binding?:{version_id?:unknown;activity_url?:unknown}|null):AssignmentMembership{
 const age=receipt?now.getTime()-Date.parse(receipt.observed_at):NaN;
 const checked=!!receipt&&receipt.provenance==='signed_in_capture'&&age>=-60000&&age<=86400000&&!!binding?.version_id&&binding.version_id===receipt.version_id&&!!binding.activity_url&&binding.activity_url===receipt.activity_url&&receipt.membership?.state==='observed';
 const group=observedAssignmentGroup(receipt?.proof||null,checked);
 return group.group===receipt?.membership?.group?group:{state:'unknown',scope:'assignment',group:null};
}

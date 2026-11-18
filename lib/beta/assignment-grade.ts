// Pure interpretation of saved assignment grading observations. These are not
// independent Moodle API checks and never establish submission or policy compliance.
export type AssignmentGrading={layout:'assign-feedback-table'|'assign-no-feedback'|'unavailable';attempt:{label:string;value:string};status:{label:string;value:string;classes:string[]};rows:{label:string;value:string}[];truncated:boolean};
export type AssignmentGrade={state:'released'|'not_graded'|'unknown';attempt_number:number|null;value:string|null;graded_on:string|null;reason:string};
export const assignmentAttempt=(value:string)=>Number(value.replace(/\s+/g,' ').trim().match(/^This is attempt ([1-9]\d{0,5})(?:\s*\(\s*[1-9]\d{0,5} attempts? allowed\s*\))?\s*\.$/i)?.[1])||null;
export function observedAssignmentGrade(proof:{kind:string;layout:string;truncated:boolean;grading?:AssignmentGrading}|null,eligible:boolean,submitted:boolean):AssignmentGrade{
 const unknown=(reason:string):AssignmentGrade=>({state:'unknown',attempt_number:null,value:null,graded_on:null,reason});
 if(!eligible)return unknown('Refresh Moodle before treating a saved grade as current.');
 if(!proof||proof.kind!=='assignment'||proof.layout!=='assign-status-table'||proof.truncated||!proof.grading)return unknown('Assignment grading evidence was not collected.');
 const g=proof.grading,attempt=assignmentAttempt(g.attempt.value),status=g.status.value.replace(/\s+/g,' ').trim().toLowerCase();
 if(!attempt||g.truncated||g.layout==='unavailable')return unknown('A single current attempt and complete grading region were not established.');
 if(!submitted)return unknown('The current submission status needs review; an earlier grade cannot resolve it.');
 const grades=g.rows.filter(r=>r.label.toLowerCase()==='grade'),dates=g.rows.filter(r=>r.label.toLowerCase()==='graded on');
 if(status==='not graded'&&g.status.classes.includes('submissionnotgraded')&&!g.status.classes.includes('submissiongraded')&&g.layout==='assign-no-feedback'&&!g.rows.length)return {state:'not_graded',attempt_number:attempt,value:null,graded_on:null,reason:'Moodle showed this submitted attempt as not graded.'};
 if(status!=='graded'||!g.status.classes.includes('submissiongraded')||g.status.classes.includes('submissionnotgraded')||g.layout!=='assign-feedback-table'||grades.length!==1||dates.length!==1)return unknown('The grading status and released feedback do not establish one consistent grade.');
 const value=grades[0].value.replace(/\s+/g,' ').trim(),match=value.match(/^(\d{1,7}(?:\.\d{1,6})?)\s*\/\s*(\d{1,7}(?:\.\d{1,6})?)$/);
 if(!match||Number(match[2])<=0||Number(match[1])>Number(match[2]))return unknown('The released grade format needs review.');
 return {state:'released',attempt_number:attempt,value,graded_on:dates[0].value,reason:'Observed in this assignment’s released feedback; later instructions and resubmission needs remain separate.'};
}

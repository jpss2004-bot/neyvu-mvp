import type {StudentMemory} from './student-memory';
import type {CourseMembershipView} from './course-membership';
import {currentAssignmentGroup} from './assignment-membership';
import type {ReceiptView} from './moodle-receipts';

export const groupKinds=['lab','section','team'] as const;
export type GroupKind=typeof groupKinds[number];
export type GroupReport={id:string;revision:number;course_id:string;kind:GroupKind;name:string;updated_at:string;authority:'student_reported'};
export type GroupContext={course_id:string;official:CourseMembershipView;reports:GroupReport[]};
export function groupReportBody(kind:unknown,name:unknown){
 if(!groupKinds.includes(kind as GroupKind)||typeof name!=='string'||!name.trim()||name.trim().length>180||/[\x00-\x1f\x7f]/.test(name))throw Error('Enter a group name of up to 180 characters.');
 return `Student-reported ${kind}: ${name.trim()}`;
}
export function parseGroupReport(body:string):{kind:GroupKind;name:string}|null{
 const match=/^Student-reported (lab|section|team): (.+)$/.exec(body);
 if(!match)return null;
 try{return groupReportBody(match[1],match[2])===body?{kind:match[1] as GroupKind,name:match[2]}:null;}catch{return null;}
}
export function courseGroupReports(courseId:string,memories:StudentMemory[]):GroupReport[]{
 const found=new Map<GroupKind,GroupReport>();
 for(const m of [...memories].sort((a,b)=>Date.parse(b.updated_at)-Date.parse(a.updated_at)||b.id.localeCompare(a.id))){
  const report=parseGroupReport(m.body);
  if(m.course_id!==courseId||m.chat_id!==null||m.kind!=='correction'||!report||found.has(report.kind))continue;
  found.set(report.kind,{...report,id:m.id,revision:m.revision,course_id:courseId,updated_at:m.updated_at,authority:'student_reported'});
 }
 return [...found.values()];
}
const sameName=(a:string,b:string)=>a.trim().replace(/\s+/g,' ').toLocaleLowerCase('en')===b.trim().replace(/\s+/g,' ').toLocaleLowerCase('en');
export function currentGroupEvidence(context:GroupContext,now:Date){
 const at=Date.parse(context.official.observed_at||''),age=now.getTime()-at;
 return context.official.state==='observed'&&Number.isFinite(age)&&age>=-60000&&age<=86400000;
}
export function reportCorroborated(context:GroupContext,report:GroupReport,now:Date){
 // Exact name correspondence only. "Beta" is not automatically "Lab Beta",
 // and a profile's untyped group list cannot certify a lab/team role.
 return report.course_id===context.course_id&&currentGroupEvidence(context,now)&&context.official.groups.some(g=>sameName(g.name,report.name));
}
export type GroupApplicability={state:'activity_group_observed'|'needs_check';group:string|null;reason:string;profile_url?:string};
export function groupApplicability(courseId:string,context:GroupContext|undefined,receipt:ReceiptView|null|undefined,now:Date,binding?:{version_id?:unknown;activity_url?:unknown;title?:unknown}|null):GroupApplicability|null{
 const activity=currentAssignmentGroup(receipt,now,binding);
 if(activity.state==='observed')return {state:'activity_group_observed',group:activity.group,reason:'Moodle names this group for this assignment. This does not verify individual submission or your group in another activity.'};
 if(!/\b(?:lab|group|team|section)\b/i.test(String(binding?.title||''))||!context||context.course_id!==courseId||!context.reports.length&&!currentGroupEvidence(context,now))return null;
 return {state:'needs_check',group:null,reason:'Your course group is known or reported, but this assignment’s group requirements are not verified. Check the instructions before choosing group-specific work.',...(currentGroupEvidence(context,now)&&context.official.profile_url?{profile_url:context.official.profile_url}:{})};
}

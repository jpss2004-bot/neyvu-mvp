import type {PoolClient} from 'pg';
import {tenant,uuid} from './db';
import {BetaHttpError} from './http';
import {groupKinds,groupReportBody,parseGroupReport,type GroupKind} from './group-context-format';
import {saveStudentMemory} from './student-memory';

// One clarifying question when an activity has several group versions and the
// student's group is unknown. The worker proposes it; the web app only accepts
// options that appear in the answer's own same-course sources, and a choice is
// saved as a student-reported group (never as verified Moodle membership).
export type GroupClarificationOption={name:string;source_ids:string[]};
export type GroupClarification={kind:'group';version:1;course_id:string;group_kind:GroupKind;activity:string;question:string;options:GroupClarificationOption[]};
const questions:Record<GroupKind,string>={lab:'Which lab section are you in?',section:'Which section are you in?',team:'Which team are you in?'};
const norm=(x:string)=>x.trim().replace(/\s+/g,' ').toLocaleLowerCase('en');
const escape=(x:string)=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const sourceCourse=(s:any)=>s?.course_id??s?.course?.id;

export function groupClarification(raw:any,input:any):GroupClarification{
 const invalid=()=>new BetaHttpError('Invalid group clarification');
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).sort().join(',')!=='activity,course_id,group_kind,kind,options,question,version')throw invalid();
 if(raw.kind!=='group'||raw.version!==1||!groupKinds.includes(raw.group_kind)||raw.question!==questions[raw.group_kind as GroupKind])throw invalid();
 if(typeof raw.activity!=='string'||!/^(?:Lab|Assignment|Quiz|Project|Test|Exam) \d{1,3}$/.test(raw.activity))throw invalid();
 const contexts=Array.isArray(input?.group_context)?input.group_context:[];
 const course=input?.course_id||(contexts.length===1?contexts[0]?.course_id:undefined);
 // The course must be the answer's own course and carry server group context.
 if(!uuid(raw.course_id)||raw.course_id!==course||!contexts.some((c:any)=>c?.course_id===raw.course_id))throw invalid();
 if(!Array.isArray(raw.options)||raw.options.length<2||raw.options.length>8)throw invalid();
 const sources=Array.isArray(input?.sources)?input.sources:[],seen=new Set<string>();
 const options=raw.options.map((o:any)=>{
  if(!o||typeof o!=='object'||Object.keys(o).sort().join(',')!=='name,source_ids'||typeof o.name!=='string'||!Array.isArray(o.source_ids)||!o.source_ids.length||o.source_ids.length>8)throw invalid();
  try{groupReportBody(raw.group_kind,o.name);}catch{throw invalid();}
  if(o.name!==o.name.trim()||/[\[\]<>`*_\\]/.test(o.name)||seen.has(norm(o.name)))throw invalid();
  seen.add(norm(o.name));
  const label=new RegExp('(?<![\\p{L}\\p{N}])'+escape(o.name).replace(/\s+/g,'\\s+')+'(?![\\p{L}\\p{N}])','iu');
  for(const id of o.source_ids){
   const s=sources.find((s:any)=>s?.id===id);
   // Every option must be visible in a cited current source of this course.
   if(typeof id!=='string'||!s||sourceCourse(s)!==raw.course_id||s.historical||s.untrusted||![s.title,s.excerpt,s.body].some(t=>typeof t==='string'&&label.test(t)))throw invalid();
  }
  return {name:o.name,source_ids:[...new Set<string>(o.source_ids)]};
 });
 return {kind:'group',version:1,course_id:raw.course_id,group_kind:raw.group_kind,activity:raw.activity,question:raw.question,options};
}

async function storedClarification(c:PoolClient,user:string,messageId:string){
 const row=(await c.query("SELECT m.id,m.chat_id,m.content FROM schoolvault.messages m WHERE m.user_id=$1 AND m.id=$2 AND m.role='assistant'",[user,messageId])).rows[0];
 const content=typeof row?.content==='string'?JSON.parse(row.content):row?.content;
 const clarification=content?.clarification as GroupClarification|undefined;
 if(!row||content?.type!=='answer'||clarification?.kind!=='group'||clarification.version!==1||!uuid(clarification.course_id))throw new BetaHttpError('This question no longer offers a group choice.',409);
 return {chat_id:row.chat_id as string,job_id:typeof content.job_id==='string'?content.job_id:null,clarification};
}

export async function saveGroupClarification(user:string,input:any){
 if(!uuid(input?.message_id)||typeof input?.choice!=='string'||input.request_id!=null&&!uuid(input.request_id))throw new BetaHttpError('Choose one of the offered groups.');
 const found=await tenant(user,async c=>{
  const stored=await storedClarification(c,user,input.message_id);
  const option=stored.clarification.options.find(o=>o.name===input.choice);
  if(!option)throw new BetaHttpError('Choose one of the offered groups.');
  const existing=(await c.query("SELECT id,revision,body FROM schoolvault.student_memory WHERE user_id=$1 AND course_id=$2 AND chat_id IS NULL AND kind='correction' AND starts_with(body,$3) ORDER BY updated_at DESC,id DESC LIMIT 1",[user,stored.clarification.course_id,'Student-reported '+stored.clarification.group_kind+': '])).rows[0];
  return {...stored,option,existing:existing&&parseGroupReport(existing.body)?existing:undefined};
 });
 const {clarification,option,existing}=found,body=groupReportBody(clarification.group_kind,option.name);
 if(existing?.body===body)return {saved:true,changed:false,memory:{id:existing.id,revision:existing.revision,body}};
 const memory=await saveStudentMemory(user,{kind:'correction',course_id:clarification.course_id,chat_id:null,body,request_id:input.request_id??undefined,...(existing?{id:existing.id,revision:existing.revision}:{})},{
  action:'group-clarification-choice',target:clarification.course_id,
  details:{provenance:'student_chat_clarification',authority:'student_reported',message_id:input.message_id,chat_id:found.chat_id,job_id:found.job_id,activity:clarification.activity,group_kind:clarification.group_kind,choice:option.name,offered:clarification.options.map(o=>o.name),source_ids:option.source_ids,replaced:existing?.body??null}
 });
 return {saved:true,changed:true,memory};
}

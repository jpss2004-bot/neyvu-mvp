import {uuid} from './db';
import {BetaHttpError} from './http';

// D5: a clarifying question for a missing course or activity, proposed by the
// worker's question-rewrite route (SCHOOL_BETA_QUESTION_REWRITE, default off).
// Group/section choices keep their own validated path (group-clarification.ts).
// Activity options must be visible in the answer's own same-course sources.
export type QuestionClarification=
 |{kind:'course';version:1;question:string;activity:string;options:{id:string;name:string}[]}
 |{kind:'activity';version:1;question:string;course_id:string;options:{name:string}[]};
const plain=(x:unknown,max=120)=>typeof x==='string'&&x===x.trim()&&x.length>0&&x.length<=max&&!/[\x00-\x1f\[\]<>`*_\\]/.test(x);
const activityName=/^(?:Lab|Assignment|Quiz|Project|Test|Exam) \d{1,3}$/;

export function questionClarification(raw:any,input:any):QuestionClarification{
 const invalid=()=>new BetaHttpError('Invalid question clarification');
 if(!raw||typeof raw!=='object'||raw.version!==1||!Array.isArray(raw.options)||raw.options.length<2||raw.options.length>8)throw invalid();
 if(raw.kind==='course'){
  if(Object.keys(raw).sort().join(',')!=='activity,kind,options,question,version'||!activityName.test(raw.activity)||raw.question!==`Which course is ${raw.activity} for?`)throw invalid();
  const ids=new Set<string>();
  const options=raw.options.map((o:any)=>{if(!o||Object.keys(o).sort().join(',')!=='id,name'||!uuid(o.id)||ids.has(o.id)||!plain(o.name))throw invalid();ids.add(o.id);return {id:o.id,name:o.name};});
  return {kind:'course',version:1,question:raw.question,activity:raw.activity,options};
 }
 if(raw.kind==='activity'){
  if(Object.keys(raw).sort().join(',')!=='course_id,kind,options,question,version'||!uuid(raw.course_id)||raw.question!=='Which activity do you mean?')throw invalid();
  const sources=Array.isArray(input?.sources)?input.sources:[],seen=new Set<string>();
  const options=raw.options.map((o:any)=>{
   if(!o||Object.keys(o).join(',')!=='name'||!activityName.test(o.name)||seen.has(o.name))throw invalid();seen.add(o.name);
   const label=new RegExp('\\b'+o.name.replace(' ','[\\s_-]*')+'\\b','i');
   if(!sources.some((s:any)=>(s?.course_id??s?.course?.id)===raw.course_id&&!s.historical&&typeof s.title==='string'&&label.test(s.title)))throw invalid();
   return {name:o.name};
  });
  return {kind:'activity',version:1,question:raw.question,course_id:raw.course_id,options};
 }
 throw invalid();
}

export type StudyApproach='explain'|'practice'|'worked';
export type StudyRequestKind='explain'|'practice-question'|'practice-answer'|'worked';
export type StudySession={
 version:1;id:string;chatId:string;originId:string;question:string;courseId:string|null;
 approach:StudyApproach;goal:string;attempt:string;nextAction:string;plannedOn:string;noteUncertain:boolean;phase:'study'|'review';
 sourceRefs:{id:string;version_id?:string;course_id:string}[];
 request:{kind:StudyRequestKind;question:string;afterId:string|null;userId:string|null}|null;
 practiceQuestionId:string|null;noteId:string|null;planId:string|null;noteRequestId:string;planRequestId:string;
};
export const studyApproaches={explain:'Explanation',practice:'Practice',worked:'Worked example'} as const;
const id=(value:unknown):value is string=>typeof value==='string'&&/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const bounded=(value:unknown,max:number):value is string=>typeof value==='string'&&value.length<=max;
export function readStudySession(raw:string|null):StudySession|null {
 if(!raw||raw.length>12000)return null;
 try{
  const s=JSON.parse(raw);
  if(s?.version!==1||![s.id,s.chatId,s.originId,s.noteRequestId,s.planRequestId].every(id)||s.courseId!==null&&!id(s.courseId)||!['explain','practice','worked'].includes(s.approach)||!['study','review'].includes(s.phase))return null;
  if(!bounded(s.question,1000)||!s.question.trim()||!bounded(s.goal,300)||!bounded(s.attempt,1000)||!bounded(s.nextAction,1000)||!bounded(s.plannedOn,10)||typeof s.noteUncertain!=='boolean'||s.plannedOn!==''&&!/^\d{4}-\d{2}-\d{2}$/.test(s.plannedOn))return null;
  if(!Array.isArray(s.sourceRefs)||s.sourceRefs.length>8||s.sourceRefs.some((r:any)=>!id(r.id)||!id(r.course_id)||r.version_id!==undefined&&!id(r.version_id)))return null;
  if([s.practiceQuestionId,s.noteId,s.planId].some(v=>v!==null&&!id(v)))return null;
  if(s.request!==null&&(!s.request||typeof s.request!=='object'||!['explain','practice-question','practice-answer','worked'].includes(s.request.kind)||!bounded(s.request.question,3000)||s.request.afterId!==null&&!id(s.request.afterId)||s.request.userId!==null&&!id(s.request.userId)))return null;
  return s as StudySession;
 }catch{return null;}
}
export function studyRequest(session:StudySession,kind:StudyRequestKind):string {
 const task={
  explain:'Explain the key idea using my saved material. Show one useful step and cite the sources. Ask a specific clarification if the saved material is insufficient.',
  'practice-question':'Give me one practice question on this topic, using my saved course material and notation. Do not reveal its answer yet. Identify any example you create as an AI-written practice example.',
  'practice-answer':'For the practice question you just gave me, show a worked answer and compare it with my attempt. Explain specific differences without assigning an official grade. Cite course material where relevant.',
  worked:'Show a worked example using my saved course material and notation. Explain the steps, cite the supporting material, and label any example you create as AI-written study material.',
 }[kind];
 return [task,'Question to study: '+session.question.trim(),session.goal.trim()?'My goal: '+session.goal.trim():'',kind==='practice-answer'?'My attempt: '+session.attempt.trim():''].filter(Boolean).join('\n\n');
}
export type StudyMessage={id:string;role:string;content:{text:string;type?:string};sources?:unknown[]};
export function studyResponse<T extends StudyMessage>(session:StudySession,messages:T[]):T|null {
 const r=session.request;if(!r)return null;
 let index=r.userId?messages.findIndex(m=>m.id===r.userId):-1;
 if(index<0){const after=r.afterId?messages.findIndex(m=>m.id===r.afterId):-1;if(r.afterId&&after<0)return null;index=messages.findIndex((m,i)=>i>after&&m.role==='user'&&m.content.text===r.question);}
 if(index<0||messages[index].role!=='user'||messages[index].content.text!==r.question)return null;
 for(const m of messages.slice(index+1)){if(m.role==='user')break;if(m.role==='assistant'&&m.content.type==='answer')return m;}
 return null;
}

export type StudyLibrary={version:2;activeId:string|null;sessions:StudySession[]};
export function readStudyLibrary(raw:string|null):StudyLibrary {
 const empty:StudyLibrary={version:2,activeId:null,sessions:[]};
 if(!raw||raw.length>8000000)return empty;
 try{const value=JSON.parse(raw);if(value?.version===1){const s=readStudySession(raw);return s?{version:2,activeId:s.id,sessions:[s]}:empty;}
  if(value?.version!==2||!Array.isArray(value.sessions))return empty;
  const seen=new Set<string>();const sessions:StudySession[]=[];
  for(const candidate of value.sessions){const s=readStudySession(JSON.stringify(candidate));if(s&&!seen.has(s.id)){sessions.push(s);seen.add(s.id);}}
  return {version:2,activeId:sessions.some(s=>s.id===value.activeId)?value.activeId:sessions[0]?.id||null,sessions};
 }catch{return empty;}
}
export function retainStudy(library:StudyLibrary,session:StudySession):StudyLibrary {return {version:2,activeId:session.id,sessions:[session,...library.sessions.filter(s=>s.id!==session.id)]};}

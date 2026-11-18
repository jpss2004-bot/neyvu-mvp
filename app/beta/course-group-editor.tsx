'use client';
import {useEffect,useRef,useState} from 'react';
import {groupKinds,groupReportBody,reportCorroborated,type GroupContext,type GroupKind,type GroupReport} from '../../lib/beta/group-context-format';
import {useI18n} from './language';

// In-memory only, scoped by the tenant-owned course UUID. Internal navigation
// keeps an unfinished correction; a full document/sign-out clears it.
const drafts=new Map<string,{kind:GroupKind;name:string}>();
export default function CourseGroupEditor({context,disabled=false,onSaved}:{context:GroupContext;disabled?:boolean;onSaved?:()=>void}){
 const {t:ui}=useI18n(),draft=drafts.get(context.course_id);
 const [reports,setReports]=useState(context.reports),[kind,setKind]=useState<GroupKind>(draft?.kind||'lab'),[name,setName]=useState(draft?.name||''),[editing,setEditing]=useState(!!draft),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const request=useRef<{body:string;id:string}|null>(null);
 const current=reports.find(report=>report.kind===kind);
 useEffect(()=>{
  if(!editing||name===(current?.name||'')){drafts.delete(context.course_id);return;}
  drafts.set(context.course_id,{kind,name});
  const warn=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',warn);
  return()=>window.removeEventListener('beforeunload',warn);
 },[context.course_id,editing,kind,name,current?.name]);
 function choose(value:GroupKind){setKind(value);setName(reports.find(report=>report.kind===value)?.name||'');setMessage('');setError('');}
 async function save(event:React.FormEvent){
  event.preventDefault();setBusy(true);setError('');setMessage('');
  try{
   const body=groupReportBody(kind,name),payload={op:'memory.save',kind:'correction',course_id:context.course_id,chat_id:null,body,...(current?{id:current.id,revision:current.revision}:{})},signature=JSON.stringify(payload);
   if(request.current?.body!==signature)request.current={body:signature,id:crypto.randomUUID()};
   const response=await fetch('/api/beta',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,request_id:request.current.id})});
   const row=await response.json();if(!response.ok)throw Error(row.error||'Your group could not be saved.');
   const report:GroupReport={id:row.id,revision:row.revision,course_id:context.course_id,kind,name:name.trim(),updated_at:row.updated_at,authority:'student_reported'};
   drafts.delete(context.course_id);setReports(old=>[...old.filter(item=>item.kind!==kind),report]);setEditing(false);setMessage('Group saved for this course and its future chats.');onSaved?.();
  }catch(error){setError(error instanceof Error?error.message:'Your group could not be saved.');}finally{setBusy(false);}
 }
 return <section aria-label={ui('Your reported groups')}>
  {reports.map(report=><p key={report.kind}><strong>{ui('Student-reported')} · {ui(report.kind)}: {report.name}</strong>{' '}{ui(reportCorroborated(context,report,new Date())?'The same name appears in your Moodle course profile.':'Not yet corroborated by Moodle.')} <button type="button" disabled={disabled||busy} onClick={()=>{choose(report.kind);setEditing(true);}}>{ui('Edit')}</button></p>)}
  {!editing?<button type="button" disabled={disabled||busy} onClick={()=>{choose(kind);setEditing(true);}}>{ui('Add or correct my group')}</button>:<form onSubmit={save}><fieldset disabled={disabled||busy}><label>{ui('Group type')}<select value={kind} onChange={e=>choose(e.target.value as GroupKind)}>{groupKinds.map(value=><option key={value} value={value}>{ui(value)}</option>)}</select></label><label>{ui('My group')}<input value={name} onChange={e=>setName(e.target.value)} maxLength={180} required autoFocus/></label><p>{ui('Remembered only for this course. This does not confirm which assignments apply or whether you submitted them.')}</p><button type="submit">{ui(busy?'Saving…':'Save group')}</button><button type="button" onClick={()=>setEditing(false)}>{ui('Cancel')}</button></fieldset></form>}
  {message&&<p role="status">{ui(message)}</p>}{error&&<p role="alert">{ui(error)} {ui('Your edit is kept.')}</p>}
 </section>;
}

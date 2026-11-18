'use client';
import {useI18n} from "./language";
import {useBrowserCopies} from './browser-copy-context';

import {useEffect,useId,useRef,useState} from 'react';
import type {MemoryKind,StudentMemory} from '../../lib/beta/student-memory';
type Scope='chat'|'course'|'all';
const kindLabels:Record<MemoryKind,string>={choice:'Choice',correction:'Correction',preference:'Preference',progress:'Personal progress',availability:'Study availability'};
async function rawRequest(query:string,data?:unknown){
 const response=await fetch('/api/beta'+query,{method:data?'POST':'GET',credentials:'same-origin',headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(15000)});
 const body=await response.json();if(!response.ok)throw Error(body.error||'Could not save this memory. Your text is kept here.');return body;
}
export default function StudentMemoryPanel({actor,chat,course,courseLabel,initialOpen=false,onBusy}:{actor:string;chat:string|null;course:string|null;courseLabel:string;initialOpen?:boolean;onBusy?:(busy:boolean)=>void}){
 const {t:ui}=useI18n();
 const browserCopies=useBrowserCopies();
 async function request(query:string,data?:unknown){if(!browserCopies.canWrite())throw Error('Browser work is paused. Reopen saved account data before continuing.');const result=await rawRequest(query,data);if(!browserCopies.canWrite())throw Error('Browser work is paused. Reopen saved account data before continuing.');return result;}
 const [open,setOpen]=useState(initialOpen),[rows,setRows]=useState<StudentMemory[]>([]),[loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[loaded,setLoaded]=useState(false);
 const [body,setBody]=useState(''),[kind,setKind]=useState<MemoryKind>('choice'),[scope,setScope]=useState<Scope>(course?'course':chat?'chat':'all'),[editing,setEditing]=useState<StudentMemory|null>(null);
 const [forgetTarget,setForgetTarget]=useState<StudentMemory|null>(null);
 const [error,setError]=useState(''),[status,setStatus]=useState('');
 const [restored,setRestored]=useState(false);
 const alive=useRef(true),reading=useRef(0),mutating=useRef(false),requestId=useRef(''),input=useRef<HTMLTextAreaElement>(null);
 const draftKey='schoolvault-memory-draft-v1:'+actor+':'+(chat||'new')+':'+(course||'all');
 const inputId=useId();
 useEffect(()=>{
  alive.current=true;requestId.current=crypto.randomUUID();
  try{const old=JSON.parse(sessionStorage.getItem(draftKey)||'null');if(typeof old?.body==='string'&&old.body.length<=1600){setBody(old.body);if(old.kind in kindLabels)setKind(old.kind);if(['chat','course','all'].includes(old.scope))setScope(old.scope);if(old.editing?.id&&Number.isSafeInteger(old.editing.revision))setEditing(old.editing);if(typeof old.request_id==='string')requestId.current=old.request_id;setStatus('Unsaved memory text restored.');}}
  catch{ /* A storage error does not prevent the current form from working. */ }
  setRestored(true);
  return()=>{alive.current=false;reading.current++;};
 },[draftKey]);
 useEffect(()=>{if(!restored||!browserCopies.canWrite())return;try{if(body.trim())sessionStorage.setItem(draftKey,JSON.stringify({body,kind,scope,editing,request_id:requestId.current}));else sessionStorage.removeItem(draftKey);}catch{/* Preserve the current on-screen edit even when browser storage is unavailable. */}},[body,kind,scope,editing,draftKey,restored]);
 useEffect(()=>{onBusy?.(saving);},[saving,onBusy]);
 useEffect(()=>{if(initialOpen)void load();},[]);
 async function load(){
  const read=++reading.current;setLoading(true);setError('');
  try{const result=await request('?op=memory'+(chat?'&chat='+chat:'')+(course?'&course='+course:''));if(alive.current&&read===reading.current){setRows(result.memories);setLoaded(true);}}
  catch(e){if(alive.current&&read===reading.current)setError((e as Error).message);}
  finally{if(alive.current&&read===reading.current)setLoading(false);}
 }
 function clear(){setBody('');setKind('choice');setScope(course?'course':chat?'chat':'all');setEditing(null);requestId.current=crypto.randomUUID();}
 async function save(){
  if(mutating.current||!body.trim())return;mutating.current=true;setSaving(true);setError('');setStatus('');reading.current++;
  try{
   const row:StudentMemory=await request('',{op:'memory.save',...(editing?{id:editing.id,revision:editing.revision}:{request_id:requestId.current}),body,kind,chat_id:scope==='chat'?chat:null,course_id:scope==='all'?null:course});
   if(alive.current){setRows(current=>[row,...current.filter(item=>item.id!==row.id)]);clear();setStatus('Memory saved. Future answers can use it.');setLoaded(true);}
  }catch(e){if(alive.current)setError((e as Error).message);}
  finally{mutating.current=false;if(alive.current){setSaving(false);setLoading(false);}}
 }
 async function forget(row:StudentMemory){
  if(mutating.current)return;
  setForgetTarget(null);
  mutating.current=true;setSaving(true);setError('');setStatus('');reading.current++;
  try{await request('',{op:'memory.forget',id:row.id,revision:row.revision});if(alive.current){setRows(current=>current.filter(item=>item.id!==row.id));if(editing?.id===row.id)clear();setStatus('Saved memory removed. Existing chats and notes remain.');}}
  catch(e){if(alive.current)setError((e as Error).message);}
  finally{mutating.current=false;if(alive.current){setSaving(false);setLoading(false);}}
 }
 function edit(row:StudentMemory){setEditing(row);setBody(row.body);setKind(row.kind);setScope(row.chat_id?'chat':row.course_id?'course':'all');setError('');setStatus('');input.current?.focus();}
 return <details className="beta-student-memory" data-memory-course={course||''} open={open} onToggle={e=>{const next=e.currentTarget.open;setOpen(next);if(next&&!loaded&&!loading)void load();}}>
  <summary>{ui("What should I remember?")}</summary>
  <p>{ui("Save your choices, corrections and study preferences for future answers. Personal progress stays separate from Moodle receipts.")}</p>
  <div className="beta-memory-list" aria-busy={loading}>
   {loading&&<p role="status">{ui("Loading your memories…")}</p>}
   {loaded&&!rows.length&&<p>{ui("No memories saved here yet. For example: “Explain one step at a time and use the notation in my course notes.”")}</p>}
   {rows.map(row=><div key={row.id} className="beta-memory-item"><small>{ui(kindLabels[row.kind])} · {row.chat_id?ui("This chat"):row.course_id?courseLabel:ui("All my chats")}</small><p>{row.body}</p><div><button type="button" disabled={saving} aria-label={ui("Edit")+' '+ui(kindLabels[row.kind]).toLowerCase()} onClick={()=>edit(row)}>{ui("Edit")}</button><button type="button" disabled={saving} aria-label={ui("Forget")+' '+ui(kindLabels[row.kind]).toLowerCase()} onClick={()=>setForgetTarget(row)}>{ui("Forget")}</button></div></div>)}
  </div>
  {forgetTarget&&<section className="nu-memory-confirm" role="alertdialog" aria-labelledby={inputId+'-forget'} aria-describedby={inputId+'-forget-details'}><h3 id={inputId+'-forget'}>{ui("Forget this saved")} {kindLabels[forgetTarget.kind].toLowerCase()}?</h3><p>{forgetTarget.body}</p><p id={inputId+'-forget-details'}>{ui("This removes the memory record permanently. Existing chats and notes remain and may still provide context.")}</p><div><button autoFocus type="button" onClick={()=>setForgetTarget(null)}>{ui("Cancel")}</button><button type="button" disabled={saving} onClick={()=>void forget(forgetTarget)}>{ui("Forget this memory")}</button></div></section>}
  <form onSubmit={e=>{e.preventDefault();void save();}}>
   <div className="beta-memory-options"><label>{ui("Kind")}<select aria-label={ui("Kind")} value={kind} disabled={saving} onChange={e=>setKind(e.target.value as MemoryKind)}>{Object.entries(kindLabels).map(([key,label])=><option key={key} value={key}>{ui(label)}</option>)}</select></label><label>{ui("Use in")}<select aria-label={ui("Use in")} value={scope} disabled={saving} onChange={e=>setScope(e.target.value as Scope)}>{chat&&<option value="chat">{ui("This chat")}</option>}{course&&<option value="course">{courseLabel}</option>}<option value="all">{ui("All my chats")}</option></select></label></div>
   <div className="beta-memory-field"><label htmlFor={inputId}>{editing?ui("Edit memory"):ui("What should I keep in mind?")}</label><textarea id={inputId} name="memory-text" autoComplete="off" ref={input} rows={3} value={body} maxLength={1600} disabled={saving} onChange={e=>setBody(e.target.value)} placeholder={ui("My choice, correction or preference…")}/></div>
   <div className="beta-memory-actions"><button className="beta-primary" disabled={saving||!body.trim()}>{saving?ui("Saving…"):editing?ui("Save changes"):ui("Save memory")}</button>{editing&&<button type="button" disabled={saving} onClick={clear}>{ui("Cancel edit")}</button>}<button type="button" disabled={saving||loading} onClick={()=>void load()}>{ui("Reload memories")}</button></div>
  </form>
  {error&&<p role="alert">{ui(error)}  {ui("Your edit remains above.")}</p>}{status&&<p role="status">{ui(status)}</p>}
  <small>{ui("Forget removes the saved record. Existing messages and notes may still provide context. Only relevant memories and saved work fit each answer.")}</small>
 </details>;
}

'use client';
import {useI18n} from "./language";

import {useEffect,useRef,useState} from 'react';
import StudentMemoryPanel from './student-memory';
export default function MemoryManager({actor,chat,course,courses,trigger,onClose}:{actor:string;chat:string|null;course:string|null;courses:{id:string;code:string}[];trigger:HTMLElement|null;onClose:()=>void}){
 const {t:ui}=useI18n();
 const dialog=useRef<HTMLDialogElement>(null);const [scope,setScope]=useState(chat?'current':course||'all');
 const [busy,setBusy]=useState(false);
 const selectedCourse=scope==='current'?course:scope==='all'?null:scope;
 const label=courses.find(c=>c.id===selectedCourse)?.code||'All courses';
 useEffect(()=>{dialog.current?.showModal();return()=>{dialog.current?.close();if(trigger?.isConnected)trigger.focus();};},[]);
 return <dialog ref={dialog} className="nu-memory-dialog" aria-labelledby="nu-memory-title" onCancel={e=>{e.preventDefault();if(!busy)onClose();}}>
  <header><div><h2 id="nu-memory-title">{ui("Remembered information")}</h2><p>{ui("Review what Neyvu can keep in mind.")}</p></div><button onClick={onClose} disabled={busy} autoFocus>{ui("Close")}</button></header>
  <label className="nu-memory-scope">{ui("Review scope")}<select disabled={busy} value={scope} onChange={e=>setScope(e.target.value)}>{chat&&<option value="current">{ui("Current chat and its course")}</option>}<option value="all">{ui("Shared across all chats")}</option>{courses.map(c=><option key={c.id} value={c.id}>{c.code}  {ui("and shared memories")}</option>)}</select></label>
  <StudentMemoryPanel key={scope} initialOpen onBusy={setBusy} actor={actor} chat={scope==='current'?chat:null} course={selectedCourse} courseLabel={label}/>
 </dialog>;
}

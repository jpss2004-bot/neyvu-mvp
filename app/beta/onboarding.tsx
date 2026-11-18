'use client';
import {useI18n} from "./language";

import {useEffect,useState} from 'react';
type Progress={companion:boolean;moodle:boolean;courses:boolean;material:boolean;answer:boolean;note:boolean};
export default function Onboarding({revision,onNavigate,showCompleted=false}:{revision:string;onNavigate:(tab:string)=>void;showCompleted?:boolean}){
 const {t:ui}=useI18n();
 const [progress,setProgress]=useState<Progress|null>(null),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[expanded,setExpanded]=useState(false);
 useEffect(()=>{const controller=new AbortController();fetch('/api/beta/onboarding',{cache:'no-store',signal:controller.signal}).then(async r=>{if(!r.ok)throw Error();return r.json();}).then(value=>{setProgress(value);setError('');}).catch(()=>{if(!controller.signal.aborted)setError('Setup status could not refresh. Your saved work is still available.');});return()=>controller.abort();},[revision,refresh]);
 if(!progress&&!showCompleted)return null;
 if(!progress)return <div className="nu-onboarding" role="status">{ui(error)||ui("Checking your setup…")}{error&&<button onClick={()=>setRefresh(v=>v+1)}>{ui("Retry setup check")}</button>}</div>;
 const steps=[{title:'Sign in with your Google account',done:true,tab:'',action:''},{title:'Add readable course material',done:progress.material,tab:'sources',action:'Add files or a folder'},{title:'Ask your first course question',done:progress.answer,tab:'chat',action:'Open Conversation'},{title:'Save a course note',done:progress.note,tab:'notes',action:'Open Notebook'}];
 const completed=steps.filter(s=>s.done).length,next=steps.findIndex(s=>!s.done);
 if(completed===steps.length&&!showCompleted)return null;
 return <details className="nu-onboarding" open={expanded} onToggle={e=>setExpanded(e.currentTarget.open)}><summary>{ui("Getting started ·")} {completed}  {ui("of")} {steps.length}  {ui("steps done")}</summary><p>{ui("These are saved setup milestones, not a freshness check. Moodle can be connected separately. This updates when you return. Readable material and saved answers still need your review.")}</p>{error&&<p role="status">{ui(error)}</p>}<ol>{steps.map((step,index)=><li key={ui(step.title)}><span className="nu-setup-state">{step.done?ui("Ready"):index===next?ui("Next step"):ui("To do")}</span><strong>{ui(step.title)}</strong>{step.action&&<button onClick={()=>onNavigate(step.tab)}>{ui(step.action)}</button>}</li>)}</ol><p>{ui("Get the Windows Companion from Microsoft Store using the setup guide. Mac downloads are still being qualified. On your phone, use saved material, notes and conversations.")}</p><a href="/beta/start">{ui("Full first-session guide")}</a><button onClick={()=>setRefresh(v=>v+1)}>{ui("Refresh setup status")}</button><p>{ui("You can start with files or notes. Automatic Moodle updates need the Companion on a connected computer.")}</p><button onClick={()=>onNavigate('connection')}>{progress.moodle?ui("Review Moodle connection"):ui("Connect Moodle")}</button></details>;
}

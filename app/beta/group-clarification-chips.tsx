'use client';
import {useRef,useState} from 'react';
import type {GroupClarification} from '../../lib/beta/group-clarification';
import {useI18n} from './language';

// Quick replies for a group clarification. A choice is saved for the course as
// student-reported (not Moodle-verified), then the original question is asked
// again so the answer uses only that group's requirements.
export default function GroupClarificationChips({messageId,clarification,disabled=false,onChosen}:{messageId:string;clarification:GroupClarification;disabled?:boolean;onChosen:(choice:string)=>Promise<void>|void}){
 const {t:ui}=useI18n();
 const [busy,setBusy]=useState(''),[error,setError]=useState('');
 const request=useRef<{choice:string;id:string}|null>(null);
 async function choose(choice:string){
  if(busy||disabled)return;setBusy(choice);setError('');
  try{
   if(request.current?.choice!==choice)request.current={choice,id:crypto.randomUUID()};
   const response=await fetch('/api/beta',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'group.clarify',message_id:messageId,choice,request_id:request.current.id})});
   const row=await response.json();if(!response.ok)throw Error(row.error||'Your group could not be saved.');
   await onChosen(choice);
  }catch(e){setError(e instanceof Error?e.message:'Your group could not be saved.');}finally{setBusy('');}
 }
 return <section className="nu-group-clarification" aria-label={ui(clarification.question)}>
  <div className="nu-group-clarification-options" role="group" aria-label={ui(clarification.question)}>
   {clarification.options.map(option=><button key={option.name} type="button" disabled={disabled||!!busy} aria-busy={busy===option.name||undefined} onClick={()=>choose(option.name)}>{option.name}</button>)}
  </div>
  <p className="nu-group-clarification-note">{ui('Saved for this course as student-reported. You can change it later in course groups.')}</p>
  {error&&<p role="alert">{ui(error)}</p>}
 </section>;
}

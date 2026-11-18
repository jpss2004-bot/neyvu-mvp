'use client';
import {useI18n} from "../language";

import {useEffect,useRef,useState,type FormEvent} from 'react';
type Student={id:string;email:string;name:string;origin:string;access_state:string;joined_at:string|null;has_companion:boolean};
async function write(body:unknown,method='POST'){
 const r=await fetch('/api/beta/admin/students',{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 const data=await r.json();if(!r.ok)throw Error(data.error||'This action could not finish.');return data;
}
export default function PilotStudents({revision,onChange}:{revision:number;onChange:()=>void}){
 const {t:ui}=useI18n();
 const [students,setStudents]=useState<Student[]|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[failed,setFailed]=useState(false),[review,setReview]=useState<Student|null>(null);
 const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLElement|null>(null);
 async function refresh(){const r=await fetch('/api/beta/admin/students',{cache:'no-store',signal:AbortSignal.timeout(15000)}),data=await r.json();if(!r.ok)throw Error(data.error||'Students could not load.');setStudents(data.students);}
 useEffect(()=>{refresh().catch(error=>{setFailed(true);setMessage(error.message);});},[revision]);
 useEffect(()=>{if(review)dialog.current?.showModal();else{dialog.current?.close();trigger.current?.focus();}},[review]);
 async function invite(e:FormEvent<HTMLFormElement>){
  e.preventDefault();const form=e.currentTarget,fields=new FormData(form);setBusy(true);setMessage('');setFailed(false);
  try{const data=await write({name:fields.get('name'),email:fields.get('email'),language:fields.get('language'),eligibility_confirmed:fields.get('eligibility')==='on'});setMessage(data.message+' '+data.email.message);form.reset();await refresh();onChange();}
  catch(error){setFailed(true);setMessage(error instanceof Error?error.message:'Invitation could not finish. Refresh before repeating it.');}
  finally{setBusy(false);}
 }
 async function change(){if(!review)return;setBusy(true);setMessage('');setFailed(false);
  try{const data=await write({id:review.id,state:review.access_state==='suspended'?'active':'suspended'},'PATCH');setMessage(data.message);setReview(null);await refresh();onChange();}
  catch(error){setFailed(true);setMessage(error instanceof Error?error.message:'Access could not be changed.');}finally{setBusy(false);}
 }
 return <section className="sv-admin-dashboard" aria-labelledby="students-title"><h2 id="students-title">{ui("Students")}</h2><p>{ui("Invite a student with their own Google account. Access is separate from email delivery; signing in creates their private workspace.")}</p>
  <form className="sv-admin-form sv-invite-form" onSubmit={invite} aria-busy={busy}><label>{ui("Student name")}<input name="name" required maxLength={100} disabled={busy} autoComplete="name"/></label><label>{ui("Google account email")}<input name="email" type="email" inputMode="email" autoCapitalize="none" spellCheck={false} required disabled={busy} autoComplete="email"/></label><label>{ui("Email language")}<select name="language" defaultValue="en" disabled={busy}><option value="en">English</option><option value="es">Español</option></select></label><label className="sv-invite-check"><input name="eligibility" type="checkbox" required disabled={busy}/>{ui("I reviewed this student’s eligibility for Neyvu at Acadia.")}</label><button className="sv-button" disabled={busy}>{busy?ui("Working…"):ui("Create access and send invitation")}</button></form>
  {message&&<p className="sv-feedback" role={failed?'alert':'status'}>{ui(message)}</p>}<button className="sv-button sv-secondary" disabled={busy} onClick={()=>refresh().catch(error=>{setFailed(true);setMessage(error.message);})}>{ui("Refresh students")}</button>
  <p className="sv-hint">{ui("Only contact details and basic setup status appear here. Student notes, chats and course materials stay private. Latest 200 approved students.")}</p>
  {students===null?<p>{failed?ui("Students could not load. Use Refresh students."):ui("Loading students…")}</p>:students.length===0?<p>{ui("No approved students yet.")}</p>:students.map(student=><article className="sv-admission" key={student.id}><div><strong>{student.name}</strong><span>{student.email}</span><p>{student.access_state==='suspended'?ui("Access suspended"):student.joined_at?ui("Joined"):ui("Not signed in yet")} · {student.has_companion?ui("Companion connected"):ui("Companion not connected")}</p><small>{student.origin==='invitation'?ui("Invited by admin"):student.origin==='existing'?ui("Existing account"):ui("Approved request")}</small></div><button className="sv-button sv-secondary" disabled={busy} onClick={e=>{trigger.current=e.currentTarget;setReview(student);}}>{student.access_state==='suspended'?ui("Review restoration"):ui("Review suspension")}</button></article>)}
  <dialog ref={dialog} className="sv-access-review" aria-labelledby="access-review-title" onCancel={e=>{e.preventDefault();if(!busy)setReview(null);}}><h2 id="access-review-title">{review?.access_state==='suspended'?ui("Restore access?"):ui("Suspend access?")}</h2><p>{review?.email}</p><p>{review?.access_state==='suspended'?ui("The student can sign in again and reconnect their Companion. Old sessions and connections remain revoked."):ui("This signs the student out, disconnects their Companion and cancels queued or running AI work. Saved study data is retained.")}</p><div className="sv-admission-actions"><button className="sv-button sv-secondary" disabled={busy} onClick={()=>setReview(null)}>{ui("Cancel")}</button><button className="sv-button" disabled={busy} onClick={change}>{busy?ui("Saving…"):review?.access_state==='suspended'?ui("Restore access"):ui("Suspend access")}</button></div></dialog>
 </section>;
}

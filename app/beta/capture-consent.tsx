'use client';
import {useEffect,useState} from 'react';
// E5: per-course recording attestation. Recording stays off for a course until the learner
// confirms the instructor's prior permission or a registered accommodation and accepts the
// personal-use terms. No medical or disability detail is asked for.
type Consent={id:string;course_id:string;basis:string;instructor_name:string|null;permission_date:string|null};
export default function CaptureConsentPanel({user,course,disabled,onChange}:{user:string;course:string;disabled?:boolean;onChange:(active:boolean)=>void}){
 const [terms,setTerms]=useState<string[]>([]),[version,setVersion]=useState(''),[consents,setConsents]=useState<Consent[]>([]),[basis,setBasis]=useState('instructor_permission'),[status,setStatus]=useState('');
 const [enabled,setEnabled]=useState<boolean|null>(null),[legacy,setLegacy]=useState(false);
 const [name,setName]=useState(''),[date,setDate]=useState(''),[personal,setPersonal]=useState(false),[classmates,setClassmates]=useState(false);
 async function load(){const r=await fetch('/api/beta/classes?consents=1',{credentials:'same-origin',headers:{'X-Class-Account':user}});const j=await r.json().catch(()=>({}));if(r.ok){setEnabled(j.enabled!==false);setTerms(j.terms);setVersion(j.terms_version);setConsents(j.consents);}}
 useEffect(()=>{void load();},[user]);
 const active=consents.find(c=>c.course_id===course);
 useEffect(()=>{onChange(enabled===false?legacy:!!active);},[active,onChange,enabled,legacy]);
 async function post(body:object){setStatus('');const r=await fetch('/api/beta/classes',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Class-Account':user},body:JSON.stringify(body)});const j=await r.json().catch(()=>({}));if(!r.ok){setStatus(j.error||'Could not save.');return;}await load();}
 // Consent flow off (SCHOOL_BETA_CAPTURE_CONSENT): keep main's single permission checkbox.
 if(enabled===false)return <label className="beta-class-permission"><input type="checkbox" checked={legacy} disabled={disabled} onChange={e=>setLegacy(e.target.checked)}/>I have permission to record and process this class.</label>;
 if(!course)return <p className="beta-class-help">Choose a course to see whether recording is on for it.</p>;
 if(active)return <div className="beta-class-permission" style={{display:'block'}}><p>Recording is <b>on</b> for this course ({active.basis==='instructor_permission'?`permission from ${active.instructor_name} on ${String(active.permission_date).slice(0,10)}`:'registered accommodation'}). Personal study use only.</p>
  <button type="button" disabled={disabled} onClick={()=>void post({action:'revoke_consent',course_id:course})}>Turn recording off for this course</button><p role="status">{status}</p></div>;
 return <fieldset disabled={disabled} style={{border:'1px solid #8886',borderRadius:8,padding:10}}><legend>Recording is off for this course</legend>
  <p>You may record only with the instructor’s prior permission or a registered accommodation.</p>
  <label><input type="radio" name="basis" checked={basis==='instructor_permission'} onChange={()=>setBasis('instructor_permission')}/> The instructor gave me permission</label>
  {basis==='instructor_permission'&&<div style={{display:'flex',gap:8,flexWrap:'wrap'}}><label>Instructor<input value={name} maxLength={160} onChange={e=>setName(e.target.value)}/></label><label>Date of permission<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label></div>}
  <label><input type="radio" name="basis" checked={basis==='registered_accommodation'} onChange={()=>setBasis('registered_accommodation')}/> I have a registered accommodation that includes recording</label>
  <ul>{terms.map(t=><li key={t}>{t}</li>)}</ul>
  <label><input type="checkbox" checked={personal} onChange={e=>setPersonal(e.target.checked)}/> I will use recordings for my personal study only</label>
  <label><input type="checkbox" checked={classmates} onChange={e=>setClassmates(e.target.checked)}/> I will stop or delete a recording if the instructor or a classmate asks</label>
  <button type="button" disabled={!personal||!classmates||(basis==='instructor_permission'&&(!name.trim()||!date))} onClick={()=>void post({action:'consent',course_id:course,basis,instructor_name:name,permission_date:date,personal_use:personal,classmates,terms_version:version})}>Turn on recording for this course</button>
  <p role="status">{status}</p><p className="beta-class-help"><a href="/beta/recording-takedown">How instructors and classmates can ask for a recording to be removed</a></p>
 </fieldset>;
}

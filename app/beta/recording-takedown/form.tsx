'use client';
import {useState} from 'react';
export default function TakedownForm(){
 const [status,setStatus]=useState('');const [busy,setBusy]=useState(false);
 return <form style={{display:'grid',gap:10}} onSubmit={async e=>{e.preventDefault();setBusy(true);const f=Object.fromEntries(new FormData(e.currentTarget));
  const r=await fetch('/api/beta/recording-takedown',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(f)});const j=await r.json().catch(()=>({}));
  setBusy(false);setStatus(r.ok?`Received. Reference ${j.reference}. We will contact you at the address you gave.`:j.error||'Could not send. Try again.');if(r.ok)e.currentTarget.reset();}}>
  <label>I am the<select name="requester_role" required defaultValue="instructor"><option value="instructor">Instructor</option><option value="classmate">Classmate</option><option value="institution">Institution</option><option value="learner">Learner who recorded</option><option value="other">Other</option></select></label>
  <label>How to reach you (email)<input name="contact" type="email" required maxLength={254}/></label>
  <label>Course (code and section)<input name="course" required maxLength={200}/></label>
  <label>Class date, if known<input name="class_date" type="date"/></label>
  <label>Details<textarea name="details" maxLength={4000} rows={4}/></label>
  <button disabled={busy}>Send request</button><p role="status">{status}</p>
 </form>;
}

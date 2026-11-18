'use client';
import {useState} from 'react';
export default function AssistantConsent({clientName,redirectHost,params}:{clientName:string;redirectHost:string;params:Record<string,string>}){
 const [status,setStatus]=useState('');const [busy,setBusy]=useState(false);
 async function decide(decision:'approve'|'deny'){
  setBusy(true);setStatus('');
  const r=await fetch('/api/oauth/authorize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({decision,params})});
  const j=await r.json().catch(()=>({}));if(r.ok&&j.redirect){location.href=j.redirect;return;}setBusy(false);setStatus(j.error||'Could not finish.');
 }
 return <section>
  <p><b>{clientName}</b> will be able to <b>read</b>, for you only:</p>
  <ul><li>your courses and upcoming deadlines (as Neyvu last saw them; never proof of submission)</li><li>passages from your saved sources, with citations</li><li>your institution&apos;s approved guidance that applies to you</li></ul>
  <p>It cannot change, submit or delete anything. You can disconnect it at any time in Neyvu. After you allow, you return to <code>{redirectHost}</code>.</p>
  <p style={{display:'flex',gap:8}}><button disabled={busy} onClick={()=>decide('approve')}>Allow read access</button><button disabled={busy} onClick={()=>decide('deny')}>Deny</button></p>
  <p role="status">{status}</p>
 </section>;
}

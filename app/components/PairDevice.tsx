'use client';
import {useState,useRef} from 'react';
import {GraduationCap,ArrowRight} from 'lucide-react';
export default function PairDevice(){
 const codeInput=useRef<HTMLInputElement>(null);
 const [code,setCode]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 return <main className="pair-screen"><div className="pair-card"><div className="brand-icon"><GraduationCap size={28}/></div><p className="pair-context">School for Acadia</p><h1>Bring your courses with you.</h1><p>On your desktop, open Account → Pair a device. Enter the six-digit code here.</p><form onSubmit={async e=>{e.preventDefault();setBusy(true);try{const r=await fetch('/api/pilot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'login',code})});const d=await r.json();if(!r.ok)throw Error(d.error);location.reload();}catch(e){setError(e instanceof Error?e.message:'Pairing failed. Request a new code from Account.');codeInput.current?.focus();}finally{setBusy(false);}}}><label htmlFor="code">Pairing code</label><input ref={codeInput} id="code" name="code" spellCheck={false} aria-invalid={!!error} aria-describedby="pair-error" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,6))} inputMode="numeric" autoComplete="one-time-code" required minLength={6}/><button className="button" disabled={busy}>{busy?'Connecting…':'Open my workspace'}<ArrowRight size={17}/></button></form><p id="pair-error" className="form-error" role="alert">{error}</p></div></main>;
}

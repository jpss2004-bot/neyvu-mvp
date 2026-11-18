'use client';
import {useI18n} from "./language";

import {useId,useState,type FormEvent} from 'react';
// Reviewer access: the code opens a separate demo account with synthetic data only.
export default function DemoEntry({next='/beta',open=false}:{next?:string;open?:boolean}){
 const {t:ui}=useI18n();
 const [code,setCode]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const fieldId=useId(),helpId=fieldId+'-help',errorId=fieldId+'-error';
 async function submit(event:FormEvent){
  event.preventDefault();if(busy)return;setBusy(true);setError('');
  try{
   const r=await fetch('/api/beta/demo',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'start',code:code.trim()}),signal:AbortSignal.timeout(30000)});
   const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'The demo account could not open. Try again.');
   setCode('');window.location.assign(next);
  }catch(e){setError(e instanceof Error&&e.name!=='TimeoutError'&&e.name!=='AbortError'?e.message:'The demo account could not open. Try again.');setBusy(false);}
 }
 return <details className="beta-demo-entry" open={open}><summary>{ui("Reviewer demo access")}</summary><p id={helpId}>{ui("Enter the demo access code to open a separate demo account. It contains synthetic sample data only, and no Google account is needed.")}</p><form onSubmit={submit}><label htmlFor={fieldId}>{ui("Demo access code")}</label><input id={fieldId} name="demo_code" type="password" value={code} readOnly={busy} onChange={e=>{setCode(e.target.value);setError('');}} aria-describedby={helpId+(error?' '+errorId:'')} aria-invalid={error?true:undefined} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={256} required/>{error&&<p id={errorId} role="alert" className="beta-alert">{ui(error)}</p>}<button type="submit" className="beta-primary" disabled={busy||!code.trim()}>{busy?ui("Opening the demo…"):ui("Open the demo account")}</button>{busy&&<p role="status">{ui("Opening the demo account…")}</p>}</form></details>;
}

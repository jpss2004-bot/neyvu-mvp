'use client';
import {useI18n} from "../language";

import {useState,type FormEvent} from 'react';
export default function RequestForm({ready}:{ready:boolean}){
 const {t:ui,language}=useI18n();
 const [busy,setBusy]=useState(false),[sent,setSent]=useState(false),[message,setMessage]=useState('');
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();const form=new FormData(event.currentTarget);setBusy(true);setMessage('');
  try{const response=await fetch('/api/beta/access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:form.get('name'),email:form.get('email'),website:form.get('website'),acadia_student:form.has('acadia'),consent:form.has('consent')}),signal:AbortSignal.timeout(20000)});const data=await response.json();if(!response.ok)throw Error(data.error||'Your request could not be saved. Try again.');setSent(true);setMessage(data.message);}catch(error){setMessage(error instanceof Error&&error.name!=='TimeoutError'?error.message:'The connection timed out. Check your connection and try again; repeating a request will not create another account.');}finally{setBusy(false);}
 }
 if(sent)return <div className="sv-request-result" role="status"><h3>{ui("Request recorded.")}</h3><p>{ui(message)}</p><p>{ui("Approval is manual. No account or Moodle connection has been created yet.")}</p><a className="sv-button" href="/beta">{ui("Return to sign in")}</a></div>;
 return <form onSubmit={submit} className="sv-request-form" aria-busy={busy}>
  <label>{ui("Your name")}<input name="name" autoComplete="name" maxLength={100} required disabled={busy||!ready}/></label>
  <label>{ui("Google account email")}<input name="email" type="email" inputMode="email" autoCapitalize="none" spellCheck={false} autoComplete="email" maxLength={254} required disabled={busy||!ready} aria-describedby="sv-google-hint"/></label>
  <p id="sv-google-hint" className="sv-hint">{ui("Use the same Google account when you sign in after approval. It can be your personal Gmail.")}</p>
  <div className="sv-honeypot" aria-hidden="true"><label>{ui("Website")}<input name="website" tabIndex={-1} autoComplete="off"/></label></div>
  <label className="sv-check"><input name="acadia" type="checkbox" required disabled={busy||!ready}/><span>{ui("I currently study at Acadia University.")}</span></label>
  <label className="sv-check"><input name="consent" type="checkbox" required disabled={busy||!ready}/><span>{ui("Store my name and email to review this request.")} <a href="/beta/join/privacy">{ui("How my data is used")}</a></span></label>
  <p className="sv-hint">{language==='es'?'Antes de solicitar acceso, consulta los ':'Before requesting access, read the '}<a href="/beta/join/terms">{language==='es'?'términos y condiciones':'terms and conditions'}</a>{language==='es'?' y el ':' and '}<a href="/beta/join/privacy">{language==='es'?'aviso de privacidad':'privacy notice'}</a>.</p>
  <button className="sv-button" disabled={busy||!ready}>{busy?ui("Saving your request…"):ui("Request access")}</button>
  {!ready&&<p role="status" className="sv-hint">{ui("Access requests are being prepared. Please check back here before sharing this page.")}</p>}
  {message&&<p role="alert" className="sv-feedback">{ui(message)}</p>}
 </form>;
}

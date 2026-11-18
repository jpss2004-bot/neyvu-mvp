'use client';
import {useI18n} from "../language";

import {useEffect,useRef,useState} from 'react';
import DemoEntry from '../demo-entry';
// After the handoff the browser waits for the companion on this PC, whose call to SchoolVault can take up to
// 30 s; companion 0.2.0 shows no error in its own window. A pilot student's first session (2026-10-01) sat on "Connecting…"
// with no message, so the page now says what to check while it waits.
const SLOW_MS=10000,STALLED_MS=40000;
type Wait=''|'handoff'|'slow'|'stalled';
export default function ConnectDesktop({port,state,email,demo=false,demoEntry=false,next}:{port:string;state:string;email:string|null;demo?:boolean;demoEntry?:boolean;next:string}){
 const {t:ui}=useI18n();
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[wait,setWait]=useState<Wait>('');
 const timers=useRef<number[]>([]);
 useEffect(()=>()=>timers.current.forEach(clearTimeout),[]);
 async function connect(){if(busy)return;timers.current.forEach(clearTimeout);setBusy(true);setError('');setWait('');try{
  const response=await fetch('/api/beta/companion',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'pair'}),signal:AbortSignal.timeout(15000)});const data=await response.json();if(!response.ok)throw Error(data.error||'Could not connect this laptop.');
  // A top-level form handoff avoids exposing a token to page URLs, clipboard or CORS.
  const form=document.createElement('form');form.method='POST';form.action='http://127.0.0.1:'+port+'/connect';
  for(const [name,value] of Object.entries({state,code:data.code})){const field=document.createElement('input');field.type='hidden';field.name=name;field.value=String(value);form.append(field);}document.body.append(form);form.submit();
  setWait('handoff');
  timers.current=[window.setTimeout(()=>setWait('slow'),SLOW_MS),window.setTimeout(()=>{setWait('stalled');setBusy(false);},STALLED_MS)];
 }catch(e){setError(e instanceof Error&&e.name!=='TimeoutError'&&e.name!=='AbortError'?e.message:'The connection took too long. Keep the companion open, check your internet and try again.');setBusy(false);}}
 const label=busy?(wait?'Waiting for the companion…':'Connecting…'):wait==='stalled'?'Try again':'Connect this laptop';
 return <><h1>{ui("Connect this laptop.")}</h1>{email?<>{demo&&<p className="beta-demo-banner" role="note"><strong>{ui("Demo data — not a real student account")}</strong></p>}<p>{ui("You are signed in as")} <strong>{email}</strong>.</p><p>{demo?ui("This companion will connect to the demo account, which holds synthetic sample data only. The companion’s Moodle step needs a real student account; for the demo, use Run a simulated collection on the Neyvu Moodle page instead."):ui("This companion can add Moodle material to this account’s private vault. Your Moodle password stays on this laptop.")}</p>{error&&<p role="alert" className="beta-alert">{ui(error)}</p>}
  {wait==='slow'&&<p role="status" aria-live="polite">{ui("Still waiting for Neyvu Companion on this computer. Keep its window open; finishing can take up to 30 seconds.")}</p>}
  {wait==='stalled'&&<div role="alert" className="beta-alert beta-handoff-help"><p><strong>{ui("The companion on this computer hasn’t answered.")}</strong></p><ul><li>{ui("Make sure Neyvu Companion is still open. If you chose “Open sign-in again” in the companion, close this tab and use the newest one.")}</li><li>{ui("If your computer blocks the app, keep its protections enabled and record the exact message.")}</li><li>{ui("Otherwise, choose “Open sign-in again” in the companion and use its newest browser tab.")}</li></ul></div>}
  <button className="beta-primary" disabled={busy} onClick={connect}>{label}</button><p><a href={'/beta/auth/start?'+new URLSearchParams({port,state})}>{ui("Choose a different Google account")}</a> · <a href="/beta">{ui("Cancel")}</a></p></>:<><p>{ui("Sign in with the Google account you use for Neyvu. Then confirm the connection here.")}</p><a className="beta-primary" href={'/beta/auth/start?'+new URLSearchParams({port,state})}>{ui("Continue with Google")}</a>{demoEntry&&<DemoEntry next={next}/>}</>}</>;
}

'use client';
import {useI18n} from "./language";

import {useEffect,useRef,useState} from 'react';
type Fact={kind:string;origin?:string;quote:string;context:string;interpretation:string;review_issue?:string;start_line:number;end_line:number;unit:string|null};
type Reading={source_id:string;version_id:string;current:boolean;enabled:boolean;reader_ready:boolean;authority:string;limitations:string[];readable:boolean;profile:null|{state:string;cursor:number;characters:number;sections:number;issues:string[];facts:Fact[];reviewed:false;updated_at:string}};
const labels:Record<string,string>={requirement:'Requirements',rubric:'Assessment criteria',policy:'Course policy',concept:'Concepts',argument:'Main arguments',example:'Examples',uncertainty:'Uncertainty',wording:'Additional source wording'};
async function request(id:string,version:string,write=false){
 const response=await fetch(write?'/api/beta':'/api/beta?op=profile&id='+id+'&version='+version,{method:write?'POST':'GET',credentials:'same-origin',headers:write?{'Content-Type':'application/json'}:{},body:write?JSON.stringify({op:'profile.read',id,version_id:version}):undefined,signal:AbortSignal.timeout(15000)});
 const body=await response.json();if(!response.ok)throw Error(body.error||'Could not check this reading. Your original is still available.');return body as Reading;
}
export default function SourceProfile({id,version}:{id:string;version:string}){
 const {t:ui,locale}=useI18n();
 const [open,setOpen]=useState(false),[reading,setReading]=useState<Reading|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[shown,setShown]=useState(12);
 const alive=useRef(true),sequence=useRef(0),active=useRef(false);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;sequence.current++;};},[id,version]);
 async function check(write=false){
  if(active.current)return;active.current=true;const seq=++sequence.current;setBusy(true);setError('');
  try{const result=await request(id,version,write);if(alive.current&&seq===sequence.current)setReading(result);}
  catch(e){if(alive.current&&seq===sequence.current)setError((e as Error).message);}
  finally{active.current=false;if(alive.current&&seq===sequence.current)setBusy(false);}
 }
 const pending=reading?.enabled===true&&!!reading.profile&&['queued','reading'].includes(reading.profile.state);
 useEffect(()=>{if(!open||!pending||error)return;const timer=setInterval(()=>void check(),5000);return()=>clearInterval(timer);},[open,pending,error,id,version]);
 const p=reading?.profile;
 const status=!p?'Create a reading draft from the full saved text.':p.state==='reading'?'Reading a source section':p.state==='queued'?reading?.reader_ready?'Waiting for local reading. Chat questions have priority.':'Reading queued; waiting for the local reader.':p.state==='failed'?'This reading stopped. Retry to continue from the saved section.':p.state==='paused'?'Background reading paused outside your selected current courses. You can request this source explicitly.':p.state==='stale'?'The source changed; use its current version for current advice.':p.state==='partial'?'Reading draft has gaps or interpretations to review.':'Reading draft ready. Review its quotations and interpretations.';
 return <details className="beta-source-profile" open={open} onToggle={e=>{const next=e.currentTarget.open;setOpen(next);if(next&&!reading&&!busy)void check();}}>
  <summary>{ui("Understand this source")}</summary>
  {busy&&!reading&&<p role="status">{ui("Checking saved reading…")}</p>}
  {reading&&<>
   {!reading.current&&<p role="status">{ui("This reading belongs to an older saved version. It will not apply to the current source.")}</p>}
   <p role="status">{!reading.enabled?ui("Source organization is not available in this release. Your original text and earlier reading drafts remain usable."):ui(status)}</p>
   {p&&<p>{p.cursor.toLocaleString(locale)}  {ui("of")} {p.characters.toLocaleString(locale)}  {ui("saved characters processed ·")} {p.sections} {p.sections===1?ui("section"):ui("sections")}{ui(". This does not verify every meaning or requirement.")}</p>}
   <div className="beta-profile-actions">{reading.enabled&&(!p||['failed','stale','paused'].includes(p.state))&&<button type="button" disabled={busy||!reading.readable} onClick={()=>void check(true)}>{p?ui("Retry reading"):ui("Read and organize this source")}</button>}<button type="button" disabled={busy} onClick={()=>void check()}>{ui("Check progress")}</button></div>
   {!reading.readable&&<p>{ui("The source needs readable text first. Check its original and document-reading status.")}</p>}
   {p?.facts.length? <div className="beta-profile-points">{p.facts.slice(0,shown).map((fact,index)=><section key={index}><h3>{ui(labels[fact.kind]||"Reading point")} <small> · {fact.unit?fact.unit+' · ':''}{ui("Lines")} {fact.start_line}–{fact.end_line}</small></h3><blockquote>{fact.quote}</blockquote>{fact.context!==fact.quote&&<details><summary>{ui("Surrounding source wording")}</summary><p>{fact.context}</p></details>}{fact.interpretation?<p><small>{ui("AI interpretation · Unreviewed")}</small><br/>{fact.interpretation}</p>:<p>{fact.review_issue||(fact.origin==='source_wording'?ui("Found in the original wording; review its full context."):ui("The interpretation needs review; the source wording is preserved."))}</p>}</section>)}<p>{Math.min(shown,p.facts.length)}  {ui("of")} {p.facts.length}  {ui("reading points shown.")}</p>{shown<p.facts.length&&<button type="button" onClick={()=>setShown(value=>value+12)}>{ui("Show more points")}</button>}</div>:p&&p.cursor>0&&<p>{ui("No structured points have been recovered yet. The full saved text remains below.")}</p>}
   {!!p?.issues.length&&<details><summary>{ui("Reading gaps and review needs")}</summary><ul>{p.issues.map(issue=><li key={issue}>{issue}</li>)}</ul></details>}
   <p>{reading.authority==='student_notes'?ui("These are your notes, not official instructor evidence."):''}{ui("This is a draft interpretation of saved text. It does not verify deadlines, grades, receipts or completed work.")}</p>
  </>}
  {error&&<div role="alert"><p>{ui(error)}</p><button type="button" disabled={busy} onClick={()=>void check()}>{ui("Retry check")}</button></div>}
 </details>;
}

'use client';
import {useI18n} from "./language";
import {CheckCircle2,AlertCircle,FolderOpen} from 'lucide-react';
import ActivityStatus from './activity-status';
import {ProductHeading} from './product-ui';


import {useCallback,useEffect,useRef,useState} from 'react';

type ImportStatus={state:'never'|'running'|'ready'|'failed';finished_at?:string;counts?:Record<string,number>;warnings?:string[];generated_outputs_excluded?:string[];skipped_entries?:number;retained_originals_reused?:number;file_io?:{complete:boolean;gap_count:number;elapsed_ms:number|null;gaps:{path:string;reason:string}[]}|null};
type LocalStatus={local:true;import:ImportStatus};
const countLabels=[['courses','Courses'],['notes','Notes'],['sources','Saved sources'],['files','Original files'],['tasks','Saved tasks']] as const;

function isLocalStatus(value:unknown):value is LocalStatus{
 if(!value||typeof value!=='object')return false;
 const status=value as Partial<LocalStatus>;
 return status.local===true&&!!status.import&&['never','running','ready','failed'].includes(status.import.state);
}

async function requestLocal(controller:AbortController,body?:{op:'refresh'}){
 const timeout=setTimeout(()=>controller.abort(),15000);
 try{
  const response=await fetch('/api/beta/local',{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:controller.signal});
  if(!response.ok)throw Error('Local import unavailable');
  return await response.json().catch(()=>null);
 }finally{clearTimeout(timeout);}
}

export default function LocalConnection({onRefresh,onNavigate,timezone}:{onRefresh:()=>void;onNavigate?:(tab:string)=>void;timezone:string}){
 const {t:ui,locale}=useI18n();
 const [status,setStatus]=useState<ImportStatus|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const generation=useRef(0),inFlight=useRef(false),request=useRef<AbortController|null>(null),wasRunning=useRef(false),onRefreshRef=useRef(onRefresh);
 useEffect(()=>{onRefreshRef.current=onRefresh;},[onRefresh]);

 const readStatus=useCallback(async()=>{
  if(inFlight.current)return;
  const current=generation.current,controller=new AbortController();
  inFlight.current=true;request.current=controller;
  try{
   const data=await requestLocal(controller);
   if(generation.current!==current)return;
   if(!isLocalStatus(data))throw Error('Local status unavailable');
   setStatus(data.import);setError('');
   const completed=wasRunning.current&&data.import.state==='ready';
   wasRunning.current=data.import.state==='running';
   if(completed)await onRefreshRef.current();
  }catch{
   if(generation.current===current)setError('The import status could not be checked. Try again.');
  }finally{
   if(generation.current===current){inFlight.current=false;request.current=null;setLoading(false);setBusy(false);}
  }
 },[]);

 useEffect(()=>{
  generation.current++;void readStatus();
  return()=>{generation.current++;request.current?.abort();request.current=null;inFlight.current=false;};
 },[readStatus]);

 useEffect(()=>{
  if(status?.state!=='running')return;
  const timer=setInterval(()=>{if(document.visibilityState!=='hidden')void readStatus();},5000);
  return()=>clearInterval(timer);
 },[status?.state,readStatus]);

 async function refreshVault(){
  if(inFlight.current||status?.state==='running')return;
  const current=generation.current,controller=new AbortController();
  inFlight.current=true;request.current=controller;setBusy(true);setError('');
  try{
   await requestLocal(controller,{op:'refresh'});
   if(generation.current!==current)return;
   wasRunning.current=true;
   setStatus(previous=>({...previous,state:'running'}));
  }catch{
   if(generation.current===current)setError('The refresh could not start. Your saved vault is still available. Try again.');
   return;
  }finally{
   if(generation.current===current){inFlight.current=false;request.current=null;setBusy(false);}
  }
  if(generation.current===current)await readStatus();
 }

 const finished=status?.finished_at?new Date(status.finished_at):null;
 const finishedLabel=finished&&Number.isFinite(finished.getTime())?new Intl.DateTimeFormat(locale,{timeZone:timezone,dateStyle:'medium',timeStyle:'short'}).format(finished):'';
 const counts=countLabels.filter(([key])=>Number.isFinite(status?.counts?.[key]));
 const warningCount=Array.isArray(status?.warnings)?status.warnings.length:0;
 const running=status?.state==='running';

 const gaps=status?.file_io?.gap_count||0,excluded=status?.generated_outputs_excluded||[];
 const stateLabel=!status?'Status unavailable':status.state==='ready'?(gaps?'Updated with source gaps':'Saved material updated'):status.state==='failed'?'Refresh needs attention':'Ready for your first import';
 return <section className="beta-connection nu-vault-workspace">
  <ProductHeading title={ui('Your personal vault')} description={ui('Keep your saved coursework close, and see what still needs checking.')}>
   <button type="button" className="beta-primary" disabled={loading||busy||running} onClick={refreshVault}>{busy||running?ui('Refresh in progress'):ui('Refresh from personal vault')}</button>
  </ProductHeading>
  <div className="nu-vault-layout">
   <div className="nu-vault-main">
    <section className="nu-vault-status" aria-label={ui('Personal vault import')}>
     {loading||busy||running?<ActivityStatus label={running?'Reading saved vault files…':busy?'Starting your refresh…':'Checking your saved vault…'} detail="You can keep using your saved notes, sources and Today." pausable/>:<div className="nu-vault-result">{gaps||status?.state==='failed'||!status?<AlertCircle size={26} aria-hidden="true"/>:<CheckCircle2 size={26} aria-hidden="true"/>}<div><h2 role="status">{ui(stateLabel)}</h2><p>{ui(gaps?'Your previous versions are kept for anything that could not be verified.':'This workspace uses a saved copy. Each source keeps its original observation time.')}</p></div></div>}
     {finishedLabel&&<p className="nu-vault-completed">{ui('Last completed import:')} <time dateTime={status?.finished_at}>{finishedLabel}</time></p>}
     {error&&<div className="beta-alert" role="alert"><p>{ui(error)}</p><button type="button" disabled={busy} onClick={()=>void readStatus()}>{ui('Check status again')}</button></div>}
     {counts.length>0&&<dl className="beta-import-counts">{counts.map(([key,label])=><div key={key}><dt>{ui(label)}</dt><dd>{status!.counts![key].toLocaleString(locale)}</dd></div>)}</dl>}
    </section>
    <section className="nu-vault-coverage" aria-label={ui('Refresh coverage')}>
     <h2>{ui('What was checked')}</h2>{running&&<p className="nu-vault-limit">{ui('These coverage details are from the last completed import. The current refresh is still running.')}</p>}
     {!!status?.retained_originals_reused&&<p><strong>{status.retained_originals_reused.toLocaleString(locale)}</strong> {ui('retained originals were verified against the saved index. These are checked local copies, not new iCloud reads.')}</p>}
     {gaps>0&&<details className="nu-vault-gaps" open><summary>{ui('Files still needing attention')} · {gaps}</summary><p>{ui('These files could not be refreshed. Their previous saved versions remain available.')}</p><ul>{status?.file_io?.gaps.map((g,i)=><li key={i}><FolderOpen size={18} aria-hidden="true"/><div><strong>{g.path}</strong><p>{ui(g.reason==='file_timeout'?'The file did not respond within the read limit.':g.reason==='refresh_budget_exhausted'?'The refresh time budget was reached before this file could be checked.':g.reason==='index_hash_changed'?'The file differs from the saved index. Its newer text was not substituted.':['enoent','ENOENT','file_error_ENOENT'].includes(g.reason)?'The original capture is missing. It has not been reconstructed or treated as verified.':'The file could not be read or verified.')}</p></div></li>)}</ul>{gaps>(status?.file_io?.gaps.length||0)&&<p>{ui('Additional file gaps are retained in the local import report.')}</p>}</details>}
     {excluded.length>0&&<details className="nu-vault-exclusions"><summary>{ui('Generated calendar summaries excluded')} · {excluded.length}</summary><p>{ui('These are generated views, not original course evidence. They are excluded from source-file scanning; your saved versions are preserved.')}</p><ul>{excluded.map(p=><li key={p}>{p}</li>)}</ul></details>}
     {!!status?.skipped_entries&&<p className="nu-vault-limit">{status.skipped_entries} {ui('entries were omitted or could not be imported. This is separate from the file-gap count; source coverage remains partial.')}</p>}
     {warningCount>0&&<p className="nu-vault-limit">{ui('Some sources have reading or import limitations. Check their text and timestamps before relying on an answer.')}</p>}
    </section>
   </div>
   <aside className="nu-vault-context">
    <h2>{ui('Keep working')}</h2><p>{ui('Your saved work stays available while a refresh runs.')}</p>
    {onNavigate&&<div className="nu-vault-links"><button onClick={()=>onNavigate('today')}>{ui('Open Today')}</button><button onClick={()=>onNavigate('sources')}>{ui('Browse sources')}</button><button onClick={()=>onNavigate('notes')}>{ui('Open Notes')}</button></div>}
    <details><summary>{ui('About this saved copy')}</summary><p>{ui('Refresh reads material already saved in your personal vault and copies it into this workspace. The original vault is preserved.')}</p><p>{ui('A local import does not check Moodle for new requirements, submissions or grades. Import time and source observation time are different.')}</p><p>{ui('No Notion account is needed to use this saved copy.')}</p></details>
   </aside>
  </div>
 </section>;
}

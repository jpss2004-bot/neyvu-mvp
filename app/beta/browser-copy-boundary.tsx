'use client';
import './browser-copies.css';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {BrowserCopyContext,type BrowserCopyLease} from './browser-copy-context';
import {studyMemoryStorage} from './use-study-session';
import {useI18n} from './language';
import {WorkspaceOpening} from './assistant-feedback';
import {alignBrowserSession,browserCopyControl,browserCopyLock,inspectBrowserCopies,removeBrowserCopies,resumeBrowserCopies,type BrowserCopyPlan} from '../../lib/beta/browser-copies';
import type {RecoveryStorage} from '../../lib/beta/chat-recovery';

const unavailable='Browser storage is unavailable. Nothing can be verified or removed.';
function stores(){let local:RecoveryStorage|null=null,session:RecoveryStorage|null=null;try{local=localStorage;session=sessionStorage;}catch{}return {local,session};}
export default function BrowserCopyBoundary({actor,children}:{actor:string;children:ReactNode}){
 const {t}=useI18n();const [phase,setPhase]=useState<'starting'|'ready'|'paused'|'blocked'|'unavailable'>('starting');
 const [epoch,setEpoch]=useState('initial'),[lease,setLease]=useState<BrowserCopyLease>({canWrite:()=>false,review:()=>{}});
 const [open,setOpen]=useState(false),[plan,setPlan]=useState<BrowserCopyPlan|null>(null),[checked,setChecked]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('');
 const allowed=useRef(false),token=useRef('initial'),release=useRef<(()=>void)|null>(null),held=useRef<Promise<unknown>>(Promise.resolve()),joining=useRef<Promise<boolean>|null>(null),alive=useRef(true),readiness=useRef<()=>string|null>(()=>null),dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLElement|null>(null);
 const latestActor=useRef(actor);latestActor.current=actor;
 const lifecycle=useRef(0);
 async function review(ready:()=>string|null){const reason=ready();if(reason){setError(reason);return;}readiness.current=ready;trigger.current=document.activeElement as HTMLElement;setOpen(true);setPlan(null);setChecked(false);setError('');setStatus('');try{const s=stores();setPlan(await inspectBrowserCopies(s.local,s.session,actor,studyMemoryStorage));}catch(e){setError((e as Error).message);}}
 function activate(generation:string){const identity=actor+':'+generation;token.current=identity;allowed.current=true;setEpoch(identity);setLease({canWrite:()=>allowed.current&&latestActor.current===actor&&token.current===identity,review});setPhase('ready');}
 async function acquire(){
  if(release.current)return true;if(joining.current)return joining.current;
  const cycle=lifecycle.current;
  let task:Promise<boolean>;task=new Promise<boolean>(resolve=>{
   const enter=async()=>{
    if(!alive.current||latestActor.current!==actor||cycle!==lifecycle.current){resolve(false);return;}
    const s=stores(),control=browserCopyControl(s.local,actor);if(alignBrowserSession(s.local,s.session,actor))studyMemoryStorage.removeItem('neyvu-study-v1:'+actor);
    if(control?.mode==='blocked'){allowed.current=false;token.current=control.epoch;setPhase('blocked');resolve(false);return;}
    if(!navigator.locks){activate(control?.epoch||'initial');resolve(true);return;}
    activate(control?.epoch||'initial');resolve(true);await new Promise<void>(done=>{release.current=done;});
   };
   held.current=(navigator.locks?navigator.locks.request(browserCopyLock(actor),{mode:'shared'},enter):enter()).catch(e=>{if(cycle===lifecycle.current&&latestActor.current===actor){allowed.current=false;if(alive.current){setError((e as Error).message);setPhase('unavailable');}}resolve(false);});
  }).finally(()=>{if(joining.current===task)joining.current=null;});joining.current=task;return task;
 }
 async function freeze(){allowed.current=false;setPhase('paused');const done=release.current;release.current=null;done?.();await held.current;}
 useEffect(()=>{
  alive.current=true;void acquire();
  const hide=()=>{lifecycle.current++;joining.current=null;allowed.current=false;if(alive.current)setPhase(value=>value==='ready'?'paused':value);const done=release.current;release.current=null;done?.();};
  const show=()=>{if(!allowed.current)void acquire();};
  window.addEventListener('pagehide',hide);window.addEventListener('pageshow',show);
  return()=>{alive.current=false;hide();joining.current=null;window.removeEventListener('pagehide',hide);window.removeEventListener('pageshow',show);};
 },[actor]);
 useEffect(()=>{if(open){dialog.current?.showModal();}else if(trigger.current?.isConnected)trigger.current.focus();},[open]);
 async function apply(){
  if(!plan||!checked||pending)return;const reason=readiness.current();if(reason){setError(reason);return;}
  if(!navigator.locks){setError('This browser cannot coordinate safe removal across tabs. Use its site-data controls after saving your work.');return;}
  setPending(true);setError('');await freeze();let outcome:'unchanged'|'blocked'='unchanged';
  try{await navigator.locks.request(browserCopyLock(actor),{mode:'exclusive',ifAvailable:true},async lock=>{
   if(!lock)throw Error('Finish any recording and close other Neyvu tabs for this account, then review again.');
   const s=stores(),result=await removeBrowserCopies(s.local,s.session,actor,plan,studyMemoryStorage);
   if(result.state==='changed'){setPlan(result.plan);setChecked(false);setStatus('Browser copies changed. Review the new counts before removing them.');return;}
   outcome='blocked';const control=browserCopyControl(s.local,actor)!;token.current=control.epoch;setEpoch(control.epoch);setPhase('blocked');
   if(result.state==='incomplete'){setPlan(result.plan);setChecked(false);setStatus('Some browser copies remain. Removal is incomplete; review and retry.');return;}
   setStatus('The reviewed chat, Study and memory-form copies were removed from this browser.');setPlan(null);setChecked(false);
  });}catch(e){setError((e as Error).message);try{if(browserCopyControl(stores().local,actor)?.mode==='blocked'){outcome='blocked';setPhase('blocked');}}catch{outcome='blocked';setPhase('unavailable');}}
  finally{if(outcome==='unchanged')await acquire();setPending(false);}
 }
 async function reopen(){
  if(pending)return;setPending(true);setError('');try{
   if(!navigator.locks)throw Error('This browser cannot coordinate safe removal across tabs. Use its site-data controls after saving your work.');
   let resumed=false;await navigator.locks.request(browserCopyLock(actor),{mode:'exclusive',ifAvailable:true},async lock=>{if(!lock)throw Error('Finish any recording and close other Neyvu tabs for this account, then review again.');const s=stores();await resumeBrowserCopies(s.local,s.session,actor);resumed=true;});
   if(resumed){setOpen(false);setPlan(null);await acquire();}
  }catch(e){setError((e as Error).message);}finally{setPending(false);}
 }
 function close(){if(!pending)setOpen(false);}
 const block=phase==='blocked'||phase==='unavailable';
 return <BrowserCopyContext.Provider value={lease}>
  {!open&&phase==='ready'&&error&&<p className="beta-alert" role="alert">{t(error)}</p>}
  {phase==='starting'?<div className="beta-app nu-browser-frame"><WorkspaceOpening/></div>:block?<section className="beta-app nu-browser-frame nu-browser-paused" role="status"><h1>{t('Browser recovery is paused for this account')}</h1><p>{t('Old tab copies will not be restored. Account data, files and recordings are separate.')}</p><p>{t(status)}</p>{error&&<p role="alert">{t(error)}</p>}<div className="nu-browser-actions"><button disabled={pending} onClick={()=>void review(()=>null)}>{t('Review remaining browser copies')}</button><button disabled={pending} onClick={()=>void reopen()}>{t('Open saved account data')}</button></div></section>:<div key={epoch} inert={phase==='paused'}>{children}</div>}
  {open&&<dialog ref={dialog} className="beta-app nu-browser-dialog" aria-labelledby="browser-copy-title" onCancel={e=>{e.preventDefault();close();}}><section className="nu-settings"><h2 id="browser-copy-title">{t('Remove this account’s browser work copies')}</h2><p>{t('This covers unsent chat drafts, pending conversation and answer IDs, Study sessions, and unsaved memory forms in this browser profile. Copies held in this tab’s memory are included.')}</p><p>{t('Account notes and messages, original files, recordings, sign-in, shared appearance settings, other accounts and other devices stay separate. A small content-free marker prevents old tab copies from returning.')}</p><p>{t('This review checks shared browser storage and this tab. Restored tabs clear retired session copies before opening account data. Review each browser profile and device separately.')}</p>
   {plan&&<dl>{([['drafts','Draft copies'],['pendingAnswers','Unconfirmed answer copies'],['pendingChats','Unconfirmed conversation copies'],['study','Study storage records'],['memoryDrafts','Unsaved memory forms'],['markers','Completed-request markers']] as const).map(([key,label])=><div key={key}><dt>{t(label)}</dt><dd>{plan.counts[key]}</dd></div>)}</dl>}
   <p>{t('Save or export needed work and check interrupted requests first. Removing a browser copy does not cancel a request already sent to your account. Finish recordings before closing other Neyvu tabs.')}</p>
   {plan&&<label><input autoFocus type="checkbox" checked={checked} disabled={pending} onChange={e=>setChecked(e.target.checked)}/>{t('I reviewed these copies and want to discard them. Other Neyvu tabs for this account are closed, and no legacy app tab is still open.')}</label>}
   {status&&<p role="status">{t(status)}</p>}{error&&<p role="alert">{t(error||unavailable)}</p>}<div className="beta-form-actions"><button disabled={pending} onClick={close}>{t('Close')}</button><button disabled={pending} onClick={()=>void review(readiness.current)}>{t('Refresh review')}</button><button disabled={!plan||!checked||pending} onClick={()=>void apply()}>{pending?t('Removing browser copies…'):t('Remove reviewed browser copies')}</button></div></section></dialog>}
 </BrowserCopyContext.Provider>;
}

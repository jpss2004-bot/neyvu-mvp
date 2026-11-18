'use client';

import {useEffect,useRef,useState} from 'react';
import {Search,X} from 'lucide-react';
import {courseLabel} from '../../lib/beta/course-label';
import {useI18n} from './language';

type Source={id:string;title:string;course_id:string;kind:string;version_id?:string};
type Course={id:string;code:string;title:string};
type Chat={id:string;title:string;course_id?:string|null;archived?:boolean};
type Result={id:string;title:string;detail:string;open:()=>void};

export default function WorkspaceFind({chats,courses,onChat,onCourse,onSource,courseName}:{
 chats:Chat[];
 courses:Course[];
 onChat:(id:string)=>void;
 onCourse:(id:string)=>void;
 onSource:(source:Source,trigger:HTMLElement)=>void;
 courseName:(id:string)=>string;
}){
 const {t}=useI18n();
 const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null),input=useRef<HTMLInputElement>(null);
 const sourceRequest=useRef<AbortController|null>(null);
 const [opened,setOpened]=useState(false),[query,setQuery]=useState(''),[selected,setSelected]=useState(0);
 const [remote,setRemote]=useState<{query:string;chats:Chat[];error?:boolean}|null>(null);
 const [sourceSearch,setSourceSearch]=useState<{query:string;items:Source[];loading?:boolean;error?:boolean}|null>(null);
 const value=query.trim();
 function show(){
  const element=dialog.current;
  if(!element||document.querySelector('dialog[open][aria-modal="true"],.beta-find-dialog[open]'))return;
  setQuery('');setSelected(0);setRemote(null);setSourceSearch(null);setOpened(true);
  element.showModal();input.current?.focus();
 }
 useEffect(()=>{
  const keys=(event:KeyboardEvent)=>{
   if((event.metaKey||event.ctrlKey)&&!event.altKey&&event.key.toLowerCase()==='k'){event.preventDefault();show();}
  };
  document.addEventListener('keydown',keys);
  return()=>{document.removeEventListener('keydown',keys);sourceRequest.current?.abort();};
 },[]);
 useEffect(()=>{
  if(!opened||!value)return;
  const controller=new AbortController();
  const timer=setTimeout(async()=>{
   try{
    const response=await fetch('/api/beta?op=chat.search&q='+encodeURIComponent(value),{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
    if(!response.ok)throw Error();
    const result=await response.json() as Chat[];
    if(!controller.signal.aborted)setRemote({query:value,chats:result});
   }catch{if(!controller.signal.aborted)setRemote({query:value,chats:[],error:true});}
  },180);
  return()=>{clearTimeout(timer);controller.abort();};
 },[value,opened]);
 async function searchSources(){
  if(!value)return;
  sourceRequest.current?.abort();
  const controller=new AbortController();sourceRequest.current=controller;
  setSourceSearch({query:value,items:[],loading:true});
  try{
   const response=await fetch('/api/beta?op=search&q='+encodeURIComponent(value),{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
   if(!response.ok)throw Error();
   const items=await response.json() as Source[];
   if(!controller.signal.aborted)setSourceSearch({query:value,items});
  }catch{if(!controller.signal.aborted)setSourceSearch({query:value,items:[],error:true});}
 }
 function choose(action:()=>void){dialog.current?.close();action();}
 const matches=(text:string)=>value.toLocaleLowerCase().split(/\s+/).every(term=>text.toLocaleLowerCase().includes(term));
 const currentRemote=remote?.query===value?remote:null;
 const currentSources=sourceSearch?.query===value?sourceSearch:null;
 const matchingCourses=courses.filter(course=>matches(course.code+' '+course.title)).slice(0,value?12:5);
 const localChats=chats.filter(chat=>!chat.archived&&(chat.title!=='New chat'||!!value)&&matches(chat.title+' '+(chat.course_id?courseName(chat.course_id):'')));
 const matchingChats=[...new Map([...localChats,...(currentRemote?.chats||[])].map(chat=>[chat.id,chat])).values()].slice(0,value?20:6);
 const sections:{label:string;items:Result[]}[]=[
  {label:t('Start a course chat'),items:matchingCourses.map(course=>({id:course.id,title:courseLabel(course),detail:t('New chat'),open:()=>onCourse(course.id)}))},
  {label:t(value?'Conversations':'Recent chats'),items:matchingChats.map(chat=>({id:chat.id,title:chat.title,detail:chat.course_id?courseName(chat.course_id):t('All courses'),open:()=>onChat(chat.id)}))},
  {label:t('Course materials'),items:(currentSources?.items||[]).map(source=>({id:source.id,title:source.title,detail:courseName(source.course_id),open:()=>{if(trigger.current)onSource(source,trigger.current);}}))}
 ];
 const results=sections.flatMap(section=>section.items),active=Math.min(selected,Math.max(0,results.length-1));
 function move(step:number){
  if(!results.length)return;
  const next=(active+step+results.length)%results.length;setSelected(next);
  document.getElementById('beta-find-option-'+next)?.scrollIntoView({block:'nearest'});
 }
 let index=0;
 return <>
  <button ref={trigger} className="beta-find-trigger" onClick={show} aria-label={t('Quick switch')} title={t('Find materials and chats (⌘ or Ctrl K)')}><Search size={18} aria-hidden="true"/><span>{t('Quick switch')}</span><kbd>⌘/Ctrl K</kbd></button>
  <dialog ref={dialog} className="beta-find-dialog nu-desk-switch" aria-labelledby="beta-find-heading" onClose={()=>{setOpened(false);sourceRequest.current?.abort();}}>
   <header><h2 id="beta-find-heading">{t('Quick switch')}</h2><button type="button" onClick={()=>dialog.current?.close()} aria-label={t('Close search')}><X size={20} aria-hidden="true"/></button></header>
   <div className="beta-search">
    <Search size={18} aria-hidden="true"/>
    <input ref={input} autoFocus type="search" aria-label={t('Find in your workspace')} placeholder={t('A course or conversation')} maxLength={200} value={query} onChange={event=>{sourceRequest.current?.abort();setSourceSearch(null);setQuery(event.target.value);setSelected(0);}} onKeyDown={event=>{
     if(event.nativeEvent.isComposing)return;
     if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();move(event.key==='ArrowDown'?1:-1);}
     if(event.key==='Enter'){event.preventDefault();if(results[active])choose(results[active].open);else void searchSources();}
    }}/>
    <button type="button" disabled={!value||currentSources?.loading} onClick={()=>void searchSources()}>{t('Search source text')}</button>
   </div>
   <div className="nu-desk-switch-results">
    {sections.map(section=>section.items.length>0&&<section key={section.label}><h3>{section.label}</h3>{section.items.map(item=>{
     const position=index++;
     return <button type="button" key={item.id} id={'beta-find-option-'+position} data-active={position===active} onClick={()=>choose(item.open)}><strong>{item.title}</strong><small>{item.detail}</small></button>;
    })}</section>)}
    {!results.length&&<p>{t(value&&!currentRemote?'Checking saved conversations…':value?'No matching courses or conversations.':'Your conversations will appear here.')}</p>}
    {currentRemote?.error&&<p role="status">{t('Could not check all saved conversations. Results shown here are already loaded.')}</p>}
    {currentSources&&<p role="status">{t(currentSources.loading?'Searching saved material…':currentSources.error?'Search could not finish. Your query is kept; try again.':currentSources.items.length?'Matching sources shown above.':'No matching sources. Try another term.')}</p>}
    <span className="beta-sr" role="status">{results[active]?.title}</span>
   </div>
   <footer><kbd>↑</kbd> <kbd>↓</kbd> {t('Move')} <kbd>Enter</kbd> {t('Open')} <kbd>Esc</kbd> {t('Close')}</footer>
  </dialog>
 </>;
}

'use client';
import {useSyncExternalStore} from 'react';
import {readStudyLibrary,retainStudy,type StudySession,type StudyLibrary} from '../../lib/beta/study-session';
import {useBrowserCopies} from './browser-copy-context';
import type {RecoveryStorage} from '../../lib/beta/chat-recovery';
const changed='neyvu-study-change';const temporary=new Map<string,string>();const initial=JSON.stringify(readStudyLibrary(null));
export const studyMemoryStorage:RecoveryStorage={get length(){return temporary.size;},key:n=>[...temporary.keys()][n]??null,getItem:key=>temporary.get(key)??null,setItem:(key,value)=>{temporary.set(key,value);},removeItem:key=>{temporary.delete(key);if(typeof window!=='undefined')window.dispatchEvent(new Event(changed));}};
export function useStudySession(actor:string){
 const browserCopies=useBrowserCopies();
 const key='neyvu-study-v1:'+actor;
 const snapshot=()=>{let raw:string|null=null;try{raw=temporary.get(key)??localStorage.getItem(key);}catch{raw=temporary.get(key)||null;}return JSON.stringify(readStudyLibrary(raw));};
 const subscribe=(listener:()=>void)=>{const storage=(e:StorageEvent)=>{if(!e.key||e.key===key){temporary.delete(key);listener();}};window.addEventListener(changed,listener);window.addEventListener('storage',storage);return()=>{window.removeEventListener(changed,listener);window.removeEventListener('storage',storage);};};
 const raw=useSyncExternalStore(subscribe,snapshot,()=>initial),library=readStudyLibrary(raw),session=library.sessions.find(s=>s.id===library.activeId)||null;
 function write(next:StudyLibrary){if(!browserCopies.canWrite())return false;const serialized=JSON.stringify(next);let saved=true;try{localStorage.setItem(key,serialized);temporary.delete(key);}catch{temporary.set(key,serialized);saved=false;}window.dispatchEvent(new Event(changed));return saved;}
 function update(value:StudySession|((previous:StudySession)=>StudySession)){
  const current=readStudyLibrary(snapshot()),previous=current.sessions.find(s=>s.id===session?.id);
  if(typeof value==='function'&&!previous)return false;
  const next=retainStudy(current,typeof value==='function'?value(previous!):value);return write(typeof value==='function'?{...next,activeId:current.activeId}:next);
 }
 function select(id:string){const current=readStudyLibrary(snapshot());if(!current.sessions.some(s=>s.id===id))return false;return write({...current,activeId:id});}
 return {session,sessions:library.sessions,persistent:!temporary.has(key),update,select};
}

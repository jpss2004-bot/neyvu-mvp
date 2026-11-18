'use client';
import {useEffect,useSyncExternalStore} from 'react';
import {presentationDefaults,readPresentation,type PresentationPreferences} from '../../lib/beta/presentation';
const appearanceKey='schoolvault-appearance',displayKey='neyvu-presentation-v1',change='neyvu-presentation-change';
const initial=JSON.stringify(presentationDefaults);
let temporary:string|null=null;
function snapshot(){
 if(temporary)return temporary;
 try{return JSON.stringify(readPresentation(localStorage.getItem(appearanceKey),localStorage.getItem(displayKey)));}catch{return initial;}
}
function subscribe(listener:()=>void){
 const storage=(event:StorageEvent)=>{if(!event.key||[appearanceKey,displayKey].includes(event.key)){temporary=null;listener();}};
 window.addEventListener(change,listener);window.addEventListener('storage',storage);
 return()=>{window.removeEventListener(change,listener);window.removeEventListener('storage',storage);};
}
function update(changes:Partial<PresentationPreferences>){
 const next={...JSON.parse(snapshot()),...changes} as PresentationPreferences;
 let saved=true;
 try{
  if(changes.appearance!==undefined)localStorage.setItem(appearanceKey,next.appearance);
  localStorage.setItem(displayKey,JSON.stringify({text:next.text,motion:next.motion,contrast:next.contrast}));
  temporary=null;
 }catch{temporary=JSON.stringify(next);saved=false;}
 window.dispatchEvent(new Event(change));return saved;
}
export function usePresentation(){
 const serialized=useSyncExternalStore(subscribe,snapshot,()=>initial);
 const preferences=JSON.parse(serialized) as PresentationPreferences;
 useEffect(()=>{
  const media=window.matchMedia('(prefers-color-scheme: dark)');
  const apply=()=>{
   document.documentElement.dataset.schoolvaultTheme=preferences.appearance==='system'?(media.matches?'black':'light'):preferences.appearance;
   document.documentElement.dataset.neyvuText=preferences.text;
   document.documentElement.dataset.neyvuMotion=preferences.motion;
   document.documentElement.dataset.neyvuContrast=preferences.contrast;
  };
  apply();media.addEventListener('change',apply);return()=>media.removeEventListener('change',apply);
 },[serialized]);
 return {preferences,update};
}

'use client';

import Script from 'next/script';
import {useEffect, useRef, useState, type ReactNode} from 'react';
import {initializeConstellation} from './constellation-motion';
import {usePresentation} from '../use-presentation';
import {useI18n} from '../language';

export function ConstellationExperience({children}:{children:ReactNode}) {
 const {preferences}=usePresentation();
 const {t,language}=useI18n();const labels=useRef(t);labels.current=t;
 const root=useRef<HTMLDivElement>(null);
 const [gsapReady,setGsapReady]=useState(false);
 const [triggerReady,setTriggerReady]=useState(false);
 const [lenisReady,setLenisReady]=useState(false);
 const [failed,setFailed]=useState(false);
 const [reduced,setReduced]=useState(false);

 useEffect(()=>{
  const preference=window.matchMedia('(prefers-reduced-motion: reduce)');
  const update=()=>setReduced(preference.matches);
  update();preference.addEventListener('change',update);
  return ()=>preference.removeEventListener('change',update);
 },[]);

 useEffect(()=>{
  if(!root.current||(!failed&&!(gsapReady&&triggerReady&&lenisReady)))return;
  // A failed library leaves a readable static story and the existing React access form.
  const libraries=failed?{}:window as unknown as Parameters<typeof initializeConstellation>[1];
  return initializeConstellation(root.current,libraries,(copy:string)=>labels.current(copy),reduced||preferences.motion==='reduce');
 },[gsapReady,triggerReady,lenisReady,failed,reduced,preferences.motion]);

 useEffect(()=>{
  const toggle=root.current?.querySelector<HTMLButtonElement>('.motion-toggle'),label=root.current?.querySelector('.mt-label');
  if(toggle&&label){const text=t(toggle.disabled?'Motion off':toggle.getAttribute('aria-pressed')==='true'?'Resume motion':'Pause motion');toggle.setAttribute('aria-label',text);label.textContent=text;if(toggle.disabled)toggle.title=t(reduced?'Motion is off because your device asks for reduced motion.':'Motion is off on this page.');}
  const frame=requestAnimationFrame(()=>{(window as unknown as {ScrollTrigger?:{refresh:()=>void}}).ScrollTrigger?.refresh();});return()=>cancelAnimationFrame(frame);
 },[language,t,reduced]);

 return <div ref={root} className="sv-constellation daylight">
  {children}
  <Script id="sv-gsap" src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js" strategy="afterInteractive" onReady={()=>setGsapReady(true)} onError={()=>setFailed(true)}/>
  {gsapReady&&<Script id="sv-scroll-trigger" src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js" strategy="afterInteractive" onReady={()=>setTriggerReady(true)} onError={()=>setFailed(true)}/>}
  <Script id="sv-lenis" src="https://cdn.jsdelivr.net/npm/lenis@1.1.20/dist/lenis.min.js" strategy="afterInteractive" onReady={()=>setLenisReady(true)} onError={()=>setFailed(true)}/>
 </div>;
}

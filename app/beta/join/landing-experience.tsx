'use client';
import {createContext,useContext,useEffect,useRef,useState,type ReactNode,type PointerEvent} from 'react';

const MotionContext=createContext<{manualPause:boolean;reduced:boolean;toggle:()=>void}|null>(null);

export default function LandingExperience({children}:{children:ReactNode}){
 const [manualPause,setManualPause]=useState(false),[reduced,setReduced]=useState(false),[hidden,setHidden]=useState(false);
 const root=useRef<HTMLElement>(null),frame=useRef<number|null>(null);
 useEffect(()=>{
  const preference=window.matchMedia('(prefers-reduced-motion: reduce)');
  const updatePreference=()=>setReduced(preference.matches),updateVisibility=()=>setHidden(document.hidden);
  updatePreference();updateVisibility();preference.addEventListener('change',updatePreference);document.addEventListener('visibilitychange',updateVisibility);
  return ()=>{preference.removeEventListener('change',updatePreference);document.removeEventListener('visibilitychange',updateVisibility);if(frame.current!==null)cancelAnimationFrame(frame.current);};
 },[]);
 const paused=manualPause||reduced||hidden;
 function followPointer(event:PointerEvent<HTMLElement>){
  if(paused||event.pointerType!=='mouse'||frame.current!==null)return;
  const x=(event.clientX/window.innerWidth-.5)*40,y=(event.clientY/window.innerHeight-.5)*30;
  frame.current=requestAnimationFrame(()=>{root.current?.style.setProperty('--sv-pointer-x',`${x}px`);root.current?.style.setProperty('--sv-pointer-y',`${y}px`);frame.current=null;});
 }
 return <MotionContext.Provider value={{manualPause,reduced,toggle:()=>setManualPause(v=>!v)}}><main ref={root} className="sv-landing" data-motion-paused={paused} onPointerMove={followPointer}>
  <div className="sv-atmosphere" aria-hidden="true"><div className="sv-light-field"/><div className="sv-light-secondary"/><div className="sv-grain"/>
   <svg className="sv-course-paths" viewBox="0 0 1400 1400" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="sv-path-color" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#7389c6"/><stop offset=".5" stopColor="#b8d8ff"/><stop offset="1" stopColor="#718fcc"/></linearGradient></defs><g className="sv-path-base"><path d="M-80 380 C220 380 80 820 500 820 S1080 120 1480 120"/><path d="M-80 435 C270 435 90 870 530 870 S1110 170 1480 170"/><path d="M-80 490 C310 490 140 920 560 920 S1140 220 1480 220"/><path d="M-80 545 C350 545 180 970 590 970 S1170 270 1480 270"/></g><g className="sv-path-travel"><path d="M-80 380 C220 380 80 820 500 820 S1080 120 1480 120"/><path d="M-80 490 C310 490 140 920 560 920 S1140 220 1480 220"/></g><circle cx="500" cy="820" r="4"/><circle cx="1030" cy="433" r="3"/></svg>
  </div>
  {children}
 </main></MotionContext.Provider>;
}

/* Sits in the page header, never fixed over content. The name stays constant; aria-pressed carries the state. */
export function MotionToggle(){
 const motion=useContext(MotionContext);
 if(!motion)return null;
 return <><button className="sv-motion-control" type="button" aria-pressed={motion.manualPause||motion.reduced} disabled={motion.reduced} aria-describedby={motion.reduced?'sv-motion-reduced':undefined} onClick={motion.toggle}><svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16"><path d="M5 3V13M11 3V13"/></svg>Pause motion</button>{motion.reduced&&<span id="sv-motion-reduced" className="sr-only">Your device setting already reduces motion.</span>}</>;
}

'use client';
import {useEffect,useRef,useState,type RefObject,type ReactNode} from 'react';
import {useI18n} from './language';
export function panelWidth(value:number,viewport:number){return Math.max(340,Math.min(value,780,Math.max(340,viewport-660)));}
export default function SourcePanel({panel,label,width,onResize,onClose,children}:{panel:RefObject<HTMLDialogElement|null>;label:string;width:number;onResize:(width:number)=>void;onClose:()=>void;children:ReactNode}){
 const {t}=useI18n(),[maximum,setMaximum]=useState(780),[modal,setModal]=useState(true),drag=useRef<{x:number;width:number}|null>(null),close=useRef(onClose);close.current=onClose;
 const currentWidth=useRef(width);currentWidth.current=width;
 useEffect(()=>{const mq=window.matchMedia('(min-width:1100px)'),dialog=panel.current;if(!dialog)return;
  const fit=()=>{setMaximum(panelWidth(780,window.innerWidth));if(mq.matches)onResize(panelWidth(currentWidth.current,window.innerWidth));};
  let frame=0;
  const show=()=>{
   fit();dialog.close();
   const needsModal=!mq.matches||!!document.querySelector('dialog:modal');
   setModal(needsModal);
   if(needsModal)dialog.showModal();else dialog.show();
   cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>dialog.querySelector('mark')?.scrollIntoView({block:'center',inline:'nearest'}));
  };show();mq.addEventListener('change',show);window.addEventListener('resize',fit);
  const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'&&mq.matches&&!dialog.matches(':modal')&&!e.defaultPrevented&&!Array.from(document.querySelectorAll('dialog[open]')).some(other=>other!==dialog&&other.contains(document.activeElement))){e.preventDefault();close.current();}};window.addEventListener('keydown',escape);
  return()=>{cancelAnimationFrame(frame);dialog.close();window.removeEventListener('resize',fit);mq.removeEventListener('change',show);window.removeEventListener('keydown',escape);};
 },[panel]);
 const resize=(value:number)=>onResize(panelWidth(value,window.innerWidth));
 return <dialog ref={panel} className="beta-source-overlay nu-source-panel" aria-label={label} aria-modal={modal||undefined} onCancel={e=>{e.preventDefault();onClose();}}>
  <div className="nu-source-resize" role="separator" tabIndex={0} aria-label={t('Resize source panel')} aria-orientation="vertical" aria-valuemin={340} aria-valuemax={maximum} aria-valuenow={width}
   onPointerDown={e=>{drag.current={x:e.clientX,width};e.currentTarget.setPointerCapture(e.pointerId);}}
   onPointerMove={e=>{if(drag.current)resize(drag.current.width+drag.current.x-e.clientX);}}
   onPointerUp={e=>{drag.current=null;e.currentTarget.releasePointerCapture(e.pointerId);}} onPointerCancel={()=>{drag.current=null;}} onLostPointerCapture={()=>{drag.current=null;}}
   onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();resize(e.key==='Home'?340:e.key==='End'?780:width+(e.key==='ArrowLeft'?32:-32));}}}/>
  <section>{children}</section>
 </dialog>;
}

'use client';
import {useI18n} from "../../language";

import {useEffect,useState} from 'react';
import {studyMathScale,studyPrintWidth} from '../../../../lib/beta/study-print-layout';
export default function StudyPrintButton(){
 const {t:ui}=useI18n();
 const [ready,setReady]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(false);
 useEffect(()=>{
  let active=true,timer:ReturnType<typeof setTimeout>;
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Math font timeout')),15000);});
  Promise.race([document.fonts.ready,timeout]).then(()=>{
   clearTimeout(timer);
   if(!active)return;
   if([...document.fonts].some(font=>/KaTeX_/.test(font.family)&&font.status==='error'))throw Error('A math font failed');
   const paper=document.querySelector<HTMLElement>('.study-copy-paper');if(!paper)throw Error('Missing study copy');
   const probe=document.createElement('div');probe.className='study-copy-prose study-copy-print-measure';probe.style.width=studyPrintWidth+'px';document.body.append(probe);
   let tooWide=0;const invalidMath=paper.querySelector('.katex-error, .study-math-render-error')!==null;
   try{
    for(const equation of paper.querySelectorAll<HTMLElement>('.katex-display, .katex:not(.katex-display .katex)')){
     const clone=equation.cloneNode(true) as HTMLElement;probe.replaceChildren(clone);
     const content=clone.querySelector<HTMLElement>('.katex-html');if(!content)throw Error('Missing equation layout');
     // KaTeX's outer HTML box can fill the line while its unbroken base
     // overflows on both sides. Measure the actual bases, not that line box.
     const bases=[...content.querySelectorAll<HTMLElement>(':scope > .base')];
     const width=bases.length?bases.reduce((sum,base)=>sum+base.getBoundingClientRect().width,0):Math.max(content.scrollWidth,content.getBoundingClientRect().width);
     const scale=studyMathScale(width);
     equation.classList.toggle('study-math-too-wide',scale===null);
     if(scale===null)tooWide++;else equation.style.setProperty('--study-print-math-scale',String(scale));
    }
   }finally{probe.remove();}
   paper.classList.toggle('study-copy-print-blocked',tooWide>0||invalidMath);
   if(invalidMath)setError('An equation could not render. Ask the assistant to correct its notation, then open the new answer.');
   else if(tooWide)setError('An equation is too wide for a readable PDF. Ask the assistant to split the equation into shorter steps, then open the new answer.');
   else{paper.classList.remove('study-copy-print-pending');setReady(true);}
  }).catch(()=>{clearTimeout(timer);if(active){setRetry(true);setError('The math layout could not finish. Reload this page before printing.');}});
  return()=>{active=false;clearTimeout(timer);};
 },[]);
 return <div className="study-print-action"><button disabled={!ready} onClick={()=>window.print()}>{ready?ui("Print / save PDF"):error?ui("Print needs a layout repair"):ui("Preparing math layout…")}</button>{retry&&<button onClick={()=>window.location.reload()}>{ui("Reload layout")}</button>}<p role="status">{error||ui("Choose Save as PDF in the print window to keep this study copy.")}</p><noscript>{ui("Enable JavaScript to check the equation layout before printing.")}</noscript></div>;
}

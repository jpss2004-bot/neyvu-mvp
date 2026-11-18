'use client';

import {useEffect, useRef, useState} from 'react';
import {SYMBOL_LIGHT} from '../../../lib/brand';

/** One native-scroll composition. Nothing needed to read or join depends on animation. */
export function CinematicStory(){
 const root=useRef<HTMLElement>(null);
 const [paused,setPaused]=useState(false);
 const [reduced,setReduced]=useState(false);
 useEffect(()=>{
  const node=root.current;
  if(!node)return;
  const preference=matchMedia('(prefers-reduced-motion: reduce)');
  const compact=matchMedia('(max-width: 760px), (max-height: 600px)');
  const introduction=node.querySelector<HTMLElement>('.nc-hero-copy');
  let frame=0;
  function update(){
   frame=0;
   if(paused||preference.matches||compact.matches||document.hidden)return;
   const box=node!.getBoundingClientRect();
   const distance=box.height-(window.innerHeight-80);
   const progress=Math.max(0,Math.min(1,(80-box.top)/Math.max(1,distance)));
   node!.style.setProperty('--nc-progress',progress.toFixed(4));
   node!.dataset.enhanced='true';
   if(introduction)introduction.inert=progress>.4;
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(update);}
  function mediaChanged(){
   setReduced(preference.matches);
   if(preference.matches||compact.matches){node!.style.removeProperty('--nc-progress');if(introduction)introduction.inert=false;}
   schedule();
  }
  mediaChanged();
  window.addEventListener('scroll',schedule,{passive:true});
  window.addEventListener('resize',schedule,{passive:true});
  document.addEventListener('visibilitychange',schedule);
  preference.addEventListener('change',mediaChanged);
  compact.addEventListener('change',mediaChanged);
  return ()=>{
   cancelAnimationFrame(frame);
   window.removeEventListener('scroll',schedule);
   window.removeEventListener('resize',schedule);
   document.removeEventListener('visibilitychange',schedule);
   preference.removeEventListener('change',mediaChanged);
   compact.removeEventListener('change',mediaChanged);
  };
 },[paused]);
 return <section ref={root} className="nc-story" id="top" aria-labelledby="hero-title" data-paused={paused||reduced}>
  <div className="nc-stage">
   <div className="nc-light" aria-hidden="true"/>
   <div className="nc-orbits" aria-hidden="true"><i/><i/><i/></div>
   <div className="nc-hero-copy">
    <p className="nc-pilot">Neyvu at Acadia</p>
    <h1 id="hero-title">Bring your courses<br/>into focus.</h1>
    <p className="nc-lede">The reading. The class notes. That Moodle announcement.<br className="nc-desktop-break"/> A conversation that brings your saved material together.</p>
    <div className="nw-actions"><a className="nw-primary" href="#request-access">Request access</a><a className="nc-explore" href="#product-tour">Explore a conversation <span aria-hidden="true">↗</span></a></div>
    <p className="nc-fine">Free for Acadia students. Access is reviewed manually.</p>
   </div>
   <div className="nc-materials" aria-hidden="true">
    <article className="nc-paper nc-moodle">
     <div className="nc-browser"><i/><i/><i/><span>Moodle</span></div>
     <div className="nc-paper-body"><p className="nc-paper-meta">Sample course</p><h3>Communication<br/>and collaboration</h3><div className="nc-course-tabs"><span>Course</span><span>Participants</span><span>Grades</span></div><h4>Next class</h4><p>Listening in teams</p><div className="nc-file-row"><span>↗</span> Week 3 reading</div><div className="nc-file-row"><span>≡</span> Announcements</div></div>
    </article>
    <article className="nc-paper nc-reading">
     <div className="nc-paper-body"><p className="nc-paper-meta">Week 3 reading</p><h3>The art of<br/>paying attention.</h3><div className="nc-paper-rule"/><p>Listen to understand, then respond.</p><p className="nc-book-text">A conversation begins with attention. Reflecting back what you hear gives the other person a chance to clarify their meaning.</p><span className="nc-page-number">03</span></div>
    </article>
    <article className="nc-paper nc-notes">
     <div className="nc-paper-body"><p className="nc-paper-meta">My class notes</p><h3>Listening in teams</h3><ul><li>Give the speaker your attention.</li><li>Reflect back what you heard.</li><li>Check that you understood.</li></ul><p className="nc-hand-note">A question to bring to class:<br/>What makes someone feel heard?</p></div>
    </article>
    <article className="nc-paper nc-announcement">
     <div className="nc-paper-body"><p className="nc-paper-meta">Moodle announcement</p><h3>For our next discussion</h3><p>We’ll talk about listening in teams. Bring an example from a group project.</p><div className="nc-paper-rule"/><p className="nc-paper-meta">Illustrative course material</p></div>
    </article>
    <div className="nc-core"><img src={SYMBOL_LIGHT} width="72" height="72" alt=""/><span>Connected to your question</span></div>
   </div>
   <div className="nc-clarity" aria-hidden="true"><p>The context you need.</p><h2>Room to think.</h2></div>
   <div className="nc-story-bottom"><p><span className="nc-scroll-line" aria-hidden="true"/>Scroll to bring it together <span className="nc-fiction">Illustrative material</span></p><div><button type="button" onClick={()=>setPaused(v=>!v)} aria-pressed={paused||reduced} disabled={reduced}>{reduced?'Motion reduced':paused?'Resume motion':'Pause motion'}</button><a href="#product-tour">Skip the story</a></div></div>
  </div>
 </section>;
}

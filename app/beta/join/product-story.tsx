'use client';
import {useState} from 'react';
import Image from 'next/image';
const views=[
 {name:'Plan your week',file:'today',title:'Give the week a starting point.',body:'Review saved course work and choose when to study. Keep the official deadline visible while making a plan that fits your week.',alt:'Actual SchoolVault Today screen with demo course work and personal planning'},
 {name:'Keep your notes',file:'notebook',title:'Keep the thinking you want to build on.',body:'Save lecture explanations, lab observations and your working draft with their course. Come back with a follow-up question and the context you need.',alt:'Actual SchoolVault Notebook with saved demo course notes'},
 {name:'Read the source',file:'source',title:'Check the evidence behind the work.',body:'Read the actual saved instructions and supporting material. Check the details yourself, see what is missing and confirm important dates in Moodle.',alt:'Actual saved assignment instructions in the SchoolVault demo'}
] as const;
export default function ProductStory(){
 const [selected,setSelected]=useState(0),view=views[selected];
 return <section className="sv-product-story" aria-label="Explore SchoolVault">
  <div className="sv-story-switch" aria-label="Choose a product view">{views.map((v,i)=><button key={v.file} type="button" aria-pressed={selected===i} aria-controls="sv-product-view" onClick={()=>setSelected(i)}>{v.name}</button>)}</div>
  <div id="sv-product-view" className="sv-story-view">
   <div className="sv-story-frame" key={view.file}><div className="sv-screen-caption"><span className="sv-window-dots" aria-hidden="true"><i/><i/><i/></span><span>SchoolVault / {view.name}</span><span>Demo</span></div><a href={'/beta-product/'+view.file+'.png'} target="_blank" rel="noopener noreferrer" aria-label={'View full screenshot: '+view.name}><picture><source media="(max-width:640px)" srcSet={'/beta-product/'+view.file+'-phone.png'}/><Image src={'/beta-product/'+view.file+'.png'} width={1280} height={720} alt={view.alt} unoptimized loading="lazy"/></picture></a></div>
   <div className="sv-story-description" aria-live="polite"><h2>{view.title}</h2><p>{view.body}</p><a href={'/beta-product/'+view.file+'.png'} target="_blank" rel="noopener noreferrer">View full screenshot</a><small>Real app screens with demo courses.</small></div>
  </div>
 </section>;
}

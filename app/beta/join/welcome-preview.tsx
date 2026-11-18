'use client';
import {useState} from 'react';
import {SYMBOL_LIGHT,PRODUCT_NAME} from '../../../lib/brand';

const examples=[
 {label:'Understand',question:'Explain active listening using my notes.',answer:'Active listening means paying attention, reflecting back what you heard, and checking that you understood.',suggestion:'AI-written example: paraphrase a classmate’s point, then ask, “Have I understood you correctly?”'},
 {label:'Prepare',question:'Help me prepare for our class discussion.',answer:'Your note identifies listening in teams as the next discussion topic.',suggestion:'Suggested preparation: review the three listening steps, bring one example from a group project, and think of a question to ask. This is a study suggestion, not an instructor requirement.'},
 {label:'Find the source',question:'Where does that explanation come from?',answer:'The explanation uses “Listening in teams”, the sample class note saved with this course.',suggestion:'Open the note below to compare the explanation with the supporting text.'}
];
export function WelcomePreview(){
 const [selected,setSelected]=useState(0),[sourceOpen,setSourceOpen]=useState(false);
 const example=examples[selected];
 return <div className="nw-preview-area" id="product-tour">
  <fieldset className="nw-examples"><legend>Explore a conversation</legend><div>{examples.map((item,i)=><button type="button" key={item.label} aria-pressed={i===selected} onClick={()=>{setSelected(i);setSourceOpen(false);}}>{item.label}</button>)}</div></fieldset>
  <div className="nw-preview">
   <div className="nw-preview-top"><span>Conversation</span><span>Sample course</span></div>
   <div className="nw-sample-question" aria-live="polite"><span>You</span><p>{example.question}</p></div>
   <div className="nw-sample-answer" aria-live="polite" aria-atomic="true">
    <div className="nw-answer-byline"><span><img src={SYMBOL_LIGHT} alt="" width="22" height="22"/>{PRODUCT_NAME}</span><span>1 sample note</span></div>
    <p>{example.answer} <button className="nw-citation" type="button" aria-label="Open supporting sample note" aria-expanded={sourceOpen} aria-controls="nw-sample-source" onClick={()=>setSourceOpen(v=>!v)}>[1]</button></p>
    <p className="nw-suggestion">{example.suggestion}</p>
   </div>
   <div className="nw-evidence"><button type="button" aria-expanded={sourceOpen} aria-controls="nw-sample-source" onClick={()=>setSourceOpen(v=>!v)}><span aria-hidden="true">{sourceOpen?'−':'+'}</span> Listening in teams <span className="nw-source-action">{sourceOpen?'Close note':'Read note'}</span></button>
    <div id="nw-sample-source" hidden={!sourceOpen}><p>Original sample note</p><blockquote>Active listening involves attending, reflecting and checking understanding. Next class: discuss listening in teams.</blockquote></div>
   </div>
   <a className="nw-preview-next" href="#request-access">Bring your own course materials <span aria-hidden="true">↗</span></a>
  </div>
  <p className="nw-sample-caption">Illustrative example with fictional course material. This is not a live AI response.</p>
 </div>;
}

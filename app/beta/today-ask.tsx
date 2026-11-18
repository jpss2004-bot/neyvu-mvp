'use client';

import type {Dispatch,SetStateAction} from 'react';
import {ArrowUp, MessageSquare} from 'lucide-react';
import {courseLabel} from '../../lib/beta/course-label';
import {useI18n} from './language';

const nextQuestion = 'What is due next that actually applies to my courses and groups?';
type Course = {id:string; code:string; title:string};

export default function TodayAsk({courses,disabled,onAsk,onChat,onSetup,question,setQuestion,course,setCourse}:{
 courses:Course[];
 disabled:boolean;
 onAsk:(question:string,course:string)=>Promise<boolean>;
 onChat:()=>void;
 onSetup?:()=>void;
 question:string;setQuestion:Dispatch<SetStateAction<string>>;
 course:string;setCourse:Dispatch<SetStateAction<string>>;
}){
 const {t}=useI18n();
 const selected=courses.some(item=>item.id===course)?course:'';
 async function ask(value:string){
  if(!value.trim()||disabled)return;
  if(await onAsk(value.trim(),selected)){
   setQuestion(current=>current===value?'':current);
  }
 }
 return <section className="nu-today-ask" aria-label={t('Ask Neyvu')}>
  <form onSubmit={event=>{event.preventDefault();void ask(question);}} className="nu-desk-composer">
   <label className="beta-sr" htmlFor="beta-today-question">{t('Ask Neyvu')}</label>
   <textarea id="beta-today-question" rows={1} maxLength={3000} value={question} disabled={disabled} onChange={event=>setQuestion(event.target.value)} placeholder={t('Ask Neyvu about your courses…')} onKeyDown={event=>{if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)&&!event.nativeEvent.isComposing){event.preventDefault();void ask(question);}}}/>
   <div>
    <select value={selected} onChange={event=>setCourse(event.target.value)} disabled={disabled} aria-label={t('Question course')}>
     <option value="">{t('All courses')}</option>
     {courses.map(item=><option value={item.id} key={item.id}>{courseLabel(item)}</option>)}
    </select>
    <button type="submit" className="beta-primary" disabled={disabled||!question.trim()}>{t('Ask Neyvu')} <ArrowUp size={17} aria-hidden="true"/></button>
   </div>
  </form>
  <details className="nu-today-suggestions"><summary>{t("Ideas for a question")}</summary><div className="nu-today-ask-links">
   <button type="button" disabled={disabled} onClick={()=>void ask(t(nextQuestion))}>{t(nextQuestion)}</button>
   <button type="button" disabled={disabled} onClick={onChat}><MessageSquare size={16} aria-hidden="true"/> {t('Open Chat')}</button>
   {onSetup&&<button type="button" onClick={onSetup}>{t("Review your setup")}</button>}
  </div></details>
 </section>;
}

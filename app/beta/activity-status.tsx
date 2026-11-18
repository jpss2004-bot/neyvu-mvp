'use client';
import {useState} from 'react';
import {Pause,Play} from 'lucide-react';
import {SYMBOL,SYMBOL_LIGHT} from '../../lib/brand';
import {useI18n} from './language';

export function ActivityMark(){
 return <span className="nu-activity-mark" aria-hidden="true"><span className="nu-activity-orbit"/><img className="beta-brand-dark" src={SYMBOL} width="28" height="28" alt=""/><img className="beta-brand-light" src={SYMBOL_LIGHT} width="28" height="28" alt=""/></span>;
}

/** Labels describe the pending request, never a guessed model/tool activity. */
export default function ActivityStatus({label,detail,pausable=false}:{label:string;detail?:string;pausable?:boolean}){
 const {t}=useI18n(),[paused,setPaused]=useState(false);
 return <div className="nu-activity-line" data-active data-motion-paused={paused||undefined}>
  <ActivityMark/><div><p role="status" aria-live="polite">{t(label)}</p>{detail&&<small>{t(detail)}</small>}</div>
  {pausable&&<button type="button" className="nu-activity-pause" aria-label={t(paused?'Resume activity animation':'Pause activity animation')} aria-pressed={paused} onClick={()=>setPaused(v=>!v)}>{paused?<Play size={15} aria-hidden="true"/>:<Pause size={15} aria-hidden="true"/>}</button>}
 </div>;
}

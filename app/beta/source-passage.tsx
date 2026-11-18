'use client';
import {useEffect,useRef,useMemo} from 'react';
import {locateSourcePassage} from '../../lib/beta/source-focus';
import {useI18n} from './language';
export default function SourcePassage({body,excerpt}:{body:string;excerpt?:string}){
 const {t}=useI18n(),mark=useRef<HTMLElement>(null),match=useMemo(()=>locateSourcePassage(body,excerpt),[body,excerpt]);
 useEffect(()=>{const frame=requestAnimationFrame(()=>mark.current?.scrollIntoView({block:'center',inline:'nearest'}));return()=>cancelAnimationFrame(frame);},[body,excerpt]);
 return <>{excerpt&&!match&&<p className="nu-source-location-note" role="status">{t('The exact cited passage could not be located in this saved text. Review the source before relying on it.')}</p>}<pre className="nu-source-text">{match?<>{body.slice(0,match.start)}<mark ref={mark}>{body.slice(match.start,match.end)}</mark>{body.slice(match.end)}</>:body}</pre></>;
}

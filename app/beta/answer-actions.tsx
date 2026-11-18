'use client';
import {useI18n} from "./language";

import {useState} from 'react';
import ResearchExport from './research-export';
import AnswerTrace from './answer-trace';

/** Actions use the saved answer verbatim; this never regenerates its claims. */
export default function AnswerActions({text,studyHref,onStudy,disabled=false,messageId,jobId}:{messageId?:string;jobId?:string;text:string;studyHref?:string;onStudy:()=>void;disabled?:boolean}) {
 const {t:ui}=useI18n();
 const [copyStatus,setCopyStatus]=useState('');
 const [exportOpen,setExportOpen]=useState(false);
 const [copying,setCopying]=useState(false);
 async function copy(){
  setCopying(true);
  try{await navigator.clipboard.writeText(text);setCopyStatus('Answer copied.');}
  catch{setCopyStatus('Copy unavailable. Select the answer text to copy it.');}
  finally{setCopying(false);}
 }
 return <footer className="nu-answer-footer">
  {exportOpen&&messageId&&<ResearchExport message={messageId} onClose={()=>setExportOpen(false)}/>}
  <div className="nu-answer-actions">{jobId&&process.env.NEXT_PUBLIC_NEYVU_ANSWER_TRACE==='1'&&<AnswerTrace jobId={jobId}/>}{messageId&&<button type="button" onClick={()=>setExportOpen(true)}>{ui("Copy with references")}</button>}<button type="button" disabled={disabled} onClick={onStudy}>{ui("Study this answer")}</button><button type="button" disabled={copying} onClick={copy}>{copying?ui("Copying…"):ui("Copy answer text")}</button>{studyHref&&<a href={studyHref} target="_blank" rel="noopener noreferrer">{ui("Print or save PDF")}</a>}</div>
  <span className="nu-copy-status" role="status">{ui(copyStatus)}</span>
 </footer>;
}

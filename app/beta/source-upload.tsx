'use client';
import {useI18n} from "./language";

import {useEffect,useRef,useState} from 'react';
import {courseLabel} from '../../lib/beta/course-label';
type SavedFile={id:string;course_id:string;title:string;kind:'file'};
type Item={id:string;file:File;state:'queued'|'saving'|'saved'|'failed'|'uncertain'|'unsupported';detail:string;saved?:SavedFile};
const mime:Record<string,string>={ppt:'application/vnd.ms-powerpoint',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',heic:'image/heic',heif:'image/heif',csv:'text/plain',pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',txt:'text/plain',md:'text/plain'};
export default function SourceUpload({courses,defaultCourse='',readableCopy,onSaved,onOpen,onActivityChange}:{courses:{id:string;code:string;title:string}[];defaultCourse?:string;readableCopy?:{course:string};onSaved:(file:SavedFile,single:boolean,trigger?:HTMLElement)=>Promise<void>;onOpen?:(source:SavedFile,trigger:HTMLElement)=>void;onActivityChange:(active:boolean)=>void}){
 const {t:ui}=useI18n();
 const [course,setCourse]=useState(''),[items,setItems]=useState<Item[]>([]),[active,setActive]=useState(false),[message,setMessage]=useState('');
 const running=useRef(false),paused=useRef(false),savedCallback=useRef(onSaved),activityCallback=useRef(onActivityChange);
 const savedActions=useRef(new Map<string,HTMLButtonElement>());
 const pendingFiles=items.some(item=>['queued','failed','uncertain'].includes(item.state));
 const handledReadableCopy=useRef<typeof readableCopy>(undefined);
 savedCallback.current=onSaved;activityCallback.current=onActivityChange;
 useEffect(()=>{if(!running.current&&!items.length)setCourse(defaultCourse);},[defaultCourse]);
 useEffect(()=>{
  if(!readableCopy||handledReadableCopy.current===readableCopy)return;
  handledReadableCopy.current=readableCopy;
  if(running.current||pendingFiles){
   setMessage('Review the current file batch before adding a readable copy.');
   return;
  }
  setCourse(readableCopy.course);
  setMessage('Choose a readable copy for this course. Neyvu keeps the original.');
 },[readableCopy,pendingFiles]);
 useEffect(()=>{if(!active)return;const stop=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',stop);return()=>window.removeEventListener('beforeunload',stop);},[active]);
 function choose(files:FileList|null){
  if(!files||running.current)return;
  const selected=Array.from(files);
  if(selected.length>50||selected.reduce((n,file)=>n+file.size,0)>100*1024*1024){setMessage('Choose up to 50 files and 100 MB per batch. Split this folder into smaller batches.');return;}
  setMessage('');setItems(selected.map(file=>{
   const extension=file.name.toLowerCase().split('.').pop()||'';
   const error=!mime[extension]?'Unsupported file type':!file.size?'Empty file':file.size>10*1024*1024?'Larger than 10 MB':'';
   return {id:crypto.randomUUID(),file,state:error?'unsupported':'queued',detail:error};
  }));
 }
 async function start(){
  if(running.current||!course)return;
  running.current=true;paused.current=false;setActive(true);activityCallback.current(true);setMessage('Keep this browser tab open. You can use the rest of Neyvu while files save.');
  const selectedCourse=course,batch=items.filter(row=>row.state==='queued'||row.state==='failed');let savedCount=0,refreshFailed=false;
  try{
   for(const item of batch){
    if(paused.current)break;
    const update=(state:Item['state'],detail:string)=>setItems(rows=>rows.map(row=>row.id===item.id?{...row,state,detail}:row));
    update('saving','Saving original…');
    try{
     const response=await fetch('/api/beta/files?course='+encodeURIComponent(selectedCourse)+'&name='+encodeURIComponent(item.file.name),{method:'POST',headers:{'Content-Type':mime[item.file.name.toLowerCase().split('.').pop()||'']},body:item.file,signal:AbortSignal.timeout(30000)});
     const result=await response.json().catch(()=>null);
     if(!response.ok){
      const definitive=[400,401,403,409,413,415,429].includes(response.status);
      update(definitive?'failed':'uncertain',result?.error||(definitive?'The file was not accepted.':'Save unconfirmed. Check Sources before adding this file again.'));
      if(!definitive||response.status===429||response.status===401||response.status===403){paused.current=true;setMessage(response.status===429?'Uploads paused while saved documents are read. Resume after they finish.':'Uploads paused. Check the file result before continuing.');}
      continue;
     }
     if(!result?.id){update('uncertain','Save unconfirmed. Check Sources before adding this file again.');paused.current=true;continue;}
     const saved:SavedFile={id:result.id,course_id:selectedCourse,title:item.file.name,kind:'file'};
     savedCount++;setItems(rows=>rows.map(row=>row.id===item.id?{...row,state:'saved',detail:result.searchable?'Saved · Text available':'The original is saved. Text may still be processing.',saved}:row));
     // Let the saved action mount before opening its detail panel, so Back can
     // restore keyboard focus to that action rather than a disabled upload.
     await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
     try{await savedCallback.current(saved,batch.length===1,savedActions.current.get(saved.id));}catch{refreshFailed=true;setMessage('The original was saved. Sources could not refresh; use Open saved file before adding it again.');}
    }catch{
     update('uncertain','Save unconfirmed. Check Sources before adding this file again.');paused.current=true;setMessage('The connection stopped. Saved files are kept; check the uncertain file before continuing.');
    }
   }
  }finally{if(!paused.current&&!refreshFailed)setMessage(savedCount?`${savedCount} ${savedCount===1?'file':'files'} saved. Review the results below; saved originals are available in Sources.`:'No files were saved. Review the file results before retrying.');running.current=false;setActive(false);activityCallback.current(false);}
 }
 const pending=items.filter(item=>item.state==='queued'||item.state==='failed').length;
 return <section className="beta-import" aria-label={ui("Add course material")}><h2>{ui("Add your materials")}</h2><p>{ui("Import files or a folder for one course at a time. PDF, Word, PowerPoint, photos (PNG, JPEG, WebP, HEIC), XLSX, CSV, text and Markdown are supported.")}</p>
  <label>{ui("Course for this batch")}<select value={course} disabled={active} onChange={event=>setCourse(event.target.value)}><option value="">{ui("Choose a course")}</option>{courses.map(row=><option key={row.id} value={row.id}>{courseLabel(row)}</option>)}</select></label>
  <div className="beta-import-choose"><label>{ui("Add files")}<input type="file" aria-label={ui("Choose course files")} accept=".pdf,.txt,.md,.docx,.pptx,.ppt,.png,.jpg,.jpeg,.webp,.heic,.heif,.xlsx,.csv" multiple disabled={active||!course} onChange={event=>{choose(event.target.files);event.target.value='';}}/></label>
  <label>{ui("Add a folder")}<input type="file" aria-label={ui("Choose a course folder")} multiple {...{webkitdirectory:''}} disabled={active||!course} onChange={event=>{choose(event.target.files);event.target.value='';}}/></label></div>
  <small>{ui("Up to 10 MB per file. Folder import copies your selected files once; it does not watch the folder.")}</small>
  {!!items.length&&<><ul className="beta-import-list" aria-label={ui("Selected files")}>{items.map(item=><li key={item.id}><strong>{item.file.webkitRelativePath||item.file.name}</strong><span>{ui(item.detail)||ui("Ready to upload")}</span>{item.saved&&(onOpen?<button ref={node=>{if(node)savedActions.current.set(item.saved!.id,node);else savedActions.current.delete(item.saved!.id);}} type="button" onClick={event=>onOpen(item.saved!,event.currentTarget)}>{ui('Open saved file')}</button>:<a href={'/beta?tab=sources&source='+encodeURIComponent(item.saved.id)}>{ui('Open saved file')}</a>)}</li>)}</ul><div className="beta-import-actions"><button disabled={active||!course||!pending} onClick={()=>void start()}>{active?ui("Saving files…"):pending?ui("Upload {value0} {value1}",{value0:pending,value1:pending===1?ui('file'):ui('files')}):items.some(item=>item.state==='uncertain')?ui("Uploads paused"):ui("Batch finished")}</button>{active&&<button onClick={()=>{paused.current=true;setMessage('Pausing after the current file. Your saved originals are kept.');}}>{ui("Pause after this file")}</button>}</div></>}
  {message&&<p role="status">{ui(message)}</p>}
 </section>;
}

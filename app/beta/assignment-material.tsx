'use client';
import {useEffect,useState} from 'react';
import {useI18n} from './language';
import {useSourceLibrary} from './use-source-library';

type Binding={source_id:string;version_id:string;course_id:string};
export async function readAssignmentSource(binding:Binding,signal:AbortSignal,reader:typeof fetch=fetch){
 const params=new URLSearchParams({op:'source',id:binding.source_id,version:binding.version_id});
 const response=await reader('/api/beta?'+params,{credentials:'same-origin',signal});
 if(!response.ok)throw Error('Preview could not load. You can still open the saved source.');
 const source=await response.json();
 if(source.id!==binding.source_id||source.course_id!==binding.course_id||source.version_id!==binding.version_id||typeof source.body!=='string')throw Error('Preview could not load. You can still open the saved source.');
 return source as {id:string;course_id:string;version_id:string;body:string};
}
const readLibrary=async(query:string,_data?:unknown,signal?:AbortSignal)=>{
 const response=await fetch('/api/beta?'+query,{credentials:'same-origin',signal});
 if(!response.ok)throw Error('Search could not finish. Your query is kept; try again.');
 return response.json();
};
// Mounted only while one task is open. Text and the whole course-file catalogue
// load independently; neither can block progress editing or the other result.
export default function AssignmentMaterial({binding,onOpen}:{binding:Binding;onOpen:(id:string)=>void}){
 const {t}=useI18n(),scope=JSON.stringify(binding),[retry,setRetry]=useState(0),[query,setQuery]=useState('');
 const [text,setText]=useState({scope:'',body:'',error:''}),files=useSourceLibrary(true,binding.course_id,'file',query,readLibrary);
 useEffect(()=>{
  let current=true;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  readAssignmentSource(binding,controller.signal).then(source=>{if(current)setText({scope,body:source.body,error:''});}).catch(()=>{if(current)setText({scope,body:'',error:'Preview could not load. You can still open the saved source.'});}).finally(()=>clearTimeout(timer));
  return()=>{current=false;clearTimeout(timer);controller.abort();};
 },[scope,retry]);
 return <div className="nu-assignment-material">
  <section><h3>{t('Saved source text')}</h3>
   {text.scope!==scope?<p role="status">{t('Loading saved source…')}</p>:text.error?<p role="alert">{t(text.error)} <button type="button" onClick={()=>setRetry(n=>n+1)}>{t('Retry')}</button></p>:text.body.trim()?<div className="nu-assignment-text" role="region" aria-label={t('Saved source text')} tabIndex={0}>{text.body}</div>:<p>{t('No readable text was saved for this source.')}</p>}
  </section>
  <section aria-label={t('Course materials')}><h3>{t('Course materials')}</h3>
   <label>{t('Search your course materials')}<input type="search" maxLength={200} value={query} onChange={event=>setQuery(event.target.value)}/></label>
   {files.loading&&<p role="status">{t('Loading saved source…')}</p>}
   {files.error&&<p role="alert">{t(files.error)} <button type="button" onClick={files.retry}>{t('Retry')}</button></p>}
   {files.data&&<><p>{t('Documents')} ({files.data.total})</p><ul className="nu-assignment-files">{files.data.sources.map(file=><li key={file.id}><button type="button" onClick={()=>onOpen(file.id)}>{file.title}</button></li>)}</ul>{!files.data.sources.length&&<p>{t('No saved items')}</p>}<div className="nu-assignment-pages"><button type="button" disabled={files.loading||files.page===0} onClick={files.previous}>{t('Previous')}</button><span>{t('Page')} {files.page+1}</span><button type="button" disabled={files.loading||!files.data.next_cursor} onClick={files.next}>{t('Next')}</button></div></>}
  </section>
 </div>;
}

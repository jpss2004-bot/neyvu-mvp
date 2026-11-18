 'use client';
import {useEffect,useRef,useState} from 'react';
import {X,Copy,ArrowUpRight,Check} from 'lucide-react';
import {citationStyles,type CitationStyle,type ReferenceMetadata,type ResearchExportView,type ResearchReference,type FormattedResearch} from '../../lib/beta/research-types';
import './research-export.css';
async function api(message:string,body?:Record<string,unknown>){
 const response=await fetch('/api/beta/research-export'+(!body?'?message='+encodeURIComponent(message):''),body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,...body})}:{cache:'no-store'});
 const data=await response.json();if(!response.ok)throw Error(data.error||'The export could not load. Your answer is still saved.');return data;
}
function ReferenceEditor({reference,onSave,onDirty,busy}:{reference:ResearchReference;onSave:(metadata:ReferenceMetadata)=>Promise<void>;onDirty:(value:boolean)=>void;busy:boolean}){
 const [value,setValue]=useState(reference.metadata),[dirty,setDirty]=useState(false),[error,setError]=useState('');
 function change(key:keyof ReferenceMetadata,text:string){setValue(v=>({...v,[key]:text}));setDirty(true);onDirty(true);}
 useEffect(()=>()=>onDirty(false),[onDirty]);
 async function save(){setError('');try{await onSave(value);setDirty(false);onDirty(false);}catch(e){setError(e instanceof Error?e.message:'Reference details could not save.');}}
 const field=(key:keyof ReferenceMetadata,label:string)=><label>{label}<input value={value[key]} maxLength={key==='url'?2000:500} onChange={e=>change(key,e.target.value)} /></label>;
 return <div className="nu-reference-editor"><p>{reference.provenance}. These details describe the source actually read.</p>
  {field('title','Title')}<small>Check capitalization in the preview. APA uses sentence case for article and book titles; preserve proper names.</small>{field('author','Authors — Family, Given; separate authors with semicolons')}
  <small>For an organization, enter its name without a comma.</small>
  <div className="nu-reference-fields">{field('year','Publication year')}<label>Source type<select value={value.type} onChange={e=>change('type',e.target.value)}><option value="document">Course document</option><option value="speech">Lecture / slides</option><option value="article-journal">Journal article</option><option value="book">Book</option><option value="webpage">Web page</option></select></label></div>
  <details><summary>Publication details and original link</summary>{field('container','Journal / website title')}{field('publisher','Publisher')}<div className="nu-reference-fields">{field('volume','Volume')}{field('issue','Issue')}{field('pages','Article page range')}</div>{field('doi','DOI')}{field('url','Original public URL')}</details>
  <p className="nu-reference-hint">Leave unknown details blank. A saved or uploaded date is not a publication date.</p>
  <button type="button" disabled={!dirty||busy} onClick={()=>void save()}>{busy?'Saving…':'Save reference details'}</button>{error&&<p role="alert">{error} Your edit is kept.</p>}
 </div>;
}
export default function ResearchExport({message,onClose}:{message:string;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),[view,setView]=useState<ResearchExportView|null>(null),[style,setStyle]=useState<CitationStyle|''>(''),[result,setResult]=useState<FormattedResearch|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState(''),[editing,setEditing]=useState<number|null>(null),[dirty,setDirty]=useState(false),[remember,setRemember]=useState(true);
 const generation=useRef(0);
 useEffect(()=>{dialog.current?.showModal();const n=++generation.current;api(message).then(async data=>{if(n!==generation.current)return;setView(data);setStyle(data.style||'');if(data.style){setBusy(true);const formatted=await api(message,{op:'format',style:data.style});if(n===generation.current){setResult(formatted);setBusy(false);}}}).catch(e=>{if(n===generation.current){setError(e.message);setBusy(false);}});return()=>{generation.current++;};},[message]);
 function close(){if(busy||dirty){setStatus('Save your reference details or cancel the edit before closing.');return;}onClose();}
 async function prepare(){if(!view||!style)return;setBusy(true);setError('');setStatus('');setResult(null);try{
  if(remember&&view.course_id&&!view.style_evidence&&style!==view.style){const next=await api(message,{op:'style',style,revision:view.style_revision});setView(next);}
  setResult(await api(message,{op:'format',style}));
 }catch(e){setError(e instanceof Error?e.message:'The references could not be prepared.');}finally{setBusy(false);}}
 async function saveReference(ref:ResearchReference,metadata:ReferenceMetadata){setBusy(true);try{const next=await api(message,{op:'metadata',source_id:ref.id,version_id:ref.version_id,revision:ref.revision,metadata});setView(next);setResult(null);setStatus('Reference details saved for this exact source version.');}finally{setBusy(false);}}
 async function copy(){if(!result)return;setError('');try{
  if(typeof ClipboardItem!=='undefined'&&navigator.clipboard?.write){await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([result.html],{type:'text/html'}),'text/plain':new Blob([result.text],{type:'text/plain'})})]);setStatus('Copied with formatting and references. Paste into Word or Google Docs.');}
  else{await navigator.clipboard.writeText(result.text);setStatus('Copied as plain text with references. Paste into your document.');}
 }catch{setError('Clipboard access was blocked. Select the preview text to copy it, or download the text copy.');}}
 function download(){if(!result)return;const url=URL.createObjectURL(new Blob([result.text],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='Neyvu research note.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 return <dialog className="nu-research-dialog" ref={dialog} aria-labelledby="research-export-title" onCancel={e=>{e.preventDefault();close();}} onClick={e=>{if(e.target!==dialog.current)return;const b=dialog.current.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)close();}}>
  <header><div><p>{view?.course_label||'Your research'}</p><h2 id="research-export-title">Take this into your work</h2></div><button type="button" aria-label="Close research export" onClick={close}><X size={20}/></button></header>
  <div className="nu-research-body">
   {!view&&!error&&<p role="status">Opening the saved answer and its references…</p>}
   {status&&<p role="status" className="nu-research-status"><Check size={16}/>{status}</p>}
   {view&&<><div className="nu-reference-style"><label>Citation style<select value={style} disabled={busy||dirty} onChange={e=>{setStyle(e.target.value as CitationStyle);setResult(null);setStatus('');}}><option value="">Choose a style</option>{Object.entries(citationStyles).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><button type="button" disabled={!style||busy||dirty} onClick={()=>void prepare()}>{busy?'Preparing…':result?'Refresh preview':'Prepare copy'}</button></div>
   {view.style_evidence?<p className="nu-style-evidence">Syllabus requirement: “{view.style_evidence.quote}” <a href={'/beta?source='+view.style_evidence.source_id+'&version='+view.style_evidence.version_id} target="_blank" rel="noreferrer">Open source <ArrowUpRight size={13}/></a>{style!==view.style&&' This export uses your selected override.'}</p>:view.course_id?<label className="nu-remember-style"><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/> Remember this style for {view.course_label}</label>:<p className="nu-reference-hint">This answer spans courses. The style applies to this export only.</p>}
   {view.style_conflict&&<p role="note">Saved syllabi disagree about citation style. Check the requirement for this assignment before choosing.</p>}
   {result&&<><div className="nu-research-copy-actions"><button className="beta-primary" type="button" onClick={()=>void copy()} disabled={busy||dirty}><Copy size={16}/> Copy for Word</button><button type="button" onClick={download}>Download text</button></div>
    {result.warnings.length>0&&<div className="nu-reference-warning" role="note"><strong>Some references need a check</strong><p>{result.warnings.join(' ')}</p></div>}
    <section className="nu-research-preview" aria-label="Explanation and references preview" dangerouslySetInnerHTML={{__html:result.html.replace(/^[\s\S]*?<body>/,'').replace(/<\/body>[\s\S]*$/,'')}}/>
   </>}
   <details className="nu-reference-list" open={editing!==null||undefined}><summary>Review reference details <span>{view.references.length}</span></summary><p>Course material is cited as the material Neyvu read. A study mentioned inside it is not automatically treated as a source we verified.</p>
    {view.references.map(ref=><section key={ref.number} className="nu-reference-item"><div><strong>[{ref.number}] {ref.metadata.title}</strong><span>{ref.missing.length?'Draft · missing '+ref.missing.join(', '):'Metadata complete · '+ref.provenance}</span></div>
     <div className="nu-reference-item-actions">{ref.href&&<a href={ref.href} target="_blank" rel="noreferrer">Inspect saved source <ArrowUpRight size={13}/></a>}<button type="button" disabled={busy||dirty&&editing!==ref.number||ref.state==='unavailable'} onClick={()=>{if(dirty){setStatus('Save your edit or use Cancel edit first.');return;}setEditing(editing===ref.number?null:ref.number);}}>{editing===ref.number?'Close details':'Edit details'}</button></div>
     {editing===ref.number&&<><ReferenceEditor key={ref.id+':'+ref.version_id} reference={ref} busy={busy} onSave={data=>saveReference(ref,data)} onDirty={setDirty}/><button type="button" disabled={busy} onClick={()=>{if(dirty&&!window.confirm('Discard these unsaved reference edits?'))return;setDirty(false);setEditing(null);}}>Cancel edit</button></>}
    </section>)}
   </details>
   <p className="nu-research-attribution">Formatting: <a href="/citation-licenses/README.txt" target="_blank" rel="noreferrer">citeproc-js · Citation Style Language</a></p>
   </>}
   {error&&<p role="alert" className="nu-reference-warning">{error}{!view&&<button type="button" onClick={()=>{setError('');api(message).then(data=>{setView(data);setStyle(data.style||'');}).catch(e=>setError(e.message));}}>Retry</button>}</p>}
  </div>
 </dialog>;
}

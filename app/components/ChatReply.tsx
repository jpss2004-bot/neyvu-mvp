'use client';
import {memo,useMemo,useRef,useId} from 'react';
import {FileText,ChevronDown} from 'lucide-react';
import type {Message} from '../../lib/types';
import type {Source} from '../../lib/pilot';
import {time} from '../../lib/types';
import {safeLink} from '../../lib/policy';
import {citationNumbers} from '../../lib/replies';
import Markdown from './Markdown';
import AnswerBlocks from './AnswerBlocks';

function ChatReply({message,onTask,onNotes,onSave}:{message:Message;onTask?:(id:string)=>void;onNotes?:(course:string)=>void;onSave?:()=>void}) {
 const panel=useRef<HTMLDetailsElement>(null),container=useRef<HTMLDivElement>(null);
 const id=useId();
 const sources=message.sources||[];
 const cited=useMemo(()=>{const used=citationNumbers([message.content,message.details,message.caution].join('\n'),sources.length);for(const b of message.blocks||[])if(b.type!=='sources')for(const item of b.items)if(item.source_number)used.add(item.source_number);return used;},[message.content,message.details,message.caution,message.blocks,sources.length]);
 const groups=useMemo(()=>{
   const rows=new Map<string,{source:Source;numbers:number[];href?:string;cited:boolean}>();
   sources.forEach((source,i)=>{
     const href=source.file_id?'/api/pilot/files/'+encodeURIComponent(source.file_id):source.url&&safeLink(source.url)||undefined;
     const key=(source.course||'')+'|'+(href||source.id);
     const found=rows.get(key);
     if(found){found.numbers.push(i+1);found.cited||=cited.has(i+1);}
     else rows.set(key,{source,numbers:[i+1],href,cited:cited.has(i+1)});
   });return [...rows.values()];
 },[sources,cited]);
 function openSource(number:number) {
   if(panel.current)panel.current.open=true;
   requestAnimationFrame(()=>{
     const target=container.current?.querySelector<HTMLElement>(`[data-source-number="${number}"]`);
     target?.closest('details')?.setAttribute('open','');
     const row=target?.closest('li');
     (row?.querySelector<HTMLElement>('a')||row?.querySelector<HTMLElement>('.source-title'))?.focus({preventScroll:true});row?.scrollIntoView({block:'nearest',behavior:'instant'});
   });
 }
 function sourceRows(rows:typeof groups) {
   return <ol className="chat-source-list">{rows.map(({source,numbers,href})=><li key={numbers[0]}>
     {numbers.map(number=><span key={number} id={id+'-source-'+number} data-source-number={number} className="source-target"/>)}
     <div className="source-title" tabIndex={-1}>{href?<a href={href} target="_blank" rel="noopener noreferrer">{numbers.join(', ')}. {source.title}</a>:<span>{numbers.join(', ')}. {source.title}</span>}</div>
     <small>{source.course?source.course+' · ':''}{source.kind==='assistant_draft'?'AI draft · review required':source.kind==='personal_note'?'Saved note':source.kind==='file'?'Saved file':'Saved evidence'}{source.observed_at?' · Observed '+time(source.observed_at):''}</small>
     {source.excerpt?<details className="source-excerpt"><summary>View supplied excerpt{source.extract_truncated?' · partial text':''}</summary><Markdown text={source.excerpt}/></details>:null}
   </li>)}</ol>;
 }
 const historicalLong=!message.details&&!message.caution&&message.content.split(/\s+/).length>300;
 const citedGroups=groups.filter(row=>row.cited),otherGroups=groups.filter(row=>!row.cited);
 return <div className="message-body chat-reply" ref={container}>
   <span className="message-label">School assistant</span>
   {historicalLong?<details className="reply-details historical-reply"><summary>Earlier detailed reply</summary><p className="reply-provenance">Saved from an earlier assistant version. Original text is preserved.</p><Markdown text={message.content} citationCount={sources.length} onCitation={openSource}/></details>:<Markdown text={message.content} citationCount={sources.length} onCitation={openSource}/>}
   {message.blocks?.length?<AnswerBlocks blocks={message.blocks} sources={sources} onTask={onTask} onNotes={onNotes} onCitation={openSource}/>:null}
   {message.caution?<div className="reply-caution"><Markdown text={message.caution} citationCount={sources.length} onCitation={openSource}/></div>:null}
   {message.details?<details className="reply-details" open={message.expandDetails||undefined}><summary>{message.detailsLabel||(message.expandDetails?'Steps and explanation':'More detail')}</summary><Markdown text={message.details} citationCount={sources.length} onCitation={openSource}/></details>:null}
   {groups.length?<details ref={panel} className="reply-sources"><summary><FileText size={14} aria-hidden="true"/>{citedGroups.length?'Sources':'Material provided'} <span>{citedGroups.length||groups.length}</span><ChevronDown size={14} aria-hidden="true"/></summary>
     <p className="reply-provenance">{message.mode?.startsWith('Local AI')?'The answer uses selected saved extracts. A citation does not verify the whole file.':'Saved evidence accompanies this reply.'}</p>
     {sourceRows(citedGroups.length?citedGroups:groups)}
     {citedGroups.length&&otherGroups.length?<details className="other-sources"><summary>Other material provided ({otherGroups.length})</summary>{sourceRows(otherGroups)}</details>:null}
   </details>:null}
 {onSave&&message.id?<button type="button" className="save-answer" onClick={onSave}>Save as a note</button>:null}
 </div>;
}
export default memo(ChatReply);

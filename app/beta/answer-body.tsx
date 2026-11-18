'use client';
import type {ReactNode} from 'react';
import {useI18n} from './language';
import {workerCourse} from '../../lib/beta/course-codes';
import {revisionComparison,revisionDiff} from '../../lib/beta/revision-comparison';
// Only Neyvu's explicit planning table is recognized; arbitrary model tables
// and source text are never interpreted as HTML or component instructions.
function cells(line:string){return line.trim().replace(/^\||\|$/g,'').split(/(?<!\\)\|/).map(c=>c.trim().replace(/\\\|/g,'|'));}
// Match the labels used by the worker after a citation has identified the exact activity.
export function matchesPlanningWorkTitle(label:string,activityTitle:string,courseCode:string){
 const savedLabel=(value:string,limit:number)=>Array.from(value.trim().replace(/\s+/g,' ').replace(/\[\d+\]/g,'')).slice(0,limit).join('').trim();
 const title=savedLabel(activityTitle,180);
 if(!title)return false;
 if(label===title)return true;
 const course=savedLabel(workerCourse({code:courseCode}).code,80);
 const shortCode=course.match(/\b[A-Z]{2,5}\s*\d{3,4}[A-Z]?\b/)?.[0]||course;
 return !!shortCode&&label===shortCode+' · '+title;
}
export function answerParts(text:string){
 const lines=text.split('\n'),index=lines.findIndex((l,i)=>l.trim().startsWith('|')&&cells(l).length===4&&/^\|(?:\s*:?-+:?\s*\|){4}$/.test(lines[i+1]?.trim()||''));
 if(index<0||!/^\|(?:\s*:?-+:?\s*\|){4}$/.test(lines[index+1]?.trim()||''))return null;
 let end=index+2;while(end<lines.length&&lines[end].startsWith('|')&&cells(lines[end]).length===4&&end<index+62)end++;
 return {before:lines.slice(0,index).join('\n'),head:cells(lines[index]),rows:lines.slice(index+2,end).map(cells),after:lines.slice(end).join('\n')};
}
export default function AnswerBody({text,render,rowAction}:{text:string;render:(text:string)=>ReactNode;rowAction?:(row:string[],head:string[])=>ReactNode}){
 const {t}=useI18n();
 const revision=revisionComparison(text);
 if(revision){const diff=revisionDiff(revision.before,revision.after);return <>{render(revision.prefix)}<section className="nu-revision-comparison" aria-label={t('Compare current and proposed wording')}><div><p className="nu-revision-label">{t('Current wording')}</p><p className="nu-revision-text">{diff.filter(part=>part.kind!=='added').map((part,i)=>part.kind==='removed'?<del key={i}>{part.text}</del>:part.text)}</p></div><div><p className="nu-revision-label">{t('Proposed revision')}</p><p className="nu-revision-text">{diff.filter(part=>part.kind!=='removed').map((part,i)=>part.kind==='added'?<ins key={i}>{part.text}</ins>:part.text)}</p></div></section><p className="nu-revision-legend">{t('Removed words are struck through; added words are underlined. Review the supporting passage before changing your draft.')}</p>{render(revision.suffix)}</>;}
 const table=answerParts(text);
 if(table){
  function nextAction(cell:string){
   const why=cell.lastIndexOf(' Why: ');
   if(why<0)return render(cell);
   const reason=cell.slice(why+6),citation=reason.match(/\s\[\d+\]$/);
   return <>{render(cell.slice(0,why)+(citation?.[0]||''))}<details><summary>{t('Why this?')}</summary>{render(citation?reason.slice(0,citation.index):reason)}</details></>;
  }
  return <>{render(table.before)}<div className="nu-plan-table"><table role="table" aria-label={t('Study tasks')}>
   <thead role="rowgroup"><tr role="row">{table.head.map(h=><th role="columnheader" key={h} scope="col">{h}</th>)}</tr></thead>
   <tbody role="rowgroup">{table.rows.map((row,i)=><tr role="row" key={i}>{row.map((cell,j)=><td role="cell" data-label={table.head[j]} key={j}>{j===2?<>{nextAction(cell)}{rowAction?.(row,table.head)}</>:render(cell)}</td>)}</tr>)}</tbody>
  </table></div>{(()=>{const at=table.after.search(/^### (?:More saved actions|Information to check|Classes (?:and office hours )?to plan around|Check before planning|Closed activities|Already submitted|Your projects)/m);return at<0?render(table.after):<>{render(table.after.slice(0,at))}<details className="nu-more-planning"><summary>{t('Other work, status checks and context')}</summary>{render(table.after.slice(at))}</details></>;})()}</>;
 }
 const starts=[...text.matchAll(/^### (?:Source|Reading|Fuente|Lectura)\s+(?:\[\d+\]|\d+).*$/gm)];
 if(!/^## (?:Class preparation|Preparaci[oó]n(?: para| de)? (?:la )?clase)/.test(text)||!starts.length)return <>{render(text)}</>;
 const first=starts[0].index!,sections=[];let tail='';
 for(let i=0;i<starts.length;i++){const start=starts[i].index!,next=starts[i+1]?.index??text.length,raw=text.slice(start,next),boundary=raw.search(/\n### (?!Source\s|Reading\s|Fuente\s|Lectura\s)/);const section=boundary>=0?raw.slice(0,boundary):raw;if(boundary>=0)tail+=raw.slice(boundary);const line=section.indexOf('\n');sections.push({title:line<0?section.slice(4):section.slice(4,line),body:line<0?'':section.slice(line+1)});}
 return <>{render(text.slice(0,first))}<div className="nu-preparation-sources">{sections.map((section,i)=><details key={i}><summary>{section.title}</summary>{render(section.body)}</details>)}</div>{render(tail)}</>;
}

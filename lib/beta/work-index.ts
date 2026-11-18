import type {ContinuingWork} from './planning-view';

export type WorkEntry={work:ContinuingWork;related:ContinuingWork[]};
/** Presentation grouping only: never merge persisted intentions or versions.
 * Ambiguous source-to-task matches stay separate, as do courses and versions.
 */
export function workIndex(items:ContinuingWork[]):WorkEntry[]{
 const entries=items.filter(item=>item.kind==='task').map(work=>({work,related:[] as ContinuingWork[]}));
 for(const work of items.filter(item=>item.kind==='plan')){
  const matches=entries.filter(entry=>entry.work.kind==='task'&&work.source_id&&work.version_id&&entry.work.course_id===work.course_id&&entry.work.source_id===work.source_id&&entry.work.version_id===work.version_id);
  if(matches.length===1)matches[0].related.push(work);
  else entries.push({work,related:[]});
 }
 return entries.sort((a,b)=>items.indexOf(a.work)-items.indexOf(b.work));
}

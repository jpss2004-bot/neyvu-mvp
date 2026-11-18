import {zoneDate} from './agenda';

type Row={id?:string;source_id:string;version_id:string;course_id:string;evidence?:any;observed_at?:string};
// The requested week, rather than collection order, determines admission to
// bounded answer context. Preserve source/version identity and course coverage.
export function prioritizeWeeklyEvidence<T extends Row>(rows:T[],window:{start:string;end:string},zone:string,progress:{task_id:string;planned_on:string|null}[]=[],limit=30){
 const date=(r:T)=>typeof r.evidence?.due_at==='string'&&Number.isFinite(Date.parse(r.evidence.due_at))?zoneDate(new Date(r.evidence.due_at),zone):r.evidence?.due_date||'';
 const rank=(r:T)=>{const d=date(r),planned=progress.find(p=>p.task_id===r.id)?.planned_on;return d>=window.start&&d<=window.end||planned&&planned>=window.start&&planned<=window.end?0:d&&d<window.start?1:2;};
 const ordered=rows.map((row,index)=>({row,index})).sort((a,b)=>rank(a.row)-rank(b.row)||String(date(a.row)||'9999').localeCompare(String(date(b.row)||'9999'))||String(a.row.evidence?.due_at||'').localeCompare(String(b.row.evidence?.due_at||''))||a.index-b.index);
 const selected=new Map<string,T>();
 for(const {row} of ordered){const key=row.source_id+':'+row.version_id;if(!selected.has(key)&&selected.size<limit)selected.set(key,row);}
 return selected;
}

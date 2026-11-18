import type {Assessment} from './assessments-format';
import type {AgendaItem,BetaTask} from './agenda';
import {zoneDate} from './agenda';
export function assessmentAgenda(claims:Assessment[],tasks:BetaTask[],courseIds:string[],start:string,end:string,zone='UTC'):AgendaItem[]{
 const key=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
 return claims.filter(a=>courseIds.includes(a.courseId)&&a.sourceKind!=='student_plan'&&a.sourceId&&a.version&&a.date>=start&&a.date<=end&&!tasks.some(t=>t.course_id===a.courseId&&key(String(t.evidence?.title||''))===key(a.key)&&(typeof t.evidence?.due_at==='string'&&Number.isFinite(Date.parse(t.evidence.due_at))?zoneDate(new Date(t.evidence.due_at),zone):t.evidence?.due_date)===a.date)).map(a=>({
  id:'assessment:'+a.courseId+':'+a.key+':'+a.version,date:a.date,time:'',kind:'assessment',title:a.key,course_id:a.courseId,source_id:a.sourceId!,version_id:a.version!,
  authority:'Quoted assessment date · time not stated',note:a.quote+(a.conflicts.some(c=>!c.olderSyllabusVersion&&c.date!==a.date)?' Sources disagree about the date; check the saved versions.':''),
 }));
}

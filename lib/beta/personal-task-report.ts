// Read-only interpretation of explicit saved student reports. This never
// creates a progress row or a Moodle receipt, and never infers task completion
// from an artifact, deadline, grade, future plan or assistant text.
export type PersonalTaskReport={state:'submitted'|'finished';memory_id:string;revision:number;updated_at:string;task_id:string;source_id:string;quote:string;needs_review:boolean};
type Task={id:string;course_id:string;source_id:string;evidence?:any;source_observed_at?:string};
type Memory={id:string;kind:string;course_id:string|null;body:string;revision:number;updated_at:string};
const activity=/\b(assignment|homework|hw|quiz|test)\s*(\d+)\b/gi;
const canonical=(s:string)=>/^(assignment|homework|hw)$/i.test(s)?'assignment':s.toLowerCase();
const code=(s:string)=>s.replace(/[^A-Z0-9]/gi,'').toUpperCase();
const part=(s:string)=>s.toLowerCase().match(/\b(online|written)\b/)?.[1]||null;
export function personalTaskReports(tasks:Task[],courses:{id:string;code:string}[],memories:Memory[]):Record<string,PersonalTaskReport>{
 const result:Record<string,PersonalTaskReport>={};
 const ordered=memories.filter(m=>m.kind==='progress').sort((a,b)=>Date.parse(b.updated_at)-Date.parse(a.updated_at));
 for(const task of tasks){
  const target=String(task.evidence?.title||'').match(new RegExp(activity.source,'i')),course=courses.find(c=>c.id===task.course_id);if(!target||!course)continue;
  let settled=false;
  for(const m of ordered){
   const matches=[...m.body.matchAll(new RegExp(activity.source,'gi'))];
   for(let i=0;i<matches.length;i++){
    const match=matches[i];if(canonical(match[1])!==canonical(target[1])||Number(match[2])!==Number(target[2]))continue;
    const prefix=m.body.slice(Math.max(0,match.index!-70),match.index),before=prefix.split(/[.;,\n]/).at(-1)||'',tail=m.body.slice(match.index!+match[0].length,Math.min(matches[i+1]?.index??m.body.length,match.index!+match[0].length+110)).split(/[.;,\n]/)[0];
    const named=[...prefix.matchAll(/\b[A-Z]{2,5}[ -]?\d{3,4}[A-Z]?\b/gi)].at(-1)?.[0];
    if(named?code(named)!==code(course.code):m.course_id!==task.course_id)continue;
    const done=tail.match(/\b(submitted|finished|completed|complete|done)\b/i),earlier=before.match(/\b(?:I|we)(?: have)?\s+(submitted|finished|completed)\s*$/i);const negativeBefore=/\b(?:I|we)\s+(?:have not|did not|haven.t|didn.t|never|have never)\s+(?:submit|submitted|finish|finished|complete|completed)\s*$/i.test(before);if(!done&&!earlier&&!negativeBefore)continue;
    const clause=before+' '+(done?tail.slice(0,done.index):tail),reportedPart=part(done?tail.slice(0,done.index):before),targetPart=part(String(task.evidence?.title||''));
    if((reportedPart||targetPart)&&reportedPart!==targetPart)continue;
    if(/\b(will|might|could|would|should|if|unless|whether|hypothetical|suppose|plan to|want to|hope to)\b/i.test(clause))continue;
    // A newer explicit negative blocks an older positive without inventing
    // a new official status. It remains available in saved personal memory.
    if(/\b(not|never|haven.t|didn.t|have not|did not)\b/i.test(clause)){settled=true;break;}
    const state=(done?.[1]||earlier?.[1]||'').toLowerCase()==='submitted'?'submitted':'finished';
    result[task.id]={state,memory_id:m.id,revision:m.revision,updated_at:new Date(m.updated_at).toISOString(),task_id:task.id,source_id:task.source_id,quote:m.body,needs_review:!!task.source_observed_at&&Date.parse(task.source_observed_at)>Date.parse(m.updated_at)};settled=true;break;
   }
   if(settled)break;
  }
 }
 return result;
}

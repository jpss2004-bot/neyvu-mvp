export type AnswerActivity={label:string;source_title?:string;course?:string};
// Only durable reader checkpoints can name a source as being read. A list of
// selected sources alone does not establish that reading has started.
export function answerActivity(job:any):AnswerActivity|null{
 if(job.status!=='leased')return null;
 const entries=job.reading_plan?.entries;
 if(!Array.isArray(entries)||!entries.length)return {label:'Preparing your answer'};
 const active=entries.find((e:any)=>e.state&&e.state.complete_saved_text_processed!==true&&Array.isArray(e.state.processed_sections)&&e.state.processed_sections.length>0);
 if(active){const source=(job.activity_sources||[]).find((s:any)=>s.id===active.id&&s.version_id===active.version_id);if(source)return {label:'Reading saved material',source_title:String(source.title||'').slice(0,180),course:String(source.course||'').slice(0,80)};}
 if(entries.every((e:any)=>e.state?.complete_saved_text_processed===true))return {label:'Building your answer from saved sources'};
 return {label:'Preparing your answer'};
}

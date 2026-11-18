import type {WeekPriority} from './week-priorities';

export type CourseworkMaterial={id:string;version_id:string;course_id:string;title:string;kind:string;original_url:string|null;observed_at:string;has_original:boolean;role:'saved_source'|'activity_observation'|'status_observation'|'catalogue'|'discussion';question?:{quote:string;unit:string|null;line:number;response_format:string|null;limitation?:string|null}};
export type CourseworkCatalogue={materials:CourseworkMaterial[];truncated:boolean;scope:'current-course-saved-material'};
export type MaterialConnection={source:CourseworkMaterial;relationship:'title_match'|'date_source'|'activity_source';reason:string};

// This is a navigation suggestion, not an assignment-attachment or authority test.
// The named numbered assessment/assignment must match in the same course.
function workKey(title:string){
 const match=title.match(/\b(assignment|test|quiz|exam|midterm)\s*(\d+|iv|iii|ii|i)\b/i);
 if(!match)return null;const numbers:Record<string,string>={i:'1',ii:'2',iii:'3',iv:'4'};
 return [match[1].toLowerCase(),numbers[match[2].toLowerCase()]||match[2]].join(' ');
}
export function connectedCourseworkMaterials(work:WeekPriority,materials:CourseworkMaterial[]):MaterialConnection[]{
 const key=workKey(work.title);if(!key)return [];
 const direct=materials.find(m=>m.id===work.source_id&&m.version_id===work.version_id&&m.course_id===work.course_id&&m.role==='saved_source'&&(m.question||workKey(m.title)===key));
 const exact:MaterialConnection[]=direct?[{source:direct,relationship:work.kind==='assessment'?'date_source':'activity_source',reason:work.kind==='assessment'?'This exact saved version supplied the assessment date. It does not establish complete reading coverage.':'This is the exact saved source version linked to the activity.'}]:[];
 const suggested:MaterialConnection[]=materials.filter(m=>m.course_id===work.course_id&&m.kind!=='ai_draft'&&m.role==='saved_source'&&m.id!==work.source_id&&workKey(m.title)===key)
  .sort((a,b)=>Number(/study\s*guide|checklist|instructions/i.test(b.title))-Number(/study\s*guide|checklist|instructions/i.test(a.title))||Number(b.has_original)-Number(a.has_original)||a.title.localeCompare(b.title)||a.id.localeCompare(b.id))
  .slice(0,3).map(source=>({source,relationship:'title_match',reason:'Same course and numbered work in the source title; assigned status is not verified.'}));
 return [...exact,...suggested].slice(0,3);
}
export function courseworkMaterialStep(work:WeekPriority,connection?:MaterialConnection){
 const material=connection?.source;
 if(material?.question)return {action:'Write an answer to this saved question, then compare it with the reading.',result:material.question.response_format?'Use the response format quoted in the source: '+material.question.response_format:'Identify one part your answer cannot yet support from the reading.',source:material,question:material.question};
 if(material)return {action:'Open “'+material.title+'” and identify the first output it asks for in “'+work.title+'”.',result:'Keep one checkable next step from that source; this suggested connection still needs your review.',source:material,question:null};
 return {action:'Open the saved evidence for “'+work.title+'” and check the activity’s instructions before starting.',result:'If the saved evidence contains only status or dates, check the original activity for the missing instructions.',source:null,question:null};
}
export function courseworkMaterialGroups(work:WeekPriority[],materials:CourseworkMaterial[]){
 const matched=work.filter(w=>connectedCourseworkMaterials(w,materials).some(c=>c.source.has_original||c.source.question));
 const ids=new Set(matched.map(w=>w.id));
 return {featured:matched.slice(0,3),more:matched.slice(3),other:work.filter(w=>!ids.has(w.id))};
}

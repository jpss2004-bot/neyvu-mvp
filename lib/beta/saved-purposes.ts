import {writingActivity} from './writing-target';
export type PurposeMemory={id:string;kind:string;course_id:string|null;chat_id:string|null;revision:number;updated_at:string;body:string};
export type SavedPurpose={key:string;label:string;state:'saved'|'missing'|'conflict';values:{text:string;memory_id:string;revision:number;updated_at:string;changed_since_answer:boolean}[]};
// Exact declared purpose lines only. A positively rated proposed sentence is
// not a purpose declaration or approval. Never fall back to old answer prose.
export function savedPurposes(draft:{title:string;course_id:string;text:string},memories:PurposeMemory[],chatId:string,answerMemories:PurposeMemory[]=[]):SavedPurpose[]{
 const activity=writingActivity(draft.title);if(!activity)return [];
 const project=draft.text.match(/My Featured section highlights an? ([\p{L}\p{N} -]{1,60}?) engineering story/iu)?.[1];
 const definitions=[...(project?[{key:'client',label:project+' engineering story',pattern:/(?:^|—)[ \t]*Client takeaway:[ \t]*([^\n]+)/im}]:[]),...(/\bportfolio\b/i.test(draft.text)?[{key:'portfolio',label:'Summer portfolio',pattern:/^Portfolio purpose:[ \t]*([^\n]+)/im}]:[]),...(/\bresearch announcement\b/i.test(draft.text)?[{key:'research',label:'Research announcement',pattern:/^Research purpose:[ \t]*([^\n]+)/im}]:[])];
 return definitions.map(item=>{
  const values=memories.flatMap(m=>{
   if(!['choice','correction'].includes(m.kind)||m.course_id!==draft.course_id||m.chat_id&&m.chat_id!==chatId||new Set((m.body.match(/\b(?:assignment|essay|report|case|project)\s+\d{1,3}\b/gi)||[]).map(x=>x.toLowerCase().replace(/\s+/g,' '))).size!==1||!new RegExp('\\b'+activity.replace(' ','\\s+')+'\\b','i').test(m.body))return [];
   const text=m.body.match(item.pattern)?.[1]?.trim();if(!text||text.length>650)return [];
   const old=answerMemories.find(x=>x.id===m.id);return [{text,memory_id:m.id,revision:m.revision,updated_at:new Date(m.updated_at).toISOString(),changed_since_answer:!old||old.revision!==m.revision||old.body!==m.body}];
  });const unique=new Set(values.map(v=>v.text.toLowerCase().replace(/\s+/g,' ')));return {key:item.key,label:item.label,state:unique.size>1?'conflict':unique.size?'saved':'missing',values};
 });
}

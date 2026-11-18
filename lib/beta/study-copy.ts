import {tenant,uuid} from './db';
import {BetaHttpError} from './http';
import {calculationRecord,type CalculationRecord} from './calculation-record';
import {moodleURL} from './companion';
import {moodleFileURL} from './moodle-files';

export type StudyCopySource={number:number;id?:string;version_id?:string;title:string;kind:string;href?:string;original_url?:string;observed_at?:string;state:'available'|'changed'|'unavailable';sha256?:string};
export type StudyCopy={message_id:string;chat_id:string;question:string;answer:string;created_at:string;timezone:string;course:{code:string;title:string}|null;calculation?:CalculationRecord;sources:StudyCopySource[]};
export function studyOriginalUrl(raw:unknown){
 if(typeof raw!=='string'||raw.length>2000)return undefined;
 for(const validate of [moodleURL,moodleFileURL])try{return validate(raw);}catch{}
 return undefined;
}
export async function readStudyCopy(user:string,messageId:string):Promise<StudyCopy>{
 if(!uuid(messageId))throw new BetaHttpError('Invalid answer');
 return tenant(user,async c=>{
  // A generation ID binds this immutable answer to its actual question. Never
  // choose a neighboring message or match equal text from another generation.
  const row=(await c.query(`SELECT m.id,m.chat_id,m.content,m.sources,m.created_at,j.input->>'question' AS question,j.result->'content' AS result,co.code,co.title,u.timezone
   FROM schoolvault.messages m JOIN schoolvault.jobs j ON j.user_id=m.user_id AND j.id::text=m.content->>'job_id' AND j.chat_id=m.chat_id AND j.kind='answer' AND j.status='complete'
   JOIN schoolvault.users u ON u.id=m.user_id AND u.disabled_at IS NULL
   LEFT JOIN schoolvault.courses co ON co.user_id=m.user_id AND co.id::text=j.input->>'course_id'
   WHERE m.user_id=$1 AND m.id=$2 AND m.role='assistant' AND m.content->>'type'='answer'`,[user,messageId])).rows[0];
  if(!row)throw new BetaHttpError('This saved answer is not available as a study copy. Open its conversation or ask again.',404);
  if(typeof row.question!=='string'||typeof row.content.text!=='string'||row.result?.text!==row.content.text)throw new BetaHttpError('The saved answer record could not be checked. Open its conversation and ask again.',409);
  let calculation:CalculationRecord|undefined;
  try{calculation=calculationRecord(row.content.calculation,row.question,row.content.text);}
  catch{throw new BetaHttpError('The calculation record no longer matches this answer. Ask again for a fresh calculation.',409);}
  const refs=Array.isArray(row.sources)?row.sources.slice(0,30):[];
  const pairs=refs.filter(ref=>uuid(ref?.id)&&uuid(ref?.version_id)).map(ref=>({id:ref.id,version:ref.version_id}));
  const versions=pairs.length?(await c.query(`SELECT s.id,s.current_version,v.id AS version_id,v.sha256,v.observed_at
   FROM jsonb_to_recordset($2::jsonb) ref(id uuid,version uuid)
   JOIN schoolvault.sources s ON s.user_id=$1 AND s.id=ref.id
   JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.source_id=s.id AND v.id=ref.version`,[user,JSON.stringify(pairs)])).rows:[];
  const sources=refs.map((ref,index):StudyCopySource=>{
   const version=versions.find(v=>v.id===ref?.id&&v.version_id===ref?.version_id);
   return {number:index+1,title:typeof ref?.title==='string'?ref.title.slice(0,180):'Saved source',kind:typeof ref?.kind==='string'?ref.kind:'unknown',
    ...(uuid(ref?.id)?{id:ref.id}:{}),...(uuid(ref?.version_id)?{version_id:ref.version_id}:{}),
    ...(version?{href:'/beta?source='+version.id+'&version='+version.version_id,sha256:version.sha256,observed_at:new Date(version.observed_at).toISOString()}:{}),
    ...(studyOriginalUrl(ref?.original_url)?{original_url:studyOriginalUrl(ref.original_url)}:{}),
    state:!version?'unavailable':version.current_version===version.version_id?'available':'changed'};
  });
  return {message_id:row.id,chat_id:row.chat_id,question:row.question,answer:row.content.text,created_at:new Date(row.created_at).toISOString(),timezone:row.timezone,
   course:row.code?{code:row.code,title:row.title}:null,...(calculation?{calculation}:{}),sources};
 });
}

export {studyCopyDate} from './study-date';

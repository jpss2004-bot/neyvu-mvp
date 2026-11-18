import {tenant,uuid} from './db';
import {planningState} from './student-planning';
import {sourceBlocks} from './source-blocks';
import {savedSourceCatalogue} from './source-material';
import {unverifiedForumSource} from './source-authority';
import type {CourseworkCatalogue,CourseworkMaterial} from './coursework-materials';

export function savedStudyQuestion(title:string,body:string):CourseworkMaterial['question']{
 if(!/study\s*guide|review\s*questions|practice\s*(?:test|exam|questions)/i.test(title))return;
 // An exact, complete question from a located source block, never an AI answer.
 for(const block of sourceBlocks(body)){
  for(const match of block.text.matchAll(/(?:^|[.!?]\s+|\n)([^\n?]{20,550}\?)/g)){
   const raw=match[1].trim(),start=raw.search(/\b(?:How|What|Why|Which|When|On what|According to|Do|Does|Can|Should|Is|Are)\b/),quote=start>=0?raw.slice(start):raw;if(!/\b(?:what|why|how|which|when|whether|is|are|do|does|can|should)\b/i.test(quote)||/password|log\s*in|any questions|test (?:date|format)|when is the/i.test(quote))continue;
   const format=body.match(/\b(?:\d+\s*(?:[–—-]|or)\s*\d+|\d+)\s*(?:sentence|sentences)\b[^.\n]{0,60}/i)?.[0]||null;
   const limitation=body.match(/[^.\n]*\bnot (?:meant to be )?exhaustive\b[^.\n]*\./i)?.[0]?.trim()||null;
   return {quote,unit:block.unit,line:block.start_line,response_format:format,limitation};
  }
 }
}

export async function betaCourseworkCatalogue(user:string,course?:string):Promise<CourseworkCatalogue>{
 if(course&&!uuid(course))throw Error('Invalid course');
 return tenant(user,async c=>{
  const planning=await planningState(c,user),scope=course?[course]:planning.current_course_ids;
  if(course&&!(await c.query('SELECT id FROM schoolvault.courses WHERE user_id=$1 AND id=$2',[user,course])).rowCount)throw Error('Course not found');
  // Full tenant corpus, not the newest snapshot page. Notes/review artifacts
  // stay in general browsing; they are not candidate original course material.
  const rows=(await c.query(`SELECT s.id,s.course_id,s.title,s.kind,s.original_url,v.id AS version_id,v.observed_at,v.object_key,left(v.body,160000) AS body
   FROM schoolvault.sources s JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.id=s.current_version
   WHERE s.user_id=$1 AND s.course_id=ANY($2::uuid[]) AND s.kind IN('moodle','file')
   ORDER BY (s.kind='moodle') DESC,v.observed_at DESC,s.id LIMIT 1201`,[user,scope])).rows;
  const materials:CourseworkMaterial[]=rows.slice(0,1200).map(({body,object_key,...s})=>{
   const prefix=String(body).slice(0,2400),role:CourseworkMaterial['role']=unverifiedForumSource({...s,excerpt:body})?'discussion':/Source role: owner_snapshot_(?:status|participation)/.test(prefix)?'activity_observation':/Source role: moodle_receipt_observation/.test(prefix)?'status_observation':savedSourceCatalogue({...s,body})?'catalogue':'saved_source';
   return {...s,observed_at:new Date(s.observed_at).toISOString(),has_original:!!object_key,role,...(role==='saved_source'?{question:savedStudyQuestion(s.title,body)}:{})};
  });
  return {materials,truncated:rows.length>1200,scope:'current-course-saved-material'};
 });
}

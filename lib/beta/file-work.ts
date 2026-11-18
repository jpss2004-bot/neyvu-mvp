import {unverifiedForumSource} from './source-authority';
import {createHash,randomUUID} from 'node:crypto';
import {originalMimes} from './file-types';
import type {PoolClient} from 'pg';
import {uuid} from './db';
import {lockVault} from './budget';
import {workInstructionExcerpts,workKind,optionalWorkTitle} from './moodle-facts';

export const fileWorkDerivation='required-file-instructions-v1';
export const fileWorkKey=(source:string)=>'file-work:'+source;
const explicitRequired=/\b(?:you|students?|learners?|everyone)\s+(?:must|(?:are|is) required to|have to|need to|(?:are|is) expected to)\b|\b(?:must|need to)\s+be\s+(?:completed|submitted|uploaded|handed in|turned in|posted|brought)\b|\b(?:required|mandatory|compulsory)\s+(?:pre[- ]?lab\s+)?(?:quiz|lab|worksheet|assignment|report|discussion|in[- ]class)\b|\b(?:quiz|quizzes|worksheets?|assignments?|reports?|exercises?)\s+(?:is|are)\s+(?:required|mandatory|compulsory)\b/i;
export function fileWorkInstructions(body:string,title=''){
 let instruction_excerpts=workInstructionExcerpts(body);const optionalTitle=optionalWorkTitle(title);
 if(optionalTitle){
  // A filename's optional context applies to bare imperatives. Retain explicit
  // required wording/subsections as conflicting review evidence, not certainty.
  const required=new Set<string>();let requiredSection=false;
  for(const raw of body.split('\n')){
   const heading=raw.trim().replace(/^#+\s*/,'');
   if(heading.length<=90&&!/[.!?]/.test(heading)){
    if(/^(?:optional(?:\s+.*)?|practice(?:\s+(?:only|examples?))?|examples?|samples?|demonstrations?|for reference)\s*:?$/i.test(heading))requiredSection=false;
    else if(/^(?:required(?:\s+.*)?|mandatory(?:\s+.*)?|coursework|lab work|in[- ]class work)\s*:?$/i.test(heading))requiredSection=true;
   }
   for(const excerpt of workInstructionExcerpts(raw))if(requiredSection||explicitRequired.test(excerpt))required.add(excerpt);
  }
  instruction_excerpts=instruction_excerpts.filter(excerpt=>required.has(excerpt));
 }
 return instruction_excerpts.length?{instruction_excerpts,kind:workKind(instruction_excerpts.join(' ')),
  requirement:optionalTitle?'unknown':'observed_instruction',...(optionalTitle?{title_context:'optional_required_conflict'}:{})}:null;
}

// Internal indexing hook: the caller supplies its tenant transaction. Only the
// current immutable original's text can create review candidates. This parser
// establishes neither an official deadline nor outstanding/completed work.
export async function deriveFileWork(c:PoolClient,user:string,source:string,version:string){
 if(![user,source,version].every(uuid))throw Error('Invalid file work source');
 await lockVault(c,user);
 const row=(await c.query(`SELECT s.course_id,s.title,s.original_url,v.body,v.sha256,v.observed_at,
 EXISTS(SELECT 1 FROM schoolvault.passages p WHERE p.user_id=s.user_id AND p.source_id=s.id AND p.version_id=v.id) AS indexed,
 EXISTS(SELECT 1 FROM schoolvault.audit a WHERE a.user_id=s.user_id AND a.target=s.id
  AND a.action='moodle-file-collected' AND a.details->>'sha256'=v.sha256) AS moodle_attachment
 FROM schoolvault.sources s JOIN schoolvault.source_versions v ON v.user_id=s.user_id
  AND v.source_id=s.id AND v.id=s.current_version
 WHERE s.user_id=$1 AND s.id=$2 AND s.kind='file' AND v.id=$3 AND v.object_key IS NOT NULL
  AND v.mime=ANY($4::text[]) FOR UPDATE OF s`,[user,source,version,originalMimes])).rows[0];
 if(!row)return {changed:false,ignored:'not_current_file'};
 if(unverifiedForumSource(row))return {changed:false,ignored:'unverified_forum'};
 const external=fileWorkKey(source),old=(await c.query('SELECT id,source_id,evidence FROM schoolvault.tasks WHERE user_id=$1 AND course_id=$2 AND external_id=$3 FOR UPDATE',[user,row.course_id,external])).rows[0];
 // A reserved-key collision is still personal data. Do not seize it.
 if(old&&(old.source_id!==source||old.evidence?.derivation!==fileWorkDerivation||old.evidence?.confirmation!=='candidate'))return {changed:false,ignored:'protected_task'};
 const instructions=row.indexed?fileWorkInstructions(row.body,row.title):null;
 if(!instructions){
  if(!old||old.evidence?.active===false)return {changed:false};
  const evidence={...old.evidence,active:false,completion_status:'unknown',superseded_by:version,
   superseded_at:new Date(row.observed_at).toISOString(),
   note:'The current file has no indexed required-work instruction. Its earlier candidate is retired; completion was not inferred.'};
  await c.query('UPDATE schoolvault.tasks SET evidence=$3,observed_at=$4 WHERE user_id=$1 AND id=$2',[user,old.id,evidence,row.observed_at]);
  return {changed:true,retired:true};
 }
 const evidence={...instructions,title:row.title,derivation:fileWorkDerivation,
  confirmation:'candidate',active:true,
  completion_status:'unknown',due_at:null,due_date:null,
  authority:row.moodle_attachment?'Observed Moodle file work candidate':'Saved file work candidate',
  provider:row.moodle_attachment?'moodle':'saved_file',
  provenance:row.moodle_attachment?'observed_moodle_attachment':'student_uploaded_file',
  version_id:version,sha256:createHash('sha256').update(row.body).digest('hex'),original_sha256:row.sha256,
  observed_at:new Date(row.observed_at).toISOString(),
  ...(row.original_url?{original_url:row.original_url}:{}),
  note:instructions.requirement==='unknown'?'The filename describes optional material but this quotation has required wording or a required section. Review that conflict; dates and completion are not verified.':'Required-work wording was observed in this file. Review its context and current Moodle instructions; dates and completion are not verified.'};
 // jsonb reorders keys; compare values in SQL so an identical indexing replay
 // does not rewrite the candidate or its observation time.
 if(old){
  const updated=await c.query('UPDATE schoolvault.tasks SET evidence=$3,observed_at=$4 WHERE user_id=$1 AND id=$2 AND evidence IS DISTINCT FROM $3::jsonb',[user,old.id,evidence,row.observed_at]);
  return {changed:updated.rowCount===1};
 }
 await c.query('INSERT INTO schoolvault.tasks(user_id,id,course_id,source_id,external_id,evidence,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[user,randomUUID(),row.course_id,source,external,evidence,row.observed_at]);
 return {changed:true};
}

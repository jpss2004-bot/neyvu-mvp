import {tenant,uuid} from './db';
import {readStudyCopy} from './study-copy';
import {BetaHttpError} from './http';
import {citationStyle,initialReference,missingReferenceFields,referenceMetadata,syllabusCitationStyle} from './citation-metadata';
import type {ResearchExportView} from './research-types';
export async function researchExportView(user:string,message:string):Promise<ResearchExportView>{
 const copy=await readStudyCopy(user,message);
 return tenant(user,async c=>{
  const course=(await c.query(`SELECT co.id,co.code FROM schoolvault.messages m JOIN schoolvault.jobs j ON j.user_id=m.user_id AND j.id::text=m.content->>'job_id' LEFT JOIN schoolvault.courses co ON co.user_id=m.user_id AND co.id::text=j.input->>'course_id' WHERE m.user_id=$1 AND m.id=$2`,[user,message])).rows[0];
  const preference=course?.id?(await c.query('SELECT style,revision FROM schoolvault.citation_preferences WHERE user_id=$1 AND course_id=$2',[user,course.id])).rows[0]:null;
  const syllabi=course?.id?(await c.query(`SELECT s.id,v.id AS version_id,v.body FROM schoolvault.sources s JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.id=s.current_version WHERE s.user_id=$1 AND s.course_id=$2 AND s.kind IN ('file','moodle') AND s.title ~* '(syllabus|course outline)' ORDER BY s.id LIMIT 20`,[user,course.id])).rows:[];
  const suggestions=syllabi.map(row=>({found:syllabusCitationStyle(row.body),row})).filter(x=>x.found);
  const conflict=new Set(suggestions.map(x=>x.found!.style)).size>1;
  const suggestion=!conflict?suggestions[0]:null;
  const references=[];
  for(const source of copy.sources){
   const row=source.id&&source.version_id?(await c.query('SELECT data,revision FROM schoolvault.citation_metadata WHERE user_id=$1 AND source_id=$2 AND version_id=$3 ORDER BY revision DESC LIMIT 1',[user,source.id,source.version_id])).rows[0]:null;
   const metadata=row?referenceMetadata(row.data):initialReference(source.title,source.original_url);
   references.push({...source,revision:row?.revision||0,metadata,provenance:row?'Student-corrected metadata':'Saved source title; publication details not verified',missing:missingReferenceFields(metadata)});
  }
  return {message_id:message,course_id:course?.id||null,course_label:course?.code||null,style:suggestion?.found?.style||preference?.style||null,style_revision:preference?.revision||0,...(suggestion?{style_evidence:{quote:suggestion.found!.quote,source_id:suggestion.row.id,version_id:suggestion.row.version_id}}:{}),style_conflict:conflict,references};
 });
}
export async function saveResearchSettings(user:string,message:string,body:Record<string,unknown>){
 const view=await researchExportView(user,message);
 return tenant(user,async c=>{
  if(body.op==='style'){
   if(!view.course_id)throw new BetaHttpError('This answer spans courses. Choose a style for this export only.');
   const style=citationStyle(body.style);
   if(view.style_evidence&&style!==view.style)throw new BetaHttpError('The saved syllabus specifies a different style. Use an export-only override.');
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user+':citation:'+view.course_id]);
   const old=(await c.query('SELECT revision FROM schoolvault.citation_preferences WHERE user_id=$1 AND course_id=$2',[user,view.course_id])).rows[0];
   if(body.revision!==(old?.revision||0))throw new BetaHttpError('The saved style changed. Reopen the export before saving.',409);
   await c.query('INSERT INTO schoolvault.citation_preferences(user_id,course_id,style,revision) VALUES($1,$2,$3,1) ON CONFLICT(user_id,course_id) DO UPDATE SET style=excluded.style,revision=schoolvault.citation_preferences.revision+1,updated_at=now()',[user,view.course_id,style]);
  }else if(body.op==='metadata'){
   const ref=view.references.find(x=>x.id===body.source_id&&x.version_id===body.version_id);
   if(!ref||!uuid(ref.id)||!uuid(ref.version_id)||ref.state==='unavailable')throw new BetaHttpError('This exact source version is unavailable.',404);
   const metadata=referenceMetadata(body.metadata);
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user+':reference:'+ref.version_id]);
   const old=(await c.query('SELECT revision FROM schoolvault.citation_metadata WHERE user_id=$1 AND source_id=$2 AND version_id=$3 ORDER BY revision DESC LIMIT 1',[user,ref.id,ref.version_id])).rows[0];
   if(body.revision!==(old?.revision||0))throw new BetaHttpError('These reference details changed. Reopen the export before saving.',409);
   await c.query('INSERT INTO schoolvault.citation_metadata(user_id,source_id,version_id,revision,data) VALUES($1,$2,$3,$4,$5::jsonb)',[user,ref.id,ref.version_id,(old?.revision||0)+1,JSON.stringify(metadata)]);
  }else throw new BetaHttpError('Invalid reference action.');
 });
}

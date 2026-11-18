import {parseGroupReport} from './group-context-format';
import {workInventoryQuestion} from './chat-intent';
import {createHash} from 'node:crypto';
import {type ChangedSource,noteChanges} from './source-dependencies';
import type {PoolClient} from 'pg';
import type {StudentMemory} from './student-memory';
import {contextTerms,contextScore,continuingWork,continuityExcerpt} from './continuity-text';
import {mentionedCourseKeys} from './course-codes';
import {writingActivity,writingPriority} from './writing-target';
export {contextTerms,contextScore} from './continuity-text';
export function workExcerpt(body:string,terms:string[],limit=2400){const {text,truncated}=continuityExcerpt(body,terms,limit);return {text,truncated};}
type Selection={id:string;version_id:string};
const count=(eligible:number,selected:number)=>({eligible,selected,omitted:Math.max(0,eligible-selected)});
export function memoryInTopic(row:Pick<StudentMemory,'body'|'kind'|'course_id'|'chat_id'>,terms:string[],codes:Set<string>,activity:string|null=null){
 const activities=[...row.body.matchAll(/\b(assignment|case|quiz|test|exam|report|project)\s+(\d+)\b/gi)].map(m=>m[1].toLowerCase()+' '+Number(m[2]));
 if(activity&&activities.length&&!activities.includes(activity.toLowerCase()))return false;
 if(row.chat_id||row.course_id)return true;
 const named=mentionedCourseKeys(row.body);
 if(named.size)return [...named].some(code=>codes.has(code));
 return ['preference','availability'].includes(row.kind)||contextScore(row.body,terms)>0;
}
export function workScore(title:string,body:string,terms:string[],activity:string|null){
 return 4*contextScore(title,terms)+contextScore(body,terms)+(activity&&title.toLowerCase().replace(/[_-]/g,' ').includes(activity.toLowerCase())?30:0);
}
export async function studentContext(c:PoolClient,user:string,chat:string,course:string|null,scopes:string[],question:string,recentIds:string[],selectedRefs:Selection[]=[]){
 const terms=contextTerms(question),continuing=continuingWork(question),planning=workInventoryQuestion(question);
 const groupRelevant=planning||/\b(?:groups?|labs?|teams?|sections?)\b/i.test(question);
 const courses=(await c.query('SELECT id,code FROM schoolvault.courses WHERE user_id=$1 AND id=ANY($2::uuid[])',[user,scopes])).rows;
 const topicCodes=mentionedCourseKeys(question+' '+courses.map(row=>row.code).join(' '));
 const memories=(await c.query(`SELECT id,course_id,chat_id,kind,body,revision,updated_at,count(*) OVER()::int AS eligible_count FROM schoolvault.student_memory WHERE user_id=$1 AND (course_id IS NULL AND chat_id IS NULL OR chat_id=$2 AND course_id IS NOT DISTINCT FROM $3::uuid OR chat_id IS NULL AND course_id=ANY($4::uuid[])) ORDER BY CASE WHEN $5 AND kind='correction' AND course_id IS NOT NULL AND chat_id IS NULL AND body ~ '^Student-reported (lab|section|team): ' THEN 0 ELSE 1 END,updated_at DESC,id DESC LIMIT 100`,[user,chat,course,scopes,groupRelevant])).rows as (StudentMemory&{eligible_count:number})[];
 const memoryActivity=writingActivity(question)||question.match(/\b(?:assignment|case|quiz|test|exam|report|project)\s+\d+\b/i)?.[0]||null;
 const ranked=memories.map((row,index)=>({row,index,score:(groupRelevant&&row.kind==='correction'&&row.course_id&&!row.chat_id&&parseGroupReport(row.body)?2000:0)+(planning&&row.kind==='progress'?100:0)+(row.kind==='availability'&&!planning?1000:0)+contextScore(row.body,terms)+(row.chat_id===chat?3:row.course_id===course&&course?2:0)+(continuing&&row.kind==='correction'?4:0)})).filter(({row})=>memoryInTopic(row,terms,topicCodes,planning?null:memoryActivity)).sort((a,b)=>b.score-a.score||a.index-b.index);
 let used=0;const selected:StudentMemory[]=[];
 for(const {row} of ranked){if(selected.length>=8)break;if(used+row.body.length>8000)continue;const {eligible_count,...memory}=row;selected.push(memory);used+=row.body.length;}
 // Read the full bounded stored user message before ranking; a late correction
 // must not disappear inside an SQL prefix. Legacy course binding is unchanged.
 const older=(await c.query(`SELECT id,content->>'text' AS text,created_at,count(*) OVER()::int AS eligible_count FROM schoolvault.messages WHERE user_id=$1 AND chat_id=$2 AND role='user' AND NOT(id=ANY($3::uuid[])) AND (content ? 'context_course_id' AND (content->>'context_course_id') IS NOT DISTINCT FROM $4::uuid::text OR NOT(content ? 'context_course_id') AND $4::uuid IS NULL) ORDER BY created_at DESC,id DESC LIMIT 120`,[user,chat,recentIds,course])).rows;
 const prior=older.map((row,index)=>({row,index,score:contextScore(row.text,terms)+(continuing&&/\b(?:i|we) (?:chose|decided|prefer)|\bcorrection\b|open question|unresolved|correcci[oó]n|elegimos|decidimos|pregunta pendiente/i.test(row.text)?2:0)})).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,3).map(({row})=>({id:row.id,role:'user',course_id:course,chat_id:chat,created_at:row.created_at,...continuityExcerpt(row.text,terms,1600)}));
 const drafts=(await c.query(`SELECT n.id FROM schoolvault.jobs j JOIN schoolvault.notes n ON n.user_id=j.user_id AND n.id=(j.result->>'study_note_id')::uuid WHERE j.user_id=$1 AND j.chat_id=$2 AND j.status='complete' AND j.kind='answer' AND j.input->>'course_id'=$3::text AND j.result ? 'study_note_id' ORDER BY j.created_at DESC,j.id DESC LIMIT 10`,[user,chat,course])).rows.map(row=>row.id);
 // Explicit selected originals are already tenant/course checked by the caller;
 // repeat the joins here. An old selected note uses that immutable version,
 // never the mutable latest Notebook body. Imported adjacent notes retain their
 // own revision/hash: their body is not certified by the original file version.
 const writing=writingActivity(question);
 const activity=writing||question.match(/\b(?:assignment|case|quiz|test|exam|report|project)\s+\d+\b/i)?.[0]||null;
 // Rank across the scoped notebook before applying the candidate bound. A
 // large import must not hide an older current draft behind the newest notes.
 const notes=scopes.length?(await c.query(`SELECT n.id,n.course_id,n.source_id,n.title,n.body,n.origin,n.version AS note_revision,n.updated_at,s.kind AS source_kind,s.current_version,v.id AS version_id,v.body AS selected_body,ref.id IS NOT NULL AS attached,count(*) OVER()::int AS eligible_count
 FROM schoolvault.notes n JOIN schoolvault.sources s ON s.user_id=n.user_id AND s.id=n.source_id
 LEFT JOIN jsonb_to_recordset($3::jsonb) ref(id uuid,version_id uuid) ON ref.id=s.id
 JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.source_id=s.id AND v.id=coalesce(ref.version_id,s.current_version)
 WHERE n.user_id=$1 AND n.course_id=ANY($2::uuid[])
 ORDER BY (ref.id IS NOT NULL) DESC,(n.id=ANY($6::uuid[])) DESC,
 (CASE WHEN $5::text IS NOT NULL AND to_tsvector('english',translate(n.title,'_-','  '))@@phraseto_tsquery('english',$5) THEN 30 ELSE 0 END
 +4*ts_rank_cd(to_tsvector('english',n.title),websearch_to_tsquery('english',$4))
 +ts_rank_cd(to_tsvector('english',CASE WHEN ref.id IS NOT NULL AND s.kind IN('note','ai_draft') THEN v.body ELSE n.body END),websearch_to_tsquery('english',$4))) DESC,
 n.updated_at DESC,n.id DESC LIMIT 80`,[user,scopes,JSON.stringify(selectedRefs),terms.join(' OR '),activity,continuing?drafts:[]])).rows:[];
 const work=notes.map((row,index)=>({row,index,score:workScore(row.title,row.attached&&['note','ai_draft'].includes(row.source_kind)?row.selected_body:row.body,terms,activity)+writingPriority(row.title,writing)+(row.attached?100000:0)+(continuing&&drafts.includes(row.id)?100:0)})).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,writing?1:2).map(({row})=>{
  const pinned=row.attached&&['note','ai_draft'].includes(row.source_kind),body=pinned?row.selected_body:row.body;
  return {changed_sources:undefined as ChangedSource[]|undefined,id:row.id,course_id:row.course_id,source_id:row.source_id,title:row.title,origin:row.origin,updated_at:row.updated_at,version_id:row.version_id,historical:row.version_id!==row.current_version,basis:pinned?'selected_source_version':'note_revision',note_revision:pinned?null:row.note_revision,text_sha256:createHash('sha256').update(body).digest('hex'),...continuityExcerpt(body,terms,writing?4800:2400)};
 });
 await noteChanges(c,user,work);
 return {authority:'student_context_only',intent:continuing?'continue':'current_request',courses,memories:selected,memory_count:memories[0]?.eligible_count||0,earlier_user_statements:prior,work,coverage:{format:'student-continuity/1',complete:false,memories:count(memories[0]?.eligible_count||0,selected.length),earlier_user_statements:count(older[0]?.eligible_count||0,prior.length),work:count(notes[0]?.eligible_count||0,work.length),selection:'Bounded relevant personal context; omitted records and text remain saved. This does not establish exhaustive recall or official requirements.'}};
}

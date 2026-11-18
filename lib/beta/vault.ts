import {writePassages} from './passage-writer';
import {retrieveSourceRows,type RetrievalTrace} from './hybrid-search';
import {ownerParticipations} from './owner-forum-participation';
import {chatScope,readChatScope,sameChatScope,type ChatScope} from './chat-scope';
import {forumObservation} from './forum-evidence';
import {teachingEvidence} from './teaching-evidence';
import {sourceEvidenceBlocks} from './source-blocks';
import {wholeEvidenceExcerpt,renderEvidenceSelection} from './evidence-excerpt';
import {aiDisclosurePriority} from './source-policy-units';
import {classExceptionExcerpt} from './dated-class-evidence';
import {excerptCoverage} from './excerpt-coverage';
import {sourceBoundTask,unverifiedForumSource} from './source-authority';
import {receiptsForSources} from './moodle-receipts';
import {sourceChanged,changedSources,noteChanges} from './source-dependencies';
import {planningState} from './student-planning';
import {profileExcerpt,readingProgress} from './source-profiles';
import {sourceContent,instructionExcerpt,latePolicyExcerpt,aiPolicyExcerpt,officeHoursExcerpt,courseInfoExcerpt,assessmentDetailExcerpt,examReviewExcerpt} from './source-content';
import {savedMaterial} from './source-material';
import {createHash,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {tenant,uuid} from './db';
import {searchSql,definitionSearchSql,pieceSql,segmentText,bestExcerpt,bestExcerptPlan,searchQuestion,rankingQuestion,scopedSearchQuestion,sourceFitsCourse,conceptSourceDiversity,conceptAnchorQuery,continuationSourceAnchor} from './search';
import {courseCoverage} from './coverage';
import {mentionedCourseKeys} from './course-codes';
import {checkHistory,checkObjects,lockVault} from './budget';
export class BetaConflict extends Error{}
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
export function text(value:unknown,max:number){if(typeof value!=='string'||value.length>max)throw Error('Invalid text');return value;}
export function id(value:unknown){if(!uuid(value))throw Error('Invalid item');return value;}
async function audit(c:PoolClient,user:string,action:string,target:string){await c.query('INSERT INTO schoolvault.audit(user_id,id,action,target) VALUES($1,$2,$3,$4)',[user,randomUUID(),action,target]);}
export async function ownedBetaCourse(c:PoolClient,user:string,courseId:string){
 const row=(await c.query('SELECT id FROM schoolvault.courses WHERE user_id=$1 AND id=$2',[user,id(courseId)])).rows[0];
 if(!row)throw Error('Course not found');
}
// Text history is capped at 32 MiB, or at a vault's smaller text quota (the synthetic demo vault).
export const textLimit=(textQuota:unknown)=>Math.min(32*1024*1024,Number(textQuota)||32*1024*1024);
export async function sourceVersion(c:PoolClient,user:string,source:string,body:string){
 const vault=(await c.query('SELECT text_quota_bytes FROM schoolvault.vaults WHERE user_id=$1 FOR UPDATE',[user])).rows[0];
 const used=Number((await c.query(`SELECT coalesce((SELECT sum(octet_length(body)) FROM schoolvault.source_versions WHERE user_id=$1),0)
 +coalesce((SELECT sum(octet_length(snapshot::text)) FROM schoolvault.note_revisions WHERE user_id=$1),0) AS used`,[user])).rows[0].used);
 if(used+Buffer.byteLength(body)>textLimit(vault?.text_quota_bytes))throw Error('Invalid text: your notebook history has reached its beta limit.');
 const version=randomUUID();
 await c.query('INSERT INTO schoolvault.source_versions(user_id,id,source_id,body,sha256) VALUES($1,$2,$3,$4,$5)',[user,version,source,body,hash(body)]);
 await writePassages(c,user,source,version,body);
 await c.query('UPDATE schoolvault.sources SET current_version=$3 WHERE user_id=$1 AND id=$2',[user,source,version]);
 await sourceChanged(c,user,source,version);
 await checkHistory(c,user);
 return version;
}
export async function createBetaCourse(user:string,code:string,title:string){
 code=text(code,40).trim();title=text(title,180).trim();if(!code||!title)throw Error('Enter a course name');
 return tenant(user,async c=>{
  await checkObjects(c,user,'courses');
  const item=(await c.query('INSERT INTO schoolvault.courses(user_id,id,code,title) VALUES($1,$2,$3,$4) RETURNING id,code,title,kind',[user,randomUUID(),code,title])).rows[0];
  await audit(c,user,'course-created',item.id);await checkHistory(c,user);return item;
 });
}
export async function createBetaNote(user:string,courseId:string,title:string,body:string){
 title=text(title,180).trim()||'Class notes';body=text(body,80000);
 return tenant(user,async c=>{
  await checkObjects(c,user,'notes');await checkObjects(c,user,'sources');
  await ownedBetaCourse(c,user,courseId);const source=randomUUID(),note=randomUUID();
  await c.query("INSERT INTO schoolvault.sources(user_id,id,course_id,kind,title) VALUES($1,$2,$3,'note',$4)",[user,source,courseId,title]);
  await sourceVersion(c,user,source,body);
  const row=(await c.query('INSERT INTO schoolvault.notes(user_id,id,course_id,source_id,title,body) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[user,note,courseId,source,title,body])).rows[0];
  await audit(c,user,'note-created',note);await checkHistory(c,user);return row;
 });
}
export async function updateBetaNote(user:string,noteId:string,version:number,title:string,body:string){
 id(noteId);text(title,180);text(body,80000);if(!Number.isSafeInteger(version)||version<1)throw Error('Invalid note version');
 return tenant(user,async c=>{
  await lockVault(c,user);
  const old=(await c.query('SELECT * FROM schoolvault.notes WHERE user_id=$1 AND id=$2 FOR UPDATE',[user,noteId])).rows[0];
  if(!old)throw Error('Note not found');if(old.version!==version)throw new BetaConflict('This note changed elsewhere. Your draft is preserved. Reload to review both copies.');
  await c.query('INSERT INTO schoolvault.note_revisions(user_id,id,note_id,version,snapshot) VALUES($1,$2,$3,$4,$5)',[user,randomUUID(),noteId,version,JSON.stringify(old)]);
  const original=(await c.query('SELECT v.object_key FROM schoolvault.sources s JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.id=s.current_version WHERE s.user_id=$1 AND s.id=$2',[user,old.source_id])).rows[0];
  // A Notebook draft imported beside a file can be edited independently. Its
  // source continues to identify the immutable original and its download hash.
  if(!original?.object_key){
   await c.query('UPDATE schoolvault.sources SET title=$3 WHERE user_id=$1 AND id=$2',[user,old.source_id,title.trim()||'Class notes']);
   await sourceVersion(c,user,old.source_id,[body,old.transcript].filter(Boolean).join('\n'));
  }
  const row=(await c.query("UPDATE schoolvault.notes SET title=$4,body=$5,version=version+1,updated_at=now() WHERE user_id=$1 AND id=$2 AND version=$3 RETURNING *",[user,noteId,version,title.trim()||'Class notes',body])).rows[0];
  await c.query(`UPDATE schoolvault.jobs SET status='cancelled',error='A saved note changed. Your question and draft are kept; ask again to use the updated work.',lease_hash=NULL,lease_until=NULL,updated_at=now() WHERE user_id=$1 AND kind='answer' AND status='leased' AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(input->'student_context'->'work','[]')) w WHERE w->>'id'=$2 AND w->>'basis' IS DISTINCT FROM 'selected_source_version')`,[user,noteId]);
  await audit(c,user,'note-updated',noteId);await checkHistory(c,user);return row;
 });
}
export async function betaNote(user:string,noteId:string){return tenant(user,async c=>{const row=(await c.query('SELECT * FROM schoolvault.notes WHERE user_id=$1 AND id=$2',[user,id(noteId)])).rows[0];if(!row)throw Error('Note not found');await noteChanges(c,user,[row]);return row;});}
export async function betaSnapshot(user:string,limit=100){
 if(!Number.isSafeInteger(limit)||limit<100||limit>2000)throw Error('Invalid list size');
 return tenant(user,async c=>{
  const courses=(await c.query('SELECT id,code,title,kind,moodle_id,url FROM schoolvault.courses WHERE user_id=$1 ORDER BY code',[user])).rows;
  const notes=(await c.query("SELECT id,course_id,source_id,title,body,transcript,summary,version,origin,created_at,updated_at FROM schoolvault.notes WHERE user_id=$1 ORDER BY (origin IS DISTINCT FROM 'ai_draft') DESC,updated_at DESC,id DESC LIMIT $2",[user,Math.min(limit,1000)])).rows;
  const sources=(await c.query("SELECT s.id,s.course_id,s.title,s.kind,s.original_url,v.id AS version_id,v.observed_at,v.bytes,v.mime FROM schoolvault.sources s JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.id=s.current_version WHERE s.user_id=$1 AND s.kind!='ai_draft' ORDER BY CASE s.kind WHEN 'moodle' THEN 0 WHEN 'file' THEN 1 ELSE 2 END,v.observed_at DESC,s.id DESC LIMIT $2",[user,Math.max(200,limit)])).rows;
  // A version is evidence of when this vault saved content, never proof of
  // when Moodle published it. Show recent changes without a second event table.
  const changes=(await c.query(`WITH versions AS (
    SELECT s.id AS source_id,s.course_id,s.title,s.kind,s.original_url,
           v.id AS version_id,v.sha256,v.observed_at,
           row_number() OVER (PARTITION BY s.id ORDER BY v.observed_at,v.id) AS version_number
    FROM schoolvault.sources s JOIN schoolvault.source_versions v
      ON v.user_id=s.user_id AND v.source_id=s.id
    WHERE s.user_id=$1 AND s.kind IN ('moodle','file')
   ) SELECT source_id,course_id,title,kind,original_url,version_id,sha256,observed_at,
            CASE WHEN version_number=1 THEN 'first_saved' ELSE 'changed' END AS change
     FROM versions WHERE observed_at>=now()-interval '14 days'
     ORDER BY observed_at DESC,version_id DESC LIMIT 40`,[user])).rows;
  const chats=(await c.query('SELECT id,title,course_id,mode,draft,context,archived,created_at,updated_at FROM schoolvault.chats WHERE user_id=$1 ORDER BY updated_at DESC,id DESC LIMIT $2',[user,Math.min(limit,200)])).rows;
  const jobs=(await c.query("SELECT j.id,j.chat_id,j.note_id,j.kind,j.status,j.error,j.updated_at,(j.input->>'model_recovery'='pending') AS recovering,j.input->>'source_id' AS source_id,s.title AS source_title,CASE WHEN j.kind='answer' THEN j.input->>'question' END AS question,CASE WHEN j.status IN ('leased','failed') THEN j.result->>'draft' END AS draft,j.result->>'study_note_id' AS study_note_id,j.result->>'study_note_skipped' AS study_note_skipped FROM schoolvault.jobs j LEFT JOIN schoolvault.sources s ON s.user_id=j.user_id AND s.id::text=j.input->>'source_id' WHERE j.user_id=$1 ORDER BY (j.kind='answer' AND j.status IN('queued','leased')) DESC,j.created_at DESC LIMIT 30",[user])).rows;
  const tasks=(await c.query('SELECT t.id,t.course_id,t.source_id,t.evidence,t.observed_at,s.kind AS source_kind,s.title AS source_title,s.original_url FROM schoolvault.tasks t JOIN schoolvault.sources s ON s.user_id=t.user_id AND s.id=t.source_id WHERE t.user_id=$1',[user])).rows.map(({source_kind,source_title,original_url,...task})=>sourceBoundTask(task,{kind:source_kind,title:source_title,original_url}));
  const receiptRefs=tasks.filter(t=>t.evidence?.version_id).map(t=>({id:t.source_id,version_id:t.evidence.version_id})),receipts=await receiptsForSources(c,user,receiptRefs);const participation=await ownerParticipations(c,user,receiptRefs);for(const task of tasks)task.evidence={...task.evidence,receipt:receipts.get(task.source_id)||null,forum_participation:participation.get(task.source_id)||null};
  const meetings=(await c.query('SELECT id,course_id,source_id,schedule FROM schoolvault.meetings WHERE user_id=$1',[user])).rows;
  const connectors=(await c.query('SELECT provider,identity,status,checked_at,revoked_at FROM schoolvault.connectors WHERE user_id=$1',[user])).rows;
  const coverage=await courseCoverage(c,user),reading=await readingProgress(c,user);await noteChanges(c,user,notes);
  return {chat_creation_ids:true,courses,notes,sources,changes,chats,jobs,tasks,meetings,connectors,coverage,reading,planning:await planningState(c,user)};
 });
}
// Up to 8 current sources matching any word of the question, best first (ranking: lib/beta/search.ts).
// Each excerpt is the source's best-matching text, at most 1,800 characters.
export async function searchBetaSources(c:PoolClient,user:string,query:string,courseId?:string,trace?:RetrievalTrace){
 text(query,3000);if(courseId)id(courseId);
 // The chosen course is already an enforced SQL scope. Its code is repeated in
 // most course documents and must not outweigh the student's actual topic.
 let code='';const originalQuery=query;
 if(courseId){code=(await c.query('SELECT code FROM schoolvault.courses WHERE user_id=$1 AND id=$2',[user,courseId])).rows[0]?.code||'';if(code)query=scopedSearchQuestion(query,code);}
 const expanded=searchQuestion(query);
 // Keyword SQL unchanged; hybrid/rerank only when NEYVU_RETRIEVAL=hybrid (hybrid-search.ts).
 let rows=await retrieveSourceRows(c,user,{question:query,ranking:rankingQuestion(expanded),expanded,courseId:courseId||null},trace);
 const anchor=continuationSourceAnchor(query)||conceptAnchorQuery(query);
 if(anchor){
  const definitions=(await c.query(definitionSearchSql,[user,anchor,courseId||null,anchor])).rows.slice(0,2);
  const ids=new Set(definitions.map(row=>row.id));rows=[...definitions,...rows.filter(row=>!ids.has(row.id))];
 }
 const excerpts=await excerptBetaSources(c,rows,query);
 // Bibliographic strings such as "SSD 2017" can resemble a course code.
 // Only actual courses in this tenant can establish foreign-course identity.
 const knownCodes=code?new Set((await c.query('SELECT code FROM schoolvault.courses WHERE user_id=$1',[user])).rows.flatMap(row=>[...mentionedCourseKeys(row.code)])):undefined;
 return conceptSourceDiversity(excerpts.filter(row=>!code||sourceFitsCourse(row,code,originalQuery,knownCodes,row.course_id===courseId)),originalQuery).slice(0,8);
}
// Applies the same topic-aware excerpt selection to current search hits and
// explicitly selected historical versions; full body text never leaves this helper.
export async function excerptBetaSources(c:PoolClient,rows:any[],query:string,budget=1800){
 if(!Number.isSafeInteger(budget)||budget<0||budget>1800)throw Error('Invalid excerpt budget');
 if(rows.length){
  const observed=(await c.query(`SELECT result->>'source_id' AS source_id,result->>'version_id' AS version_id,result->>'text_sha256' AS text_sha256,result->'device_content'->>'original_location' AS original_location,result->'device_content'->'accounting'->'declared_pages' AS declared_pages,result->'device_content'->'accounting'->'partial_pages' AS partial_pages FROM schoolvault.jobs WHERE user_id=current_setting('schoolvault.user_id')::uuid AND kind='collect' AND input->>'task'='device-content-v1' AND status='complete' AND result->>'version_id'=ANY($1::text[])`,[rows.map(r=>r.version_id)])).rows;
  for(const row of rows){const info=observed.find(o=>o.source_id===row.id&&o.version_id===row.version_id&&o.text_sha256===createHash('sha256').update(row.full_body).digest('hex'));if(info)row.device_content_observation={format:'device-content-observation/1',...info};}
 }
 const warnings=rows.map(row=>/local OCR.*unreviewed/.test(row.full_body)?'Unreviewed OCR transcription is present in this source; verify numbers, formulas, dates and reading order against its original.\n':'');
 const numericFact=/\b(?:how much|worth|weights?|graded|grading|length|when|date|time|hours|minimum|final grade)\b/i.test(query);
 const originalQuery=query.replace(/\bhow (?:much|many)\b/gi,' ');
 query=searchQuestion(query);
 // Postgres reports which question terms each short piece of the top passages contains.
 // Rank candidates by their best passage, then find the answer excerpt across
 // the complete bounded version. A due date and its weight can be on different
 // pages of the same syllabus; limiting excerpts to two passages lost facts.
 const texts=rows.map(r=>[...sourceEvidenceBlocks(r.full_body)]),pieces=texts.flat().map(block=>block.text);
 const found:number[][]=pieces.length?(await c.query(pieceSql,[query,pieces])).rows.map(r=>r.hits):[];
 const original:number[][]=pieces.length&&numericFact?(await c.query(pieceSql,[originalQuery,pieces])).rows.map(r=>r.hits):[];
 let k=0;
 const excerpts=rows.map(({passages,full_body,body,source_reading:_previousReading,...row},n)=>{
 const available=Math.max(0,budget-warnings[n].length);
 const candidates=[texts[n].map(block=>{
  const text=block.text;
  const hits=found[k]||[],specific=original[k++]||[];
  const quantified=numericFact&&/\d\s*%|\d\s*percent|\d:\d\d|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+\d/i.test(text);
  // A numeric fact naming the actual topic must beat generic grading prose
  // reached only through discovery aliases.
  return {text:text+'\n\n',hits,priority:(quantified?(specific.length?4+specific.length:0.75):0)+aiDisclosurePriority(text,originalQuery)};
 })];
 const courseInfo=courseInfoExcerpt(full_body,originalQuery,available);
 const remaining=available-(courseInfo?.length||0)-3;
 // An assessment table supplements the passages that explain how the work runs;
 // a bibliography or reading-week block replaces them, since weekly readings
 // beside a required-book list invite the wrong answer.
 const extra=courseInfo&&(/\d\s*%/.test(courseInfo)||/\b(?:format|requirements?|instructions?)\b/i.test(originalQuery))&&remaining>=320?bestExcerpt(candidates,remaining):'';
 const latePolicy=latePolicyExcerpt(full_body,originalQuery,available);
 const datedClass=classExceptionExcerpt(full_body,originalQuery,available);
  const primary=examReviewExcerpt(full_body,originalQuery,available)||officeHoursExcerpt(full_body,originalQuery,available)||datedClass||latePolicy||aiPolicyExcerpt(full_body,originalQuery,available)||assessmentDetailExcerpt(full_body,originalQuery,available)||instructionExcerpt(full_body,originalQuery,available)||courseInfo;
 const structured=primary===courseInfo&&courseInfo?courseInfo+(extra?'\n…\n'+extra:''):primary;
 const plan=bestExcerptPlan(candidates,available),expanded=primary?wholeEvidenceExcerpt(full_body,primary,available,texts[n]):null;
 let excerpt=structured??plan.excerpt,selected=structured?undefined:plan.selected.map(item=>item.index);
 if(expanded){
  const whole=new Set(expanded.selected);
  if(primary!==latePolicy&&primary!==datedClass)for(const piece of plan.selected){const next=new Set([...whole,piece.index]);if(renderEvidenceSelection(texts[n],next).length<=available)whole.add(piece.index);}
  selected=[...whole].sort((a,b)=>a-b);excerpt=renderEvidenceSelection(texts[n],selected);
 }
 // Risk follows the complete pinned body even if retrieval omits its copied
 // post header. A generic course/resource URL cannot erase that evidence.
 const full={...row,excerpt:full_body};
 const untrusted=unverifiedForumSource(full);
 return {...row,untrusted,teaching_evidence:untrusted?null:teachingEvidence({...row,full_body},originalQuery),source_material:savedMaterial({...row,body:full_body}),excerpt,excerpt_coverage:excerptCoverage(row,full_body,excerpt,selected,{evidenceUnits:true})};
 });
 // A partial profile must not displace original passages it has not processed.
 // Add only whole quotations that fit after the existing source excerpt.
 for(let n=0;n<rows.length;n++){
  const row=rows[n],original=excerpts[n].excerpt,remaining=budget-warnings[n].length-original.length-3;
  if(remaining<20)continue;
  const quote=await profileExcerpt(c,row.id,row.version_id,row.full_body,originalQuery,remaining);
  if(quote&&!original.includes(quote))excerpts[n].excerpt=original?original+'\n…\n'+quote:quote;
 }
 for(let n=0;n<rows.length;n++)if(warnings[n]&&warnings[n].length<=budget)excerpts[n].excerpt=warnings[n]+excerpts[n].excerpt;
 for(let n=0;n<rows.length;n++)if(excerpts[n].excerpt!==undefined&&excerpts[n].excerpt_coverage.excerpt_sha256!==createHash('sha256').update(excerpts[n].excerpt).digest('hex'))excerpts[n].excerpt_coverage=excerptCoverage(rows[n],rows[n].full_body,excerpts[n].excerpt,undefined,{evidenceUnits:true});
 return excerpts;
}
export async function betaSearch(user:string,query:string,courseId?:string){return tenant(user,c=>searchBetaSources(c,user,query,courseId));}
export async function betaSource(user:string,sourceId:string,versionId?:string){
 if(versionId)id(versionId);
 return tenant(user,async c=>{
  const row=(await c.query('SELECT s.id,s.title,s.kind,s.course_id,s.original_url,v.id AS version_id,v.body,v.object_key,v.mime,v.bytes,v.sha256,v.observed_at FROM schoolvault.sources s JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.source_id=s.id AND v.id=coalesce($3::uuid,s.current_version) WHERE s.user_id=$1 AND s.id=$2',[user,id(sourceId),versionId||null])).rows[0];
  if(!row)throw Error('Source not found');
  if(row.kind==='moodle')row.capture=(await c.query('SELECT captured_at,received_at,coverage FROM schoolvault.moodle_observations WHERE user_id=$1 AND source_id=$2',[user,sourceId])).rows[0];
  if(row.kind==='moodle')row.forum_observation=await forumObservation(c,user,sourceId,row.version_id,row.body);
  const extraction=row.mime?(await c.query("SELECT result FROM schoolvault.jobs WHERE user_id=$1 AND (kind='extract' OR kind='collect' AND input->>'task'='device-content-v1') AND status='complete' AND input->>'source_id'=$2 AND result->>'version_id'=$3 ORDER BY created_at DESC LIMIT 1",[user,sourceId,row.version_id])).rows[0]:null;
  return {...row,...(extraction?.result?.device_content?{device_content:extraction.result.device_content}:{}),content:sourceContent({...row,device_content:extraction?.result?.device_content,truncated:extraction?.result?.truncated===true,pdf_reading:extraction?.result?.pdf_reading,office_reading:extraction?.result?.office_reading})};
 });
}
export const betaModes=['ask','plan','study','solve','sources'] as const;
export async function createBetaChat(user:string,requestId?:unknown,initial?:{mode?:string;course_id?:string|null;draft?:string;context?:string[];context_versions?:Record<string,string>}){
 if(requestId!==undefined&&!uuid(requestId))throw Error('Invalid conversation creation ID');
 if(initial!==undefined&&(!requestId||!initial||typeof initial!=='object'||Array.isArray(initial)||Object.keys(initial).some(k=>!['mode','course_id','draft','context','context_versions'].includes(k))))throw Error('Invalid initial conversation');
 const scope=readChatScope({mode:initial?.mode??'ask',course_id:initial?.course_id??null,context:initial?.context??[],context_versions:initial?.context_versions??{}});
 if(!scope||scope.context.some(source=>!scope.context_versions[source]))throw Error('Invalid initial conversation');const draft=initial?.draft===undefined?'':text(initial.draft,3000),chatId=requestId===undefined?randomUUID():requestId;
 return tenant(user,async c=>{
  await lockVault(c,user);
  if(!(await c.query('SELECT id FROM schoolvault.users WHERE id=$1 AND disabled_at IS NULL',[user])).rowCount)throw Error('Account unavailable');
  // The client-chosen UUID is the chat identity, scoped by the tenant PK. A
  // replay returns current state before limits, without restoring old settings.
  if(requestId!==undefined){const old=(await c.query('SELECT * FROM schoolvault.chats WHERE user_id=$1 AND id=$2',[user,chatId])).rows[0];if(old)return old;}
  if(scope.course_id&&!(await c.query('SELECT id FROM schoolvault.courses WHERE user_id=$1 AND id=$2',[user,scope.course_id])).rowCount)throw Error('Course not found');
  if(scope.context.length){
   const refs=scope.context.map(source=>({source,version:scope.context_versions[source]}));
   const found=(await c.query(`SELECT count(*)::int AS count
    FROM jsonb_to_recordset($2::jsonb) AS ref(source uuid,version uuid)
    JOIN schoolvault.sources s ON s.user_id=$1 AND s.id=ref.source
    JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.source_id=s.id AND v.id=ref.version
    WHERE ($3::uuid IS NULL OR s.course_id=$3)`,[user,JSON.stringify(refs),scope.course_id])).rows[0].count;
   if(found!==refs.length)throw Error('Selected source version not found in this course');
  }
  await checkObjects(c,user,'chats');
  const chat=(await c.query('INSERT INTO schoolvault.chats(user_id,id,mode,course_id,draft,context,context_versions) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[user,chatId,scope.mode,scope.course_id,draft,JSON.stringify(scope.context),JSON.stringify(scope.context_versions)])).rows[0];await checkHistory(c,user);return chat;
 });
}
export async function betaChat(user:string,chatId:string,before?:string){
 return tenant(user,async c=>{
  const chat=(await c.query('SELECT * FROM schoolvault.chats WHERE user_id=$1 AND id=$2',[user,id(chatId)])).rows[0];
  if(!chat)throw Error('Chat not found');
  let cursor:any=null;if(before){cursor=(await c.query('SELECT created_at,id FROM schoolvault.messages WHERE user_id=$1 AND chat_id=$2 AND id=$3',[user,chatId,id(before)])).rows[0];if(!cursor)throw Error('Message cursor not found');}
  const messages=(await c.query('SELECT id,role,content,sources,created_at FROM schoolvault.messages WHERE user_id=$1 AND chat_id=$2 AND ($3::timestamptz IS NULL OR (created_at,id)<($3::timestamptz,$4::uuid)) ORDER BY created_at DESC,id DESC LIMIT 101',[user,chatId,cursor?.created_at||null,cursor?.id||null])).rows;
  const has_more=messages.length>100;if(has_more)messages.pop();messages.reverse();
  const changed=await changedSources(c,user,messages.flatMap(m=>m.sources||[]));
  for(const m of messages)m.changed_sources=changed.filter(r=>(m.sources||[]).some((s:any)=>s.id===r.id&&s.version_id===r.version_id));
  return {chat,messages,has_more};
 });
}
export async function updateBetaChat(user:string,chatId:string,changes:{draft?:string;expected_draft?:string;expected_context?:ChatScope;mode?:string;course_id?:string|null;title?:string;archived?:boolean;context?:string[];context_versions?:Record<string,string>}){
 if(!changes||Array.isArray(changes)||typeof changes!=='object'||changes.archived!==undefined&&typeof changes.archived!=='boolean')throw Error('Invalid chat settings');
 id(chatId);if(changes.draft!==undefined)text(changes.draft,3000);if(changes.expected_draft!==undefined){text(changes.expected_draft,3000);if(changes.draft===undefined)throw Error('A draft is required for draft comparison');}if(changes.title!==undefined&&!text(changes.title,120).trim())throw Error('Enter a chat title');
 if(changes.expected_context!==undefined&&(!readChatScope(changes.expected_context)||changes.draft===undefined))throw Error('Invalid draft source comparison');
 if(changes.mode&&!betaModes.includes(changes.mode as any))throw Error('Unknown mode');
 const refs=changes.context;if(refs&&(!Array.isArray(refs)||refs.length>8||refs.some(v=>!uuid(v))))throw Error('Choose up to eight sources');
 const pins=changes.context_versions;
 if(pins!==undefined&&(!pins||Array.isArray(pins)||typeof pins!=='object'||Object.entries(pins).length>8||Object.entries(pins).some(([s,v])=>!uuid(s)||!uuid(v))))throw Error('Invalid source versions');
 return tenant(user,async c=>{
  await lockVault(c,user);
  if(changes.course_id)await ownedBetaCourse(c,user,changes.course_id);
  if(refs?.length){const owned=(await c.query('SELECT id FROM schoolvault.sources WHERE user_id=$1 AND id=ANY($2::uuid[])',[user,refs])).rows;if(owned.length!==new Set(refs).size)throw Error('Selected source not found');}
  const old=(await c.query('SELECT * FROM schoolvault.chats WHERE user_id=$1 AND id=$2 FOR UPDATE',[user,chatId])).rows[0];if(!old)throw Error('Chat not found');
  const versions=pins??(refs?{}:old.context_versions);
  const intended=chatScope({...old,...(changes.expected_context||{}),...changes,context:refs??changes.expected_context?.context??old.context,context_versions:pins??(refs?{}:changes.expected_context?.context_versions??old.context_versions)});
  const staleDraft=changes.expected_draft!==undefined&&old.draft!==changes.expected_draft;
  const staleScope=changes.expected_context!==undefined&&!sameChatScope(chatScope(old),changes.expected_context);
  if((staleDraft||staleScope)&&!(changes.draft!==undefined&&old.draft===changes.draft&&sameChatScope(chatScope(old),intended)))throw new BetaConflict('Your saved draft or source selection changed in another window. Review both versions before saving.');
  for(const [s,v] of Object.entries(versions||{})){
   if(!(refs??old.context).includes(s)||(await c.query('SELECT id FROM schoolvault.source_versions WHERE user_id=$1 AND source_id=$2 AND id=$3',[user,s,v])).rowCount!==1)throw Error('Selected source version not found');
  }
  const row=(await c.query('UPDATE schoolvault.chats SET draft=$3,mode=$4,course_id=$5,title=$6,context=$7,archived=$8,updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING *',[user,chatId,changes.draft??old.draft,changes.mode??old.mode,changes.course_id===undefined?old.course_id:changes.course_id,changes.title??old.title,JSON.stringify(refs??old.context),changes.archived??old.archived])).rows[0];
  await c.query('UPDATE schoolvault.chats SET context_versions=$3 WHERE user_id=$1 AND id=$2',[user,chatId,versions]);row.context_versions=versions;
  // Archival is a durable cancellation, including an answer already leased by
  // the worker. Reopening cannot revive that lease or block a new question.
  if(changes.archived===true)await c.query("UPDATE schoolvault.jobs SET status='cancelled',error='This conversation was archived. Your question is saved.',lease_hash=NULL,lease_until=NULL,updated_at=now() WHERE user_id=$1 AND chat_id=$2 AND kind='answer' AND status IN ('queued','leased')",[user,chatId]);
  await checkHistory(c,user);
  return row;
 });
}

// Search all saved, non-archived conversation titles without loading their bodies.
export async function betaChatSearch(user:string,query:string){
 const value=text(query,300).trim();if(!value)return [];
 const literal=value.replace(/[\\%_]/g,character=>'\\'+character);
 return tenant(user,async c=>(await c.query("SELECT id,title,course_id FROM schoolvault.chats WHERE user_id=$1 AND NOT archived AND title ILIKE $2 ORDER BY updated_at DESC,id DESC LIMIT 20",[user,'%'+literal+'%'])).rows);
}

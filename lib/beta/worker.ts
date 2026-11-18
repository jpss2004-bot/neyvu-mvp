import {writeAnswerTrace} from './answer-trace';
import {retrievalConfig} from './retrieval-config';
import {newRetrievalTrace} from './hybrid-search';
import {workerRetrievalPlan} from './worker-retrieval';
import {groupClarification} from './group-clarification';
import {questionClarification} from './question-clarification';
import {knowledgeGraphEnabled,graphProjection} from './knowledge-graph';
import {learnerProfileEnabled,learnerProfileProjection} from './learner-profile';
import {preparationTopic} from './preparation-intent';
import {returnedFeedbackSources} from './returned-feedback';
import {applyingFeedback,writingRequirements,writingFollowupQuestion} from './writing-target';
import {featuredWritingSources} from './featured-writing';
import {planAnswerSourceReadings,assertAnswerSourcesRead} from './answer-source-reading';
import {missingSourceTarget,missingStudentAnswer} from './source-target';
import {selectedSourcesOnly} from './answer-scope';
import {excerptCoverage,joinWholeExcerpts} from './excerpt-coverage';
import {sourceBoundTask} from './source-authority';
import {questionForIntent,retrievalLanguages} from './question-language';
import {receiptsForSources} from './moodle-receipts';
import {changedSources} from './source-dependencies';
import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {betaPool,tenant,uuid} from './db';
import {searchBetaSources,excerptBetaSources,sourceVersion,textLimit,BetaConflict} from './vault';
import {agenda,zoneDate,addDays} from './agenda';
import {studyDraft} from './study-draft';
import {calculationRecord} from './calculation-record';
import {BetaHttpError,peerAddress} from './http';
import {lockVault,checkHistory,HistoryLimit,objectLimit} from './budget';
import type {PoolClient} from 'pg';
import {release} from './release';
import {localAccountAvailable} from './config';
import {courseCode,mentionedCourseKeys,uniqueCourseAliases,workerCourse} from './course-codes';
import {conversationQuery,conversationInventory,conversationWorkWindowQuestion,nextDeadlineQuestion} from './chat-intent';
import {activityDeadlineExcerpt} from './moodle-facts';
import {savedWorkContext} from './work-context';
import {planningScope} from './planning-scope';
import {currentCourseSelection} from './course-selection';
import {answerInstitutionEvidence} from './connectors/institution-evidence';
import {studentContext} from './student-context';
import {continuityExcerpt,contextTerms} from './continuity-text';
import {courseCoverage} from './coverage';
import {collectionQuestion} from './coverage-intent';
import {citationNumbers} from './prose-citations';
import {quotedSourceExcerpt} from './source-focus';
import {scopedSearchQuestion} from './search';
import {answerGroupContext,answerGroupsCurrent} from './answer-group-context';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
// The worker key can lease any student's jobs, so it is rotatable and can be pinned to
// known peers. During a rotation both SCHOOL_BETA_WORKER_KEY and _NEXT are accepted.
// SCHOOL_BETA_WORKER_PEERS (comma-separated IPs), when set, refuses any other peer.
export function authorizeWorker(request:Request):'primary'|'next'{
 const raw=request.headers.get('authorization'),presented=raw?.startsWith('Bearer ')?hash(raw.slice(7)):'';
 const keys:[ 'primary'|'next',string|undefined][]=[['primary',process.env.SCHOOL_BETA_WORKER_KEY],['next',process.env.SCHOOL_BETA_WORKER_KEY_NEXT]];
 let label:'primary'|'next'|null=null;
 for(const [name,secret] of keys)if(secret&&secret.length>=43&&presented&&timingSafeEqual(Buffer.from(presented),Buffer.from(hash(secret))))label=name;
 const peers=(process.env.SCHOOL_BETA_WORKER_PEERS||'').split(',').map(v=>v.trim()).filter(Boolean);
 if(!label||request.headers.has('origin')||(peers.length&&!peers.includes(peerAddress(request))))throw new BetaHttpError('Worker access denied.',401);
 return label;
}
// One line per lease: which tenant (hashed), which job kind and which key. No content.
export function auditLease<T>(op:string,key:string,job:T):T{
 const lease=(job as any)?.lease;
 if(job)console.log(JSON.stringify({event:'worker-lease',op,key,tenant:typeof lease==='string'?hash('tenant:'+lease.split('.')[0]).slice(0,16):'unknown',job:(job as any)?.job_id??null}));
 return job;
}
// disabled: the assistant is switched off for this service. offline: it is enabled but the
// worker has not checked in recently, so questions queue until it returns.
export type AssistantStatus='ready'|'offline'|'disabled';
export async function assistantStatus(client?:PoolClient):Promise<AssistantStatus>{if(process.env.SCHOOL_BETA_AI_ENABLED!=='1')return 'disabled';return (await (client||betaPool()).query(`SELECT id FROM schoolvault.worker_status WHERE checked_at>now()-interval '60 seconds' AND capabilities @> '{"math":true,"date":true,"citation":true,"authority":true,"protocol":3}'::jsonb`)).rowCount?'ready':'offline';}
export async function workerReady(){return (await assistantStatus())==='ready';}
// For outside monitoring: the worker's state and heartbeat age, so a mini that is off or asleep is
// noticed by something other than the mini. Health reports it but never fails because of it.
export async function workerHealth(){
 const state=await assistantStatus();
 const row=(await betaPool().query('SELECT floor(extract(epoch FROM now()-max(checked_at)))::int AS age FROM schoolvault.worker_status')).rows[0];
 return {state,heartbeat_age_seconds:Number.isSafeInteger(row?.age)?row.age:null};
}
export async function workerHeartbeat(capabilities:any={}){const verified={math:capabilities.math===true,date:capabilities.date===true,citation:capabilities.citation===true,authority:capabilities.authority===true,pdf:capabilities.pdf===true,profiles:capabilities.profiles===true,cornell:capabilities.cornell===true,speech:capabilities.speech===true,speech_model_sha256:typeof capabilities.speech_model_sha256==='string'&&/^[a-f0-9]{64}$/.test(capabilities.speech_model_sha256)?capabilities.speech_model_sha256:null,protocol:capabilities.protocol===release.protocol?release.protocol:0,version:typeof capabilities.version==='string'?capabilities.version.slice(0,30):'unknown'};await betaPool().query('UPDATE schoolvault.worker_status SET checked_at=now(),capabilities=$1',[verified]);return {ready:verified.protocol===release.protocol&&verified.math&&verified.date&&verified.citation&&verified.authority,release};}
export async function leaseAnswer(){
 await betaPool().query('UPDATE schoolvault.worker_status SET checked_at=now()');
 const users=(await betaPool().query('SELECT id,timezone FROM schoolvault.users WHERE disabled_at IS NULL ORDER BY last_answer_lease_at NULLS FIRST,created_at,id')).rows;
 // Discovery exposes no content before entering the selected actor transaction.
 for(const user of users){
  const result=await tenant(user.id,async c=>{
   await lockVault(c,user.id);
   await c.query("UPDATE schoolvault.jobs SET status='failed',error='The assistant could not finish. Please try again.',lease_hash=NULL,lease_until=NULL,updated_at=now() WHERE user_id=$1 AND kind='answer' AND status='leased' AND lease_until<now() AND attempts>=3",[user.id]);
   const job=(await c.query("SELECT * FROM schoolvault.jobs WHERE user_id=$1 AND kind='answer' AND (status='queued' AND (input->>'model_recovery' IS DISTINCT FROM 'pending' OR updated_at<now()-interval '10 seconds') OR status='leased' AND lease_until<now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",[user.id])).rows[0];
   if(!job)return null;
   const chat=(await c.query('SELECT * FROM schoolvault.chats WHERE user_id=$1 AND id=$2',[user.id,job.chat_id])).rows[0];
   if(!chat||chat.archived){await c.query("UPDATE schoolvault.jobs SET status='cancelled',updated_at=now() WHERE user_id=$1 AND id=$2",[user.id,job.id]);return null;}
   const lease=user.id+'.'+job.id+'.'+randomBytes(32).toString('base64url');
   await c.query("UPDATE schoolvault.jobs SET status='leased',result=NULL,lease_hash=$3,lease_until=now()+interval '5 minutes',attempts=attempts+1,updated_at=now() WHERE user_id=$1 AND id=$2",[user.id,job.id,hash(lease)]);
   await c.query('UPDATE schoolvault.users SET last_answer_lease_at=now() WHERE id=$1',[user.id]);
   return {job,chat,lease};
  });
  if(!result)continue;
  const {job,chat,lease}=result;
  try{
   // Source search can take seconds across many courses. It must not hold the
   // vault write lock that Moodle collection, drafts and plans also require.
   const prepared=await tenant(user.id,c=>prepareAnswer(c,user,job,chat,lease),{readOnlySnapshot:true});
   return await tenant(user.id,async c=>{
    await lockVault(c,user.id);
    const live=(await c.query('SELECT * FROM schoolvault.jobs WHERE user_id=$1 AND id=$2 FOR UPDATE',[user.id,job.id])).rows[0];
    if(!live||live.status!=='leased'||live.lease_hash!==hash(lease)||Date.parse(live.lease_until)<=Date.now())return null;
    const active=(await c.query('SELECT id FROM schoolvault.users WHERE id=$1 AND disabled_at IS NULL',[user.id])).rowCount;
    const currentChat=(await c.query('SELECT archived FROM schoolvault.chats WHERE user_id=$1 AND id=$2',[user.id,chat.id])).rows[0];
    if(!active||!currentChat||currentChat.archived){
     await c.query("UPDATE schoolvault.jobs SET status='cancelled',lease_hash=NULL,lease_until=NULL,updated_at=now() WHERE user_id=$1 AND id=$2",[user.id,job.id]);return null;
    }
    const scope=prepared.usesPlanningScope?await planningScope(c,user.id):await currentCourseSelection(c,user.id);
    const revision='binding_revision' in scope?scope.binding_revision:scope.revision;
    const pins=prepared.pin.context_versions;
    const refs=prepared.payload.sources.filter((ref:any)=>pins[ref.id]!==ref.version_id);
    const versions=refs.length?(await c.query('SELECT id,current_version FROM schoolvault.sources WHERE user_id=$1 AND id=ANY($2::uuid[])',[user.id,refs.map((r:any)=>r.id)])).rows:[];
    const notes=prepared.payload.student_context?.work.filter((n:any)=>n.basis!=='selected_source_version')||[];
    const savedNotes=notes.length?(await c.query('SELECT id,version FROM schoolvault.notes WHERE user_id=$1 AND id=ANY($2::uuid[])',[user.id,notes.map((n:any)=>n.id)])).rows:[];
    if(revision!==prepared.binding||!(await answerGroupsCurrent(c,user.id,prepared.pin.group_context,new Date(),prepared.pin.sources))||refs.some((ref:any)=>!versions.some(v=>v.id===ref.id&&v.current_version===prepared.versions.find((saved:any)=>saved.id===ref.id)?.current_version))||notes.some((n:any)=>!savedNotes.some(v=>v.id===n.id&&v.version===n.note_revision))){
     // A write during retrieval must not slip past the normal source-change
     // invalidation, which could not yet see these not-yet-pinned references.
     await c.query("UPDATE schoolvault.jobs SET status='cancelled',error='Saved work or course selection changed while preparing this answer. Your question is saved; ask again to use the current evidence.',lease_hash=NULL,lease_until=NULL,updated_at=now() WHERE user_id=$1 AND id=$2",[user.id,job.id]);return null;
    }
    await c.query('SAVEPOINT pin_answer');
    try{
     await c.query("UPDATE schoolvault.jobs SET input=input||$3::jsonb,lease_until=now()+interval '5 minutes',updated_at=now() WHERE user_id=$1 AND id=$2",[user.id,job.id,JSON.stringify(prepared.pin)]);
     await checkHistory(c,user.id,100000);
    }catch(error){
     if(!(error instanceof HistoryLimit))throw error;
     await c.query('ROLLBACK TO SAVEPOINT pin_answer');
     await c.query("UPDATE schoolvault.jobs SET status='failed',error='Vault history is full. Your question is saved; export work before trying again.',lease_hash=NULL,lease_until=NULL,updated_at=now() WHERE user_id=$1 AND id=$2",[user.id,job.id]);
     await c.query('RELEASE SAVEPOINT pin_answer');return null;
    }
    await c.query('RELEASE SAVEPOINT pin_answer');return prepared.payload;
   });
  }catch(error){
   // A failed preparation has no worker holding its token. Recover the same
   // request with the existing bounded attempt limit, without another message.
   await tenant(user.id,async c=>{
    await lockVault(c,user.id);
    await c.query("UPDATE schoolvault.jobs SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'queued' END,error=CASE WHEN attempts>=3 THEN 'The assistant could not prepare your sources. Your question is saved; try again.' ELSE NULL END,lease_hash=NULL,lease_until=NULL,updated_at=now() WHERE user_id=$1 AND id=$2 AND status='leased' AND lease_hash=$3",[user.id,job.id,hash(lease)]);
   });throw error;
  }
 }
 return null;
}

const workSourceLimit=30;

async function prepareAnswer(c:PoolClient,user:any,job:any,chat:any,lease:string){
   const courseId='course_id' in job.input?job.input.course_id:chat.course_id;
   const history=(await c.query("SELECT id,role,sources,created_at,content->>'context_course_id' AS course_id,content->>'text' AS text,count(*) OVER()::int AS eligible_count FROM schoolvault.messages WHERE user_id=$1 AND chat_id=$2 AND (content ? 'context_course_id' AND (content->>'context_course_id') IS NOT DISTINCT FROM $3::uuid::text OR NOT(content ? 'context_course_id') AND $3::uuid IS NULL) ORDER BY created_at DESC,id DESC LIMIT 8",[user.id,chat.id,courseId])).rows.reverse();
   const historyCount=history[0]?.eligible_count||0,historyCoverage={eligible:historyCount,selected:history.length,omitted:Math.max(0,historyCount-history.length)};
   for(const row of history){Object.assign(row,continuityExcerpt(row.text||'',contextTerms(job.input.question),row.text===job.input.question?3000:1200));delete row.eligible_count;}
   const changedHistory=await changedSources(c,user.id,history.flatMap(row=>row.sources||[]));
   for(const row of history){if(row.role==='assistant'&&changedHistory.some(changed=>(row.sources||[]).some((ref:any)=>ref.id===changed.id&&ref.version_id===changed.version_id)))row.text='Earlier assistant answer omitted from this prompt because its source changed. Recheck current originals: '+changedHistory.filter(changed=>(row.sources||[]).some((ref:any)=>ref.id===changed.id&&ref.version_id===changed.version_id)).map(s=>s.title).join(', ');delete row.sources;}
   const intentQuestion=questionForIntent(job.input.retrieval_query||job.input.question);
   const intentHistory=history.map(row=>({...row,text:questionForIntent(row.text)}));
   const writingQuestion=writingFollowupQuestion(intentQuestion,intentHistory);
   const translatedRetrieval=preparationTopic(conversationQuery(writingQuestion,intentHistory));
   const retrievalQuestion=job.input.retrieval_query&&job.input.retrieval_query!==job.input.question?retrievalLanguages(translatedRetrieval,job.input.question):translatedRetrieval,inventory=conversationInventory(intentQuestion,intentHistory);
   const context=job.input.context??chat.context,selected=Array.isArray(context)?context.slice(0,8):[];
   const needsSourceTarget=missingSourceTarget({question:intentQuestion,context:selected,history:intentHistory});
   const selectedOnly=selectedSourcesOnly(job.input.question);
   const deadlineOnly=!selectedOnly&&nextDeadlineQuestion(intentQuestion);
   const selectedContextRows=selected.length?(await c.query("SELECT s.id,s.title,s.course_id,s.kind,s.original_url,s.current_version,v.id AS version_id,v.observed_at,v.body AS full_body FROM schoolvault.sources s JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.source_id=s.id AND v.id=coalesce(($4::jsonb->>s.id::text)::uuid,s.current_version) WHERE s.user_id=$1 AND s.id=ANY($2::uuid[]) AND ($3::uuid IS NULL OR s.course_id=$3) ORDER BY array_position($2::uuid[],s.id)",[user.id,selected,courseId,job.input.context_versions??chat.context_versions??{}])).rows:[];
   const selectedRows=selectedContextRows.filter(row=>row.kind!=='ai_draft');
   const courseRows=(await c.query('SELECT id,code,title,moodle_id FROM schoolvault.courses WHERE user_id=$1',[user.id])).rows;
   const usesPlanningScope=!selectedOnly&&(inventory||job.input.mode==='plan');
   const planning=usesPlanningScope?await planningScope(c,user.id):undefined;
   const current=planning??await (async()=>{
    const official=await currentCourseSelection(c,user.id);
    return {confirmed:official.confirmed,binding_revision:official.revision,course_ids:courseRows.filter(row=>!row.moodle_id||official.moodle_ids.includes(row.moodle_id)).map(row=>row.id)};
   })();
   const eligible=current.confirmed?courseRows.filter(row=>current.course_ids.includes(row.id)||row.id===courseId):courseRows;
   const originalCodes=mentionedCourseKeys(job.input.question),namedCodes=originalCodes.size?originalCodes:mentionedCourseKeys(retrievalQuestion),aliases=uniqueCourseAliases(eligible);
   // A typed code shared by two Moodle cards cannot identify a lecture or lab.
   // An explicit course selection disambiguates it; without one, supply no
   // course facts for the model to turn into an assumed answer.
   const ambiguousNamedCourse=!courseId&&[...namedCodes].some(code=>aliases.has(code)&&aliases.get(code)===null);
   const namedCourses=[...namedCodes].map(code=>aliases.get(code)).filter((row):row is (typeof courseRows)[number]=>!!row).slice(0,8);
   const inventoryScopeMismatch=inventory&&!!courseId&&originalCodes.size>0&&namedCourses.some(row=>row.id!==courseId);
   const inventoryMissingCourse=inventory&&[...originalCodes].some(code=>!aliases.has(code));
   const explicitScopes=[...new Set([courseId,...namedCourses.map(row=>row.id)].filter(Boolean))];
   const scopes=explicitScopes.length?explicitScopes:current.confirmed?eligible.map(row=>row.id):[];
   const excerptQuestion=scopes.length===1?scopedSearchQuestion(retrievalQuestion,courseRows.find(row=>row.id===scopes[0])?.code||''):retrievalQuestion;
   const scopedRows=inventory&&!selectedOnly?selectedRows.filter(row=>row.version_id===row.current_version&&(!(scopes.length||current.confirmed)||scopes.includes(row.course_id))):selectedRows;
   const refs=await excerptBetaSources(c,scopedRows,excerptQuestion,scopedRows.length>6?1350:1800);
   const clock=new Date();
   const collectedWork=planning?await savedWorkContext(c,user.id,scopes.length||current.confirmed?scopes:eligible.map(row=>row.id),inventory?conversationWorkWindowQuestion(intentQuestion,intentHistory):intentQuestion,clock,user.timezone,!!explicitScopes.length||current.confirmed,explicitScopes.length?'the selected course scope':'your selected current courses',planning):null;
   const workResult=collectedWork?{...collectedWork,work:{...collectedWork.work,scope:{...collectedWork.work.scope,courses:courseRows.filter(row=>collectedWork.work.scope.course_ids.includes(row.id)).map(workerCourse)}}}:null;
   const workSources=new Map<string,NonNullable<typeof workResult>['sources'][number]>();
   for(const source of workResult?.sources||[]){
    const key=source.id+':'+source.version_id;
    if(!workSources.has(key))workSources.set(key,source);
    if(workSources.size===workSourceLimit)break;
   }
   const workRefs=await excerptBetaSources(c,[...workSources.values()],excerptQuestion,1200);
   // Keep the exact assessment quote beside its citation even when the
   // general weekly search terms select a different page of a syllabus.
   for(const ref of workRefs){
    const original=workSources.get(ref.id+':'+ref.version_id);
    if(deadlineOnly&&original?.kind==='moodle'){
     const field=activityDeadlineExcerpt(original.original_url,original.full_body,1800);
     if(field){ref.excerpt=field;ref.excerpt_coverage=excerptCoverage(ref,original.full_body,field);}
    }
    const quotes=workResult?.work.assessments.flatMap(a=>[a,...a.conflicts]).filter(a=>a.sourceId===ref.id&&a.version===ref.version_id&&original?.full_body.includes(a.quote)).map(a=>a.quote)||[];
    if(quotes.length&&original){ref.excerpt=joinWholeExcerpts([...new Set(quotes),ref.excerpt],1800);ref.excerpt_coverage=excerptCoverage(ref,original.full_body,ref.excerpt);}
   }
   // Structured work already fills the answer in this case. Generic search
   // cannot contribute a source after the version-aware dedupe and cap below.
   const workFillsSources=workSources.size>=workSourceLimit;
   // B6: retrieval trace for answer_traces (NEYVU_ANSWER_TRACE=1 only; job input is unchanged otherwise).
   const retrievalTrace=retrievalConfig().trace?newRetrievalTrace():undefined,retrievalStarted=performance.now();
   const groups=selectedOnly||deadlineOnly||workFillsSources?[]:scopes.length?await Promise.all(scopes.map(scope=>searchBetaSources(c,user.id,retrievalQuestion,scope,retrievalTrace))):current.confirmed?[]:[await searchBetaSources(c,user.id,retrievalQuestion,undefined,retrievalTrace)];
   const retrievalMs=Math.round(performance.now()-retrievalStarted);
   if(!selectedOnly&&courseId&&/\blab\b.*\b(?:section|meet)|\b(?:section|meet)\b.*\blab\b/i.test(job.input.question)){
    const chosen=courseCode(courseRows.find(row=>row.id===courseId)?.code||'');
    if(chosen){const code=chosen.replace(/ /g,'');const related=(await searchBetaSources(c,user.id,retrievalQuestion)).filter(source=>source.course_id!==courseId&&(!current.confirmed||eligible.some(row=>row.id===source.course_id))&&mentionedCourseKeys(source.excerpt).has(code));if(related.length)groups.push(related.slice(0,2));}
   }
   // Interleave explicitly named courses so a lab question referring to its
   // parent lecture course can include both sources. Every lookup stays tenant scoped.
   const feedback=!selectedOnly&&!selected.length?await returnedFeedbackSources(c,user.id,courseId,writingQuestion):[];
   const requirements=!selectedOnly&&!selected.length?await writingRequirements(c,user.id,courseId,writingQuestion):[];
   const writingMaterial=!selectedOnly&&!selected.length?await featuredWritingSources(c,user.id,courseId,retrievalQuestion):[];
   const general=Array.from({length:8},(_,index)=>groups.map(group=>group[index]).filter(Boolean)).flat();
   // Once the current writing task has exact originals, do not reintroduce
   // old student drafts as additional "source" material beside current work.
   const hits=feedback.length&&!applyingFeedback(writingQuestion)&&!writingMaterial.length?feedback:requirements.length?[...requirements,...feedback,...writingMaterial]:[...feedback,...writingMaterial,...general];
   const needsPolicy=/\b(?:write|complete|do)\b.*\b(?:assignment|reflection|essay)\b.*\b(?:for me|hand|submit)\b/i.test(intentQuestion);
   const policyRefs=!selectedOnly&&needsPolicy&&courseId?(await searchBetaSources(c,user.id,'generative artificial intelligence AI policy prohibited allowed',courseId)).slice(0,2):[];
   const recentRows=!selectedOnly&&!deadlineOnly&&!workFillsSources&&!refs.length&&!hits.length?(await c.query("SELECT s.id,s.title,s.course_id,s.kind,s.original_url,v.id AS version_id,v.observed_at,v.body AS full_body FROM schoolvault.sources s JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.id=s.current_version WHERE s.user_id=$1 AND s.kind!='ai_draft' AND ($2::uuid[] IS NULL OR s.course_id=ANY($2)) ORDER BY v.observed_at DESC LIMIT 6",[user.id,scopes.length||current.confirmed?scopes:null])).rows:[];
   const recent=recentRows.length?await excerptBetaSources(c,recentRows,excerptQuestion):[];
   const scopeFilter=scopes.length||current.confirmed?scopes:null;
   const planned=!selectedOnly&&!deadlineOnly&&job.input.mode==='plan'?agenda((await c.query("SELECT t.*,s.kind AS source_kind,s.title AS source_title,s.original_url FROM schoolvault.tasks t JOIN schoolvault.sources s ON s.user_id=t.user_id AND s.id=t.source_id WHERE t.user_id=$1 AND ($2::uuid[] IS NULL OR t.course_id=ANY($2)) AND coalesce(t.evidence->>'active','true')!='false'",[user.id,scopeFilter])).rows.map(row=>sourceBoundTask(row,{kind:row.source_kind,title:row.source_title,original_url:row.original_url})),(await c.query('SELECT * FROM schoolvault.meetings WHERE user_id=$1 AND ($2::uuid[] IS NULL OR course_id=ANY($2))',[user.id,scopeFilter])).rows,zoneDate(clock,user.timezone),addDays(zoneDate(clock,user.timezone),14),user.timezone).slice(0,30):[];
   const planRows=planned.length?(await c.query(`SELECT DISTINCT s.id,s.title,s.course_id,s.kind,s.original_url,s.current_version,v.id AS version_id,v.observed_at,v.body AS full_body
    FROM jsonb_to_recordset($2::jsonb) ref(id uuid,version_id uuid)
    JOIN schoolvault.sources s ON s.user_id=$1 AND s.id=ref.id
    JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.source_id=s.id AND v.id=coalesce(ref.version_id,s.current_version)`,[user.id,JSON.stringify(planned.map(p=>({id:p.source_id,version_id:p.version_id||null})))])).rows:[];
   const planRefs=planRows.length?await excerptBetaSources(c,planRows,excerptQuestion):[];
   const unique=new Map();for(const s of [...workRefs,...planRefs,...refs,...policyRefs,...hits,...recent]){const key=workResult||job.input.mode==='plan'?s.id+':'+s.version_id:s.id;if(!unique.has(key)){const course=courseRows.find(row=>row.id===s.course_id);unique.set(key,{...s,historical:!!s.current_version&&s.current_version!==s.version_id,course:course?workerCourse(course):null,excerpt:s.excerpt});}}
   const required=new Set([...refs,...policyRefs].map(s=>s.id));
   const continuity=selectedOnly?null:await studentContext(c,user.id,chat.id,courseId,ambiguousNamedCourse?[]:scopes,retrievalQuestion,history.map(row=>row.id),selectedContextRows.filter(row=>scopes.includes(row.course_id)).map(row=>({id:row.id,version_id:row.version_id})));
   const needsAnswerTarget=missingStudentAnswer({question:job.input.question,context:selected,history:intentHistory,student_context:continuity});
   const sources=needsSourceTarget||needsAnswerTarget?[]:selectedOnly?refs.map(s=>({...s,historical:!!s.current_version&&s.current_version!==s.version_id,course:courseRows.find(row=>row.id===s.course_id)?workerCourse(courseRows.find(row=>row.id===s.course_id)!):null})):ambiguousNamedCourse||inventoryScopeMismatch||inventoryMissingCourse?[]:[...unique.values()].slice(0,workResult||job.input.mode==='plan'?workSourceLimit:Math.max(6,required.size));
   // NEYVU_RETRIEVAL=hybrid (worker site): pin a wide candidate set; the worker
   // reorders only the generic-search slots (op retrieval.rank, worker-retrieval.ts).
   const fixedRouteIds=new Set([...workRefs,...planRefs,...refs,...policyRefs,...feedback,...requirements,...writingMaterial].map((s:any)=>s.id));
   const searchIds=new Set([...general,...recent].map((s:any)=>s.id));
   const hybrid=!selectedOnly&&!workResult&&job.input.mode!=='plan'?await workerRetrievalPlan(c,user.id,{question:retrievalQuestion,sources,rerankable:sources.flatMap((s:any,i:number)=>searchIds.has(s.id)&&!fixedRouteIds.has(s.id)?[i]:[]),keywordOrder:[...general,...recent].map((s:any)=>s.id),scopeIds:scopes.length||current.confirmed?scopes:null}):null;
   const sourceScope=selectedOnly?{kind:'selected_only',source_ids:selected,complete:selected.length>0&&selected.every(id=>sources.some(s=>s.id===id))}:null;
   const sourceReadings=await planAnswerSourceReadings(c,user.id,{...job,input:{...job.input,history:selectedOnly?[]:history,...(workResult?{work:workResult.work}:{})}},sources,current.binding_revision,usesPlanningScope?'planning':'moodle');
   const receiptViews=await receiptsForSources(c,user.id,sources.filter(s=>s.kind==='moodle'),clock);for(const source of sources)source.receipt=receiptViews.get(source.id)||null;
   const work=workResult?.work;
   const collection=!selectedOnly&&collectionQuestion(intentQuestion)?{
    scope_confirmed:!ambiguousNamedCourse&&![...originalCodes].some(code=>!aliases.has(code))&&!(courseId&&namedCourses.some(row=>row.id!==courseId)),
    courses:(await courseCoverage(c,user.id)).filter(row=>(scopes.length?scopes:current.confirmed?[]:eligible.map(course=>course.id)).includes(row.course_id)).map(row=>({course_id:row.course_id,code:courseRows.find(course=>course.id===row.course_id)?.code,readiness:row.readiness}))
   }:undefined;
   if(work){const count=work.tasks.length;work.tasks=ambiguousNamedCourse||inventoryScopeMismatch||inventoryMissingCourse?[]:work.tasks.filter(task=>sources.some(s=>s.id===task.source_id&&s.version_id===task.version_id));if(ambiguousNamedCourse||inventoryScopeMismatch||inventoryMissingCourse)work.scope.confirmed=false;if(inventoryScopeMismatch){const selected=courseRows.find(row=>row.id===courseId);work.scope.clarification='This chat is set to '+String(selected?.code||'a different course').slice(0,180)+'. Select '+namedCourses.filter(row=>row.id!==courseId).map(row=>String(row.code).slice(0,180)).join(' or ')+' to check its saved work.';}else if(inventoryMissingCourse)work.scope.clarification='I do not have a saved current course matching '+[...originalCodes].join(' or ')+'. Select its course or review your current courses in the Companion.';if(count!==work.tasks.length)work.coverage.limitations.push('Some work references do not fit this answer; select a course to narrow the summary.');if(inventory&&scopedRows.length<selectedRows.length)work.coverage.limitations.push('Historical attachments are preserved, but this current-work summary uses the current selected course scope and saved evidence versions.');}
   const selectedCourse=courseRows.find(row=>row.id===courseId),course=selectedCourse?workerCourse(selectedCourse):null;
   const group_context=!selectedOnly&&/\b(?:groups?|labs?|teams?|sections?)\b/i.test(retrievalQuestion)?await answerGroupContext(c,user.id,ambiguousNamedCourse?[]:scopes,clock):undefined;
   // Flagged (default off): the learner graph and editable profile for the answer's courses.
   const knowledge_graph=knowledgeGraphEnabled()&&!selectedOnly&&scopes.length?await graphProjection(c,user.id,scopes):undefined;
   const learner_profile=learnerProfileEnabled()&&!selectedOnly?await learnerProfileProjection(c,user.id,scopes):undefined;
   // C7 (flag NEYVU_INSTITUTION_EVIDENCE): public university evidence, labelled apart from course sources.
   const institution_evidence=selectedOnly?[]:await answerInstitutionEvidence(c,user.id,retrievalQuestion).catch(()=>[]);
   const payload={lease,job_id:job.id,course,...(hybrid?{retrieval:hybrid.payload}:{}),group_context,...(knowledge_graph?{knowledge_graph}:{}),...(learner_profile?{learner_profile}:{}),...(institution_evidence.length?{institution_evidence}:{}),context:selected,question:job.input.question,response_language:job.input.response_language||'en',prepared_question:job.input.retrieval_query||null,query_usage:job.input.query_usage||null,retrieval_question:retrievalQuestion,mode:job.input.mode,sources,source_scope:sourceScope,source_readings:sourceReadings,student_context:continuity,history_coverage:selectedOnly?{eligible:historyCount,selected:0,omitted:historyCount}:historyCoverage,...(work?{work}:{}),...(collection?{collection_coverage:collection}:{}),student:{today:zoneDate(clock,user.timezone),timezone:user.timezone,current_courses:{confirmed:current.confirmed,courses:eligible.map(workerCourse)}},agenda:planned.flatMap(p=>{const evidence=sources.find(s=>s.id===p.source_id&&(!p.version_id||s.version_id===p.version_id));return evidence?[{...p,version_id:evidence.version_id}]:[];}),agenda_omitted:planned.filter(p=>!sources.some(s=>s.id===p.source_id&&(!p.version_id||s.version_id===p.version_id))).length,history:selectedOnly?[]:history,timezone:user.timezone,now:clock.toISOString()};
   const versions=sources.length?(await c.query('SELECT id,current_version FROM schoolvault.sources WHERE user_id=$1 AND id=ANY($2::uuid[])',[user.id,sources.map((s:any)=>s.id)])).rows:[];
   return {payload,versions,pin:{...(hybrid?{retrieval_pool:hybrid.pin}:{}),...(retrievalTrace?{retrieval_trace:{...retrievalTrace,retrieval_ms:retrievalMs,retrieval_question:retrievalQuestion.slice(0,4000),prepared_at:new Date().toISOString()}}:{}),sources,source_scope:sourceScope,source_readings:sourceReadings,context_versions:job.input.context_versions??chat.context_versions??{},student_context:continuity,group_context,history:selectedOnly?[]:history,history_coverage:selectedOnly?{eligible:historyCount,selected:0,omitted:historyCount}:historyCoverage,retrieval_question:retrievalQuestion,...(work?{work}:{}),...(collection?{collection_coverage:collection}:{})},binding:current.binding_revision,usesPlanningScope};
}
// A local translation prepares retrieval, then the normal lease re-runs every
// scope/evidence check. It never creates a second student message or job.
export async function prepareAnswerQuery(raw:unknown,query:unknown,usage:any={}){
 if(typeof raw!=='string')throw new BetaHttpError('Invalid worker lease');
 const parts=raw.split('.');if(parts.length!==3||!uuid(parts[0])||!uuid(parts[1])||!/^[A-Za-z0-9_-]{43}$/.test(parts[2]))throw new BetaHttpError('Invalid worker lease');
 if(typeof query!=='string'||!query.trim()||query.length>3000)throw new BetaHttpError('Invalid prepared question');
 const totals={requests:usage?.requests??0,input:usage?.input??0,output:usage?.output??0};
 if(Object.values(totals).some(n=>!Number.isSafeInteger(n)||n<0||n>10000000)||totals.requests>2)throw new BetaHttpError('Invalid preparation usage');
 const [user,jobId]=parts;
 return tenant(user,async c=>{
  await lockVault(c,user);
  if(!(await c.query('SELECT id FROM schoolvault.users WHERE id=$1 AND disabled_at IS NULL',[user])).rowCount)throw new BetaHttpError('Account unavailable.',403);
  const job=(await c.query('SELECT * FROM schoolvault.jobs WHERE user_id=$1 AND id=$2 FOR UPDATE',[user,jobId])).rows[0];
  if(job?.input?.query_preparation_hash===hash(raw)){
   if(job.input.retrieval_query!==query)throw new BetaConflict('This question was already prepared.');
   return {prepared:true};
  }
  if(!job||job.kind!=='answer'||job.status!=='leased'||job.lease_hash!==hash(raw)||Date.parse(job.lease_until)<=Date.now())throw new BetaConflict('This worker lease expired.');
  if(job.input.retrieval_query)throw new BetaConflict('This question was already prepared.');
  await c.query("UPDATE schoolvault.jobs SET input=input||$3::jsonb,status='queued',lease_hash=NULL,lease_until=NULL,attempts=greatest(attempts-1,0),updated_at=now() WHERE user_id=$1 AND id=$2",[user,jobId,JSON.stringify({retrieval_query:query,query_preparation_hash:hash(raw),query_usage:totals})]);
  await checkHistory(c,user);
  return {prepared:true};
 });
}

export async function finishAnswer(raw:unknown,output:any){
 if(typeof raw!=='string')throw new BetaHttpError('Invalid worker lease');
 const parts=raw.split('.');if(parts.length!==3||!uuid(parts[0])||!uuid(parts[1])||!/^[A-Za-z0-9_-]{43}$/.test(parts[2]))throw new BetaHttpError('Invalid worker lease');
 const [user,jobId]=parts;
 return tenant(user,async c=>{
  await lockVault(c,user);
  const active=(await c.query('SELECT id FROM schoolvault.users WHERE id=$1 AND disabled_at IS NULL',[user])).rowCount;if(!active)throw new BetaHttpError('Account unavailable.',403);
  const job=(await c.query('SELECT * FROM schoolvault.jobs WHERE user_id=$1 AND id=$2 FOR UPDATE',[user,jobId])).rows[0];
  if(!job||job.status!=='leased'||job.lease_hash!==hash(raw)||Date.parse(job.lease_until)<=Date.now())throw new BetaConflict('This worker lease expired.');
  if(output?.error){
   const transient=['model_timeout','model_connection','model_http_408','model_http_429','model_http_500','model_http_502','model_http_503','model_http_504','model_deadline'].includes(output.reason);
   if(output.retryable===true&&transient&&job.attempts<3&&!job.result?.draft){
    await c.query("UPDATE schoolvault.jobs SET status='queued',error=NULL,input=input||$3::jsonb,lease_hash=NULL,lease_until=NULL,updated_at=now() WHERE user_id=$1 AND id=$2",[user,jobId,JSON.stringify({model_recovery:'pending'})]);
    await c.query("INSERT INTO schoolvault.audit(user_id,id,action,target,details) VALUES($1,$2,'answer-model-recovery',$3,$4)",[user,randomUUID(),jobId,{attempt:job.attempts,reason:output.reason}]);
    return {saved:true,status:'queued',recovering:true};
   }
   const failure=output.reason==='model_context_limit'?'There is too much context for one answer. Your question and saved work are kept. Ask about one source or one part in a new chat.':'The assistant could not finish. Your question is saved; try again.';
   await c.query("UPDATE schoolvault.jobs SET status='failed',error=$3,lease_hash=NULL,lease_until=NULL,updated_at=now() WHERE user_id=$1 AND id=$2",[user,jobId,failure]);return {saved:true,status:'failed'};
  }
  if(typeof output?.text!=='string'||!output.text.trim()||output.text.length>12000||/<\/?think>/.test(output.text)||typeof output.model!=='string'||output.model.length>100||!Number.isSafeInteger(output.input_tokens)||output.input_tokens<0||!Number.isSafeInteger(output.output_tokens)||output.output_tokens<0)throw new BetaHttpError('Invalid assistant output');
  const readingUsage=await assertAnswerSourcesRead(c,user,job);
  if(!(await answerGroupsCurrent(c,user,job.input.group_context,new Date(),job.input.sources)))throw new BetaConflict('Group evidence changed or expired. Your question is saved; ask again to use the current evidence.');
  const pinned=job.input.sources||[];
  const citations=citationNumbers(output.text);
  for(const number of citations)if(number<1||number>pinned.length)throw new BetaHttpError('Assistant cited an unavailable source');
  const focus=output.citation_focus;
  const number=focus?.number;
  const passage=output.model==='saved-moodle-deadline-conflict'&&Number.isInteger(number)&&[...citations].includes(number)&&typeof focus?.passage==='string'
   ?quotedSourceExcerpt(pinned[number-1]?.excerpt,focus.passage):undefined;
  const sources=passage?pinned.map((source:any,index:number)=>index===number-1?{...source,excerpt:passage}:source):pinned;
  const calculation=calculationRecord(output.calculation,job.input.question,output.text);
  // Only the worker's group-clarification route may attach group choices, and
  // only options visible in this answer's own same-course sources survive.
  if(output.clarification!==undefined&&output.model!=='group-clarification'&&output.model!=='question-clarification')throw new BetaHttpError('Invalid assistant output');
  const clarification=output.clarification===undefined?undefined:output.model==='question-clarification'?questionClarification(output.clarification,job.input):groupClarification(output.clarification,job.input);
  const content={type:'answer',text:output.text.trim(),job_id:jobId,...(calculation?{calculation}:{}),...(clarification?{clarification}:{})},result={available:true,content,sources,model:output.model,input_tokens:output.input_tokens,output_tokens:output.output_tokens,estimated_cost_usd:0,...(readingUsage?{source_reading_usage:readingUsage}:{}),compute:localAccountAvailable()?'This computer':'Answer worker',completed_at:new Date().toISOString()};
  await c.query('SAVEPOINT answer_result');
  await c.query("INSERT INTO schoolvault.messages(user_id,id,chat_id,role,content,sources) VALUES($1,$2,$3,'assistant',$4,$5)",[user,randomUUID(),job.chat_id,JSON.stringify({...content,context_course_id:job.input.course_id??null}),JSON.stringify(sources)]);
  await c.query("UPDATE schoolvault.jobs SET result=$3 WHERE user_id=$1 AND id=$2",[user,jobId,JSON.stringify(result)]);
  try{await checkHistory(c,user);}catch(error){
   if(!(error instanceof HistoryLimit))throw error;
   await c.query('ROLLBACK TO SAVEPOINT answer_result');
   await c.query("UPDATE schoolvault.jobs SET status='failed',error='Vault history is full. Your question is saved; export work before trying again.',lease_hash=NULL,lease_until=NULL,updated_at=now() WHERE user_id=$1 AND id=$2",[user,jobId]);
   await c.query('RELEASE SAVEPOINT answer_result');return {saved:true,status:'failed'};
  }
  await c.query('RELEASE SAVEPOINT answer_result');
  await writeAnswerTrace(c,user,job,output,sources,result);
  // Solve-mode answers become labelled study drafts in the selected course's
  // notebook. Their sources use kind=ai_draft, so the retriever cannot cite an
  // AI answer as original evidence. A full text quota skips only the draft.
  if(job.input.mode==='solve'&&uuid(job.input.course_id)){
   const owner=(await c.query('SELECT timezone FROM schoolvault.users WHERE id=$1',[user])).rows[0];
   const draft=studyDraft(job.input.question,content.text,sources,owner?.timezone,new Date(),calculation);
   const vault=(await c.query('SELECT text_quota_bytes FROM schoolvault.vaults WHERE user_id=$1 FOR UPDATE',[user])).rows[0];
   const used=Number((await c.query(`SELECT coalesce((SELECT sum(octet_length(body)) FROM schoolvault.source_versions WHERE user_id=$1),0)
      +coalesce((SELECT sum(octet_length(snapshot::text)) FROM schoolvault.note_revisions WHERE user_id=$1),0) AS used`,[user])).rows[0].used);
   const counts=(await c.query('SELECT (SELECT count(*) FROM schoolvault.notes WHERE user_id=$1) AS notes,(SELECT count(*) FROM schoolvault.sources WHERE user_id=$1) AS sources',[user])).rows[0];
   if(!vault||used+Buffer.byteLength(draft.body)>textLimit(vault.text_quota_bytes))Object.assign(result,{study_note_skipped:'text_quota'});
   else if(Number(counts.notes)>=await objectLimit(c,user,'notes')||Number(counts.sources)>=await objectLimit(c,user,'sources'))Object.assign(result,{study_note_skipped:'item_limit'});
   else{
    await c.query('SAVEPOINT study_draft');
    try{
     const source=randomUUID(),note=randomUUID();
     await c.query("INSERT INTO schoolvault.sources(user_id,id,course_id,kind,title) VALUES($1,$2,$3,'ai_draft',$4)",[user,source,job.input.course_id,draft.title]);
     await sourceVersion(c,user,source,draft.body);
     await c.query("INSERT INTO schoolvault.notes(user_id,id,course_id,source_id,title,body,origin) VALUES($1,$2,$3,$4,$5,$6,'ai_draft')",[user,note,job.input.course_id,source,draft.title,draft.body]);
     await checkHistory(c,user,2000);
     await c.query("INSERT INTO schoolvault.audit(user_id,id,action,target,details) VALUES($1,$2,'study-draft-created',$3,$4)",[user,randomUUID(),note,JSON.stringify({job_id:jobId})]);
     Object.assign(result,{study_note_id:note});
    }catch{
     await c.query('ROLLBACK TO SAVEPOINT study_draft');
     Object.assign(result,{study_note_skipped:'storage_error'});
    }
    await c.query('RELEASE SAVEPOINT study_draft');
   }
  }
  await c.query("UPDATE schoolvault.jobs SET status='complete',result=$3,lease_hash=NULL,lease_until=NULL,updated_at=now() WHERE user_id=$1 AND id=$2",[user,jobId,JSON.stringify(result)]);
  await checkHistory(c,user);
  return {saved:true,status:'complete'};
 });
}
// A slow answer (long generation, Spanish translation passes) keeps its lease while the worker
// is still drafting. Each attempt is capped at 20 minutes from its lease (updated_at is set only
// when leased), so a stuck worker cannot hold a student's question indefinitely.
export async function renewAnswerLease(raw:unknown){
 if(typeof raw!=='string')throw new BetaHttpError('Invalid worker lease');
 const parts=raw.split('.');if(parts.length!==3||!uuid(parts[0])||!uuid(parts[1])||!/^[A-Za-z0-9_-]{43}$/.test(parts[2]))throw new BetaHttpError('Invalid worker lease');
 const [user,jobId]=parts;
 return tenant(user,async c=>{
  const row=(await c.query("UPDATE schoolvault.jobs SET lease_until=least(now()+interval '5 minutes',updated_at+interval '20 minutes') WHERE user_id=$1 AND id=$2 AND kind='answer' AND status='leased' AND lease_hash=$3 AND lease_until>now() AND updated_at+interval '20 minutes'>now() RETURNING lease_until",[user,jobId,hash(raw)])).rows[0];
  if(!row)throw new BetaConflict('This worker lease expired.');
  return {renewed:true,lease_until:new Date(row.lease_until).toISOString()};
 });
}
export async function saveAnswerDraft(raw:unknown,text:unknown,sequence?:unknown){
 if(typeof raw!=='string'||typeof text!=='string'||!text.trim()||text.length>(sequence===undefined?2000:12000)||/<\/?think>/.test(text))throw new BetaHttpError('Invalid draft');
 const parts=raw.split('.');if(parts.length!==3||!uuid(parts[0])||!uuid(parts[1])||!/^[A-Za-z0-9_-]{43}$/.test(parts[2]))throw new BetaHttpError('Invalid worker lease');
 const [user,jobId]=parts;
 return tenant(user,async c=>{
  await lockVault(c,user);
  if(!(await c.query('SELECT id FROM schoolvault.users WHERE id=$1 AND disabled_at IS NULL',[user])).rowCount)throw new BetaHttpError('Account unavailable.',403);
  const job=(await c.query('SELECT * FROM schoolvault.jobs WHERE user_id=$1 AND id=$2 FOR UPDATE',[user,jobId])).rows[0];
  if(!job||job.kind!=='answer'||job.status!=='leased'||job.lease_hash!==hash(raw)||Date.parse(job.lease_until)<=Date.now())throw new BetaConflict('This worker lease expired.');
  await assertAnswerSourcesRead(c,user,job);
  if(!(await answerGroupsCurrent(c,user,job.input.group_context,new Date(),job.input.sources)))throw new BetaConflict('Group evidence changed or expired. Your question is saved; ask again to use the current evidence.');
  if(sequence!==undefined&&(!Number.isSafeInteger(sequence)||Number(sequence)<1||Number(sequence)>1000))throw new BetaHttpError('Invalid draft sequence');
  if(sequence===undefined&&job.result?.draft)return {saved:true};
  if(sequence!==undefined&&Number(sequence)<=Number(job.result?.draft_sequence||0)){if(Number(sequence)===Number(job.result?.draft_sequence)&&text===job.result?.draft)return {saved:true};throw new BetaConflict('Stale draft sequence');}
  if(sequence!==undefined&&job.result?.draft&&!text.startsWith(job.result.draft))throw new BetaConflict('Draft does not extend the saved answer');
  for(const number of citationNumbers(text))if(number<1||number>(job.input.sources||[]).length)throw new BetaHttpError('Draft cited an unavailable source');
  await c.query('UPDATE schoolvault.jobs SET result=$3 WHERE user_id=$1 AND id=$2',[user,jobId,{...job.result,draft:text.trim(),draft_at:new Date().toISOString(),...(sequence===undefined?{}:{draft_sequence:sequence})}]);
  await checkHistory(c,user);return {saved:true};
 });
}

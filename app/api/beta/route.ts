import {saveGroupClarification} from '../../../lib/beta/group-clarification';
import {betaFeedbackContext} from '../../../lib/beta/feedback-context';
import {betaCourseworkCatalogue} from '../../../lib/beta/coursework-catalogue';
import {betaSourceLibrary} from '../../../lib/beta/source-library';
import {savePlanningScope} from '../../../lib/beta/planning-scope';
import {readStudyAvailability,saveStudyAvailability} from '../../../lib/beta/study-availability';
import {answerEventStream} from '../../../lib/beta/answer-stream';
import {betaRoute} from '../../../lib/beta/api-route';
import {betaTimetableSuggestions} from '../../../lib/beta/timetable';
import {answerProgress} from '../../../lib/beta/answer-progress';
import {betaCourseContext} from '../../../lib/beta/course-context';
import {supportedLanguage} from '../../../lib/beta/language';
import {createMeeting,setMeetingActive} from '../../../lib/beta/meetings';
import {betaActor,revokeSession} from '../../../lib/beta/auth';
import {betaCookie,betaEnabled} from '../../../lib/beta/config';
import {betaJson,betaError,betaWriteAllowed,betaRequestJson,BetaHttpError} from '../../../lib/beta/http';
import {betaNote,betaSnapshot,betaSearch,betaChatSearch,betaSource,betaChat,createBetaChat,updateBetaChat,createBetaCourse,createBetaNote,updateBetaNote} from '../../../lib/beta/vault';
import {searchInBetaChat} from '../../../lib/beta/chat';
import {assistantStatus} from '../../../lib/beta/worker';
import {listStudentMemory,saveStudentMemory,forgetStudentMemory} from '../../../lib/beta/student-memory';
import {getLearnerProfile,saveLearnerProfileFact,forgetLearnerProfileFact} from '../../../lib/beta/learner-profile';
import {getSourceProfile,queueSourceProfile} from '../../../lib/beta/source-profiles';
import {saveStudentProgress,saveStudentPlan} from '../../../lib/beta/student-planning';
import {betaUnderstanding} from '../../../lib/beta/understanding';
import {cookies} from 'next/headers';
import {tenant} from '../../../lib/beta/db';
import {readAnswerTrace} from '../../../lib/beta/answer-trace';
export const runtime='nodejs';
async function requireActor(){const actor=await betaActor();if(!actor)throw new BetaHttpError('Please sign in to SchoolVault.',401);return actor;}
async function handleGET(request:Request){
 if(!betaEnabled())return betaJson({error:'The beta is not available yet.'},503);
 try{
  const actor=await requireActor(),p=new URL(request.url).searchParams,op=p.get('op');
  if(op==='answer.stream'){const first=await answerProgress(actor.id,p.get('chat'));let initial=true;return answerEventStream(async()=>{if(initial){initial=false;return first;}return answerProgress(actor.id,p.get('chat'));},request.signal);}
  if(op==='answer.progress')return betaJson(await answerProgress(actor.id,p.get('chat'),p.has('request')?p.get('request'):undefined));
  if(op==='answer.trace'&&process.env.NEYVU_ANSWER_TRACE!=='1')throw new BetaHttpError('Not found',404);
  if(op==='answer.trace')return betaJson({trace:await tenant(actor.id,c=>readAnswerTrace(c,actor.id,p.get('job')||''))});
  if(op==='chat.search')return betaJson(await betaChatSearch(actor.id,p.get('q')||''));
  if(op==='search')return betaJson(await betaSearch(actor.id,p.get('q')||'',p.get('course')||undefined));
  if(op==='sources.coursework')return betaJson(await betaCourseworkCatalogue(actor.id,p.get('course')||undefined));
  if(op==='sources.library')return betaJson(await betaSourceLibrary(actor.id,{course:p.get('course'),kind:p.get('kind'),q:p.get('q'),cursor:p.get('cursor'),limit:p.get('limit')??undefined}));
  if(op==='source')return betaJson(await betaSource(actor.id,p.get('id')||'',p.get('version')||undefined));
  if(op==='feedback.context')return betaJson(await betaFeedbackContext(actor.id,p.get('message')||''));
  if(op==='note')return betaJson(await betaNote(actor.id,p.get('id')||''));
  if(op==='chat')return betaJson(await betaChat(actor.id,p.get('id')||'',p.get('before')||undefined));
  if(op==='availability')return betaJson({availability:await readStudyAvailability(actor.id)});
  if(op==='memory')return betaJson({memories:await listStudentMemory(actor.id,p.get('chat')||null,p.get('course')||null)});
  if(op==='learner.profile')return betaJson(await getLearnerProfile(actor.id));
  if(op==='timetable.suggestions')return betaJson(await betaTimetableSuggestions(actor.id));
  if(op==='course.context')return betaJson(await betaCourseContext(actor.id,p.get('course')));
  if(op==='understanding')return betaJson(await betaUnderstanding(actor.id));
  if(op==='profile')return betaJson(await getSourceProfile(actor.id,p.get('id'),p.get('version')));
  if(op)return betaJson({error:'Unknown action'},400);
  const assistant=await assistantStatus();
  return betaJson({actor,...await betaSnapshot(actor.id,p.has('limit')?Number(p.get('limit')):100),assistant_ready:assistant==='ready',assistant});
 }catch(error){return betaError(error);}
}
async function handlePOST(request:Request){
 try{
  betaWriteAllowed(request);const actor=await requireActor(),body=await betaRequestJson(request);
  // No caller supplied account identifiers are accepted. The session is the authority.
  if('user_id' in body||'account' in body)throw new BetaHttpError('Invalid account selection',403);
  switch(body.op){
   case 'meeting.set_active':return betaJson(await setMeetingActive(actor.id,body.meeting_id,body.active));
   case 'meeting.create':return betaJson(await createMeeting(actor.id,body.source_id,body.schedule),201);
   case 'course.create':return betaJson(await createBetaCourse(actor.id,body.code,body.title),201);
   case 'note.create':return betaJson(await createBetaNote(actor.id,body.course_id,body.title,body.body||''),201);
   case 'note.update':return betaJson(await updateBetaNote(actor.id,body.id,body.version,body.title,body.body));
   case 'chat.create':return betaJson(await createBetaChat(actor.id,body.request_id,body.initial),201);
   case 'chat.update':return betaJson(await updateBetaChat(actor.id,body.id,body.changes||{}));
   case 'chat.send':if(body.response_language!==undefined&&!supportedLanguage(body.response_language))throw new BetaHttpError('Unsupported language',400);return betaJson(await searchInBetaChat(actor.id,body.id,body.request_id,body.question,body.response_language,{expected_context:body.expected_context,expected_draft:body.expected_draft,recovery_only:body.recovery_only}));
   case 'availability.save':return betaJson(await saveStudyAvailability(actor.id,body));
   case 'group.clarify':return betaJson(await saveGroupClarification(actor.id,body));
   case 'memory.save':return betaJson(await saveStudentMemory(actor.id,body),body.id?200:201);
   case 'learner.profile.save':return betaJson(await saveLearnerProfileFact(actor.id,body));
   case 'learner.profile.forget':return betaJson(await forgetLearnerProfileFact(actor.id,body.id,body.revision));
   case 'memory.forget':return betaJson(await forgetStudentMemory(actor.id,body.id,body.revision));
   case 'profile.read':return betaJson(await queueSourceProfile(actor.id,body.id,body.version_id));
   case 'planning.scope.save':return betaJson(await savePlanningScope(actor.id,body));
   case 'progress.save':return betaJson(await saveStudentProgress(actor.id,body));
   case 'plan.save':return betaJson(await saveStudentPlan(actor.id,body),body.id?200:201);
   case 'signout':{
    const jar=await cookies();await revokeSession(jar.get(betaCookie)?.value);jar.delete(betaCookie);return betaJson({signedOut:true});
   }
   default:throw new BetaHttpError('Unknown action');
  }
 }catch(error){return betaError(error);}
}

export const GET=betaRoute(handleGET);
export const POST=betaRoute(handlePOST);

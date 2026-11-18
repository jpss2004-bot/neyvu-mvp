import {answerActivity} from './answer-activity';
import {tenant,uuid} from './db';
import {BetaHttpError} from './http';
import {betaChat} from './vault';
import {assistantStatus} from './worker';

// Pending answers need one job, not another copy of the entire source library,
// course coverage, planner and message history. Terminal messages are read only
// after the job transaction has committed and its connection is released.
export async function answerProgress(user:string,chatId:unknown,requestId?:unknown){
 if(!uuid(chatId))throw new BetaHttpError('Choose a saved conversation.');
 if(requestId!==undefined&&!uuid(requestId))throw new BetaHttpError('Choose a valid saved request.');
 let receipt:null|{id:string;question:string;scope:unknown;context_refused:boolean;message:string|null}=null;
 const job=await tenant(user,async c=>{
  if(!(await c.query('SELECT id FROM schoolvault.chats WHERE user_id=$1 AND id=$2',[user,chatId])).rowCount)throw new BetaHttpError('Conversation not found.',404);
  const row=(await c.query("SELECT request_id,input->'request_scope' AS request_scope,(input->>'admission'='context_refused') AS context_refused,result->>'message' AS admission_message,input->'source_readings' AS reading_plan,(SELECT jsonb_agg(jsonb_build_object('id',s->>'id','version_id',s->>'version_id','title',s->>'title','course',s->'course'->>'code')) FROM jsonb_array_elements(coalesce(input->'sources','[]'::jsonb)) s) AS activity_sources,id,chat_id,kind,status,error,updated_at,(input->>'model_recovery'='pending') AS recovering,input->>'question' AS question,CASE WHEN status IN('leased','failed') THEN result->>'draft' END AS draft,result->>'study_note_id' AS study_note_id,result->>'study_note_skipped' AS study_note_skipped FROM schoolvault.jobs WHERE user_id=$1 AND chat_id=$2 AND kind='answer' AND ($3::uuid IS NULL OR request_id=$3::uuid) ORDER BY created_at DESC,id DESC LIMIT 1",[user,chatId,requestId??null])).rows[0]||null;
  if(!row)return null;
  if(requestId!==undefined)receipt={id:row.request_id,question:row.question,scope:row.request_scope,context_refused:row.context_refused===true,message:row.admission_message};
  const activity=answerActivity(row);for(const key of ['request_id','request_scope','context_refused','admission_message','reading_plan','activity_sources'])delete row[key];return {...row,activity};
 });
 const terminal=!job||!['queued','leased'].includes(job.status);
 const [assistant,view]=await Promise.all([assistantStatus(),(requestId!==undefined?!!job:terminal)?betaChat(user,chatId):Promise.resolve(null)]);
 return {job,assistant,messages:view?.messages??null,has_more:view?.has_more??null,...(requestId!==undefined?{receipt,chat:view?.chat??null}:{})};
}

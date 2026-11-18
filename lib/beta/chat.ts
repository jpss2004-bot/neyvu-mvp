import {readChatScope,chatScope,sameChatScope,pinnedScope,type ChatScope} from './chat-scope';
import {supportedLanguage,type Language} from './language';
import {translator} from './i18n';
import {randomUUID} from 'node:crypto';
import {tenant} from './db';
import {searchBetaSources,id,text,BetaConflict} from './vault';
import {assistantStatus} from './worker';
import {lockVault,checkHistory,questionLimits} from './budget';
import {savedLabAnswer,savedSyllabusAnswer} from './saved-syllabus-answer';
export const offlineMessage='The assistant is offline right now. Your question is queued and will be answered when it’s back. Your notes, files and last Moodle refresh are still available.';
// Feedback stays in the UI catalogue's canonical language; the existing client
// renders it in the current interface language, independently of answer language.
const capacityMessages={
 answer_total:"You have reached your total question limit. Waiting will not reset it. Your question is saved as a draft; ask the person who invited you for help.",
 answer_daily:'You have reached the 24-hour question limit. Your question is saved as a draft. Try again once enough earlier questions are 24 hours old.',
 search_total:"You have reached your total source-search limit. Waiting will not reset it. Your query is saved as a draft; ask the person who invited you for help.",
 search_daily:'You have reached the 24-hour source-search limit. Your query is saved as a draft. Try again once enough earlier searches are 24 hours old.',
} as const;
async function capacityResult(c:import('pg').PoolClient,user:string,mode:'answer'|'search',counts:{total:string|number;daily:string|number}){
 const limits=await questionLimits(c,user);
 const period=Number(counts.total)>=limits.total?'total':Number(counts.daily)>=limits.daily?'daily':null;
 if(!period)return null;
 // Commit the bounded draft only if it still fits the existing history budget.
 // A known refusal is not an ambiguous transport error or a queued question.
 await checkHistory(c,user);
 return {available:false,queued:false,draft_saved:true,limit:{kind:mode,period:period==='total'?'lifetime':'rolling_24h'},message:capacityMessages[`${mode}_${period}`]};
}
export async function searchInBetaChat(user:string,chatId:string,requestId:string,question:string,language:Language='en',options:{expected_context?:unknown;expected_draft?:unknown;recovery_only?:unknown}={}){
 if(!supportedLanguage(language))throw Error('Unsupported language');const t=translator(language);
 const expected=options.expected_context===undefined?undefined:readChatScope(options.expected_context);if(options.expected_context!==undefined&&!expected||options.recovery_only!==undefined&&typeof options.recovery_only!=='boolean')throw Error('Invalid question source comparison');if(options.expected_draft!==undefined)text(options.expected_draft,3000);
 id(chatId);id(requestId);const draft=text(question,3000);question=draft.trim();if(!question)throw Error('Enter a question');
 return tenant(user,async c=>{
  await lockVault(c,user);
  const chat=(await c.query('SELECT * FROM schoolvault.chats WHERE user_id=$1 AND id=$2 FOR UPDATE',[user,chatId])).rows[0];
  if(!chat)throw Error('Chat not found');
  const old=(await c.query('SELECT id,chat_id,result,input FROM schoolvault.jobs WHERE user_id=$1 AND request_id=$2',[user,requestId])).rows[0];
  if(old){if(old.chat_id!==chatId||old.input.question!==question)throw new BetaConflict('This request was already used. Please try again.');if(old.input.admission!=='context_refused'&&expected&&old.input.request_scope&&!sameChatScope(chatScope(old.input.request_scope),expected))throw new BetaConflict('This request was already used with another source selection.');return old.result||{available:true,queued:true,job_id:old.id};}
  const scope=chatScope(chat),sourceChanged=expected&&(!sameChatScope(scope,expected)||!pinnedScope(expected)),draftChanged=options.expected_draft!==undefined&&chat.draft!==options.expected_draft&&chat.draft!==draft;
  if(options.recovery_only||sourceChanged||draftChanged){
   const result={available:false,queued:false,draft_saved:false,context_refused:true,message:options.recovery_only?'This older request has no recorded source selection and was not sent. Recover the text and review its sources before sending.':'Your question was not sent because its saved draft or selected source versions changed. Review both versions before trying again.'};
   // Reserve the refusal under this request ID: a delayed duplicate cannot be
   // admitted later after someone restores the source selection. No quota for an answer is consumed.
   await checkHistory(c,user,10000);
   await c.query("INSERT INTO schoolvault.jobs(user_id,id,chat_id,kind,request_id,input,result,status) VALUES($1,$2,$3,'answer',$4,$5,$6,'cancelled')",[user,randomUUID(),chatId,requestId,JSON.stringify({question,mode:chat.mode,admission:'context_refused',request_scope:expected||null,response_language:language}),JSON.stringify(result)]);
   await checkHistory(c,user);return result;
  }
  await c.query('UPDATE schoolvault.chats SET draft=$3,updated_at=now() WHERE user_id=$1 AND id=$2',[user,chatId,draft]);
  if(chat.mode!=='sources'){
   const assistant=await assistantStatus(c);
   if(assistant==='disabled')return {available:false,message:'The assistant is temporarily unavailable. Your question is saved as a draft. You can use Find sources now.'};
   // An offline worker still accepts questions: they queue in this vault until it returns.
   if((await c.query("SELECT id FROM schoolvault.jobs WHERE user_id=$1 AND chat_id=$2 AND status IN ('queued','leased')",[user,chatId])).rowCount)throw new BetaConflict('The assistant is answering your previous question.');
   const count=(await c.query("SELECT count(*) AS total,count(*) FILTER(WHERE created_at>now()-interval '24 hours') AS daily FROM schoolvault.jobs WHERE user_id=$1 AND kind='answer' AND coalesce(input->>'mode','ask')!='sources' AND input->>'admission' IS DISTINCT FROM 'context_refused'",[user])).rows[0];
   const limited=await capacityResult(c,user,'answer',count);if(limited)return limited;
   await checkHistory(c,user,100000); // admission headroom; completion checks actual pinned sources and answer bytes
   const job=randomUUID(),input={question,mode:chat.mode,course_id:chat.course_id,context:chat.context,context_versions:chat.context_versions,request_scope:scope,response_language:language};
   const lab=chat.archived?null:await savedLabAnswer(c,user,scope,question,language);
   const quick=chat.archived?null:lab??await savedSyllabusAnswer(c,user,scope,question,language);
   const content=quick?{type:'answer',text:quick.text,job_id:job,...(lab?.moodle_membership?{moodle_membership:lab.moodle_membership}:{})}:null;
   const result=quick&&content?{available:true,queued:false,job_id:job,content,sources:quick.sources,model:lab?'saved-moodle-lab-schedule':'saved-moodle-lecture-schedule',input_tokens:0,output_tokens:0,estimated_cost_usd:0,completed_at:new Date().toISOString()}:null;
   await c.query("INSERT INTO schoolvault.jobs(user_id,id,chat_id,kind,request_id,input,result,status) VALUES($1,$2,$3,'answer',$4,$5,$6,$7)",[user,job,chatId,requestId,JSON.stringify(quick?{...input,sources:quick.sources}:input),result?JSON.stringify(result):null,result?'complete':'queued']);
   await c.query("INSERT INTO schoolvault.messages(user_id,id,chat_id,role,content) VALUES($1,$2,$3,'user',$4)",[user,randomUUID(),chatId,JSON.stringify({text:question,context_course_id:chat.course_id})]);
   if(result)await c.query("INSERT INTO schoolvault.messages(user_id,id,chat_id,role,content,sources,created_at) VALUES($1,$2,$3,'assistant',$4,$5,now()+interval '1 millisecond')",[user,randomUUID(),chatId,JSON.stringify({...result.content,context_course_id:chat.course_id}),JSON.stringify(result.sources)]);
   await c.query("UPDATE schoolvault.chats SET draft='',title=CASE WHEN title='New chat' THEN $3 ELSE title END,updated_at=now() WHERE user_id=$1 AND id=$2",[user,chatId,question.slice(0,80)]);
   await checkHistory(c,user);
   if(result)return result;
   return assistant==='offline'?{available:true,queued:true,job_id:job,offline:true,message:offlineMessage}:{available:true,queued:true,job_id:job};
  }
  // Search uses the same scoped transaction as the saved conversation.
  const searches=(await c.query("SELECT count(*) AS total,count(*) FILTER(WHERE created_at>now()-interval '24 hours') AS daily FROM schoolvault.jobs WHERE user_id=$1 AND input->>'mode'='sources' AND input->>'admission' IS DISTINCT FROM 'context_refused'",[user])).rows[0];
  const limited=await capacityResult(c,user,'search',searches);if(limited)return limited;
  const hits=await searchBetaSources(c,user,question,chat.course_id||undefined);
  const sources=[...new Map(hits.map(s=>[s.id,s])).values()];
  const content={type:'source_search',text:sources.length?t(sources.length===1?'Found {count} matching source in your vault.':'Found {count} matching sources in your vault.',{count:sources.length}):t('No matching sources yet. Add class notes or a text file, then search again.')};
  const result={available:true,content,sources};
  await c.query('INSERT INTO schoolvault.messages(user_id,id,chat_id,role,content) VALUES($1,$2,$3,\'user\',$4)',[user,randomUUID(),chatId,JSON.stringify({text:question,context_course_id:chat.course_id})]);
  await c.query('INSERT INTO schoolvault.messages(user_id,id,chat_id,role,content,sources,created_at) VALUES($1,$2,$3,\'assistant\',$4,$5,now()+interval \'1 millisecond\')',[user,randomUUID(),chatId,JSON.stringify({...content,context_course_id:chat.course_id}),JSON.stringify(sources)]);
  await c.query("INSERT INTO schoolvault.jobs(user_id,id,chat_id,kind,request_id,input,result,status) VALUES($1,$2,$3,'answer',$4,$5,$6,'complete')",[user,randomUUID(),chatId,requestId,JSON.stringify({question,mode:'sources',request_scope:scope,response_language:language}),JSON.stringify(result)]);
  await c.query("UPDATE schoolvault.chats SET draft='',title=CASE WHEN title='New chat' THEN $3 ELSE title END,updated_at=now() WHERE user_id=$1 AND id=$2",[user,chatId,question.slice(0,80)]);
  await checkHistory(c,user);
  return result;
 });
}

import {randomUUID,createHash} from 'node:crypto';
import {db,ACCOUNT,setting,audit} from './store';
import {decodeReply} from './replies';
import type {Message} from './types';
export const intents=['ask','plan','study','solve','sources'] as const;
export type Intent=typeof intents[number];
export type ContextRef={kind:'task'|'source'|'note';id:string};
export type ChatThread={id:string;title:string;course:string;intent:Intent;context:ContextRef[];draft:string;archived:boolean;created_at:string;updated_at:string;message_count:number};
export type ChatTurn={id:string;request_id:string;question:string;course:string;intent:Intent;context:ContextRef[];status:string;error:string;created_at:string;updated_at:string};
function view(row:any):ChatThread{return {...row,context:JSON.parse(row.context||'[]'),archived:!!row.archived};}
export function thread(id:string,account=ACCOUNT){const r=db().prepare('SELECT t.*,(SELECT COUNT(*) FROM messages m WHERE m.thread_id=t.id AND m.account=t.account) AS message_count FROM chat_threads t WHERE t.id=? AND t.account=?').get(id,account);return r?view(r):undefined;}
export function threads(account=ACCOUNT){return db().prepare("SELECT t.*,(SELECT COUNT(*) FROM messages m WHERE m.thread_id=t.id AND m.account=t.account) AS message_count FROM chat_threads t WHERE t.account=? AND (t.draft!='' OR EXISTS(SELECT 1 FROM messages m WHERE m.thread_id=t.id AND m.account=t.account)) ORDER BY t.updated_at DESC,t.id").all(account).map(view);}
export function createThread(course='',intent:Intent='ask',context:ContextRef[]=[],account=ACCOUNT){const id=randomUUID(),now=new Date().toISOString();db().prepare('INSERT INTO chat_threads(id,account,title,course,intent,context,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id,account,'New chat',course,intent,JSON.stringify(context),now,now);setting('last-chat',id,account);return thread(id,account)!;}
export function updateThread(id:string,changes:Partial<Pick<ChatThread,'title'|'course'|'intent'|'context'|'draft'|'archived'>>,account=ACCOUNT){
 const old=thread(id,account);if(!old)throw Error('Chat not found');
 if(old.archived&&!('archived' in changes))throw Error('Restore this chat before continuing.');
 if(changes.archived&&db().prepare("SELECT id FROM chat_turns WHERE thread_id=? AND account=? AND status='running'").get(id,account))throw Error('Wait for this answer to finish before archiving.');
 const fields=Object.entries(changes).map(([k,v])=>[k,k==='context'?JSON.stringify(v):k==='archived'?Number(v):v]);
 if(fields.length)db().prepare(`UPDATE chat_threads SET ${fields.map(([k])=>k+'=?').join(',')},updated_at=? WHERE id=? AND account=?`).run(...fields.map(([,v])=>v as string|number),new Date().toISOString(),id,account);
 return thread(id,account)!;
}
function messageView(m:any):Message{return {id:String(m.id),role:m.role,...(m.role==='assistant'?decodeReply(m.content):{content:m.content}),mode:m.mode||'',sources:JSON.parse(m.sources||'[]'),created_at:m.created_at,thread_id:m.thread_id};}
export function chatPage(id:string,account=ACCOUNT,before?:string){
 const t=thread(id,account);if(!t)throw Error('Chat not found');
 const marker=before?db().prepare('SELECT rowid FROM messages WHERE id=? AND thread_id=? AND account=?').get(before,id,account):undefined;
 if(before&&!marker)throw Error('Message not found');
 const rows=db().prepare(`SELECT * FROM messages WHERE account=? AND thread_id=? ${marker?'AND rowid<?':''} ORDER BY rowid DESC LIMIT 41`).all(account,id,...(marker?[marker.rowid]:[]));
 const has_more=rows.length>40,messages=rows.slice(0,40).reverse().map(messageView);
 const turns=db().prepare("SELECT id,request_id,question,course,intent,context,status,error,created_at,updated_at FROM chat_turns WHERE account=? AND thread_id=? AND status NOT IN ('completed','dismissed') ORDER BY created_at DESC LIMIT 10").all(account,id).map((r:any)=>({...r,context:JSON.parse(r.context)})) as ChatTurn[];
 return {thread:t,messages,turns,has_more};
}
export function lastChat(account=ACCOUNT){const id=setting('last-chat',undefined,account);if(!id)return null;const t=thread(id,account);return t&&!t.archived?chatPage(id,account):null;}
export function beginTurn(id:string,requestId:string,question:string,course:string,intent:Intent,context:ContextRef[],account=ACCOUNT){
 const t=thread(id,account);if(!t||t.archived)throw Error('Open an active chat before sending.');
 const key='chat-'+createHash('sha256').update(account+'\0'+id+'\0'+requestId).digest('hex'),json=JSON.stringify(context),store=db(),now=new Date().toISOString();
 store.exec('BEGIN IMMEDIATE');
 try{
 const old=store.prepare('SELECT * FROM chat_turns WHERE id=? AND account=?').get(key,account);
 if(old&&(old.question!==question||old.course!==course||old.intent!==intent||old.context!==json))throw Error('Retry context changed. Send this as a new question.');
 if(old?.status!=='completed'&&store.prepare("SELECT id FROM chat_turns WHERE thread_id=? AND account=? AND status='running' AND id!=?").get(id,account,key))throw Error('This chat already has an answer in progress. Wait for it to finish or open a new chat.');
 if(old?.status==='running')throw Error('This question is still running. Wait for it to finish before retrying.');
 if(!old){
  store.prepare('INSERT INTO chat_turns(id,account,thread_id,request_id,question,course,intent,context,status,worker_pid,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(key,account,id,requestId,question,course,intent,json,'running',process.pid,now,now);
  store.prepare('INSERT INTO messages(id,account,thread_id,role,content,sources,created_at) VALUES(?,?,?,?,?,?,?)').run(key+':user',account,id,'user',question,'[]',now);
  store.prepare('UPDATE chat_threads SET title=?,course=?,intent=?,context=?,draft=?,updated_at=? WHERE id=? AND account=?').run(t.message_count===0&&t.title==='New chat'?question.slice(0,80):t.title,course,intent,json,t.draft===question?'':t.draft,now,id,account);
 }else if(old.status!=='completed')store.prepare("UPDATE chat_turns SET status='running',error='',worker_pid=?,updated_at=? WHERE id=? AND account=?").run(process.pid,now,key,account);
 store.exec('COMMIT');return key;
 }catch(e){store.exec('ROLLBACK');throw e;}
}
export function failTurn(key:string,error:string,cancelled=false,account=ACCOUNT){db().prepare("UPDATE chat_turns SET status=?,error=?,updated_at=? WHERE id=? AND account=? AND status NOT IN ('completed','dismissed')").run(cancelled?'stopped':'failed',error,new Date().toISOString(),key,account);}
export function selectThread(id:string,account=ACCOUNT){const result=chatPage(id,account);setting('last-chat',id,account);return result;}
export function archiveThread(id:string,archived:boolean,account=ACCOUNT){const result=updateThread(id,{archived},account);if(archived&&setting('last-chat',undefined,account)===id)setting('last-chat','',account);audit(archived?'chat-archived':'chat-restored',id,account);return result;}

export function dismissTurn(id:string,requestId:string,account=ACCOUNT){if(!thread(id,account))throw Error('Chat not found');db().prepare("UPDATE chat_turns SET status='dismissed',updated_at=? WHERE thread_id=? AND request_id=? AND account=? AND status IN ('failed','stopped','interrupted')").run(new Date().toISOString(),id,requestId,account);audit('chat-retry-dismissed',id,account);return chatPage(id,account);}

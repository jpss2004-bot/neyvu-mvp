import {readChatScope,chatScope,sameChatScope,scopeKey,pinnedScope,type ChatScope} from './chat-scope';
// Browser recovery stores only the account's unsent text/request IDs. It never
// turns a browser draft into a sent message or chooses between divergent drafts.
export type RecoveryStorage=Pick<Storage,'getItem'|'setItem'|'removeItem'|'key'|'length'>;
export type BrowserDraft=ChatScope&{schema:2;chat:string|null;writer:string;revision:string;text:string;base:string;base_scope:ChatScope|null;creation_id?:string;creation_initial?:{mode:string;course_id:string|null;draft:string}};
export type PendingQuestion={id:string;question:string;chat:string;language?:'en'|'es';scope?:ChatScope;base?:string};
// Text alone cannot acknowledge a send: an older identical question can exist.
export function matchesPendingReceipt(request:PendingQuestion,reply:{receipt?:{id:string;question:string;scope?:unknown}|null;chat?:{id:string}|null;job?:{chat_id:string|null}|null}){
 const receipt=reply.receipt;
 if(!receipt||receipt.id!==request.id||receipt.question!==request.question.trim()||reply.chat?.id!==request.chat||reply.job?.chat_id!==request.chat)return false;
 if(!request.scope)return true;
 const scope=readChatScope(receipt.scope);return !!scope&&sameChatScope(request.scope,scope);
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validText=(v:unknown):v is string=>typeof v==='string'&&v.length<=3000;
const prefix=(actor:string,kind:string)=>'neyvu-chat-'+kind+'-v1:'+encodeURIComponent(actor)+':';
const draftPrefix=(actor:string,chat:string|null)=>prefix(actor,'draft')+(chat||'new')+':';
function keys(storage:RecoveryStorage|null,prefix:string){try{return storage?Array.from({length:storage.length},(_,i)=>storage.key(i)).filter((key):key is string=>!!key&&key.startsWith(prefix)):[];}catch{return [];}}
function parse(raw:string|null){try{return raw&&raw.length<=24000?JSON.parse(raw):null;}catch{return null;}}
function readDraft(raw:string|null):BrowserDraft|null{
 const r=parse(raw);if(!r||![1,2].includes(r.schema)||!(r.chat===null||typeof r.chat==='string'&&uuid.test(r.chat))||!uuid.test(r.writer)||!uuid.test(r.revision)||!validText(r.text)||!validText(r.base))return null;
 const scope=readChatScope(r.schema===1?{mode:r.mode,course_id:r.course_id,context:[],context_versions:{}}:r);
 const base=r.schema===1||r.base_scope===null?null:readChatScope(r.base_scope);
 if(!scope||r.schema===2&&r.base_scope!==null&&!base)return null;
 if(r.creation_id!==undefined&&(!uuid.test(r.creation_id)||!validText(r.creation_initial?.draft)||!readChatScope({...r.creation_initial,context:[],context_versions:{}}))||r.creation_initial!==undefined&&r.creation_id===undefined)return null;
 return {...scope,schema:2,chat:r.chat,writer:r.writer,revision:r.revision,text:r.text,base:r.base,base_scope:base,...(r.creation_id?{creation_id:r.creation_id,creation_initial:{mode:r.creation_initial.mode,course_id:r.creation_initial.course_id,draft:r.creation_initial.draft}}:{})};
}
export function browserDraftForWriter(storage:RecoveryStorage|null,actor:string,chat:string|null,writer:string){
 try{const r=readDraft(storage?.getItem(draftPrefix(actor,chat)+writer)||null);return r&&r.chat===chat&&r.writer===writer?r:null;}catch{return null;}
}
export function browserDrafts(storage:RecoveryStorage|null,actor:string,chat:string|null):BrowserDraft[]{
 const start=draftPrefix(actor,chat);return keys(storage,start).flatMap(key=>{try{const r=readDraft(storage!.getItem(key));return r&&r.chat===chat&&key===start+r.writer?[r]:[];}catch{return [];}});
}
export function rememberBrowserDraft(storage:RecoveryStorage|null,actor:string,draft:BrowserDraft){
 try{const raw=JSON.stringify(draft);if(!storage||!readDraft(raw))return false;const key=draftPrefix(actor,draft.chat)+draft.writer;storage.setItem(key,raw);return storage.getItem(key)===raw;}catch{return false;}
}
export function forgetBrowserDraft(storage:RecoveryStorage|null,actor:string,draft:BrowserDraft){
 try{if(!storage)return false;const key=draftPrefix(actor,draft.chat)+draft.writer,current=readDraft(storage.getItem(key));if(current?.revision!==draft.revision)return false;storage.removeItem(key);return true;}catch{return false;}
}
export function recoverBrowserDrafts(records:BrowserDraft[],saved:string,pending:string[]=[],savedScope?:ChatScope){
 const same=(r:BrowserDraft)=>!!savedScope&&sameChatScope(r,savedScope);
 const different=records.filter(r=>!(r.text===saved&&r.base_scope!==null&&same(r))&&!pending.includes(r.text)),intents=new Set(different.map(r=>JSON.stringify([r.text,scopeKey(r)])));
 const restore=different.find(r=>r.base===saved&&r.base_scope!==null&&pinnedScope(r)&&(!savedScope||sameChatScope(r.base_scope,savedScope)&&same(r)));
 return intents.size===1&&restore?{restore,choices:[] as BrowserDraft[]}:{restore:null,choices:different};
}
export function acknowledgeBrowserDraft(storage:RecoveryStorage|null,actor:string,chat:string,writer:string,base:string,saved:string,scope?:ChatScope){
 for(const draft of browserDrafts(storage,actor,chat)){
  if(draft.text===saved&&scope&&sameChatScope(draft,scope))forgetBrowserDraft(storage,actor,draft);
  else if(draft.writer===writer&&draft.base===base&&scope&&draft.base_scope&&sameChatScope(draft.base_scope,scope))rememberBrowserDraft(storage,actor,{...draft,base:saved,base_scope:scope,revision:crypto.randomUUID()});
 }
}
export function bindNewBrowserDraft(storage:RecoveryStorage|null,actor:string,writer:string,chat:string,base:string,text:string,scope?:ChatScope){
 const records=browserDrafts(storage,actor,null),own=records.find(r=>r.writer===writer&&r.text===text);
 if(!own)return false;
 if(!rememberBrowserDraft(storage,actor,{...own,creation_id:undefined,creation_initial:undefined,chat,base,base_scope:scope||own.base_scope,revision:crypto.randomUUID()}))return false;
 forgetBrowserDraft(storage,actor,own);
 return true;
}
function pending(raw:string|null):PendingQuestion|null{
 const r=parse(raw);if(!r||!uuid.test(r.id)||!uuid.test(r.chat)||!validText(r.question)||!r.question.trim()||!(r.language===undefined||r.language==='en'||r.language==='es'))return null;
 const scope=r.scope===undefined?undefined:readChatScope(r.scope);if(r.scope!==undefined&&(!scope||!validText(r.base)))return null;
 return {id:r.id,chat:r.chat,question:r.question,...(r.language?{language:r.language}:{}),...(scope?{scope,base:r.base}:{})};
}
export function pendingSettled(stores:(RecoveryStorage|null)[],actor:string,id:string){
 return stores.some(storage=>{try{return storage?.getItem(prefix(actor,'settled')+id)==='1';}catch{return false;}});
}
export function pendingQuestions(stores:(RecoveryStorage|null)[],actor:string){
 const result=new Map<string,PendingQuestion>(),start=prefix(actor,'send');
 for(const storage of stores){for(const key of keys(storage,start)){try{const r=pending(storage!.getItem(key));if(r&&key===start+r.id){if(pendingSettled(stores,actor,r.id))storage!.removeItem(key);else result.set(r.id,r);}}catch{}}
  try{const old=pending(storage?.getItem('schoolvault-send-v1:'+actor)||null);if(old&&!result.has(old.id)&&!pendingSettled(stores,actor,old.id))result.set(old.id,old);}catch{}
 }
 return [...result.values()];
}
export function rememberPendingQuestion(stores:(RecoveryStorage|null)[],actor:string,request:PendingQuestion){
 let saved=false;if(!pending(JSON.stringify(request))||pendingSettled(stores,actor,request.id))return false;
 for(const storage of stores)try{if(storage){storage.setItem(prefix(actor,'send')+request.id,JSON.stringify(request));saved ||= storage.getItem(prefix(actor,'send')+request.id)===JSON.stringify(request);}}catch{}
 return saved;
}
export function forgetPendingQuestion(stores:(RecoveryStorage|null)[],actor:string,request:PendingQuestion){
 // An opaque settlement marker invalidates other tabs' session copies too.
 for(const storage of stores)try{storage?.setItem(prefix(actor,'settled')+request.id,'1');}catch{}
 for(const storage of stores)try{if(storage){storage.removeItem(prefix(actor,'send')+request.id);const key='schoolvault-send-v1:'+actor;if(pending(storage.getItem(key))?.id===request.id)storage.removeItem(key);}}catch{}
}

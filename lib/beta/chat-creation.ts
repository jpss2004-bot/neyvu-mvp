import {pinnedScope,readChatScope,type ChatScope} from './chat-scope';
import type {RecoveryStorage} from './chat-recovery';
export type ChatInitial={mode:string;course_id:string|null;draft:string;context?:string[];context_versions?:Record<string,string>};
export type ChatCreation={schema:1;id:string;writer:string;kind:'first'|'new';initial:ChatInitial};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const prefix=(actor:string,kind='create')=>'neyvu-chat-'+kind+'-v1:'+encodeURIComponent(actor)+':';
function read(raw:string|null):ChatCreation|null{
 try{
  const r=raw&&raw.length<12000?JSON.parse(raw):null;
  if(!r||r.schema!==1||!uuid.test(r.id)||!uuid.test(r.writer)||!['first','new'].includes(r.kind)||!r.initial||typeof r.initial.draft!=='string'||r.initial.draft.length>3000)return null;
  const scope=readChatScope({context:[],context_versions:{},...r.initial});
  if(!scope||!pinnedScope(scope))return null;
  const initial={mode:scope.mode,course_id:scope.course_id,draft:r.initial.draft,...(scope.context.length?{context:scope.context,context_versions:scope.context_versions}:{})};
  return {schema:1,id:r.id,writer:r.writer,kind:r.kind,initial};
 }catch{return null;}
}
export function chatCreationSettled(stores:(RecoveryStorage|null)[],actor:string,id:string){return stores.some(s=>{try{return s?.getItem(prefix(actor,'created')+id)==='1';}catch{return false;}});}
export function chatCreations(stores:(RecoveryStorage|null)[],actor:string){
 const found=new Map<string,ChatCreation>(),start=prefix(actor);
 for(const s of stores)try{if(s)for(const key of Array.from({length:s.length},(_,i)=>s.key(i))){if(!key?.startsWith(start))continue;const r=read(s.getItem(key));if(r&&key===start+r.id){if(chatCreationSettled(stores,actor,r.id))s.removeItem(key);else if(!found.has(r.id))found.set(r.id,r);}}}catch{}
 return [...found.values()];
}
export function rememberChatCreation(stores:(RecoveryStorage|null)[],actor:string,record:ChatCreation){
 const raw=JSON.stringify(record);if(!read(raw)||chatCreationSettled(stores,actor,record.id))return false;let kept=false;
 for(const s of stores)try{if(s){const key=prefix(actor)+record.id;s.setItem(key,raw);kept ||= s.getItem(key)===raw;}}catch{}return kept;
}
export function forgetChatCreation(stores:(RecoveryStorage|null)[],actor:string,record:ChatCreation){
 for(const s of stores)try{s?.setItem(prefix(actor,'created')+record.id,'1');}catch{}
 for(const s of stores)try{s?.removeItem(prefix(actor)+record.id);}catch{}
}
export function creationScope(record:ChatCreation):ChatScope{return {mode:record.initial.mode,course_id:record.initial.course_id,context:record.initial.context??[],context_versions:record.initial.context_versions??{}};}

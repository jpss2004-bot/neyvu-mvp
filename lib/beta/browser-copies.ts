import type {RecoveryStorage} from './chat-recovery';
export type CopyCategory='drafts'|'pendingAnswers'|'pendingChats'|'study'|'memoryDrafts'|'markers';
export type BrowserCopyControl={schema:1;epoch:string;mode:'active'|'blocked';cleared:true;state:'removing'|'complete';removed:number};
export type BrowserCopyPlan={actor:string;fingerprint:string;entries:{area:'local'|'session'|'memory';key:string;sha256:string;category:CopyCategory}[];counts:Record<CopyCategory,number>};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const browserCopyLock=(actor:string)=>'neyvu-browser-copies-v1:'+encodeURIComponent(actor);
export const browserCopyControlKey=(actor:string)=>'neyvu-browser-removal-v1:'+encodeURIComponent(actor);
export const browserCopySessionKey=(actor:string)=>'neyvu-browser-epoch-v1:'+encodeURIComponent(actor);
export function browserCopyCategory(key:string,actor:string):CopyCategory|null{
 const base='neyvu-chat-',end='-v1:'+encodeURIComponent(actor)+':';
 for(const [kind,category] of [['draft','drafts'],['send','pendingAnswers'],['create','pendingChats'],['settled','markers'],['created','markers']] as const)if(key.startsWith(base+kind+end))return category;
 if(key==='schoolvault-send-v1:'+actor)return 'pendingAnswers';
 if(key==='neyvu-study-v1:'+actor)return 'study';
 if(key.startsWith('schoolvault-memory-draft-v1:'+actor+':'))return 'memoryDrafts';
 return null;
}
function required(storage:RecoveryStorage|null):RecoveryStorage{if(!storage)throw Error('Browser storage is unavailable. Nothing can be verified or removed.');return storage;}
export function browserCopyControl(storage:RecoveryStorage|null,actor:string):BrowserCopyControl|null{
 if(!uuid.test(actor))throw Error('Invalid browser account');const raw=required(storage).getItem(browserCopyControlKey(actor));if(raw===null)return null;
 let c:any;try{c=JSON.parse(raw);}catch{throw Error('Browser removal state could not be verified.');}
 if(c?.schema!==1||Object.keys(c).sort().join(',')!=='cleared,epoch,mode,removed,schema,state'||!uuid.test(c.epoch)||!['active','blocked'].includes(c.mode)||c.cleared!==true||!['removing','complete'].includes(c.state)||!Number.isSafeInteger(c.removed)||c.removed<0)throw Error('Browser removal state could not be verified.');return c;
}
function owned(storage:RecoveryStorage,actor:string){const result:{key:string;value:string;category:CopyCategory}[]=[];let size=0;const count=storage.length;if(count>100000)throw Error('Too many browser records to review safely.');
 for(let i=0;i<count;i++){const key=storage.key(i);if(!key)continue;const category=browserCopyCategory(key,actor);if(!category)continue;const value=storage.getItem(key);if(value===null)continue;size+=value.length;if(size>8000000)throw Error('These browser copies are too large for this review.');result.push({key,value,category});}return result.sort((a,b)=>a.key.localeCompare(b.key));}
async function sha(text:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),n=>n.toString(16).padStart(2,'0')).join('');}
export async function inspectBrowserCopies(local:RecoveryStorage|null,session:RecoveryStorage|null,actor:string,memory?:RecoveryStorage):Promise<BrowserCopyPlan>{
 const control=browserCopyControl(local,actor),counts={drafts:0,pendingAnswers:0,pendingChats:0,study:0,memoryDrafts:0,markers:0};const entries:BrowserCopyPlan['entries']=[];
 const stores:[BrowserCopyPlan['entries'][number]['area'],RecoveryStorage][]=[['local',required(local)],['session',required(session)]];if(memory)stores.push(['memory',memory]);
 for(const [area,store] of stores)for(const r of owned(store,actor)){entries.push({area,key:r.key,sha256:await sha(r.value),category:r.category});counts[r.category]++;}
 return {actor,entries,counts,fingerprint:await sha(JSON.stringify([control,entries]))};
}
function saveControl(local:RecoveryStorage,actor:string,control:BrowserCopyControl){const key=browserCopyControlKey(actor),raw=JSON.stringify(control);local.setItem(key,raw);if(local.getItem(key)!==raw)throw Error('The browser removal marker could not be saved.');}
// The caller must hold this account's exclusive Web Lock and freeze its own
// writers. A changed review never removes data. No IndexedDB or server calls.
export async function removeBrowserCopies(local:RecoveryStorage|null,session:RecoveryStorage|null,actor:string,plan:BrowserCopyPlan,memory?:RecoveryStorage){
 const current=await inspectBrowserCopies(local,session,actor,memory);if(plan.actor!==actor||current.fingerprint!==plan.fingerprint)return {state:'changed' as const,plan:current};
 const l=required(local),s=required(session),control:BrowserCopyControl={schema:1,epoch:crypto.randomUUID(),mode:'blocked',cleared:true,state:'removing',removed:0};saveControl(l,actor,control);
 let removed=0;for(const entry of current.entries){const store=entry.area==='local'?l:entry.area==='session'?s:required(memory||null);try{store.removeItem(entry.key);if(store.getItem(entry.key)===null)removed++;}catch{/* Verify every remaining copy below. */}}
 saveControl(l,actor,{...control,removed});const remaining=await inspectBrowserCopies(l,s,actor,memory);if(remaining.entries.length)return {state:'incomplete' as const,plan:remaining};
 saveControl(l,actor,{...control,state:'complete',removed});return {state:'complete' as const,removed};
}
// A restored/duplicated tab may retain an old sessionStorage snapshot. Purge
// its retired account copies before mounting any writer or Study memory cache.
export function alignBrowserSession(local:RecoveryStorage|null,session:RecoveryStorage|null,actor:string){
 const control=browserCopyControl(local,actor),s=required(session);if(!control)return false;
 if(control.mode==='blocked'||s.getItem(browserCopySessionKey(actor))!==control.epoch){for(const r of owned(s,actor))s.removeItem(r.key);if(owned(s,actor).length)throw Error('This tab still has browser copies that could not be removed.');s.setItem(browserCopySessionKey(actor),control.epoch);if(s.getItem(browserCopySessionKey(actor))!==control.epoch)throw Error('This tab could not record its browser recovery generation.');return true;}return false;
}
export async function resumeBrowserCopies(local:RecoveryStorage|null,session:RecoveryStorage|null,actor:string){
 const old=browserCopyControl(local,actor);if(old?.mode==='active'){alignBrowserSession(local,session,actor);return old;}
 const plan=await inspectBrowserCopies(local,session,actor);if(plan.entries.length||old?.state==='removing')throw Error('Finish removing the remaining browser copies before reopening.');
 const control:BrowserCopyControl={schema:1,epoch:crypto.randomUUID(),mode:'active',cleared:true,state:'complete',removed:old?.removed||0};saveControl(required(local),actor,control);alignBrowserSession(local,session,actor);return control;
}

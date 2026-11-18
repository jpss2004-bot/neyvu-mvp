import {createHash} from 'node:crypto';
import {identityKey} from './protocol.mjs';
import {readURL} from './capture.mjs';
import {MAX_ATTACHMENTS_PER_COURSE} from './attachment-read.mjs';

// Progress is encrypted with the existing pairing state. Stored URLs never
// authorize a read: the engine rediscovers every candidate in the current DOM.
export function collectionMemory(state,courses,revision){
 const binding=createHash('sha256').update(JSON.stringify([state.token,identityKey(state.identity),revision||null,[...courses.keys()].sort()])).digest('hex');
 const old=state.collection_memory;
 const valid=old?.version===1&&old.binding===binding&&Number.isSafeInteger(old.sequence)&&old.sequence>=0&&old.sequence<1e9;
 const memory=valid?old:{version:1,binding,sequence:0,next_course:0,activities:{},files:{}};
 const activities={};for(const [id,url] of Object.entries(memory.activities||{}))if(courses.has(id)&&readURL(url)&&new URL(url).pathname!=='/course/view.php')activities[id]=url;
 memory.activities=activities;
 memory.pages=Object.fromEntries(Object.entries(memory.pages||{}).filter(([key,n])=>/^[a-f0-9]{64}$/.test(key)&&Number.isSafeInteger(n)&&n>0&&n<=memory.sequence).sort((a,b)=>b[1]-a[1]).slice(0,4000));
 memory.files=Object.fromEntries(Object.entries(memory.files||{}).filter(([key,n])=>/^[a-f0-9]{64}$/.test(key)&&Number.isSafeInteger(n)&&n>0&&n<=memory.sequence).sort((a,b)=>b[1]-a[1]).slice(0,4000));
 if(!Number.isSafeInteger(memory.next_course)||memory.next_course<0||memory.next_course>=courses.size)memory.next_course=0;
 state.collection_memory=memory;return memory;
}
export const originalKey=(course,url)=>createHash('sha256').update(course+'\n'+url).digest('hex');
export function markNestedPage(memory,course,url){
 memory.sequence++;memory.pages[originalKey(course,url)]=memory.sequence;
 if(Object.keys(memory.pages).length>4000)memory.pages=Object.fromEntries(Object.entries(memory.pages).sort((a,b)=>b[1]-a[1]).slice(0,4000));
}
export function chooseOriginal(jobs,memory,courses,attempts,visited){
 const order=[...courses.keys()];
 for(let offset=0;offset<order.length;offset++){
  const index=(memory.next_course+offset)%order.length,id=order[index];if((attempts.get(id)||0)>=MAX_ATTACHMENTS_PER_COURSE)continue;
  const candidates=[...jobs.values()].filter(job=>job.course.id===id&&!visited.has(job.key));
  candidates.sort((a,b)=>(memory.files[a.key]||0)-(memory.files[b.key]||0)||a.ordinal-b.ordinal);
  if(candidates.length)return {job:candidates[0],next:(index+1)%order.length};
 }
 return null;
}
export function markOriginal(memory,key,next){
 memory.sequence++;memory.files[key]=memory.sequence;memory.next_course=next;
 if(Object.keys(memory.files).length>4000)memory.files=Object.fromEntries(Object.entries(memory.files).sort((a,b)=>b[1]-a[1]).slice(0,4000));
}
export function collectionIssue(reason){
 const text=String(reason).slice(0,300);
 const definitions=[
  ['file_too_large',/exceeds the 10 MiB file size limit/i,'content',false,'Open the original in Moodle, or add a smaller readable copy. Refreshing cannot change the file size.'],
  ['temporary',/HTTP 5\d\d|net::ERR_|could not finish this/i,'acquisition',true,'Retry when the connection is ready; saved material is kept.'],
  ['budget',/limit|budget|waiting (?:to be read|for (?:text )?extract)/i,'collection',true,'Continue reading; later refreshes resume with the least recently checked material.'],
  ['unsupported',/unsupported|outside Moodle|external reading/i,'collection',false,'Open the original and add a supported readable copy if you have access.'],
  ['collapsed',/collapsed|not loaded/i,'collection',true,'Expand the relevant Moodle section, then refresh.'],
  ['access',/HTTP (?:401|403)|not make.*readable/i,'acquisition',true,'Check the original in your signed-in Moodle window.'],
  ['unreadable',/readable|empty|title or links|embedded|encrypted|scanned/i,'content',false,'Compare the saved source with its original; readable text may still be missing.'],
  ['temporary',/timed out|timeout|cancelled|HTTP 5\d\d|fetch/i,'acquisition',true,'Check the connection and retry; saved material is kept.'],
 ];
 const match=definitions.find(([,pattern])=>pattern.test(text));
 return {code:match?.[0]||'page_check',phase:match?.[2]||'collection',retryable:match?.[3]??true,action:match?.[4]||'Compare this page with Moodle and retry.',reason:text};
}

export const MAX_COLLECTION_PASSES=12;
export function collectionCycle(memory,{continuation=false,now=Date.now()}={}){
 const old=memory.cycle,valid=old?.version===1&&Number.isSafeInteger(old.started)&&now>=old.started&&now-old.started<60*60*1000&&Number.isSafeInteger(old.pass)&&old.pass>0&&old.pass<MAX_COLLECTION_PASSES;
 const cycle=valid&&(continuation||old.resume===true)?old:{version:1,started:now,pass:0,pages:{},files:{},roots:{}};
 for(const field of ['pages','files','roots'])cycle[field]=Object.fromEntries(Object.entries(cycle[field]||{}).filter(([key,value])=>/^[a-f0-9]{64}$/.test(key)&&value===true).slice(0,4000));
 cycle.pass++;cycle.resume=true;memory.cycle=cycle;return cycle;
}

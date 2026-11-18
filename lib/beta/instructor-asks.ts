// Concrete instructor asks quoted from the student's own saved Moodle
// announcements: bring, print, read, prepare, room/time changes. Ported from the
// personal prototype's Sync/instructor_asks.py. It quotes; it does not paraphrase
// or decide. Questions, quoted replies, sign-offs and every sentence that
// mentions passwords, usernames or student IDs are skipped.
import type {PoolClient} from 'pg';
import {classifyMoodleContent} from './moodle-content';
import {unverifiedForumSource} from './source-authority';
import {credentialText} from './assessments-format';

const ask=/\b(please|bring|print|remember|reminder|make sure|be sure|prepare|read (?:chapter|pages?|the)|watch|review session|office hours|no class|cancel+ed|moved to|room|location|will be held|in-class|closed book|open book|study guide|due (?:on|by|before)|submit|upload)\b/i;
const noise=/unsubscribe|notification preferences|this message was sent|reply to this|go to the (?:forum|post)|^on .* wrote:/i;
const signoff=/^(?:yours|regards|best|cheers|thanks|thank you|sincerely)\b/i;

export function askSentences(text:string){
 const flat=(text||'').replace(/\s+/g,' ').trim();
 return flat?flat.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/).map(s=>s.trim()).filter(Boolean):[];
}
export function instructorAsksFrom(text:string,limit=3){
 const found:string[]=[];
 for(const s of askSentences(text)){
  // The signature or the quoted earlier message (often the student's own) follows.
  if(signoff.test(s)||/\bOn .{5,80} wrote:|^From: |-----Original Message/.test(s))break;
  // A question is not an instruction; fragments and walls of text are not quotable.
  if(s.endsWith('?')||s.length<25||s.length>260)continue;
  if(noise.test(s)||credentialText.test(s))continue;
  if(ask.test(s)&&!found.includes(s))found.push(s);
  if(found.length>=limit)break;
 }
 return found;
}

export type InstructorAsk={courseId:string;course:string;quote:string;title:string;sourceId:string;version:string;observedAt:string;url:string|null};
// Announcement versions saved in the last `days` days. The saved time is when
// this vault received the text, not when the instructor posted it.
export async function instructorAsks(c:PoolClient,user:string,now=new Date(),days=14):Promise<InstructorAsk[]>{
 const rows=(await c.query(`SELECT s.id,s.course_id,s.title,s.original_url,v.id AS version_id,v.observed_at,v.body,co.code
  FROM schoolvault.sources s JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.id=s.current_version
  JOIN schoolvault.courses co ON co.user_id=s.user_id AND co.id=s.course_id
  WHERE s.user_id=$1 AND s.kind='moodle' AND s.original_url LIKE '%/mod/forum/%' AND v.observed_at>=$2
  ORDER BY v.observed_at DESC LIMIT 100`,[user,new Date(now.getTime()-days*86400000)])).rows;
 const items:InstructorAsk[]=[];
 for(const r of rows){
  if(unverifiedForumSource(r))continue;
  if(classifyMoodleContent({url:r.original_url,title:r.title,body:''}).category!=='announcement')continue;
  for(const quote of instructorAsksFrom(r.body))items.push({courseId:r.course_id,course:r.code,quote,title:r.title,sourceId:r.id,version:r.version_id,observedAt:new Date(r.observed_at).toISOString(),url:r.original_url});
 }
 return items.slice(0,12);
}

import type {PoolClient} from 'pg';
import {excerptCoverage} from './excerpt-coverage';
import {unverifiedForumSource} from './source-authority';

export const returnedFeedbackQuestion=(q:string)=>/\b(?:returned|instructor|teacher|professor|comments?|feedback)\b/i.test(q)&&/\b(?:comments?|feedback)\b/i.test(q)&&! /\b(?:permission|allowed|policy|grade|score|submit for me)\b/i.test(q);
export function feedbackActivity(q:string){
 const named='((?:assignment|essay|report)\\s+\\d+)';
 if(new RegExp(named+'\\s+(?:and|,)\\s*'+named+'\\s+(?:comments?|feedback)\\b','i').test(q))return null;
 const patterns=['\\b(?:returned|earlier|previous)\\s+'+named,'\\b'+named+'(?:[’\x27]s)?\\s+(?:returned\\s+)?(?:comments?|feedback)\\b','\\b(?:comments?|feedback)\\s+(?:from|on|for)\\s+'+named];
 const explicit=[...new Set(patterns.flatMap(pattern=>[...q.matchAll(new RegExp(pattern,'ig'))].map(m=>m[1].toLowerCase().replace(/\s+/g,' '))))];
 if(explicit.length)return explicit.length===1?explicit[0]:null;
 const activities=[...q.matchAll(/\b(?:assignment|essay|report)\s+\d+\b/gi)];
 return activities.length===1?activities[0][0].toLowerCase().replace(/\s+/g,' '):null;
}
export function wordComments(body:string){
 // These are embedded file attributions, not proof of a person's identity.
 // Only the structured Word-comment section is parsed, never review prose or
 // checklist bullets that happen to mention an instructor.
 const records=[...body.matchAll(/\bComment\s+(\d+)\s+Author:\s*([^\n]*?)\s+Date:\s*(\S+)\s+Anchor paragraph\s+(\d+):\s*([\s\S]*?)\s+Comment text:\s*([\s\S]*?)(?=\s+Comment\s+\d+\s+Author:|\s+Tracked changes\s*\(|$)/g)];
 const seen=new Set<string>();
 return records.flatMap(m=>{
  const id=m[1],author=m[2].trim(),anchor=m[5].trim(),text=m[6].trim();
  if(seen.has(id)||!text||text.length>1800||author.length>160||anchor.length>1800||/\[empty comment/i.test(text))return [];
  seen.add(id);return [{id,author,date:m[3],paragraph:Number(m[4]),anchor,text,raw:m[0]}];
 }).slice(0,60);
}
export async function returnedFeedbackSources(c:PoolClient,user:string,course:string|null,q:string){
 if(!course||!returnedFeedbackQuestion(q))return [];
 const activity=feedbackActivity(q);
 if(!activity)return []; // No assessment guessing from a person's surname.
 const rows=(await c.query(`SELECT s.id,s.title,s.kind,s.course_id,s.original_url,v.id AS version_id,v.observed_at,v.body AS full_body
 FROM schoolvault.sources s JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.id=s.current_version
 WHERE s.user_id=$1 AND s.course_id=$2 AND s.kind!='ai_draft' AND length(v.body)<=160000
 AND (s.title ~* '\\.docx$' OR v.body ~* $3) ORDER BY v.observed_at DESC LIMIT 100`,[user,course,'\\m'+activity.replace(/\s+/g,'[[:space:]]+')+'\\M'])).rows;
 const originals=rows.filter(s=>/\.docx$/i.test(s.title)&&!unverifiedForumSource({...s,excerpt:s.full_body})).map(s=>({...s,comments:wordComments(s.full_body)})).filter(s=>s.comments.length);
 // A same-course, same-assessment saved review must name the returned file.
 // Multiple originals remain ambiguous; never select one by newest timestamp.
 const linked=originals.filter(s=>rows.some(r=>r.id!==s.id&&new RegExp('\\b'+activity.replace(/\s+/g,'\\s+')+'\\b','i').test(r.full_body)&&/returned (?:original|file)|feedback file/i.test(r.full_body)&&r.full_body.toLowerCase().includes(s.title.toLowerCase())));
 if(linked.length!==1)return [];
 const s=linked[0];
 // Exact whole comment records only. A bounded readback is not a full Word
 // review and does not include or interpret the tracked changes.
 let excerpt='';const selected=[];
 for(const comment of s.comments){if(excerpt.length+comment.raw.length+2>10000)break;selected.push(comment);excerpt+=(excerpt?'\n\n':'')+comment.raw;}
 return [{...s,excerpt,excerpt_coverage:excerptCoverage(s,s.full_body,excerpt),returned_feedback:{format:1,version_id:s.version_id,comments:selected,complete_comments:selected.length===s.comments.length,attribution:'embedded Word metadata; not independent author verification'}}];
}

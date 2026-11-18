import type {PoolClient} from 'pg';
import {excerptCoverage} from './excerpt-coverage';
import {unverifiedForumSource} from './source-authority';

// Keep the work being revised distinct from the earlier assessment supplying
// feedback. A compound question must not silently become a comment lookup.
export function writingActivity(q:string){
 if(!/\b(?:memo|draft|essay|paper|profile|writing|paragraph|readiness|rationale|wording|sentence|caption)\b/i.test(q))return null;
 const named=[...q.matchAll(/\b(assignment|essay|report|case|project)\s+(\d{1,3})\b/gi)];
 const object=named.find(m=>/^\s+(?:(?:current|saved|final)\s+)?(?:memo|draft|essay|paper|profile|(?:Featured\s+)?(?:rationale|wording|sentence|paragraph|caption))\b/i.test(q.slice(m.index!+m[0].length)));
 const chosen=object||named.at(-1);
 return chosen?chosen[1].toLowerCase()+' '+Number(chosen[2]):null;
}
export function applyingFeedback(q:string){
 return /\b(?:comments?|feedback)\b/i.test(q)&&/\b(?:apply|applying|review|critique|polish|strengthen|continue|improv\w*|revis\w*|edit\w*|rewrite|concrete change)\b/i.test(q)&&!!writingActivity(q);
}
export function writingFollowupQuestion(q:string,history:{role:string;text?:string|null}[]){
 const named=[...q.matchAll(/\b(?:assignment|essay|report|case|project|quiz|exam|test)\s+\d+\b/gi)];
 const newTarget=named.some(m=>! /(?:returned|earlier|previous)\s*$/i.test(q.slice(0,m.index))&&! /^\s+(?:returned\s+)?(?:comments?|feedback)\b/i.test(q.slice(m.index!+m[0].length)));
 if(newTarget||writingActivity(q)&&!named.length)return q;
 if(!/\b(?:memo|rationale|Featured|portfolio|(?:research|Acadia)\s+(?:announcement|post))\b/i.test(q))return q;
 const prior=[...history].reverse().find(m=>m.role==='user'&&m.text!==q&&writingActivity(m.text||''));
 const activity=prior?writingActivity(prior.text||''):null;
 return activity?q+'\nCurrent writing task: '+activity+' memo.':q;
}
export function writingPriority(title:string,activity:string|null){
 if(!activity)return 0;
 const normalized=title.replace(/[_-]/g,' ');
 if(!new RegExp('\\b'+activity.replace(' ','\\s+')+'\\b','i').test(normalized))return -80;
 if(/personal plan|feedback|confirmation|captions|study guide|review test|\btest\b/i.test(title))return -60;
 if(/\b(?:history|archive|earlier|draft|review)\b/i.test(title))return 0;
 if(/\.docx$/i.test(title))return 140;
 if(/\.pdf$/i.test(title))return 70;
 return /\b(?:current|memo|draft)\b/i.test(title)?40:0;
}
export async function writingRequirements(c:PoolClient,user:string,course:string|null,q:string){
 const activity=writingActivity(q);
 if(!course||!activity)return [];
 const pattern='\\m'+activity.replace(' ','[[:space:]_-]+')+'\\M';
 const rows=(await c.query(`SELECT s.id,s.title,s.kind,s.course_id,s.original_url,s.current_version,v.id AS version_id,v.observed_at,v.body AS full_body
 FROM schoolvault.sources s JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.source_id=s.id AND v.id=s.current_version
 WHERE s.user_id=$1 AND s.course_id=$2 AND s.kind IN('file','moodle')
 AND translate(s.title,'_-','  ') ~* $3 AND length(v.body)<=160000
 ORDER BY (s.kind='file') DESC,v.observed_at DESC,s.id LIMIT 60`,[user,course,pattern])).rows;
 return rows.filter(s=>!unverifiedForumSource({...s,excerpt:s.full_body})
  &&! /review|returned|student|sample|example|personal|draft|\.docx$/i.test(s.title)
  && /checklist|requirements?|instructions?|\bassignment\b/i.test(s.title)
  && /\b(?:memo|submit|format|font|must|should|write|checklist)\b/i.test(s.full_body))
  .sort((a,b)=>Number(/checklist/i.test(a.title))-Number(/checklist/i.test(b.title))).slice(0,2)
  .map(s=>{const excerpt=s.full_body.length<=8500?s.full_body:s.full_body.slice(0,8500).replace(/\s+\S*$/,'');return {...s,excerpt,excerpt_coverage:excerptCoverage(s,s.full_body,excerpt),review_evidence:{format:1,role:'assignment_requirement',activity}};});
}

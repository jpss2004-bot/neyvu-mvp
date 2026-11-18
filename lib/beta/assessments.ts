// Per-student loader for dated assessment claims. Parsing and ranking live in
// ./assessments-format.ts (browser-safe); see that file for the claim rules.
import type {PoolClient} from 'pg';
import {tenant} from './db';
import {classifyMoodleContent} from './moodle-content';
import {unverifiedForumSource} from './source-authority';
import {assessmentClaimsFromText,planAssessmentClaim,reconcileAssessments,type AssessmentClaim,type AssessmentSourceKind} from './assessments-format';
export * from './assessments-format';

const syllabusName=/syllab|\b(?:course[ _-]+)?outline\b|\boutline_/i;
export const syllabusVersion=(title:string)=>{const m=title.match(/\bver(?:sion)?\.?\s*(\d+(?:\.\d+)?)/i);return m?Number(m[1]):0;};

// Every read is inside the signed-in student's tenant transaction. Only current
// versions of the student's own Moodle pages and syllabus files are read; notes,
// AI drafts and forum discussions (where students also write) are not claims.
export async function assessmentClaims(c:PoolClient,user:string):Promise<AssessmentClaim[]>{
 const sources=(await c.query(`SELECT s.id,s.course_id,s.kind,s.title,s.original_url,v.id AS version_id,v.observed_at,v.body,co.code
  FROM schoolvault.sources s JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.id=s.current_version
  JOIN schoolvault.courses co ON co.user_id=s.user_id AND co.id=s.course_id
  WHERE s.user_id=$1 AND s.kind IN ('moodle','file')
   AND v.body ~* '(test|exam|midterm|quiz|presentation|reflection)'
  ORDER BY v.observed_at DESC LIMIT 500`,[user])).rows;
 const claims:AssessmentClaim[]=[];
 for(const s of sources){
  if(unverifiedForumSource(s))continue;
  let sourceKind:AssessmentSourceKind;
  if(s.kind==='file'){
   if(syllabusName.test(s.title))sourceKind='syllabus';
   else{
    // Original course files often carry the only dated test notice. Keep
    // arbitrary notes, AI drafts and forum attachments out of this loader.
    let url:URL;try{url=new URL(s.original_url);}catch{continue;}
    if(url.protocol!=='https:'||!/^moodle\./i.test(url.hostname)||!/^\/(?:pluginfile\.php\/.*\/(?:mod_resource|mod_folder|course)\/|mod\/resource\/view\.php)/.test(url.pathname))continue;
    sourceKind='course_material';
   }
  }
  else{
   const category=classifyMoodleContent({url:s.original_url,title:s.title,body:''}).category;
   if(category==='discussion')continue;
   sourceKind=category==='announcement'?'moodle_announcement':'moodle_page';
  }
  const observedAt=new Date(s.observed_at).toISOString();
  claims.push(...assessmentClaimsFromText(s.body,{courseId:s.course_id,course:s.code,sourceKind,sourceId:s.id,version:s.version_id,observedAt,title:s.title,url:s.original_url,
   ...(sourceKind==='syllabus'?{syllabusVersion:syllabusVersion(s.title)}:{})}));
 }
 const plans=(await c.query(`SELECT p.id,p.course_id,p.title,p.planned_on,p.state,p.version_id,p.updated_at,co.code FROM schoolvault.student_plans p
  JOIN schoolvault.courses co ON co.user_id=p.user_id AND co.id=p.course_id
  WHERE p.user_id=$1 AND p.planned_on IS NOT NULL AND p.state!='archived'`,[user])).rows;
 for(const p of plans){const claim=planAssessmentClaim({...p,courseId:p.course_id,course:p.code,updated_at:p.updated_at?new Date(p.updated_at).toISOString():null});if(claim)claims.push(claim);}
 return claims;
}
export async function betaAssessments(user:string){return tenant(user,async c=>reconcileAssessments(await assessmentClaims(c,user)));}

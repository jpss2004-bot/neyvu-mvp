import {tenant} from './db';
import {currentCourseSelection} from './course-selection';
import {classifyMoodleContent} from './moodle-content';
import {macDownloadUrl} from './approval-mail';
import {collectionCheck} from './collection-checks';
import type {BetaMeeting} from './agenda';
export async function onboardingProgress(user:string){return tenant(user,async c=>{
 const selection=await currentCourseSelection(c,user);
 const facts=(await c.query(`SELECT
  EXISTS(SELECT 1 FROM schoolvault.companion_devices WHERE user_id=$1 AND revoked_at IS NULL) AS companion,
  EXISTS(SELECT 1 FROM schoolvault.connectors WHERE user_id=$1 AND provider='moodle' AND status='connected' AND revoked_at IS NULL) AS moodle,
  EXISTS(SELECT 1 FROM schoolvault.passages p JOIN schoolvault.sources s ON s.user_id=p.user_id AND s.id=p.source_id AND s.current_version=p.version_id
   WHERE p.user_id=$1 AND s.kind<>'ai_draft' AND length(trim(p.body))>0) AS material,
  EXISTS(SELECT 1 FROM schoolvault.jobs WHERE user_id=$1 AND kind='answer' AND status='complete') AS answer,
  EXISTS(SELECT 1 FROM schoolvault.notes WHERE user_id=$1 AND origin IN('app','student')) AS note`,[user])).rows[0];
 return {companion:facts.companion,moodle:facts.moodle,courses:selection.confirmed&&selection.moodle_ids.length>0,material:facts.material,answer:facts.answer,note:facts.note};
});}

export async function onboardingCourseSelection(user:string){return tenant(user,async c=>{
 const {confirmed,moodle_ids}=await currentCourseSelection(c,user);
 return {confirmed,moodle_ids};
});}

export async function guidedOnboardingProgress(user:string){return tenant(user,async c=>{
 const selection=await currentCourseSelection(c,user);
 const device=(await c.query(`SELECT EXISTS(
   SELECT 1 FROM schoolvault.companion_devices d
   JOIN schoolvault.companion_tokens t ON t.user_id=d.user_id AND t.device_id=d.id
   WHERE d.user_id=$1 AND d.revoked_at IS NULL AND t.expires_at>now()
  ) AS paired`,[user])).rows[0];
 const courses=(await c.query<{id:string;title:string;moodle_id:string}>(`SELECT id,title,moodle_id
  FROM schoolvault.courses WHERE user_id=$1 AND moodle_id=ANY($2::text[]) ORDER BY code,id`,
  [user,selection.moodle_ids])).rows;
 const ids=courses.map(course=>course.id);
 const sources=(await c.query<{course_id:string;title:string;course_title:string;original_url:string;body:string;indexed:boolean;original_saved:boolean}>(`SELECT
   s.course_id,s.title,c.title AS course_title,s.original_url,v.body,
   v.object_key IS NOT NULL AS original_saved,
   EXISTS(SELECT 1 FROM schoolvault.passages p WHERE p.user_id=s.user_id AND p.source_id=s.id
     AND p.version_id=v.id AND length(trim(p.body))>0) AS indexed
  FROM schoolvault.sources s JOIN schoolvault.courses c ON c.user_id=s.user_id AND c.id=s.course_id
  JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.source_id=s.id AND v.id=s.current_version
  WHERE s.user_id=$1 AND s.course_id=ANY($2::uuid[])
    AND (s.kind='moodle' OR s.kind='file' AND s.original_url LIKE 'https://moodle.acadiau.ca/%')
  ORDER BY v.observed_at,s.id`,[user,ids])).rows;
 const byCourse=new Map<string,{saved:boolean;readable:boolean}>();
 for(const source of sources){
  const status=byCourse.get(source.course_id)||{saved:false,readable:false};
  status.saved ||= source.original_saved||!!source.body?.trim();
  if(source.indexed&&!status.readable){
   const text=classifyMoodleContent({url:source.original_url,title:source.title,course_title:source.course_title,body:source.body||''});
   status.readable=text.text_state==='readable'&&text.role==='observed_content';
  }
  byCourse.set(source.course_id,status);
 }
 const observations=(await c.query<{course_id:string;reason:string}>(`SELECT s.course_id,issue AS reason FROM schoolvault.moodle_observations o JOIN schoolvault.sources s ON s.user_id=o.user_id AND s.id=o.source_id CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(o.coverage->'issues','[]'::jsonb)) issue WHERE o.user_id=$1 AND s.course_id=ANY($2::uuid[])`,[user,ids])).rows;
 const meetings=(await c.query<BetaMeeting>('SELECT id,course_id,source_id,schedule FROM schoolvault.meetings WHERE user_id=$1 AND course_id=ANY($2::uuid[])',[user,ids])).rows;
 return {mac_download_url:macDownloadUrl(),paired:device.paired===true,selected:selection.moodle_ids.length,courses:courses.map(course=>{
  const status=byCourse.get(course.id);
  const grouped=new Map<string,ReturnType<typeof collectionCheck>&{count:number}>();
  for(const row of observations.filter(row=>row.course_id===course.id)){const check=collectionCheck(row.reason),old=grouped.get(check.kind);grouped.set(check.kind,{...check,count:(old?.count||0)+1});}
  return {id:course.id,title:course.title,checks:[...grouped.values()],state:status?.readable?'readable':status?.saved?'saved':'found'} as GuidedSetupCourse;
 }),meetings};
});}

export type GuidedSetupCourse={id:string;title:string;state:'found'|'saved'|'readable';checks?:Array<ReturnType<typeof collectionCheck>&{count:number}>};
export type GuidedSetupProgress=Awaited<ReturnType<typeof guidedOnboardingProgress>>;

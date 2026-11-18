import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {ChatScope} from './chat-scope';
import {courseCode} from './course-codes';
import {currentCourseMembership} from './course-membership';
import {currentCourseSelection} from './course-selection';
import type {CoursePassage} from './course-context';
import type {Language} from './language';
import {lectureScheduleCourse,lectureScheduleEvidence,lectureScheduleQuestion,lectureScheduleSection} from './lecture-schedule-answer';
import {labScheduleCourseCode,labScheduleEvidence,labScheduleQuestion,type LabScheduleOption} from './lab-schedule-evidence';
import {moodleFileURL} from './moodle-files';
import {pdfReading} from './pdf-reading';
import {sourceReferenceHref} from './source-reference';

const maxCandidates=8;
const maxBody=150000;
const fileTitle='(^|[^[:alnum:]])(syllabus|outline|timetable|class[ _-]+schedule|lecture[ _-]+schedule)([^[:alnum:]]|$)';
const moodleSchedule='(^|[[:space:]])((class|lecture)[[:space:]]+(meetings?|times?|schedule|location)[[:space:]]*:|(class|lecture)[[:space:]]+(is|was|has been)[[:space:]]+(cancelled|canceled|moved|rescheduled))';
const weekdays=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const dayList=new Intl.ListFormat('en-CA',{style:'long',type:'conjunction'});
const extractionProof=`
 LEFT JOIN LATERAL (
  SELECT j.result FROM schoolvault.jobs j
  WHERE source.kind='file' AND j.user_id=$1 AND j.status='complete'
    AND (j.kind='extract' OR j.kind='collect' AND j.input->>'task'='device-content-v1')
    AND j.input->>'source_id'=source.id::text AND j.result->>'version_id'=source.version_id::text
  ORDER BY j.created_at DESC,j.id DESC LIMIT 1
 ) proof ON true`;

function clock(value:string){
 const [hour,minute]=value.split(':');
 return {time:(Number(hour)%12||12)+':'+minute,period:Number(hour)<12?'a.m.':'p.m.'};
}

function timeRange(start:string,end:string){
 const a=clock(start),b=clock(end);
 return a.period===b.period?a.time+'–'+b.time+' '+b.period:a.time+' '+a.period+' to '+b.time+' '+b.period;
}

function trustedMoodleFile(value:string|null){
 try{return value!==null&&moodleFileURL(value)===value;}catch{return false;}
}

type OutlineRow={
 id:string;version_id:string;course_id:string;kind:'file'|'moodle';title:string;original_url:string|null;
 observed_at:Date;body:string;partial:boolean;sha256:string;mime:string|null;object_key:string|null;
 reading:{source_id?:string;version_id?:string;original_sha256?:string;text_sha256?:string;truncated?:boolean;pdf_reading?:unknown}|null;
};

function readingCoverage(row:OutlineRow){
 const receipt=row.reading;
 if(row.kind!=='file'||row.mime!=='application/pdf'||!row.object_key||row.partial||!receipt||receipt.truncated!==false
  ||receipt.source_id!==row.id||receipt.version_id!==row.version_id||receipt.original_sha256!==row.sha256
  ||receipt.text_sha256!==createHash('sha256').update(row.body).digest('hex'))return null;
 try{
  const reading=pdfReading(receipt.pdf_reading);
  return reading?.method==='selectable_text'&&reading.pages_read===reading.total_pages&&!reading.pages_without_text.length?reading:null;
 }catch{return null;}
}

function reference(rows:OutlineRow[],passage:CoursePassage){
 const row=rows.find(row=>row.id===passage.source_id&&row.version_id===passage.version_id)!;
 const lines=row.body.split(/\r?\n/);
 const last=passage.end_line;
 let first=passage.start_line-1;
 while(first>0&&!/^Page \d+\s*$/.test(lines[first]))first--;
 // Keep the excerpt contiguous for the existing drawer's exact highlight.
 const page=lines.slice(first,last).join('\n').trim();
 const excerpt=page.length>=48&&page.length<=4000&&page.includes(passage.quote)?page:passage.quote;
 return {id:row.id,version_id:row.version_id,course_id:row.course_id,kind:row.kind,title:row.title,observed_at:row.observed_at.toISOString(),excerpt};
}

export async function savedSyllabusAnswer(c:PoolClient,user:string,scope:ChatScope,question:string,language:Language){
 if(language!=='en'||scope.mode!=='ask'||scope.context.length)return null;
 const intent=lectureScheduleQuestion(question);
 if(!intent)return null;
 const clarify={text:'Which lecture section should I check? Select the course section in Chat, or include its section code in your question.',sources:[]};
 const selected=await currentCourseSelection(c,user);
 if(!selected.confirmed)return null;
 const courses=(await c.query<{id:string;code:string;title:string}>(`
  SELECT id,code,title FROM schoolvault.courses
  WHERE user_id=$1 AND kind='lecture' AND moodle_id=ANY($2::text[])
    AND ($3::uuid IS NULL OR id=$3)
    AND EXISTS(SELECT 1 FROM schoolvault.users WHERE id=$1 AND disabled_at IS NULL AND NOT demo)`,[user,selected.moodle_ids,scope.course_id])).rows;
 const named=courses.filter(course=>(courseCode(course.code)||courseCode(course.title))===intent.courseCode);
 if(!named.length)return null;
 if(!scope.course_id&&!intent.section)return clarify;
 const sections=named.filter(course=>lectureScheduleCourse(course,intent)==='match');
 if(sections.length!==1)return sections.length||!intent.section?clarify:null;
 const course=sections[0];
 const rows=(await c.query<OutlineRow>(`
  WITH candidates AS (
   SELECT s.id,s.kind,s.course_id,s.title,s.original_url,v.id AS version_id,v.observed_at,
          left(v.body,$5) AS body,length(v.body)>$5 AS partial,v.sha256,v.mime,v.object_key
   FROM schoolvault.sources s
   JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.source_id=s.id AND v.id=s.current_version
   WHERE s.user_id=$1 AND s.course_id=$2
     AND (s.kind='file' AND s.title ~* $3
       OR s.kind='moodle' AND (v.body ~* $4 OR s.title ~* $4))
   ORDER BY s.id LIMIT $6
  )
  SELECT source.*,proof.result AS reading
  FROM candidates source ${extractionProof}`,[user,course.id,fileTitle,moodleSchedule,maxBody,maxCandidates+1])).rows;
 // A separate saved Moodle schedule or announcement needs the normal evidence flow.
 if(rows.length>maxCandidates||rows.some(row=>row.kind==='moodle'))return null;
 const result=lectureScheduleEvidence(intent,course,rows.map(row=>{
  const reading=readingCoverage(row);
  return {...row,observed_at:row.observed_at.toISOString(),complete:!!reading,
   untrusted:!trustedMoodleFile(row.original_url),
   limitedPages:[...(reading?.visual_pages||[]),...(reading?.page_issues||[]).map(issue=>issue.page)]};
 }));
 if(!result)return null;
 if(result.kind==='unreadable'){
  const source=rows.find(row=>row.id===result.sourceId)!;
  return {text:'Please add a readable copy of the saved outline in Sources first. The current copy does not give me enough reliable text to confirm the lecture schedule. You can also ask me to review the available evidence with that limitation [1]('+sourceReferenceHref(source)+').',
   sources:[{id:source.id,version_id:source.version_id,course_id:source.course_id,kind:source.kind,title:source.title,observed_at:source.observed_at.toISOString()}]};
 }
 if(result.kind==='conflict'){
  const sources=result.sources.map(passage=>reference(rows,passage));
  return {text:'The saved outlines give different lecture schedules. Which source should I use? '+sources.map((source,index)=>'['+(index+1)+']('+sourceReferenceHref(source)+')').join(' '),sources};
 }
 const source=reference(rows,result.source);
 return {text:'According to the saved outline, the '+lectureScheduleSection(course)+' lecture meets '+dayList.format(result.weekdays.map(day=>weekdays[day]))+' from '+timeRange(result.start_time,result.end_time)+' in '+result.location+' [1]('+sourceReferenceHref(source)+'). Check the outline’s calendar or Moodle for dated exceptions.',
  sources:[source]};
}

function profileSection(code:string,groups:{name:string}[]){
 const prefix=code.replace(' ','[ -]?');
 const groupPattern=new RegExp('^(?:'+prefix+'\\s+)?((?:FA|WI|SP|SU)\\d{2})(?=$|\\s)(?!\\s*(?:[-–/]|and\\b))','i');
 const sections=new Set(groups.flatMap(group=>{
  const match=group.name.match(groupPattern);
  return match&&!/\b(?:FA|WI|SP|SU)\d{2}\b/i.test(group.name.slice(match[0].length))?[match[1].toUpperCase()]:[];
 }));
 return sections.size===1?[...sections][0]:null;
}

function describeLabSlot(option:LabScheduleOption){
 return option.section+' meets '+weekdays[option.weekday]+' from '+timeRange(option.start_time,option.end_time)+' in '+option.location;
}

export async function savedLabAnswer(c:PoolClient,user:string,scope:ChatScope,question:string,language:Language){
 if(language!=='en'||scope.mode!=='ask'||!scope.course_id||scope.context.length)return null;
 const code=labScheduleQuestion(question);
 if(!code)return null;
 const selection=await currentCourseSelection(c,user);
 if(!selection.confirmed)return null;
 const lab=(await c.query<{id:string;code:string;title:string}>(`
  SELECT id,code,title FROM schoolvault.courses
  WHERE user_id=$1 AND id=$2 AND moodle_id=ANY($3::text[])
    AND EXISTS(SELECT 1 FROM schoolvault.users WHERE id=$1 AND disabled_at IS NULL AND NOT demo)`,[user,scope.course_id,selection.moodle_ids])).rows[0];
 if(!lab||labScheduleCourseCode(lab)!==code)return null;
 const membership=await currentCourseMembership(c,user,lab.id);
 const section=membership.state==='observed'?profileSection(code,membership.groups):null;
 const profile=section&&membership.profile_url&&membership.observed_at&&membership.version?
  {course_id:lab.id,profile_url:membership.profile_url,observed_at:membership.observed_at,version:membership.version}:undefined;
 const attendance=(await c.query<{body:string}>(`
  SELECT body FROM schoolvault.student_memory WHERE user_id=$1 AND course_id=$2 AND chat_id IS NULL
    AND kind='preference' AND starts_with(body,'Personal lab attendance: ')
  ORDER BY updated_at DESC,id DESC LIMIT 1`,[user,lab.id])).rows[0]?.body
  .match(/^Personal lab attendance: ((?:FA|WI|SP|SU)\d{2}) on (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\.$/);
 const labRow='(^|[\r\n])[[:blank:]]*'+code.replace(' ','[ -]?')+'[[:blank:]]+(FA|WI|SP|SU)[0-9]{2}[[:blank:]]*:';
 const rows=(await c.query<OutlineRow&{course_code:string;course_title:string;current_version:string}>(`
  WITH candidates AS (
   SELECT s.id,s.kind,s.course_id,s.title,s.original_url,s.current_version,v.id AS version_id,v.observed_at,
          left(v.body,$5) AS body,length(v.body)>$5 AS partial,v.sha256,v.mime,v.object_key,
          lecture.code AS course_code,lecture.title AS course_title
   FROM schoolvault.courses lecture
   JOIN schoolvault.sources s ON s.user_id=lecture.user_id AND s.course_id=lecture.id
   JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.source_id=s.id AND v.id=s.current_version
   WHERE lecture.user_id=$1 AND lecture.kind='lecture' AND lecture.moodle_id=ANY($2::text[])
     AND s.kind='file' AND s.title ~* $3 AND v.body ~* $4
   ORDER BY s.id LIMIT $6
  )
  SELECT source.*,proof.result AS reading FROM candidates source ${extractionProof}`,
  [user,selection.moodle_ids,fileTitle,labRow,maxBody,maxCandidates+1])).rows;
 const evidence=rows.length>maxCandidates?null:labScheduleEvidence(lab,section,rows.map(row=>{
  const reading=readingCoverage(row);
  return {...row,course:{id:row.course_id,code:row.course_code,title:row.course_title},observed_at:row.observed_at.toISOString(),
   complete:!!reading,untrusted:!trustedMoodleFile(row.original_url),
   limitedPages:[...(reading?.visual_pages||[]),...(reading?.page_issues||[]).map(issue=>issue.page)]};
 }));
 const parts=[profile?'Your saved Moodle profile shows **'+section+'**. [Moodle profile](#moodle-membership)':'I couldn’t verify one current lab section from your saved Moodle profile.'];
 const sources:ReturnType<typeof reference>[]=[];
 if(evidence?.kind==='schedule'){
  const options=evidence.selected?[evidence.selected]:evidence.options;
  for(const option of options){
   let index=sources.findIndex(source=>source.id===option.source.source_id&&source.version_id===option.source.version_id);
   if(index===-1){index=sources.length;sources.push(reference(rows,option.source));}
   else if(!sources[index].excerpt.includes(option.source.quote))sources[index]=reference(rows,option.source);
   parts.push('According to the saved outline, '+describeLabSlot(option)+' ['+(index+1)+']('+sourceReferenceHref(sources[index])+').');
  }
 }else if(evidence?.kind==='conflict'){
  sources.push(...evidence.sources.map(source=>reference(rows,source)));
  parts.push('The saved outlines give different lab schedules. Which outline should I use? '+sources.map((source,index)=>'['+(index+1)+']('+sourceReferenceHref(source)+')').join(' '));
 }else{
  parts.push('I couldn’t verify the lab room from a readable saved outline.');
 }
 if(attendance)parts.push('Your personal attendance plan says **'+attendance[2]+' '+attendance[1]+'**.');
 return {text:parts.join('\n\n'),sources,moodle_membership:profile};
}

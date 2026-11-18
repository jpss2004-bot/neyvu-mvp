import {type CourseMembershipView} from './course-membership';
import {courseGroupContext} from './group-context';
import type {GroupContext} from './group-context-format';
import {tenant,uuid} from './db';
import {BetaHttpError} from './http';
import {sourceBlocks} from './source-blocks';
import {syllabusHeaderTimes,associatedLabRow} from './schedule-text';

export type CourseLocation={source_id:string;version_id:string;title:string;observed_at:string;start_line:number;end_line:number;unit:string|null};
export type CoursePassage=CourseLocation&{category:'office_hours'|'schedule'|'instructor';quote:string};
export type CourseOmission=CourseLocation&{reason:'passage_too_long'|'view_limit'|'source_limit'};
export type CourseContext={membership?:CourseMembershipView;groups?:GroupContext;course_id:string;source_count:number;readable_count:number;passages:CoursePassage[];truncated:boolean;omissions?:CourseOmission[];omission_count?:number;omissions_truncated?:boolean;omitted_source_count?:number};
const categoryFor=(line:string):CoursePassage['category']|null=>/\b(?:office\s+hours?|consultation\s+hours?)\b/i.test(line)?'office_hours':/^(?:(?:class|lecture|lab|seminar|tutorial)\s+(?:time|schedule|meeting|hours?)s?|meeting times?|classroom|class location)\s*(?::|\n|$)/im.test(line)||/^Delivery\s*:[\s\S]*\b(?:we will meet|meet in person)\b/i.test(line)?'schedule':/^(?:course\s+)?(?:instructor|professor|lecturer)\s*:/i.test(line)?'instructor':null;
const contextPattern='(office[[:space:]]+hours?|consultation[[:space:]]+hours?|(^|\n)[[:blank:]]*(#{1,4}[[:blank:]]+)?(class|lecture|lab|seminar|tutorial)[[:space:]]+(times?|schedules?|meetings?|hours?)[[:blank:]]*(:|\n|$)|(^|\n)[[:blank:]]*(#{1,4}[[:blank:]]+)?(meeting times?|classroom|class location|delivery|instructor|professor|lecturer)[[:space:]]*:)';
// Whole saved blocks retain late conditions. Anything too large for this view
// remains addressable by its immutable source version and exact line range.
export function coursePassageView(row:{id:string;version_id:string;title:string;observed_at:string;body:string}){
 const passages:CoursePassage[]=[],omissions:CourseOmission[]=[];let omissionCount=0;
 const lines=row.body.split(/\r?\n/),headers=syllabusHeaderTimes(row.body,row.title);
 const blocks=[...sourceBlocks(row.body)];
 const ranges=[...headers,...lines.flatMap((line,index)=>associatedLabRow(line,row.body)?[{start:index,end:index+1}]:[])];
 const extra=ranges.map(range=>({text:lines.slice(range.start,range.end).join('\n'),start_line:range.start+1,end_line:range.end,unit:[...lines.slice(0,range.start)].reverse().find(line=>/^(?:Page|Slide|Paragraph) \d+/i.test(line))||null,heading:false}));
 const selected=[...blocks.filter(block=>!ranges.some(range=>block.start_line>=range.start+1&&block.end_line<=range.end)),...extra].sort((a,b)=>a.start_line-b.start_line);
 for(const block of selected){
  const category=extra.includes(block)||associatedLabRow(block.text,row.body)?'schedule':categoryFor(block.text.replace(/^#{1,4}\s+/,''));
  if(!category||/^(?:#{1,4}\s*)?(?:(?:office|consultation)\s+hours?|instructor|professor|lecturer)\s*:?\s*$/i.test(block.text))continue;
  const location={source_id:row.id,version_id:row.version_id,title:row.title,observed_at:row.observed_at,start_line:block.start_line,end_line:block.end_line,unit:block.unit};
  if(block.text.length>1600||passages.length>=12){
   omissionCount++;
   if(omissions.length<24)omissions.push({...location,reason:block.text.length>1600?'passage_too_long':'view_limit'});
  }else passages.push({...location,category,quote:block.text});
 }
 return {passages,omissions,omission_count:omissionCount,omissions_truncated:omissionCount>omissions.length};
}
export function coursePassages(row:Parameters<typeof coursePassageView>[0]):CoursePassage[]{return coursePassageView(row).passages;}
export async function betaCourseContext(user:string,courseId:unknown):Promise<CourseContext>{
 if(!uuid(courseId))throw new BetaHttpError('Choose a course for its saved context.');
 return tenant(user,async c=>{
  if(!(await c.query('SELECT id FROM schoolvault.courses WHERE user_id=$1 AND id=$2',[user,courseId])).rowCount)throw new BetaHttpError('Course not found.',404);
  // Current originals only. Personal notes and AI drafts cannot become faculty
  // evidence. All matching sources are counted; the bounded reader is explicit.
  // Count and bounded rows share one PostgreSQL statement snapshot, so a
  // concurrent refresh cannot make the omission count contradict its locations.
  const result=(await c.query(`WITH current_sources AS NOT MATERIALIZED (
    SELECT s.id,s.title,v.id AS version_id,v.observed_at,v.body
    FROM schoolvault.sources s JOIN schoolvault.source_versions v
      ON v.user_id=s.user_id AND v.source_id=s.id AND v.id=s.current_version
    WHERE s.user_id=$1 AND s.course_id=$2 AND s.kind IN('moodle','file')
   ), counts AS (
    SELECT count(*) AS total,count(*) FILTER(WHERE btrim(body)!='') AS readable,
           count(*) FILTER(WHERE (body ~* $3 OR title ~* '(syllabus|outline|course information)')) AS matching FROM current_sources
   ) SELECT counts.*,coalesce((SELECT jsonb_agg(to_jsonb(selected)) FROM (
    SELECT * FROM current_sources WHERE (body ~* $3 OR title ~* '(syllabus|outline|course information)') ORDER BY observed_at DESC,id LIMIT 31
   ) selected),'[]'::jsonb) AS source_rows FROM counts`,[user,courseId,contextPattern])).rows[0];
  const counts=result,rows=result.source_rows;
  const passages:CoursePassage[]=[],omissions:CourseOmission[]=[];let omissionCount=0;
  const addOmission=(item:CourseOmission)=>{omissionCount++;if(omissions.length<24)omissions.push(item);};
  for(const row of rows.slice(0,30)){
   const view=coursePassageView({...row,observed_at:new Date(row.observed_at).toISOString()});
   for(const passage of view.passages){if(passages.length<24)passages.push(passage);else {const {quote,category,...location}=passage;addOmission({...location,reason:'view_limit'});}}
   for(const omission of view.omissions){if(omissions.length<24)omissions.push(omission);}
   omissionCount+=view.omission_count;
  }
  const omittedSourceCount=Math.max(0,Number(counts.matching)-30);
  for(const row of rows.slice(30)){
   if(omissions.length<24)omissions.push({source_id:row.id,version_id:row.version_id,title:row.title,observed_at:new Date(row.observed_at).toISOString(),start_line:1,end_line:row.body.split(/\r?\n/).length,unit:null,reason:'source_limit'});
  }
  omissionCount+=omittedSourceCount;
  const groups=await courseGroupContext(c,user,String(courseId));
  return {membership:groups.official,groups,course_id:String(courseId),source_count:Number(counts.total),readable_count:Number(counts.readable),passages,truncated:omissionCount>0,omissions,omission_count:omissionCount,omissions_truncated:omissionCount>omissions.length,omitted_source_count:omittedSourceCount};
 });
}

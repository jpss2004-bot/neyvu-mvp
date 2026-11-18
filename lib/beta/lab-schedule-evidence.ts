import {courseCode} from './course-codes';
import {courseLabel} from './course-label';
import type {CoursePassage} from './course-context';
import {lectureScheduleSection,type LectureScheduleSource} from './lecture-schedule-answer';
import {associatedLabRow,codedLabRow} from './schedule-text';
import {unverifiedForumSource} from './source-authority';
import {timetableSuggestions} from './timetable';

export type LabScheduleCourse={id:string;code:string;title?:string};
export type LabScheduleSource=LectureScheduleSource&{current_version:string;course:LabScheduleCourse};
export type LabScheduleOption={section:string;weekday:number;start_time:string;end_time:string;location:string;source:CoursePassage};
export type LabScheduleResult={kind:'schedule';options:LabScheduleOption[];selected:LabScheduleOption|null}
 |{kind:'conflict';sources:CoursePassage[]}|{kind:'unreadable';sourceId:string};

const mixedQuestion=/^(?:what|which) section of ([A-Z]{2,5})[ -]?(\d{4}L) am I enrolled in,? and where is (?:the|my) lab held\?(?: Use the saved Moodle evidence\.)?(?: If it only shows a combined lab course, distinguish the listed section options from verified personal enrollment\.)?(?: Cite the room\.)?$/i;
const outlineTitle=/(?:^|[^a-z0-9])(?:outline|syllabus|course information)(?:$|[^a-z0-9])/i;
const outlineUrl=/^https:\/\/moodle\.acadiau\.ca\/pluginfile\.php\/[1-9]\d{0,11}\/mod_(?:resource|folder)\/content\/\d{1,12}\/[^?#\s]+\.pdf$/i;
const tableHeader=/^Labs?\s*:/i;
const clock=String.raw`\d{1,2}:\d{2}(?:\s*[ap]\.?m\.?)?`;
const labTimeRoom=new RegExp('^'+clock+String.raw`\s*[−–—-]\s*`+clock+String.raw`\s*,\s*[A-Z]{2,8}\s+\d{2,4}[A-Z]?$`,'i');
const changes=/\blabs?\b[^.!?]{0,65}\b(?:cancelled|canceled|rescheduled|postponed|relocated|moved|instead|except|will not meet|will meet online)\b/i;
const unsafe=/\blocal OCR\b[^\r\n]*\bunreviewed\b|\b(?:ignore|override|disregard)\s+(?:(?:all|any|the)\s+)*(?:previous|prior|above|system|developer)\s+(?:instructions?|messages?|prompts?)\b|<\/?(?:system|assistant|developer)>/i;

export function labScheduleQuestion(question:string):string|null{
 const text=question.trim();
 if(text.length>320||/[\r\n]/.test(text))return null;
 const match=text.match(mixedQuestion);
 return match?(match[1]+' '+match[2]).toUpperCase():null;
}

export function labScheduleCourseCode(course:LabScheduleCourse):string|null{
 // A combined Moodle card can also mention its parent lecture in the title.
 // The lab identity here is the card's leading, separate code.
 return courseLabel(course).match(/^([A-Z]{2,5} \d{4}L)(?: · (?:FA|WI|SP|SU)\d{2}(?:-\d{2})?)?$/)?.[1]||null;
}

export function labScheduleEvidence(lab:LabScheduleCourse,section:string|null,rows:readonly LabScheduleSource[]):LabScheduleResult|null{
 const code=labScheduleCourseCode(lab);
 if(!code||!rows.length||new Set(rows.map(row=>row.id)).size!==rows.length)return null;
 const options=new Map<string,LabScheduleOption>();
 for(const row of rows){
  const lecture=courseCode(row.course.code)||courseCode(row.course.title||'');
  const lectureSection=lectureScheduleSection(row.course);
  if(!lecture||lecture.endsWith('L')||!lectureSection||row.course.id!==row.course_id||row.course_id===lab.id
   ||!row.version_id||row.current_version!==row.version_id||!outlineTitle.test(row.title)
   ||!row.original_url||!outlineUrl.test(row.original_url)||!Number.isFinite(Date.parse(row.observed_at))
   ||unverifiedForumSource({...row,excerpt:row.body}))return null;
  if(!row.complete||row.limitedPages?.includes(1)||!row.body.trim())return {kind:'unreadable',sourceId:row.id};
  if(row.body.length>150000||unsafe.test(row.body)||row.body.split(/\r?\n\s*\r?\n/).some(block=>changes.test(block.replace(/\s+/g,' '))))return null;
  const page=row.body.split(/\r?\n/);
  const next=page.findIndex((line,index)=>index>0&&/^Page \d+\s*$/.test(line));
  const pageOne=next<0?page:page.slice(0,next);
  if(pageOne[0]!=='Page 1'||courseCode(pageOne[1]||'')!==lecture
   ||lectureScheduleSection({id:row.course_id,code:pageOne[1]})!==lectureSection)return null;
  const headers=pageOne.map((line,index)=>tableHeader.test(line.trim())?index:-1).filter(index=>index>=0);
  if(headers.length!==1)return null;
  const start=headers[0]+1,tail=pageOne.slice(start);
  const end=tail.findIndex(line=>line.trim()&&!codedLabRow.test(line));
  const table=(end<0?tail:tail.slice(0,end)).flatMap((line,index)=>line.trim()?[{line,index:start+index}]:[]);
  // A malformed or second table must not leave just the first parsed section.
  const namedRows=page.filter(line=>{
   const prefix=line.trim().match(/^([A-Z]{2,5})\s*(\d{4}L)\b/i);
   return prefix&&(prefix[1]+' '+prefix[2]).toUpperCase()===code;
  });
  if(!table.length||table.length>8||namedRows.length!==table.length)return null;
  const body=pageOne.join('\n');
  const proposals=timetableSuggestions({...row,body,course_label:lecture,original_url:row.original_url});
  const sections=new Set<string>();
  for(const {line,index} of table){
   const association=associatedLabRow(line,body),prefix=line.match(codedLabRow)?.[0];
   if(!association||association.code!==code||!prefix||!labTimeRoom.test(line.slice(prefix.length).trim())||sections.has(association.section))return null;
   sections.add(association.section);
   const proposal=proposals.find(item=>item.kind==='lab'&&item.related_course_code===code&&item.section_label==='Section '+association.section
    &&item.source.start_line===index+1&&item.source.end_line===index+1&&item.source.unit==='Page 1');
   if(!proposal||proposal.weeks_need_review||!proposal.location||proposal.weekdays.length!==1
    ||proposal.weekdays[0]!==association.day||proposal.source.quote!==line.trim())return null;
   const option={section:association.section,weekday:association.day,start_time:proposal.start_time,end_time:proposal.end_time,location:proposal.location,source:proposal.source};
   const old=options.get(option.section);
   if(old&&(old.weekday!==option.weekday||old.start_time!==option.start_time||old.end_time!==option.end_time||old.location.toUpperCase()!==option.location.toUpperCase())){
    return {kind:'conflict',sources:[old.source,option.source]};
   }
   if(!old)options.set(option.section,option);
  }
 }
 return {kind:'schedule',options:[...options.values()],selected:section?options.get(section)||null:null};
}

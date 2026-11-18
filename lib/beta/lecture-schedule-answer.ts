import {courseCode} from './course-codes';
import type {CoursePassage} from './course-context';
import {unverifiedForumSource} from './source-authority';
import {timetableSuggestions} from './timetable';

export type LectureScheduleIntent={courseCode:string;section?:string};
type LectureCourse={id:string;code:string;title?:string};
export type LectureScheduleSource={
 id:string;version_id:string;course_id:string;title:string;body:string;observed_at:string;
 original_url:string|null;complete:boolean;untrusted?:boolean;limitedPages?:readonly number[];
};
type Schedule={kind:'schedule';weekdays:number[];start_time:string;end_time:string;location:string;source:CoursePassage};
export type LectureScheduleResult=Schedule|{kind:'conflict';sources:CoursePassage[]}|{kind:'unreadable';sourceId:string};

const mention=/\b([a-z]{2,5})[ -]?(\d{3,4})(?![a-z0-9])(?:\s+((?:fa|wi|sp|su)\d{2})(?![\d-]))?/gi;
const subject='(?:(?:my|the) )?(?:(?:regular|weekly) )?(?:§(?: (?:class|lecture))?|(?:class|lecture) (?:for|in|of) §)';
const regularQuestions=[
 '(?:when(?: and where)?|where) is '+subject,
 '(?:when(?: and where)?|where|what time) does '+subject+' meet',
 'what (?:time|day|days|room)(?: and (?:time|room))? (?:is|are) '+subject+'(?: in)?',
 'what (?:is|are) (?:the )?(?:regular )?(?:class |lecture )?(?:schedule|meeting times?|days,? times?,? and room|days and times?|time and location|time and room|room) for §',
];
const scheduleQuestion=new RegExp('^(?:'+regularQuestions.join('|')+')$','i');
const citedScheduleQuestion=/^according to the § course outline, on which days and at what time does the ((?:FA|WI|SP|SU)\d{2}) lecture meet, and what room is listed\? cite the outline\.?$/i;
const sectionHeader=/^[A-Z]{2,5}[ -]?\d{3,4}\s+((?:F[ \t]*A|W[ \t]*I|S[ \t]*[PU])[ \t]*\d{2})(?=$|[:\s])(?!(?:[ \t]*[-–—\/&]|[ \t]+(?:or|and)\s)\s*(?:(?:FA|WI|SP|SU)\s*)?\d)/i;
const titledOutline=/\b(?:syllabus|outline|course information|timetable|class schedule)\b|(?:^|[_-])outline[_-]/i;
const meetingHeading=/^(?:class|lecture) (?:meetings?|times?|schedules?)\s*:/i;
const day='(?:Sun(?:day)?s?|Mon(?:day)?s?|Tue(?:sday)?s?|Wed(?:nesday)?s?|Thu(?:rsday)?s?|Fri(?:day)?s?|Sat(?:urday)?s?)';
const days='(?:MWF|MW|M/W/F|T/TH|TU/TH|TTh|TuTh|'+day+'(?:(?:,\\s*(?:and\\s+)?|\\s*[/&]\\s*|\\s+and\\s+)'+day+'){0,6})';
const time=String.raw`\d{1,2}:\d{2}(?:\s*[ap]\.?m\.?)?`;
const room=String.raw`[A-Z][A-Za-z .-]{0,45}\s+\d{2,4}[A-Z]?`;
const meetingRow=new RegExp(meetingHeading.source+String.raw`\s*`+days+String.raw`\s+`+time+String.raw`\s*[−–—-]\s*`+time+String.raw`\s*,\s*`+room+'$','i');
const unsafe=/\blocal OCR\b[^\r\n]*\bunreviewed\b|\b(?:ignore|override|disregard)\s+(?:(?:all|any|the)\s+)*(?:previous|prior|above|system|developer)\s+(?:instructions?|messages?|prompts?)\b|<\/?(?:system|assistant|developer)>/i;
const meetingChange=/\b(?:class(?:es)?|lectures?)\b[^.!?]{0,65}\b(?:cancelled|canceled|rescheduled|postponed|relocated|moved|instead|except|does not meet|will not meet|will meet online|will be held online)\b|\b(?:cancelled|canceled|rescheduled|postponed|moved)\s+(?:the\s+)?(?:class|lecture)\b/i;
const noMeeting=/\bno\s+(?:class(?:es)?|lecture)\b/i;
const datedCalendarClosure=/^\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}\b[^\r\n]*\b(?:[A-Z]{3,9}\s+\d{1,2}|study break|holiday)\s+no classes\b/i;

export function lectureScheduleQuestion(question:string):LectureScheduleIntent|null{
 const text=question.trim().replace(/\?$/,'').replace(/[ \t]+/g,' ');
 if(text.length>180||/[\r\n]/.test(text)||text.includes('§'))return null;
 const mentions=[...text.matchAll(mention)];
 if(mentions.length!==1)return null;
 const [raw,department,number,section]=mentions[0];
 const shape=text.replace(raw,'§');
 const courseCode=(department+' '+number).toUpperCase();
 const citedSection=shape.match(citedScheduleQuestion)?.[1].toUpperCase();
 if(citedSection)return section&&section.toUpperCase()!==citedSection?null:{courseCode,section:citedSection};
 if(!scheduleQuestion.test(shape.replace(/^according to (?:the )?(?:saved )?(?:syllabus|course outline),? /i,'')))return null;
 return {courseCode,...(section?{section:section.toUpperCase()}:{})};
}

function sectionIn(value:string){
 const line=value.replace(/^\s*Course name[ \t]*\r?\n\s*/i,'').trimStart();
 const section=line.match(sectionHeader)?.[1].replace(/[ \t]/g,'').toUpperCase();
 return section&&/^(?:FA|WI|SP|SU)\d{2}$/.test(section)?section:null;
}
export function lectureScheduleSection(course:LectureCourse){
 const code=sectionIn(course.code),title=sectionIn(course.title||'');
 return code&&title&&code!==title?null:code||title;
}
export function lectureScheduleCourse(course:LectureCourse,intent:LectureScheduleIntent):'match'|'section_required'|'mismatch'{
 const code=courseCode(course.code),title=courseCode(course.title||'');
 if((code||title)!==intent.courseCode||code&&title&&code!==title)return 'mismatch';
 const section=lectureScheduleSection(course);
 if(!section)return 'section_required';
 return intent.section&&intent.section!==section?'mismatch':'match';
}

function originalMoodleOutline(row:LectureScheduleSource){
 if(!row.original_url||!titledOutline.test(row.title)||unverifiedForumSource({...row,excerpt:row.body}))return false;
 try{
  const url=new URL(row.original_url);
  return url.origin==='https://moodle.acadiau.ca'&&!url.username&&!url.password&&!url.search&&!url.hash
   &&/^\/pluginfile\.php\/[1-9]\d{0,11}\/mod_(?:resource|folder)\/content\/\d{1,12}\/.+\.pdf$/i.test(url.pathname);
 }catch{return false;}
}

export function lectureScheduleEvidence(intent:LectureScheduleIntent,course:LectureCourse,rows:readonly LectureScheduleSource[]):LectureScheduleResult|null{
 if(lectureScheduleCourse(course,intent)!=='match'||!rows.length)return null;
 if(new Set(rows.map(row=>row.id)).size!==rows.length)return null;
 const section=lectureScheduleSection(course);
 const schedules:Schedule[]=[];
 for(const row of rows){
  if(row.course_id!==course.id||!originalMoodleOutline(row)||!Number.isFinite(Date.parse(row.observed_at)))return null;
  if(!row.complete||row.limitedPages?.includes(1)||!row.body.trim())return {kind:'unreadable',sourceId:row.id};
  if(row.body.length>150000||unsafe.test(row.body))return null;
  const lines=row.body.split(/\r?\n/).map(line=>line.trim());
  if(lines[0]!=='Page 1')return null;
  const identity=lines.slice(1,8).filter(line=>sectionIn(line));
  if(identity.length!==1||courseCode(identity[0])!==intent.courseCode||sectionIn(identity[0])!==section)return null;
  if(row.body.split(/\r?\n\s*\r?\n/).some(block=>meetingChange.test(block.replace(/\s+/g,' ')))
   ||lines.some(line=>noMeeting.test(line)&&!datedCalendarClosure.test(line)))return null;
  const headings=lines.filter(line=>meetingHeading.test(line));
  const candidates=timetableSuggestions({...row,course_label:intent.courseCode,original_url:row.original_url||undefined}).filter(item=>item.kind==='class');
  if(headings.length!==1||candidates.length!==1)return null;
  const [{source,weekdays,start_time,end_time,location}]=candidates;
  const line=lines[source.start_line-1];
  if(source.unit!=='Page 1'||source.end_line!==source.start_line||!meetingRow.test(line)
   ||source.quote!==line||!location||!line.endsWith(location))return null;
  schedules.push({kind:'schedule',weekdays,start_time,end_time,location,source});
 }
 const unique=new Map<string,Schedule>();
 for(const schedule of schedules){
  const {weekdays,start_time,end_time,location}=schedule;
  const key=JSON.stringify([[...weekdays].sort(),start_time,end_time,location.toLowerCase()]);
  if(!unique.has(key))unique.set(key,schedule);
 }
 const candidates=[...unique.values()];
 if(candidates.length>1)return {kind:'conflict',sources:candidates.map(candidate=>candidate.source)};
 return candidates[0]||null;
}

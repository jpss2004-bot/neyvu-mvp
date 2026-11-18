import {courseLabel} from './course-label';
import {syllabusHeaderTimes,associatedLabRow} from './schedule-text';
import {createHash} from 'node:crypto';
import {tenant} from './db';
import {currentCourseSelection} from './course-selection';
import type {CoursePassage} from './course-context';

export type TimetableSuggestion={id:string;course_id:string;course_label:string;source:CoursePassage;supporting_sources?:CoursePassage[];kind:'class'|'lab'|'office_hours';section_label?:string;related_course_code?:string;weeks_need_review?:true;weeks_quote?:string;weekdays:number[];start_time:string;end_time:string;start_date:string;end_date:string;location:string;conflict:boolean;saved:boolean};
const heading=/\b(?:office\s+hours?|consultation\s+hours?|(?:class|lecture|lab|seminar|tutorial)\s+(?:timeslots?|times?|schedules?|meetings?|hours?)|(?:class|lectures?|lab|seminar|tutorial)\s*:|meeting times?|horario\s+(?:de\s+)?(?:clases?|laboratorio|consulta)|horas?\s+de\s+consulta)\b/i;
const dayNames=[/\b(?:sundays?|sun|domingo)\b/i,/\b(?:mondays?|mon|lunes)\b/i,/\b(?:tuesdays?|tue(?:s)?|martes)\b/i,/\b(?:wednesdays?|weds?|mi[eé]rcoles)\b/i,/\b(?:thursdays?|thu(?:rs)?|jueves)\b/i,/\b(?:fridays?|fri|viernes)\b/i,/\b(?:saturdays?|sat|s[aá]bado)\b/i];
const dayStart=/^\s*(?:[-*•]\s*)?(?:sundays?|sun|mondays?|mon|tuesdays?|tue(?:s)?|wednesdays?|weds?|thursdays?|thu(?:rs)?|fridays?|fri|saturdays?|sat|domingo|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado)\b/i;
const sectionBoundary=/\b(?:Instructor\s*:|Professor\s*:|E-mail\s*:|Online information\b|Meeting with your instructor\b|Prerequisites\s*:|Office(?: Location)?\s*:|Calendar description\s*:|Teaching Assistant\s*:|Course Description\b|Course Format\b|Course Overview\b|Required Materials\b|Learning Outcomes\b)/i;
function clock(hour:string,minute:string|undefined,meridian:string|undefined){let h=Number(hour),m=Number(minute||0);if(m>59||h>23)return null;if(meridian){if(h<1||h>12)return null;h=h%12+(/p/i.test(meridian)?12:0);}else if(!minute||h>0&&h<8&&!hour.startsWith('0'))return null;return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');}
// Only explicit, single recurring time ranges are prefilled. A suggestion is
// always reviewed by the student; it never becomes official Moodle evidence.
export function timetableSuggestions(row:{id:string;version_id:string;course_id:string;course_label:string;title:string;observed_at:string;body:string;original_url?:string}):TimetableSuggestion[]{
 // Calendar cards are dated occurrences; their text does not establish a weekly recurrence.
 if(/^https:\/\/moodle\.acadiau\.ca\/calendar\/view\.php(?:[?#]|$)/.test(row.original_url||''))return [];
 const lines=row.body.split(/\r?\n/),out:TimetableSuggestion[]=[],headers=syllabusHeaderTimes(row.body,row.title);let unit:string|null=null,officeUntil=-1;
 for(let i=0;i<lines.length;i++){
  if(/local OCR.*unreviewed/i.test(lines[i]))unit='Unreviewed OCR transcription';
  else if(/^(?:Page|Slide|Paragraph) \d+/i.test(lines[i]))unit=lines[i].trim();
  const header=headers.find(header=>header.start===i),labRow=associatedLabRow(lines[i],row.body);
  const explicitHeading=heading.test(lines[i])||!!header||!!labRow;
  if(explicitHeading)officeUntil=/office\s+hours|consultation|consulta/i.test(lines[i])?i+14:-1;
  else if(/^(?:#{1,4}\s|(?:course|section|class|lecture|lab|assessment|grading|assignment|reading|exam|evaluation)\b)/i.test(lines[i].trim()))officeUntil=-1;
  const inheritedOffice=!explicitHeading&&i<=officeUntil&&dayStart.test(lines[i]);
  if((!explicitHeading&&!inheritedOffice)||/unreviewed/i.test(unit||''))continue;
  let end=header?.end||i+1;while(!header&&!labRow&&end<Math.min(lines.length,i+6)&&lines[end].trim()&&!heading.test(lines[end])&&!/^(?:Page|Slide|Paragraph) \d+|^#{1,4}\s|^(?:assessment|grading|assignment|reading|exam|evaluation)\b/i.test(lines[end].trim())&&!sectionBoundary.test(lines[end]))end++;
  const block=lines.slice(i,end).join('\n'),stop=sectionBoundary.exec(block);
  // Native PDF text can place the class/room and a whole course description
  // on one line. Quote the exact preceding substring, never the OCR copy.
  const quote=(stop?block.slice(0,stop.index):block).trim();
  if(quote.length>1600||/\b(?:by appointment|appointment only|no\s+(?:(?:class|lecture|lab|seminar|tutorial)\b|office\s+hours|consultation\s+hours)|sin\s+(?:clases|consulta)|not\s+(?:held|available)|today|tomorrow|rescheduled|or|either|until|biweekly|every other|rotat\w*|alternat\w*|except|cancel\w*|this week|next week|one[- ]off|example|sample|tentative|por cita|solo esta semana|excepto|cancelad\w*)\b/i.test(quote))continue;
  if(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}\b|\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\b|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/i.test(quote))continue;
  const weekdays=dayNames.flatMap((pattern,index)=>pattern.test(quote)?[index]:[]);
  if(labRow)weekdays.push(labRow.day);
  if(!weekdays.length){const compact=quote.match(/\b(MWF|MW|M\/W\/F|T\/TH|TU\/TH|TTh|TuTh)\b/i);if(compact)weekdays.push(...(compact[1].toUpperCase().startsWith('M')?(/F/i.test(compact[1])?[1,3,5]:[1,3]):[2,4]));}
  if(!weekdays.length||/\b(?:Mon(?:day)?s?|Tue(?:sday)?s?|Wed(?:nesday)?s?|Thu(?:rsday)?s?|Fri(?:day)?s?|Sat(?:urday)?s?|Sun(?:day)?s?|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\s*(?:-|–|through|to|a)\s*(?:Mon(?:day)?s?|Tue(?:sday)?s?|Wed(?:nesday)?s?|Thu(?:rsday)?s?|Fri(?:day)?s?|Sat(?:urday)?s?|Sun(?:day)?s?|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/i.test(quote))continue;
  const ranges=[...quote.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?\s*(?:−|–|—|-|\bto\b|\ba\b)\s*(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?(?!\d)/gi)].filter(m=>m[2]||m[3]||m[5]||m[6]);
  if(ranges.length!==1)continue;const match=ranges[0];
  // A shared meridian is safe only within the same half-day (1–2 pm), not
  // across noon (11–1 pm). Both meridians must be explicit across noon.
  if(!match[3]&&match[6]&&Number(match[1])>Number(match[4]))continue;
  const start=clock(match[1],match[2],match[3]||match[6]),finish=clock(match[4],match[5],match[6]);if(!start||!finish||finish<=start)continue;
  if(/\b(?:UTC|GMT|EST|EDT|CST|CDT|MST|MDT|PST|PDT|ET|CT|MT|PT)\b/.test(quote))continue;
  const dates=[...quote.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map(m=>m[0]);
  const explicitTerm=/^(?:term(?: dates| starts| ends)?|semester(?: dates)?|course dates|teaching dates|semestre|per[ií]odo)\s*:/im.test(quote);
  if(dates.length&&(!explicitTerm||dates.length!==2))continue;
  const term=dates.length===2&&dates.every(d=>Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d)&&dates[1]>=dates[0]&&Date.parse(dates[1])-Date.parse(dates[0])<=370*86400000?dates:['',''];
  const kind=inheritedOffice||/office|consultation|consulta/i.test(lines[i])?'office_hours':labRow||/\blab\b|laboratorio/i.test(lines[i])?'lab':'class';
  const location=quote.match(/\b(?:(?:class|lecture|lab)\s+)?(?:room|location|classroom|aula|sal[oó]n)\s*:\s*([^\n]{1,180})$/im)?.[1].trim()||quote.match(/,\s*([A-Z][A-Za-z .-]{0,45}\s+\d{2,4}[A-Z]?)\s*$/m)?.[1].trim()||(header?quote.split('\n').find(line=>/^[A-Z]{2,8}\s+\d{2,4}[A-Z]?$/.test(line.trim()))?.trim():'')||'';
  const relatedCourse=labRow&&row.course_label.match(/^([A-Z]{2,5})\s*(\d{3,4}[A-Z]?)/i)?.slice(1).join(' ').toUpperCase()!==labRow.code;
  const section_label=labRow?.section||lines[i].match(/\bsection\s+([\w-]+)\s+(?:lab|class|lecture)\b/i)?.[1];
  // A timeslot identifies a section's clock time, not which weeks its members
  // attend. Keep an explicit alpha/beta or alternating-week condition visible.
  const weeks=kind==='lab'?lines.find(line=>/\balpha\s*\/\s*beta\s+split\b|\bwhich weeks\b.{0,80}\b(?:lab|attend)\b|\b(?:alternating|every other|biweekly)\b.{0,60}\b(?:lab|weeks?)\b|\b(?:lab|weeks?)\b.{0,60}\b(?:alternating|every other|biweekly)\b/i.test(line)):undefined;
  const source:CoursePassage={source_id:row.id,version_id:row.version_id,title:row.title,observed_at:row.observed_at,category:kind==='office_hours'?'office_hours':'schedule',quote,start_line:i+1,end_line:end,unit};
  const id=createHash('sha256').update(JSON.stringify([row.version_id,i,quote])).digest('hex');
  out.push({id,course_id:row.course_id,course_label:row.course_label,source,kind,...(section_label?{section_label:'Section '+section_label}:{}),...(relatedCourse&&labRow?{related_course_code:labRow.code}:{}),...(weeks?{weeks_need_review:true as const,...(weeks.trim().length<=600?{weeks_quote:weeks.trim()}:{})}:{}),weekdays,start_time:start,end_time:finish,start_date:term[0],end_date:term[1],location,conflict:false,saved:false});
  if(out.length>=12)break;
 }
 return out;
}
export type TimetableCoverage={course_id:string;course_label:string;matching_sources:number;scanned_sources:number;partial_sources:number;suggestions:number;shown_suggestions:number};
// Collapse only matching wording and schedule details, retaining every source pin.
// A later capture is the display source, not proof that it supersedes another document.
export function groupTimetableSuggestions(proposals:TimetableSuggestion[]):TimetableSuggestion[]{
 const groups=new Map<string,TimetableSuggestion>();
 for(const p of [...proposals].sort((a,b)=>b.source.observed_at.localeCompare(a.source.observed_at)||a.id.localeCompare(b.id))){
  const key=JSON.stringify([p.course_id,p.kind,p.section_label||'',p.related_course_code||'',p.weeks_need_review||false,p.weeks_quote||'',[...p.weekdays].sort(),p.start_time,p.end_time,p.start_date,p.end_date,p.location,p.source.quote.replace(/\s+/g,' ').trim()]);
  const prior=groups.get(key);
  if(!prior){groups.set(key,{...p,supporting_sources:[]});continue;}
  prior.conflict ||= p.conflict;prior.saved ||= p.saved;
  if(prior.source.source_id!==p.source.source_id||prior.source.version_id!==p.source.version_id||prior.source.start_line!==p.source.start_line)prior.supporting_sources!.push(p.source);
 }
 return [...groups.values()];
}
// One course's documents or suggestions must not consume the entire shared bound.
export function fairTimetableLimit<T extends {course_id:string}>(items:T[],limit:number):T[]{
 const buckets=new Map<string,T[]>();for(const item of items){const bucket=buckets.get(item.course_id)||[];bucket.push(item);buckets.set(item.course_id,bucket);}
 const result:T[]=[];for(let i=0;result.length<limit;i++){let found=false;for(const bucket of buckets.values()){if(bucket[i]){result.push(bucket[i]);found=true;if(result.length===limit)break;}}if(!found)break;}return result;
}
export async function betaTimetableSuggestions(user:string){
 return tenant(user,async c=>{
  const selection=await currentCourseSelection(c,user);
  const courses=(await c.query('SELECT id,code,moodle_id FROM schoolvault.courses WHERE user_id=$1 ORDER BY code',[user])).rows.filter(row=>row.moodle_id==null||selection.confirmed&&selection.moodle_ids.includes(row.moodle_id));
  if(!courses.length)return {suggestions:[],truncated:false,current_courses:0,coverage:[]};
  const timetableTitle="s.title ~* '(syllabus|outline|course information)'";
  const candidates="FROM schoolvault.sources s JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.source_id=s.id AND v.id=s.current_version WHERE s.user_id=$1 AND s.course_id=ANY($2::uuid[]) AND s.kind IN('moodle','file') AND (v.body ~* '(hours|schedule|meeting|class|lecture|lab|seminar|tutorial|horario|consulta)' OR "+timetableTitle+")";
  const params=[user,courses.map(row=>row.id)];
  const counts=(await c.query('SELECT s.course_id,count(*) AS total '+candidates+' GROUP BY s.course_id',params)).rows;
  const rows=(await c.query("WITH ranked AS (SELECT s.id,s.course_id,s.title,s.original_url,v.id AS version_id,v.observed_at,left(v.body,150000) AS body,length(v.body)>150000 AS partial,row_number() OVER(PARTITION BY s.course_id ORDER BY ("+timetableTitle+") DESC,(s.kind='file') DESC,v.observed_at DESC,s.id) AS scan_rank "+candidates+") SELECT * FROM ranked ORDER BY scan_rank,course_id LIMIT 121",params)).rows;
  const scanned=rows.slice(0,120);
  const proposals=scanned.flatMap(row=>timetableSuggestions({...row,course_label:courseLabel(courses.find(course=>course.id===row.course_id)),observed_at:new Date(row.observed_at).toISOString()}));
  const meetings=(await c.query('SELECT course_id,source_id,schedule FROM schoolvault.meetings WHERE user_id=$1',[user])).rows;
  const signature=(p:{weekdays:number[];start_time:string;end_time:string;start_date:string;end_date:string;location:string})=>JSON.stringify([[...p.weekdays].sort(),p.start_time,p.end_time,p.start_date,p.end_date,p.location]);
  for(const p of proposals){p.conflict=proposals.some(other=>other.course_id===p.course_id&&other.kind===p.kind&&other.section_label===p.section_label&&p.weekdays.some(day=>other.weekdays.includes(day))&&signature(p)!==signature(other));p.saved=meetings.some(m=>m.course_id===p.course_id&&m.source_id===p.source.source_id&&m.schedule.version_id===p.source.version_id&&m.schedule.kind===p.kind&&m.schedule.active!==false&&JSON.stringify([[...p.weekdays].sort(),p.start_time,p.end_time,p.location])===JSON.stringify([[...(m.schedule.weekdays||[])].sort(),m.schedule.start_time,m.schedule.end_time,m.schedule.location])&&(p.start_date===''||p.start_date===m.schedule.start_date&&p.end_date===m.schedule.end_date));}
  const grouped=groupTimetableSuggestions(proposals),suggestions=fairTimetableLimit(grouped,60);
  const coverage:TimetableCoverage[]=courses.map(course=>({course_id:course.id,course_label:courseLabel(course),matching_sources:Number(counts.find(row=>row.course_id===course.id)?.total||0),scanned_sources:scanned.filter(row=>row.course_id===course.id).length,partial_sources:scanned.filter(row=>row.course_id===course.id&&row.partial).length,suggestions:grouped.filter(p=>p.course_id===course.id).length,shown_suggestions:suggestions.filter(p=>p.course_id===course.id).length}));
  return {suggestions,truncated:rows.length>120||grouped.length>60||scanned.some(row=>row.partial),current_courses:courses.length,coverage};
 });
}

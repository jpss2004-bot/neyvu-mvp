import type {SchoolData} from './data';
import type {Source} from './pilot';
import {canonicalTasks} from './tasks';
import {planningWindow} from './replies';
export const CAMPUS_ZONE='America/Halifax';
export type CalendarEvidence=Source&{path?:string;sha256?:string;authority?:string;reviewed_at?:string;version_matches?:boolean};
export type Meeting={id:string;course:string;title:string;kind:'class'|'lab';weekdays:number[];start_time:string;end_time:string;start_date:string;end_date:string;location:string;sources:CalendarEvidence[];note?:string};
export type CalendarSchedule={version:number;timezone:string;reviewed_at:string;classes:Meeting[];holidays:{date:string;title:string;sources:CalendarEvidence[]}[];issues:string[];scope:string;error?:string};
export type CalendarEvent={id:string;date:string;title:string;course:string;kind:'class'|'lab'|'deadline'|'plan'|'holiday'|'course_date';start_time?:string;end_time?:string;instant?:string;all_day:boolean;location?:string;status?:string;submitted?:boolean;conflict?:boolean;note?:string;sources:CalendarEvidence[]};
export function calendarTitle(event:Pick<CalendarEvent,'course'|'title'>){const title=event.course&&event.title.startsWith(event.course)?event.title.slice(event.course.length).replace(/^\s*[·:—-]?\s*/,''):event.title;return event.course?event.course+' · '+title:title;}
export function campusDate(now:number|Date=Date.now()) {return new Intl.DateTimeFormat('en-CA',{timeZone:CAMPUS_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
export function addDays(date:string,n:number){return new Date(Date.parse(date+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);}
export function weekday(date:string){return new Date(date+'T12:00:00Z').getUTCDay();}
export function weekStart(date:string){return addDays(date,-((weekday(date)+6)%7));}
export function campusTime(now:number|Date){return new Intl.DateTimeFormat('en-CA',{timeZone:CAMPUS_ZONE,hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(now);}
export function wallInstant(date:string,time:string){
 const desired=Date.parse(date+'T'+time+':00Z');let guess=desired;
 for(let i=0;i<2;i++){
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:CAMPUS_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(guess).map(v=>[v.type,v.value]));
  const actual=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute);guess+=desired-actual;
 }return new Date(guess).toISOString();
}
function validDate(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;}
function taskDate(value:string|null){if(!value)return null;return validDate(value)?value:Number.isFinite(Date.parse(value))?campusDate(Date.parse(value)):null;}
export function calendarEvents(school:SchoolData,schedule:CalendarSchedule,start:string,end:string,course=''):CalendarEvent[]{
 const events:CalendarEvent[]=[];const inside=(date:string)=>date>=start&&date<=end;
 const holidays=new Set(schedule.holidays.map(h=>h.date));
 for(let date=start;date<=end;date=addDays(date,1)){
  const holiday=schedule.holidays.find(h=>h.date===date);
  if(holiday)events.push({id:'holiday:'+date,date,title:holiday.title,course:'',kind:'holiday',all_day:true,sources:holiday.sources});
  if(holidays.has(date))continue;
  for(const m of schedule.classes){
   if(course&&course!==m.course||date<m.start_date||date>m.end_date||!m.weekdays.includes(weekday(date)))continue;
   events.push({id:m.id+':'+date,date,title:m.title,course:m.course,kind:m.kind,start_time:m.start_time,end_time:m.end_time,instant:wallInstant(date,m.start_time),all_day:false,location:m.location,note:m.note,conflict:m.sources.some(s=>s.version_matches===false),sources:m.sources});
  }
 }
 for(const t of canonicalTasks(school.tasks)){
  const date=taskDate(t.due);if(!date||!inside(date)||t.due_authority!=='Moodle'||course&&course!==t.course)continue;
  const all_day=validDate(t.due!);
  const coursePage=t.official_url.includes('/course/view.php');
  events.push({id:'due:'+t.course+':'+t.official_url,date,title:t.title,course:t.course,kind:coursePage?'course_date':'deadline',instant:all_day?undefined:new Date(t.due!).toISOString(),all_day,status:t.label,submitted:t.confirmed_submitted,conflict:t.conflict,note:coursePage?'This saved date is linked to a course page. Verify the individual activity; it may overlap an assignment or preparation task.':t.next_action,sources:[{id:t.id,title:coursePage?'Moodle course page · saved date':'Moodle activity · saved deadline and status',course:t.course,url:t.official_url,observed_at:t.receipt_checked,authority:'Moodle'}]});
 }
 const plans=new Set<string>();
 for(const t of school.tasks){
  if(t.source_id!=='notion'||course&&course!==t.course)continue;
  for(const [raw,label] of [[t.do_on,'Personal Do on'],[t.planned_due||(t.due_authority!=='Moodle'?t.due:null),'Personal planned date']] as const){
   const date=taskDate(raw);const key=t.id.replaceAll('-','')+':'+date;if(!date||!inside(date)||plans.has(key))continue;plans.add(key);
   events.push({id:'plan:'+key,date,title:t.title,course:t.course,kind:'plan',all_day:validDate(raw!),instant:validDate(raw!)?undefined:new Date(raw!).toISOString(),status:t.working_status,submitted:t.confirmed_submitted,conflict:t.conflict,note:label+'. '+t.next_action,sources:[{id:t.id,title:'Notion working plan',course:t.course,url:'https://app.notion.com/p/'+t.id.replaceAll('-',''),authority:'Notion'}]});
  }
 }
 return events.sort((a,b)=>a.date.localeCompare(b.date)||(a.all_day!==b.all_day?(a.all_day?-1:1):!a.all_day?Date.parse(a.instant!)-Date.parse(b.instant!):0)||a.title.localeCompare(b.title));
}
export function normalizeQuestion(question:string){return question.replace(/\b(?:tomorow|tommorow|tommorrow|tommorrows?|tomorrow['’]?s?|tommors?)\b/gi,'tomorrow').replace(/\btodays?\b/gi,'today');}
export function questionDates(question:string,now:number){
 const q=normalizeQuestion(question),today=campusDate(now),iso=/\b20\d\d-\d\d-\d\d\b/.exec(q)?.[0];
 if(iso&&validDate(iso))return {start:iso,end:iso,label:iso};
 const months=['january','february','march','april','may','june','july','august','september','october','november','december'];
 const month=/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d\d))?\b/i.exec(q);
 if(month){const n=months.findIndex(m=>m.startsWith(month[1].toLowerCase())),date=(month[3]||today.slice(0,4))+'-'+String(n+1).padStart(2,'0')+'-'+month[2].padStart(2,'0');if(validDate(date))return {start:date,end:date,label:date};}
 const names=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'],day=/\b(on|for|this|next)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.exec(q);
 if(day){const target=names.indexOf(day[2].toLowerCase()),date=day[1].toLowerCase()==='next'?addDays(weekStart(today),7+(target+6)%7):addDays(today,(target-weekday(today)+7)%7);return {start:date,end:date,label:date};}
 const w=planningWindow(q,now);return {start:new Date(w.start*86400000).toISOString().slice(0,10),end:new Date(w.end*86400000).toISOString().slice(0,10),label:w.label};
}
export function calendarContextSources(school:SchoolData,schedule:CalendarSchedule,question:string,course:string,now=Date.now()):Source[]{
 const q=normalizeQuestion(question);if(!/today|tomorrow|class(?:es)?|schedule|\b20\d\d-\d\d-\d\d\b/i.test(q))return [];
 const {start,end}=questionDates(q,now);
 return calendarEvents(school,schedule,start,end,course).filter(e=>e.kind!=='plan').slice(0,6).map(e=>({id:e.id,title:'Calendar · '+e.title,course:e.course,url:e.sources[0]?.url,observed_at:e.sources[0]?.observed_at,kind:'calendar',excerpt:JSON.stringify({date:e.date,timezone:CAMPUS_ZONE,kind:e.kind,time:e.start_time||e.instant||'Time not specified',end_time:e.end_time,location:e.location,note:e.note,status:e.status,interpretation:'Reviewed recurrence for classes; saved official evidence for deadlines. No attendance or submission inferred.',sources:e.sources.map(s=>({title:s.title,authority:s.authority,version_matches:s.version_matches,reviewed_at:s.reviewed_at}))})}));
}
export function isCalendarQuestion(question:string){const q=normalizeQuestion(question);return /\b(calendar|timetable|schedule)\b|(?:what|which|when).*(?:classes|class do I|class is|class starts|day is it|time is it)|(?:when|what time|what day|which day).*\bclass\b|(?:today|tomorrow|week).*(?:classes|schedule)|\bclass(?:es)?\b.*(?:today|tomorrow|week)|(?:priority|priorities|plan|need.*do).*(?:today|tomorrow|week)|(?:today|tomorrow|week).*(?:priority|priorities|plan)/i.test(q)&&!/(print|bring|read|watch|explain|solve|summari[sz]e)/i.test(q);}
export function calendarAnswer(school:SchoolData,schedule:CalendarSchedule,question:string,course:string,now=Date.now()){
 const q=normalizeQuestion(question),sources:Source[]=[];
 if(/what (?:day|time) is it|current (?:date|time)|what is (?:today|the date)/i.test(q))return {content:new Intl.DateTimeFormat('en-CA',{timeZone:CAMPUS_ZONE,dateStyle:'full',timeStyle:'short'}).format(now)+' (Halifax campus time).',sources,mode:'Calendar · campus clock'};
 const w=questionDates(q,now),{start,end}=w;
 const events=calendarEvents(school,schedule,start,end,course);
 const priority=/priority|priorities|plan|need.*do/i.test(q);
 const filtered=events.filter(e=>priority?(e.kind==='deadline'&&!e.submitted&&(!e.instant||Date.parse(e.instant)>=now))||(e.kind==='plan'&&!e.submitted&&!/^(?:done|completed|submitted|graded|finished)$/i.test(e.status||'')):e.kind==='class'||e.kind==='lab'||e.kind==='holiday');
 if(priority)filtered.sort((a,b)=>(a.kind==='deadline'?0:1)-(b.kind==='deadline'?0:1)||a.date.localeCompare(b.date)||(a.instant||'').localeCompare(b.instant||''));
 const rows=filtered.map(e=>{
  const refs=e.sources.map(s=>{sources.push(s);return `[${sources.length}]`;}).join(' ');
  const at=e.instant?new Intl.DateTimeFormat('en-CA',{timeZone:CAMPUS_ZONE,month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(Date.parse(e.instant)):e.date;
  const when=at+(e.end_time?'–'+campusTime(Date.parse(wallInstant(e.date,e.end_time))).replace(/\s(?:ADT|AST)$/,''):'')+(e.location?', '+e.location:'');
  return `- **${calendarTitle(e)}** — ${when.replace(/\.$/,'')}. ${e.kind==='deadline'?'Official deadline; '+(e.status||'status unverified'):e.kind==='plan'?'Personal plan':e.kind==='lab'?'Lab':e.kind==='class'?'Class':'No regular meetings'}. ${refs}`;
 });
 const main=priority&&/main priority|top priority|first priority|most important/i.test(q),shown=main?1:3;
 return {content:`### ${main?'Main priority':priority?'Priorities':'Schedule'} ${w.label}\n\n`+(rows.length?rows.slice(0,shown).join('\n'):priority?'No dated unfinished official deadline or personal work date is established in this scope.':'No regular class meeting is recorded in this scope.'),details:rows.slice(shown).join('\n'),detailsLabel:priority?'Other dated work':'Remaining calendar entries',caution:priority?'Dates and statuses come from saved evidence. A deadline does not prove submission.':schedule.error||'Classes use the reviewed vault timetable and Registrar no-class dates. One-off cancellations and preparation requirements still need their current source.',sources,mode:'Calendar · vault evidence',expandDetails:/\ball\b/i.test(q)};
}

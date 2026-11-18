import type {ForumParticipation} from './participation-format';
import type {ReceiptView} from './moodle-receipts';
// Pure calendar helpers for the beta. No database access; safe in server and browser code.
export const CAMPUS_ZONE='America/Halifax';
const isDate=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
const isClock=(v:unknown):v is string=>typeof v==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const label=(v:unknown,max=180)=>typeof v==='string'?v.trim().slice(0,max):'';
function parts(instant:number|Date,zone:string){
 return Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(instant).map(p=>[p.type,p.value]));
}
export function zoneDate(instant:number|Date,zone=CAMPUS_ZONE){const p=parts(instant,zone);return p.year+'-'+p.month+'-'+p.day;}
export function zoneClock(instant:number|Date,zone=CAMPUS_ZONE){const p=parts(instant,zone);return p.hour+':'+p.minute;}
export function addDays(date:string,n:number){return new Date(Date.parse(date+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);}
export function weekday(date:string){return new Date(date+'T12:00:00Z').getUTCDay();}
// Weeks start on Monday.
export function weekStart(date:string){return addDays(date,-((weekday(date)+6)%7));}
// Wall-clock date and time in a zone, as an exact instant.
export function zoneInstant(date:string,time:string,zone=CAMPUS_ZONE){
 if(!isDate(date)||!isClock(time))throw Error('Invalid date or time');
 const desired=Date.parse(date+'T'+time+':00Z');let guess=desired;
 for(let i=0;i<3;i++){const p=parts(guess,zone);guess+=desired-Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute);}
 if(zoneDate(guess,zone)!==date||zoneClock(guess,zone)!==time)throw Error('This local time does not exist');
 return new Date(guess).toISOString();
}
export type BetaTask={id:string;course_id:string;source_id:string;evidence:{title?:unknown;kind?:unknown;due_at?:unknown;due_date?:unknown;authority?:unknown;authority_state?:unknown;note?:unknown;active?:unknown;requirement?:unknown;version_id?:unknown;activity_url?:unknown;forum_participation?:ForumParticipation;receipt?:ReceiptView|null}|null};
export type BetaMeeting={id:string;course_id:string;source_id:string;schedule:{title?:unknown;kind?:unknown;weekdays?:unknown;start_time?:unknown;end_time?:unknown;start_date?:unknown;end_date?:unknown;location?:unknown;authority?:unknown;excluded_dates?:unknown;active?:unknown;version_id?:unknown}|null};
export type AgendaItem={id:string;date:string;time:string;end_time?:string;kind:'class'|'lab'|'office_hours'|'deadline'|'assessment';title:string;course_id:string;source_id:string;location?:string;authority?:string;note?:string;version_id?:string};
const dueInstant=(t:BetaTask)=>typeof t.evidence?.due_at==='string'?Date.parse(t.evidence.due_at):NaN;
// Classes and dated deadlines between two campus dates (inclusive). Malformed records are skipped,
// and a deadline is only a date: it never says whether work was submitted.
export function agenda(tasks:BetaTask[],meetings:BetaMeeting[],start:string,end:string,zone=CAMPUS_ZONE):AgendaItem[]{
 const items:AgendaItem[]=[];
 if(!isDate(start)||!isDate(end)||start>end||Date.parse(end)-Date.parse(start)>370*86400000)return items;
 for(const m of meetings){
  const s=m.schedule;if(!s||s.active===false)continue;
  const days=Array.isArray(s.weekdays)?s.weekdays.filter((d):d is number=>Number.isInteger(d)&&d>=0&&d<=6):[];
  const excluded=new Set(Array.isArray(s.excluded_dates)?s.excluded_dates.filter(isDate):[]);
  if(!days.length||!isClock(s.start_time)||!isClock(s.end_time)||!isDate(s.start_date)||!isDate(s.end_date)||!label(s.title))continue;
  for(let date=start>s.start_date?start:s.start_date;date<=end&&date<=s.end_date;date=addDays(date,1))
   if(days.includes(weekday(date))&&!excluded.has(date))items.push({id:m.id+':'+date,date,time:s.start_time,end_time:s.end_time,kind:s.kind==='office_hours'?'office_hours':s.kind==='lab'?'lab':'class',title:label(s.title),course_id:m.course_id,source_id:m.source_id,location:label(s.location)||undefined,authority:label(s.authority)||undefined,version_id:typeof s.version_id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s.version_id)?s.version_id:undefined});
 }
 for(const t of tasks){
  if(t.evidence?.active===false||t.evidence?.authority_state==='unverified_forum')continue;
  const due=dueInstant(t),dateOnly=isDate(t.evidence?.due_date)?t.evidence.due_date:null;if((!Number.isFinite(due)&&!dateOnly)||!label(t.evidence?.title))continue;
  const date=Number.isFinite(due)?zoneDate(due,zone):dateOnly!;if(date<start||date>end)continue;
  items.push({id:t.id,date,time:Number.isFinite(due)?zoneClock(due,zone):'',kind:'deadline',title:label(t.evidence?.title),course_id:t.course_id,source_id:t.source_id,authority:label(t.evidence?.authority)||undefined,note:label(t.evidence?.note,300)||undefined,version_id:typeof t.evidence?.version_id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(t.evidence.version_id)?t.evidence.version_id:undefined});
 }
 return items.sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time)||a.title.localeCompare(b.title));
}
// Missing dates stay unknown rather than being guessed.
export function undatedTasks(tasks:BetaTask[]){return tasks.filter(t=>t.evidence?.active!==false&&!Number.isFinite(dueInstant(t))&&!isDate(t.evidence?.due_date)&&label(t.evidence?.title));}

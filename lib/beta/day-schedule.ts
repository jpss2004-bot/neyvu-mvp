import {agenda,addDays,zoneDate,zoneInstant,type AgendaItem,type BetaMeeting} from './agenda';
export type DayMeeting=AgendaItem&{phase:'current'|'upcoming'|'ended';starts_at:string;ends_at:string};
// Confirmed saved recurrences only. Detection/suggestions never enter this view.
// Personal course/section confirmations are not fresh enrollment or cancellation checks.
export function daySchedule(meetings:BetaMeeting[],courseIds:string[],now:Date,zone:string){
 const today=zoneDate(now,zone),through=addDays(today,6),at=now.getTime(),courses=new Set(courseIds);
 const items=agenda([],meetings.filter(m=>courses.has(m.course_id)),today,through,zone).flatMap(item=>{
  try{const starts_at=zoneInstant(item.date,item.time,zone),ends_at=zoneInstant(item.date,item.end_time!,zone);if(ends_at<=starts_at)return [];return [{...item,starts_at,ends_at,phase:at>=Date.parse(ends_at)?'ended':at>=Date.parse(starts_at)?'current':'upcoming'} as DayMeeting];}catch{return [];}
 });
 const classes=items.filter(i=>i.kind==='class'||i.kind==='lab'),current=classes.filter(i=>i.phase==='current'),next=classes.find(i=>i.phase==='upcoming')||null;
 return {today,through,current,next,classesToday:classes.filter(i=>i.date===today),officeHours:items.filter(i=>i.kind==='office_hours'&&i.date===today)};
}

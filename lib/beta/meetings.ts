import {sourceVersion,ownedBetaCourse} from './vault';import {checkObjects} from './budget';
import {randomUUID,createHash} from 'node:crypto';import {tenant,uuid} from './db';import {lockVault,checkHistory} from './budget';import {zoneInstant} from './agenda';import {BetaHttpError} from './http';
export async function createMeeting(user:string,sourceId:unknown,s:any){
 if(!s||s.expected_version_id!==undefined&&!uuid(s.expected_version_id)||s.request_id!==undefined&&!uuid(s.request_id)||(!uuid(sourceId)&&!(sourceId===null&&uuid(s.manual_course_id)))||s.confirmed!==true||typeof s.title!=='string'||!s.title.trim()||s.title.length>180||typeof s.location!=='string'||s.location.length>180||!Array.isArray(s.weekdays)||!s.weekdays.length||s.weekdays.length>7||s.weekdays.some((d:any)=>!Number.isInteger(d)||d<0||d>6)||!['class','lab','office_hours'].includes(s.kind))throw new BetaHttpError('Enter and confirm the complete class schedule.');
 zoneInstant(s.start_date,s.start_time);zoneInstant(s.end_date,s.end_time);if(s.end_date<s.start_date||Date.parse(s.end_date)-Date.parse(s.start_date)>370*86400000||s.end_time<=s.start_time)throw new BetaHttpError('Choose a valid term range and meeting time.');
 const excluded=s.excluded_dates??[];
 if(!Array.isArray(excluded)||excluded.length>80)throw new BetaHttpError('Enter at most 80 no-class dates.');
 for(const date of excluded){try{zoneInstant(date,'12:00');}catch{throw new BetaHttpError('Enter valid no-class dates.');}if(date<s.start_date||date>s.end_date)throw new BetaHttpError('No-class dates must fall within this term.');}
 return tenant(user,async c=>{
  await lockVault(c,user);
  const binding=createHash('sha256').update(JSON.stringify({source_id:sourceId,...(s.expected_version_id?{expected_version_id:s.expected_version_id}:{}),manual_course_id:sourceId===null?s.manual_course_id:null,title:s.title.trim(),location:s.location.trim(),kind:s.kind,weekdays:[...new Set(s.weekdays)].sort(),excluded_dates:[...new Set(excluded)].sort(),start_date:s.start_date,end_date:s.end_date,start_time:s.start_time,end_time:s.end_time})).digest('hex');
  if(s.request_id){const previous=(await c.query("SELECT id,schedule FROM schoolvault.meetings WHERE user_id=$1 AND schedule->>'request_id'=$2",[user,s.request_id])).rows[0];if(previous){if(previous.schedule.request_binding!==binding)throw new BetaHttpError('This schedule request already saved different entries. Reload before changing them.');return {id:previous.id,...previous.schedule};}}

  if(Number((await c.query('SELECT count(*) FROM schoolvault.meetings WHERE user_id=$1',[user])).rows[0].count)>=200)throw new BetaHttpError('Your saved meeting limit has been reached.');
  if(sourceId===null){
   await ownedBetaCourse(c,user,s.manual_course_id);await checkObjects(c,user,'sources');sourceId=randomUUID();
   await c.query("INSERT INTO schoolvault.sources(user_id,id,course_id,kind,title) VALUES($1,$2,$3,'note',$4)",[user,sourceId,s.manual_course_id,'Student-confirmed timetable: '+s.title.trim()]);
   await sourceVersion(c,user,String(sourceId),['# '+s.title.trim(),'Student-entered timetable, not an official Moodle schedule.','Meeting type: '+(s.kind==='office_hours'?'Office hours':s.kind==='lab'?'Lab':'Class'),'Days: '+[...new Set<number>(s.weekdays)].sort().map(day=>['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][day]).join(', '),'Time: '+s.start_time+'–'+s.end_time+' (Halifax)','Term: '+s.start_date+' through '+s.end_date,'Room: '+(s.location.trim()||'Not stated'),'No-class dates: '+(excluded.join(', ')||'None entered')].join('\n'));
  }
  const source=(await c.query('SELECT id,course_id,current_version FROM schoolvault.sources WHERE user_id=$1 AND id=$2',[user,sourceId])).rows[0];if(!source)throw new BetaHttpError('Choose a source from your own vault.');
  if(s.expected_version_id&&s.expected_version_id!==source.current_version)throw new BetaHttpError('The timetable source changed. Reload the suggestions and review the current version.',409);
  const schedule={title:s.title.trim(),location:s.location.trim(),kind:s.kind,weekdays:[...new Set(s.weekdays)],excluded_dates:[...new Set(excluded)],start_date:s.start_date,end_date:s.end_date,start_time:s.start_time,end_time:s.end_time,authority:'Student-confirmed schedule',...(s.request_id?{request_id:s.request_id,request_binding:binding}:{}),version_id:source.current_version,confirmed_at:new Date().toISOString()};const id=randomUUID();
  await c.query('INSERT INTO schoolvault.meetings(user_id,id,course_id,source_id,schedule) VALUES($1,$2,$3,$4,$5)',[user,id,source.course_id,source.id,schedule]);await checkHistory(c,user);return {id,...schedule};
 });
}

export async function setMeetingActive(user:string,meetingId:unknown,active:unknown){
 if(!uuid(meetingId)||typeof active!=='boolean')throw new BetaHttpError('Choose a saved class schedule.');
 return tenant(user,async c=>{await lockVault(c,user);const row=(await c.query("UPDATE schoolvault.meetings SET schedule=jsonb_set(schedule,'{active}',$3::jsonb) WHERE user_id=$1 AND id=$2 RETURNING id,schedule",[user,meetingId,JSON.stringify(active)])).rows[0];if(!row)throw new BetaHttpError('Class schedule not found.',404);await checkHistory(c,user);return row;});
}

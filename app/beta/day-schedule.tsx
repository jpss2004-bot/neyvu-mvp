'use client';
import './day-schedule.css';
import {useI18n} from './language';
import {daySchedule,type DayMeeting} from '../../lib/beta/day-schedule';
import type {BetaMeeting} from '../../lib/beta/agenda';
export default function DaySchedule({meetings,courseIds,now,zone,courseLabel,onOpen,onVersion}:{meetings:BetaMeeting[];courseIds:string[];now:Date|null;zone:string;courseLabel:(id:string)=>string;onOpen:(id:string)=>void;onVersion?:(ref:{source_id:string;version_id:string})=>void}){
 const {t,locale}=useI18n();
 if(!now)return <p role="status">{t('Loading your local date…')}</p>;
 const view=daySchedule(meetings,courseIds,now,zone),focus=view.current.length?view.current:view.next?[view.next]:[];
 const clock=(s:string)=>new Intl.DateTimeFormat(locale,{timeZone:'UTC',hour:'numeric',minute:'2-digit'}).format(new Date('2000-01-01T'+s+':00Z'));
 const timing=(item:DayMeeting)=>clock(item.time)+'–'+clock(item.end_time!);
 const date=(item:DayMeeting)=>item.date===view.today?t('Today'):new Intl.DateTimeFormat(locale,{timeZone:'UTC',weekday:'long',month:'short',day:'numeric'}).format(new Date(item.date+'T12:00:00Z'));
 const kind=(item:DayMeeting)=>t(item.kind==='office_hours'?'Office hours':item.kind==='lab'?'Lab':'Class');
 const open=(item:DayMeeting)=>{if(item.version_id&&onVersion)onVersion({source_id:item.source_id,version_id:item.version_id});else onOpen(item.source_id);};
 function row(item:DayMeeting){return <li key={item.id}><button type="button" onClick={()=>open(item)}><span className="nu-day-meeting-time">{timing(item)}</span><span><strong>{courseLabel(item.course_id)} · {item.title}</strong><small>{kind(item)}{item.location?' · '+item.location:''}</small><small className="nu-day-meeting-phase">{t(item.phase==='current'?'Happening now':item.phase==='ended'?'Ended':'Upcoming')}</small></span></button></li>;}
 return <div className="nu-day-schedule">
  <section className="nu-next-class" aria-label={t(view.current.length?'Class now':'Next class')}><h3>{t(view.current.length?'Class now':'Next class')}</h3>{focus.length?focus.map(item=><div key={item.id}><p className="nu-next-class-time">{date(item)} · {timing(item)}</p><strong>{courseLabel(item.course_id)} · {item.title}</strong><p>{kind(item)}{item.location?' · '+item.location:''}</p><button type="button" onClick={()=>open(item)}>{t('Review saved timetable')}</button></div>):<p>{t('No class or lab is saved in the next seven days. Check your timetable and source coverage before assuming you have no classes.')}</p>}{view.current.length>1&&<p role="status">{t('Class times overlap. Check your section and saved timetable.')}</p>}</section>
  {view.classesToday.length>0&&<details className="nu-day-class-list"><summary>{t('Today’s classes and labs')} <span>{view.classesToday.length}</span></summary><ul>{view.classesToday.map(row)}</ul></details>}
  {view.officeHours.length>0&&<details className="nu-day-class-list"><summary>{t('Optional office hours')} <span>{view.officeHours.length}</span></summary><p>{t('Check the saved conditions or appointment requirements before attending.')}</p><ul>{view.officeHours.map(row)}</ul></details>}
  <p className="nu-day-schedule-scope">{t('From saved confirmed times. Later cancellations, room changes and section conflicts still need checking.')}</p>
 </div>;
}

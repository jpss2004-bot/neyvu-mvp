'use client';

import {useEffect,useState,type ComponentProps} from 'react';
import CourseReadinessPanel,{type Coverage} from './course-readiness';
import {useI18n} from './language';
import type {BetaMeeting} from '../../lib/beta/agenda';

type Selection={confirmed:boolean;moodle_ids:string[]};
type Props=Omit<ComponentProps<typeof CourseReadinessPanel>,'courseAction'>&{
 revision:string;
 onConnect:()=>void;
 calendarCourseIds:string[];
 meetings:BetaMeeting[];
 onAddClassTime:(id:string)=>void;
 classTimeDisabled?:boolean;
};

export function selectedCoverage(coverage:Coverage[],selection:Selection){
 return selection.confirmed?coverage.filter(course=>course.moodle_id&&selection.moodle_ids.includes(course.moodle_id)):[];
}

export function needsClassTime(course:Coverage,meetings:BetaMeeting[]){
 const readiness=course.readiness;
 return !!readiness && (readiness.readable_pages>0 || readiness.attachments.readable>0)
  && !meetings.some(({course_id,schedule})=>course_id===course.course_id
   && schedule?.active!==false && (schedule?.kind==='class'||schedule?.kind==='lab'));
}

export default function TodayCoverage({coverage,revision,onConnect,calendarCourseIds,meetings,onAddClassTime,classTimeDisabled,...panel}:Props){
 const {t:ui}=useI18n();
 const [selection,setSelection]=useState<Selection|null>(null),[failed,setFailed]=useState(false),[retry,setRetry]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();
  fetch('/api/beta/onboarding?view=selection',{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(12000)])}).then(async response=>{
   if(!response.ok)throw Error();
   const next=await response.json();
   if(typeof next?.confirmed!=='boolean'||!Array.isArray(next.moodle_ids)||next.moodle_ids.some((id:unknown)=>typeof id!=='string'))throw Error();
   if(!controller.signal.aborted){setSelection(next);setFailed(false);}
  }).catch(()=>{if(!controller.signal.aborted)setFailed(true);});
  return ()=>controller.abort();
 },[retry,revision]);

 const current=selection&&!failed?selectedCoverage(coverage,selection):[];
 if(current.length)return <>
  {selection&&current.length<selection.moodle_ids.length&&<p role="status">{ui('Some selected courses have no saved Moodle pages.')}</p>}
  <CourseReadinessPanel {...panel} coverage={current} showReadingLimit courseAction={course=>
   calendarCourseIds.includes(course.course_id)&&needsClassTime(course,meetings)&&<p>
    {ui('No class time confirmed.')} <button type="button" disabled={classTimeDisabled}
     aria-label={ui('Add class time for {course}',{course:panel.title(course.course_id)})}
     onClick={()=>onAddClassTime(course.course_id)}>{ui('Add class time')}</button>
   </p>
  }/>
 </>;
 return <section className="beta-readiness" aria-labelledby="beta-today-coverage-title">
  <header><h2 id="beta-today-coverage-title">{ui('Course material and collection coverage')}</h2></header>
  {failed?<p role="status">{ui('Could not check your selected Moodle courses.')} <button type="button" onClick={()=>{setFailed(false);setRetry(value=>value+1);}}>{ui('Retry setup check')}</button></p>
   :!selection?<p role="status">{ui('Checking your setup…')}</p>
   :<p>{ui(selection.confirmed?'Some selected courses have no saved Moodle pages.':'Confirm your current courses in Companion to see their collection coverage.')} <button type="button" onClick={onConnect}>{ui('Open Moodle connection')}</button></p>}
 </section>;
}

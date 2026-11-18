'use client';
import {useI18n} from "./language";

import {useEffect,useId,useRef,useState,type FormEvent} from 'react';
import {zoneInstant} from '../../lib/beta/agenda';

export type ScheduleSeed={source_id:string;version_id:string;title:string;location:string;kind:string;weekdays:number[];start_date:string;end_date:string;start_time:string;end_time:string};

type FormError={field?:string;message:string};

export function validateScheduleDraft(form:FormData):FormError|null{
 const value=(name:string)=>String(form.get(name)||'');
 if(!value('source'))return {field:'source',message:'Choose a saved timetable or a course for your own confirmed schedule.'};
 if(!value('title').trim())return {field:'title',message:'Enter a class, lab or office-hour title.'};
 if(!form.getAll('day').length)return {field:'day',message:'Choose at least one day when this class meets.'};
 for(const [date,time,field] of [['start_date','start_time','start_date'],['end_date','end_time','end_date']]){
  try{zoneInstant(value(date),value(time));}catch{return {field,message:'Enter a valid term date and meeting time in Halifax time.'};}
 }
 const first=value('start_date'),last=value('end_date');
 if(last<first)return {field:'end_date',message:'The term must end on or after its start date.'};
 if(Date.parse(last)-Date.parse(first)>370*86400000)return {field:'end_date',message:'Keep the term range within 370 days.'};
 if(value('end_time')<=value('start_time'))return {field:'end_time',message:'The meeting must end after its start time.'};
 const excluded=value('excluded_dates').split(/[\s,]+/).filter(Boolean);
 if(excluded.length>80)return {field:'excluded_dates',message:'Enter at most 80 no-class dates.'};
 for(const date of excluded){try{zoneInstant(date,'12:00');}catch{return {field:'excluded_dates',message:'Use YYYY-MM-DD for each no-class date.'};}if(date<first||date>last)return {field:'excluded_dates',message:'No-class dates must fall within this term.'};}
 if(value('confirmed')!=='on')return {field:'confirmed',message:'Check the schedule against your timetable, then confirm it.'};
 return null;
}

export default function ScheduleForm({sources,courses=[],onSave,onDirtyChange,seed,initialCourseId,onClose,disabled=false}:{disabled?:boolean;seed?:ScheduleSeed;initialCourseId?:string;onClose?:()=>void;courses?:{id:string;code:string}[];sources:{id:string;title:string}[];onSave:(source:string|null,schedule:unknown)=>Promise<void>;onDirtyChange?:(dirty:boolean)=>void}){
 const {t:ui}=useI18n();
 const initialCourse=initialCourseId&&courses.some(course=>course.id===initialCourseId)?'manual:'+initialCourseId:undefined;
 const [open,setOpen]=useState(!!seed||!!initialCourse),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[error,setError]=useState<FormError|null>(null),[saved,setSaved]=useState(false);
 const opener=useRef<HTMLButtonElement>(null),formRef=useRef<HTMLFormElement>(null),inFlight=useRef(false);
 const request=useRef<{body:string;id:string}|null>(null);
 const id=useId(),errorId=id+'-error',formId=id+'-form';
 useEffect(()=>{onDirtyChange?.(open&&dirty);},[open,dirty,onDirtyChange]);
 useEffect(()=>()=>onDirtyChange?.(false),[onDirtyChange]);
 useEffect(()=>{
  if(!open||!dirty)return;
  const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();};
  window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
 },[open,dirty]);
 useEffect(()=>{
  if(!open)return;
  const source=formRef.current?.querySelector<HTMLSelectElement>('[name="source"]');
  if(!source)return;
  if(!initialCourse){source.focus({preventScroll:true});return;}
  const frame=requestAnimationFrame(()=>{
   source.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
   source.focus({preventScroll:true});
  });
  return ()=>cancelAnimationFrame(frame);
 },[open,initialCourse]);
 useEffect(()=>{if(saved&&!open&&!busy)opener.current?.focus({preventScroll:true});},[saved,open,busy]);
 function cancel(){
  if(inFlight.current||dirty&&!window.confirm('Discard this unsaved class schedule?'))return;
  setOpen(false);setDirty(false);setError(null);onClose?.();opener.current?.focus({preventScroll:true});
 }
 function fieldProps(name:string){return {'aria-invalid':error?.field===name||undefined,'aria-describedby':error?.field===name?errorId:undefined};}
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(inFlight.current)return;
  const form=event.currentTarget,data=new FormData(form),issue=validateScheduleDraft(data);
  if(issue){setError(issue);form.querySelector<HTMLElement>('[name="'+issue.field+'"]')?.focus();return;}
  inFlight.current=true;setBusy(true);setError(null);setSaved(false);
  try{
   const chosen=String(data.get('source')),body=JSON.stringify([...data.entries()]);
   if(request.current?.body!==body)request.current={body,id:crypto.randomUUID()};
   await onSave(chosen.startsWith('manual:')?null:chosen,{request_id:request.current.id,...(seed?{expected_version_id:seed.version_id}:{}),...(chosen.startsWith('manual:')?{manual_course_id:chosen.slice(7)}:{}),title:data.get('title'),location:data.get('location'),kind:data.get('kind'),start_date:data.get('start_date'),end_date:data.get('end_date'),start_time:data.get('start_time'),end_time:data.get('end_time'),weekdays:data.getAll('day').map(Number),excluded_dates:String(data.get('excluded_dates')||'').split(/[\s,]+/).filter(Boolean),confirmed:data.get('confirmed')==='on'});
   request.current=null;setOpen(false);setDirty(false);setSaved(true);onClose?.();
  }catch(error){setError({message:error instanceof Error?error.message:'The schedule could not be saved. Your entries are preserved; try again.'});}
  finally{inFlight.current=false;setBusy(false);}
 }
 return <section className="beta-schedule" aria-label={ui("Confirmed class schedule")}>
  <button ref={opener} type="button" disabled={busy||!open&&(disabled||!sources.length&&!courses.length)} aria-expanded={open} aria-controls={open?formId:undefined} onClick={()=>{if(open)cancel();else{setSaved(false);setError(null);setOpen(true);}}}>{open?ui("Close schedule form"):ui("Add classes or office hours")}</button>
  {saved&&<p className="beta-form-success" role="status">{ui("Schedule saved. It appears on the applicable dates in your calendar.")}</p>}
  {!sources.length&&!courses.length&&<p>{ui("Save your timetable in")} <a className="beta-text-link" href="/beta?tab=sources">{ui("Sources")}</a>  {ui("before adding class times.")}</p>}
  {open&&<form id={formId} ref={formRef} className="beta-schedule-form" onSubmit={submit} onChange={()=>setDirty(true)} aria-busy={busy}>
   <h2>{ui("Confirm your meeting times")}</h2>
   <p>{ui("Confirm weekly class times or office hours against your timetable, syllabus and later announcements. Include term dates and cancellations. Your entries are labelled student-confirmed; by-appointment hours need an agreed time first.")}</p>
   <fieldset className="beta-schedule-fields" disabled={busy}>
    <div className="beta-schedule-grid">
     <label className="beta-schedule-source">{ui("Timetable or course")}<select name="source" defaultValue={seed?.source_id??initialCourse} required {...fieldProps('source')}><option value="">{ui("Choose timetable or enter for a course")}</option>{courses.map(course=><option key={'manual:'+course.id} value={'manual:'+course.id}>{ui("Enter my timetable ·")} {course.code}</option>)}{sources.map(source=><option key={source.id} value={source.id}>{source.title}</option>)}</select></label>
     <label>{ui("Class, lab or office-hour title")}<input name="title" defaultValue={seed?.title} required maxLength={180} autoComplete="off" placeholder={ui("e.g. Linear algebra lecture…")} {...fieldProps('title')}/></label>
     <label>{ui("Room")} <small>{ui("(optional)")}</small><input name="location" defaultValue={seed?.location} maxLength={180} autoComplete="off" placeholder={ui("e.g. Room 101…")}/></label>
     <label>{ui("Meeting type")}<select name="kind" defaultValue={seed?.kind}><option value="class">{ui("Class")}</option><option value="lab">{ui("Lab")}</option><option value="office_hours">{ui("Office hours")}</option></select></label>
     <fieldset className="beta-schedule-days" aria-describedby={error?.field==='day'?errorId:undefined}><legend>{ui("Meeting days")}</legend>{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day,index)=><label className="beta-check-label" key={day}><input name="day" type="checkbox" value={index} defaultChecked={seed?.weekdays.includes(index)} {...fieldProps('day')}/>{ui(day)}</label>)}</fieldset>
     <label>{ui("Term starts")}<input type="date" name="start_date" defaultValue={seed?.start_date} required {...fieldProps('start_date')}/></label>
     <label>{ui("Term ends")}<input type="date" name="end_date" defaultValue={seed?.end_date} required {...fieldProps('end_date')}/></label>
     <label>{ui("Meeting starts")} <small>{ui("(Halifax)")}</small><input type="time" name="start_time" defaultValue={seed?.start_time} required {...fieldProps('start_time')}/></label>
     <label>{ui("Meeting ends")} <small>{ui("(Halifax)")}</small><input type="time" name="end_time" defaultValue={seed?.end_time} required {...fieldProps('end_time')}/></label>
     <label>{ui("No-class dates")} <small>{ui("(optional)")}</small><input name="excluded_dates" placeholder={ui("YYYY-MM-DD, YYYY-MM-DD")} {...fieldProps('excluded_dates')}/><small>{ui("Enter holidays or cancellations within this term.")}</small></label>
    </div>
    <label className="beta-check-label beta-schedule-confirm"><input name="confirmed" type="checkbox" required {...fieldProps('confirmed')}/>{ui("I checked the course, section, term and these meeting times against the source.")}</label>
   </fieldset>
   {error&&<p id={errorId} className="beta-field-error" role="alert">{ui(error.message)}</p>}
   <div className="beta-form-actions"><button type="submit" className="beta-primary" disabled={busy}>{busy?ui("Saving schedule…"):ui("Save schedule")}</button><button type="button" disabled={busy} onClick={cancel}>{ui("Cancel")}</button></div>
  </form>}
 </section>;
}

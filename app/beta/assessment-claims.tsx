'use client';
import {useI18n} from "./language";

import type {AssessmentRead} from './use-assessments';
import {assessmentSourceLabel,assessmentWindow,type Assessment} from '../../lib/beta/assessments-format';
import type {InstructorAsk} from '../../lib/beta/instructor-asks';
import {zoneDate} from '../../lib/beta/agenda';

const title=(key:string)=>key.replace(/\b\w/g,c=>c.toUpperCase());
type Ref={source_id:string;version_id:string};

// Quoted dates for in-class assessments and quoted instructor asks. Every line
// keeps the exact saved source version it came from; nothing here is a Moodle
// receipt, grade or completion status.
export default function AssessmentClaims({read,zone,onVersion,courseIds}:{read:AssessmentRead;zone:string;onVersion:(ref:Ref)=>void;courseIds?:string[]}){
 const {t:ui,locale}=useI18n();
 const day=(date:string)=>new Intl.DateTimeFormat(locale,{timeZone:'UTC',weekday:'short',month:'short',day:'numeric'}).format(new Date(date+'T12:00:00Z'));
 const {data,error}=read,filtered=data?{assessments:data.assessments.filter(a=>!courseIds||courseIds.includes(a.courseId)),asks:data.asks.filter(a=>!courseIds||courseIds.includes(a.courseId))}:null;
 const today=zoneDate(new Date(),zone),{upcoming,recent}=filtered?assessmentWindow(filtered.assessments,today):{upcoming:[],recent:[]};
 const open=(i:{sourceKind?:string;sourceId:string|null;version:string|null})=>i.sourceId&&i.version&&i.sourceKind!=='student_plan'?<button type="button" className="beta-link" onClick={()=>onVersion({source_id:i.sourceId!,version_id:i.version!})}>{ui("Open saved source")}</button>:null;
 return <section className="beta-library beta-assessments" aria-label={ui("Tests and in-class work")} aria-busy={!data&&!error}>
  <div className="beta-section-head"><div><h2>{ui("Tests and in-class work")}</h2><p>{ui("Dates quoted from your saved Moodle announcements, Moodle pages and syllabi, with the line they came from. Moodle and your instructor decide the actual date; check the original before relying on it.")}</p></div></div>
  {error&&<p className="beta-alert" role="alert">{ui(error)} <button type="button" onClick={()=>read.retry()}>{ui("Try loading dates again")}</button></p>}
  {!data&&!error&&<p className="nu-search-activity" role="status"><span aria-hidden="true"/>{ui("Checking saved assessment dates…")}</p>}
  {data&&!upcoming.length&&!recent.length&&<p>{ui("No quoted test, exam, quiz or presentation date in the next 30 days in your saved sources. That does not mean none is scheduled.")}</p>}
  {upcoming.length>0&&<ul className="beta-assessment-list">{upcoming.map(i=><li key={i.courseId+i.key}>
   <strong>{i.date===today?ui("Today"):(i.range?ui("Week of"):'')+day(i.date)}</strong> — {i.course} {title(i.key)}
   {i.conflicts.length>0&&<span className="beta-assessment-conflict" role="note">  {ui("⚠ Sources disagree: also")} {[...new Set(i.conflicts.map(c=>day(c.date)+' ('+(c.olderSyllabusVersion?'older syllabus version':assessmentSourceLabel[c.sourceKind])+')'))].join(', ')}{ui(". Ask your instructor or check Moodle.")}</span>}
   {i.planDates.length>0&&<span className="beta-assessment-conflict">  {ui("· Your plan has a different date (")}{i.planDates.map(day).join(', ')}).</span>}
   <blockquote>“{i.quote.slice(0,180)}”<footer>{assessmentSourceLabel[i.sourceKind]}{i.sourceKind!=='student_plan'?' · '+i.title:''}{i.sourceKind==='student_plan'?ui("— not an official source"):''}{i.observedAt&&i.sourceKind!=='student_plan'?<>  {ui("· saved")} <time dateTime={i.observedAt}>{new Date(i.observedAt).toLocaleDateString('en-CA',{timeZone:zone,month:'short',day:'numeric'})}</time>  {ui("(not the Moodle post time)")}</>:null} {open(i)}</footer></blockquote>
  </li>)}</ul>}
  {recent.length>0&&<><p>{ui("Past in-class work in the last week with no recorded outcome. Check Moodle for what happened; Neyvu does not know whether it was written or graded.")}</p><ul className="beta-assessment-list">{recent.map(i=><li key={'past'+i.courseId+i.key}>{day(i.date)} — {i.course} {title(i.key)} {open(i)}</li>)}</ul></>}
  {filtered&&filtered.asks.length>0&&<><h2>{ui("From your instructors")}</h2><p>{ui("Sentences quoted from Moodle announcements saved in the last 14 days. Check the original before acting.")}</p><ul className="beta-assessment-list">{filtered.asks.map(a=><li key={a.version+a.quote}><strong>{a.course}</strong> — {a.title}: “{a.quote}” {open({sourceId:a.sourceId,version:a.version})}</li>)}</ul></>}
 </section>;
}

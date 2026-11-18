'use client';
import {useEffect,useState} from 'react';
import {FileText,ArrowUpRight} from 'lucide-react';
import {useI18n} from './language';
import ActivityStatus from './activity-status';
import {weekPriorities,type WeekPriority} from '../../lib/beta/week-priorities';
import {connectedCourseworkMaterials,courseworkMaterialStep,courseworkMaterialGroups,type CourseworkCatalogue, type CourseworkMaterial} from '../../lib/beta/coursework-materials';
import type {BetaTask} from '../../lib/beta/agenda';
import type {PlanningState} from '../../lib/beta/student-planning';
import type {AssessmentRead} from './use-assessments';
type Ref={id:string;version_id?:string;course_id:string;title:string;kind:string;excerpt?:string};
type Props={visible:boolean;course:string;tasks:BetaTask[];planning?:PlanningState;assessmentRead:AssessmentRead;now:Date|null;zone:string;refreshKey:string;courseLabel:(id:string)=>string;onOpen:(ref:Ref,trigger:HTMLElement)=>void;onBrowse:()=>void;onWeek:()=>void};
export default function CourseworkSources({visible,course,tasks,planning,assessmentRead,now,zone,refreshKey,courseLabel,onOpen,onBrowse,onWeek}:Props){
 const {t,locale}=useI18n(),[catalogue,setCatalogue]=useState<CourseworkCatalogue|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{
  if(!visible)return;let active=true;const controller=new AbortController();setLoading(true);setError('');
  fetch('/api/beta?op=sources.coursework'+(course?'&course='+encodeURIComponent(course):''),{credentials:'same-origin',cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])}).then(async r=>{const body=await r.json();if(!r.ok||!Array.isArray(body.materials)||body.scope!=='current-course-saved-material')throw Error('Course material could not be loaded.');if(active)setCatalogue(body);}).catch(()=>{if(active)setError('The material suggestions could not refresh. Saved activity evidence and general browsing are still available.');}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;controller.abort();};
 },[visible,course,refreshKey,retry]);
 const datesPending=assessmentRead.loading||(!assessmentRead.data&&!assessmentRead.error);
 const scope=planning?{...planning,current_course_ids:planning.current_course_ids.filter(id=>!course||id===course)}:null;
 const work=scope&&now?weekPriorities(tasks,scope,assessmentRead.data?.assessments||[],now,zone,{days:14,limit:12}):[];
 const {featured:lead,more:rest,other}=courseworkMaterialGroups(work,catalogue?.materials||[]);
 function openMaterial(material:CourseworkMaterial,trigger:HTMLElement){onOpen({...material,excerpt:material.question?.quote},trigger);}
 function card(w:WeekPriority){
  const links=connectedCourseworkMaterials(w,catalogue?.materials||[]),suggestion=links[0],step=courseworkMaterialStep(w,suggestion);
  const date=w.date?new Intl.DateTimeFormat(locale,{timeZone:'UTC',month:'short',day:'numeric'}).format(new Date(w.date+'T12:00:00Z')):t('Personal plan');
  return <article key={w.id} className="nu-coursework-item" data-work-id={w.id}>
   <header><span className="nu-course">{courseLabel(w.course_id)}</span><span>{date}</span></header><h3>{w.title}</h3>
   <p className="nu-coursework-basis">{t(w.basis)}</p>
   {w.assessment&&(w.assessment.conflicts.length>0||w.activity_reference)&&<p className="nu-coursework-conflict">{t('Saved dates differ. Compare the source dates before choosing how to prepare.')}</p>}
   {suggestion?<div className="nu-connected-material"><p>{t(suggestion.relationship==='date_source'?'Source for the saved date':suggestion.relationship==='activity_source'?'Linked activity source':'Suggested material · title match')}</p><button type="button" className="nu-material-primary" onClick={e=>openMaterial(suggestion.source,e.currentTarget)}><FileText size={18} aria-hidden="true"/><span>{suggestion.source.title}</span><ArrowUpRight size={16} aria-hidden="true"/></button><small>{t(suggestion.reason)}</small>{suggestion.source.question&&<small>{suggestion.source.question.unit||t('Saved source')} · {t('Line')} {suggestion.source.question.line}</small>}</div>:!loading&&!error&&catalogue&&<p className="nu-coursework-gap">{t('No matching material title was found in this saved view. This does not mean there is no assigned handout.')}</p>}
   <div className="nu-coursework-step"><h4>{t('Start with this')}</h4><p>{t(step.action)}</p>{step.question&&<blockquote>{step.question.quote}</blockquote>}<p className="nu-coursework-result">{t(step.result)}</p>{step.question?.limitation&&<details><summary>{t('Study-guide limitation')}</summary><p>{step.question.limitation}</p></details>}</div>
   {links.length>1&&<details><summary>{t('Other matching material')} · {links.length-1}</summary>{links.slice(1).map(l=><button key={l.source.id} onClick={e=>openMaterial(l.source,e.currentTarget)}>{l.source.title}</button>)}</details>}
   {w.source_id&&w.version_id&&<button className="nu-coursework-evidence" type="button" onClick={e=>onOpen({id:w.source_id!,version_id:w.version_id!,course_id:w.course_id,title:w.kind==='assessment'?'Saved date source':w.title,kind:'file',excerpt:w.assessment?.quote},e.currentTarget)}>{t(w.kind==='assessment'?'Open saved date evidence':w.kind==='plan'?'Open saved plan evidence':'Open saved activity evidence')}</button>}
   {w.assessment?.conflicts.map((c,i)=>c.sourceId&&c.version?<button className="nu-coursework-evidence" key={i} onClick={e=>onOpen({id:c.sourceId!,version_id:c.version!,course_id:w.course_id,title:c.title,kind:'file',excerpt:c.quote},e.currentTarget)}>{t('Compare differing date')} · {c.date}</button>:null)}
  </article>;
 }
 return <section className="nu-coursework-sources" aria-label={t('Material for upcoming coursework')}>
  <div className="nu-coursework-heading"><div><h2>{t('For your upcoming work')}</h2><p>{t('Connected material for saved work in the next 14 days.')}</p></div><button onClick={onWeek}>{t('Open Today')}</button></div>
  <details className="nu-coursework-explanation"><summary>{t('About these connections')}</summary><p>{t('These are saved observations, not a live Moodle check. Suggested materials are not verified assignment attachments.')}</p><p>{t('Completed and reported work stays out. Other upcoming activities remain listed below when no useful connected original is identified.')}</p></details>
  {datesPending&&<ActivityStatus label="Checking saved test dates…"/>}
  {assessmentRead.error&&<p role="alert">{t('Saved test dates could not refresh. Available activity evidence remains below.')} <button onClick={assessmentRead.retry}>{t('Retry test dates')}</button></p>}
  {loading&&<ActivityStatus label="Finding saved course material…" detail="Your activities and general source library remain available."/>}
  {error&&<p role="alert">{t(error)} {catalogue&&t('Previously loaded suggestions remain below; this refresh did not verify them again.')} <button onClick={()=>setRetry(n=>n+1)}>{t('Retry material lookup')}</button></p>}
  {!!lead.length&&<div className="nu-coursework-grid">{lead.map(card)}</div>}
  {!work.length&&!datesPending&&now&&<div className="nu-coursework-empty"><h3>{t('No unfinished work is identified in this saved window.')}</h3><p>{t('Coverage may be incomplete. Check your planning courses and browse saved originals before concluding nothing is due.')}</p><button onClick={onBrowse}>{t('Browse all saved material')}</button></div>}
  {!!rest.length&&<details className="nu-other-coursework"><summary>{t('More upcoming work')} · {rest.length}</summary><div className="nu-coursework-grid">{rest.map(card)}</div></details>}
  {!!other.length&&<section className="nu-coursework-other-evidence" aria-label={t('Other upcoming activities')}><h3>{t(lead.length?'Other upcoming activities':'Saved activity evidence')}</h3><p>{t('These activities are still upcoming. Use their saved evidence to check instructions or find missing material.')}</p><ul>{other.map(w=><li key={w.id}><div><strong>{courseLabel(w.course_id)} · {w.title}</strong><small>{w.kind==='plan'?t('Personal target')+' · ':''}{w.date}</small></div>{w.source_id&&w.version_id&&<button onClick={e=>onOpen({id:w.source_id!,version_id:w.version_id!,course_id:w.course_id,title:w.title,kind:'file',excerpt:w.assessment?.quote},e.currentTarget)}>{t(w.kind==='assessment'?'Open saved date evidence':w.kind==='plan'?'Open saved plan evidence':'Open saved activity evidence')}</button>}</li>)}</ul></section>}
  {catalogue?.truncated&&<p>{t('Material suggestions are bounded. Use search to find sources outside this view.')}</p>}
  <div className="nu-coursework-browse"><p>{t('Need a different reading or your own notes? All saved material remains available.')}</p><button onClick={onBrowse}>{t('Browse all saved material')}</button></div>
 </section>;
}

'use client';
import {ChatDemonstration} from './chat-demonstration';
import {useI18n} from "../language";
import {BookOpen,CalendarDays,FileText,MessageSquare,Check,ArrowUpRight,Search,Link as LinkIcon,Plus,ArrowUp,Bell,ChevronDown} from 'lucide-react';
import {CourseContext,EvidenceLabel} from '../product-ui';
import './product-screen.css';
import './product-polish.css';
import {WORDMARK_LIGHT,SYMBOL_LIGHT} from '../../../lib/brand';

export type ProductView='plan'|'notes'|'answer'|'source'|'coverage'|'updates'|'prepare';
const nav=[['answer','Conversation',MessageSquare],['plan','Today',CalendarDays],['notes','Notebook',BookOpen],['updates','Updates',Bell],['source','Sources',FileText]] as const;

function Today(){
 const {t:ui}=useI18n();return <>
 <div className="pd-intro"><h4>{ui("Your next steps")}</h4><p>{ui("Upcoming work and your personal study plan.")}</p></div>
 <div className="pd-work"><CourseContext code="DEMO 1010">{ui("Linear Algebra")}</CourseContext><h5>{ui("Problem Set 2: Eigenvalues")}</h5><div className="pd-dates"><div><span>{ui("Assignment due")}</span><strong>{ui("Sun, Oct 11")} <small>{ui("11:59 PM, Halifax")}</small></strong></div><div><span>{ui("Your planned day")}</span><strong>{ui("Fri, Oct 9")}</strong></div></div><div className="pd-next"><span>{ui("My next action")}</span><p>{ui("Review Week 3 notes, then work on questions 1–3.")}</p></div><div className="pd-row-foot"><span className="pd-state">{ui("In progress")} <small>{ui("Personal update")}</small></span><a href="#tour-notes">{ui("Open course notes")} <ArrowUpRight size={15}/></a></div></div>
 <div className="pd-work pd-work-secondary"><CourseContext code="DEMO 2020">{ui("Statistics Lab")}</CourseContext><h5>{ui("Lab report 1: Sampling distributions")}</h5></div>
 </>;}
function Updates(){
 const {t:ui}=useI18n();return <>
 <div className="pd-intro"><h4>{ui("Keep up with your courses")}</h4><p>{ui("Saved announcements, upcoming work and your next step.")}</p></div>
 <div className="pd-document"><CourseContext code="DEMO 1010">{ui("Moodle announcement")}</CourseContext><h4>{ui("Problem Set 2 is posted")}</h4><p>{ui("Work through the eigenvalue problems using your Week 3 notes. The saved assignment lists Sunday, October 11, 11:59 PM, Halifax.")}</p><div className="pd-next"><span>{ui("Suggested next step")}</span><p>{ui("Choose a study day and review the worked example before starting.")}</p></div><a href="#tour-plan">{ui("Make a plan")} <ArrowUpRight size={15}/></a></div>
 <p className="pd-footnote">{ui("Fictional sample week. Saved information can be incomplete or out of date.")}</p>
 </>;}
function Prepare(){
 const {t:ui,language}=useI18n();return <>
 <div className="pd-chat-context"><CourseContext code="DEMO 1010"/><span>{ui("Week 3 notes selected")}</span></div><p className="pd-question">{ui("Help me prepare for class using these notes.")}</p><div className="pd-answer"><EvidenceLabel><img src={SYMBOL_LIGHT} width="22" height="22" alt=""/>{ui("Neyvu")}</EvidenceLabel><p>{ui("Start with the relationship")} <strong>{ui("A v = λ v")}</strong>{ui(". An eigenvector is nonzero and is scaled by the matrix.")}</p><div className="pd-answer-example"><span>{ui("Suggested preparation")}</span><p>{ui("Explain the idea in your own words. Try the 2×2 worked example. Bring one question about what happens when there are no real eigenvalues.")}</p></div><a className="pd-citation" href="#tour-source"><FileText size={19}/><span><strong>{ui("Week 3 lecture notes")}</strong><small>{ui("Read the supporting example")}</small></span><ArrowUpRight size={16}/></a><p className="pd-footnote">{language==='es'?'Sugerencia de estudio con material ficticio.':'Study suggestion with fictional material.'}</p></div>
 </>;}
function Notes(){
 const {t:ui}=useI18n();return <>
 <div className="pd-document"><CourseContext code="DEMO 1010">{ui("Class notes")}</CourseContext><h4>{ui("Week 3: Eigenvalues")}</h4><p>{ui("An eigenvector is a nonzero vector that a matrix scales by a number.")}</p><div className="pd-equation">{ui("A v = λ v")}</div><h5>{ui("Worked example")}</h5><p>{ui("For A = [[2, 1], [1, 2]], solve det(A − λI) = 0.")}</p><div className="pd-result"><span>λ = 3 <small>{ui("v = (1, 1)")}</small></span><span>λ = 1 <small>{ui("v = (1, −1)")}</small></span></div></div><div className="pd-document-foot"><span><Check size={15}/>  {ui("Saved with this course")}</span><a href="#tour-answer">{ui("Ask about this note")} <ArrowUpRight size={15}/></a></div>
 </>;}
function Source(){
 const {t:ui}=useI18n();return <>
 <div className="pd-document"><CourseContext code="DEMO 1010">{ui("Saved class notes")}</CourseContext><h4>{ui("Week 3: Eigenvalues")}</h4><div className="pd-source-meta"><LinkIcon size={15}/><span>{ui("Original supporting text")}</span></div><blockquote>{ui("An eigenvector of a square matrix A is a nonzero vector v with A v = λ v. The number λ is its eigenvalue.")}</blockquote><h5>{ui("Example from the notes")}</h5><p>{ui("A = [[2, 1], [1, 2]] gives (2 − λ)² − 1 = 0, so λ = 3 or λ = 1.")}</p><p>{ui("λ = 3 has eigenvector (1, 1).")}<br/>{ui("λ = 1 has eigenvector (1, −1).")}</p></div><div className="pd-document-foot"><FileText size={16}/><span>{ui("Compare the explanation with the saved source.")}</span></div>
 </>;}
function Coverage(){
 const {t:ui,language}=useI18n();return <>
 <div className="pd-intro"><h4>{language==='es'?'Revisa qué material puede usar Neyvu':'See what material Neyvu can use'}</h4><p>{ui("Readable material and visible collection gaps.")}</p></div><div className="pd-coverage-course"><CourseContext code="DEMO 1010">{ui("Linear Algebra")}</CourseContext><h5>{ui("Saved text with gaps")}</h5><ul><li><Check size={16}/>{ui("Assignment instructions")}</li><li><Check size={16}/>{ui("Week 3 notes")}</li></ul><div className="pd-gap"><strong>{ui("Some course sections are collapsed.")}</strong><p>{ui("Check the original Moodle page for material that was not saved.")}</p></div></div><div className="pd-coverage-course"><CourseContext code="DEMO 2020">{ui("Statistics Lab")}</CourseContext><h5>{ui("Saved material available")}</h5><p>{ui("The lab handout and your notes have readable text.")}</p></div><p className="pd-footnote">{ui("Coverage does not confirm submission or grades.")}</p>
 </>;}

export function ProductScreen({view}:{view:ProductView}) {
 const {t:ui}=useI18n();const label=view==='coverage'?'Source coverage':view==='prepare'?'Conversation':nav.find(n=>n[0]===view)?.[1]||'Sources';
 const active=view==='prepare'?'answer':view==='coverage'?'source':view;
 return <div className="product-demo" data-demo-view={view}>
 <div className="pd-layout"><aside className="pd-navigation">
  <img className="pd-brand" src={WORDMARK_LIGHT} width="108" height="28" alt="Neyvu"/>
  <a className="pd-new" href="#tour-answer"><Plus size={16}/>{ui("New chat")}</a>
  <nav aria-label={ui("Explore the product demonstration")}>{nav.map(([id,name,Icon])=><a key={id} href={'#tour-'+id} className={id===active?'pd-nav-active':''}><Icon size={17}/><span>{ui(name)}</span></a>)}</nav>
  <div className="pd-nav-history"><span>{ui("Recent chats")}</span><p>{ui("Understanding eigenvectors")}</p><p>{ui("Preparing for Week 3")}</p></div>
  <div className="pd-nav-student"><span aria-hidden="true">A</span><div>{ui("Alex")}<small>{ui("Sample student")}</small></div></div>
 </aside><div className="pd-main">
  <div className="pd-view-bar"><img className="pd-mobile-brand" src={WORDMARK_LIGHT} width="90" height="24" alt="Neyvu"/><strong>{ui(label)}</strong><div><span><Search size={15}/>{ui("Find")}</span><span className="pd-account">{ui("Account")}<ChevronDown size={13}/></span></div></div>
  <div className="pd-content">{view==='plan'?<Today/>:view==='notes'?<Notes/>:view==='answer'?<ChatDemonstration/>:view==='source'?<Source/>:view==='updates'?<Updates/>:view==='prepare'?<Prepare/>:<Coverage/>}</div>
  {view==='prepare'&&<div className="pd-composer-wrap"><div className="pd-composer"><p>{ui("Ask a follow-up about your notes…")}</p><div><span>{ui("DEMO 1010")}<ChevronDown size={12}/><i/>{ui("Ask")}<ChevronDown size={12}/></span><span className="pd-send" aria-hidden="true"><ArrowUp size={17}/></span></div></div><p>{ui("Answers use saved materials. Check the sources.")}</p></div>}
 </div></div></div>;
}

import {serverI18n} from "../../../../lib/beta/server-i18n";
import type {Metadata} from 'next';
import {redirect} from 'next/navigation';
import Markdown from 'react-markdown';
import remarkMath from 'remark-math';
import type {Components} from 'react-markdown';
import {pageSession,pageStudyCopy} from '../../../../lib/beta/page-data';
import ServiceUnavailable from '../../service-unavailable';
import {studyCopyDate} from '../../../../lib/beta/study-date';
import {studyCitations,studyWorkedSteps} from '../../../../lib/beta/study-citations';
import {studyMath} from '../../../../lib/beta/study-math';
import StudyPrintButton from './print-button';
import './study-copy.css';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Study copy',robots:{index:false,follow:false}};
const components:Components={
 a:({href,children})=>href&&/^#study-source-\d+$/.test(href)?<a href={href}>{children}</a>:<span>{children}</span>,
 img:({alt})=><span className="study-missing-image">Image not included{alt?': '+alt:''}. Open the original source to review it.</span>,
};
export default async function StudyCopyPage({params}:{params:Promise<{message:string}>}){
 const {t:ui}=await serverI18n();
 let session;try{session=await pageSession();}catch{return <ServiceUnavailable/>;}if(!session.actor)redirect('/beta');
 const {message}=await params;let copy;
 try{copy=await pageStudyCopy(message);}catch{
  return <main className="study-copy-unavailable"><h1>{ui("This study copy could not open")}</h1><p>{ui("The saved answer may be unavailable or its calculation record may need a new check. Your other saved work is still available.")}</p><a href="/beta">{ui("Return to your vault")}</a></main>;
 }
 const back='/beta?tab=chat&chat='+copy.chat_id,changed=copy.sources.filter(s=>s.state!=='available');
 return <div className="study-copy-shell">
  <div className="study-copy-toolbar"><a href={back}>{ui("Back to conversation")}</a><StudyPrintButton/></div>
  <main className="study-copy-paper study-copy-print-pending" id="study-copy">
   <header className="study-copy-heading"><div><p>{copy.course?copy.course.code+' - '+copy.course.title:ui("Your course work")}</p><h1>{ui("Study copy")}</h1><p>{ui("Answer saved")} {studyCopyDate(copy.created_at,copy.timezone)}</p></div><span>{ui("AI-written study material")}</span></header>
   <nav className="study-copy-contents" aria-label={ui("Study copy sections")}><a href="#study-question">{ui("Question")}</a><a href="#study-answer">{ui("Saved answer")}</a>{copy.calculation&&<a href="#study-check">{ui("Calculation record")}</a>}<a href="#study-sources">{ui("Sources")}</a></nav>
   <p className="study-copy-scope">{ui("This is the original saved answer. Review it against the course requirements before using it. Printing does not submit work or check later edits.")}</p>
   <p className="study-print-blocker">{ui("Incomplete print layout: the equation rendering and width checks have not passed. Reload the page, or return to the conversation and request corrected notation or shorter worked steps before using this copy.")}</p>
   {!!changed.length&&<p className="study-copy-change" role="note">{changed.length}  {ui("saved")} {changed.length===1?ui("source has changed or is"):ui("sources have changed or are")}  {ui("no longer available. This copy keeps the original answer and source versions; check the current originals before relying on its advice.")}</p>}
   <section id="study-question"><h2>{ui("Your question")}</h2><div className="study-copy-prose study-copy-question"><Markdown remarkPlugins={[remarkMath]} rehypePlugins={[studyMath]} skipHtml components={components}>{copy.question}</Markdown></div></section>
   <section id="study-answer"><h2>{ui("Saved answer")}</h2><div className="study-copy-prose"><Markdown remarkPlugins={[remarkMath,studyCitations,studyWorkedSteps]} rehypePlugins={[studyMath]} skipHtml components={components}>{copy.answer}</Markdown></div></section>
   {copy.calculation?<section id="study-check" className="study-copy-record"><h2>{ui("Calculation record")}</h2><p>{copy.calculation.calculations.length}  {ui("listed")} {copy.calculation.calculations.length===1?ui("calculation was"):ui("calculations were")}  {ui("computed with exact arithmetic")}{copy.calculation.number_system.modulus===null?ui("; no modulus was declared."):ui("modulo {value0}.",{value0:copy.calculation.number_system.modulus})}</p><p>{ui("The check applies to this typed request and saved answer. It does not verify original assignment wording, instructor requirements, source transcription or later edits.")}</p><p>{ui("Computed")} {studyCopyDate(copy.calculation.computed_at,copy.timezone)}</p><details><summary>{ui("Inspect the saved check record")}</summary><dl><dt>{ui("Request SHA-256")}</dt><dd>{copy.calculation.question_sha256}</dd><dt>{ui("Answer SHA-256")}</dt><dd>{copy.calculation.answer_sha256}</dd><dt>{ui("Exact engine")}</dt><dd>{ui("SymPy")} {copy.calculation.engine.version}</dd><dt>{ui("Engine source SHA-256")}</dt><dd>{copy.calculation.engine.source_sha256}</dd></dl></details></section>:<section id="study-check" className="study-copy-record"><h2>{ui("Review before using")}</h2><p>{ui("This answer has no exact calculation record. Treat it as an AI study draft and check its claims and requirements against the originals.")}</p></section>}
   <section id="study-sources"><h2>{ui("Sources available for this answer")}</h2><p>{ui("Citation numbers in the answer point here. An available source was not necessarily cited. Original images and diagrams are not embedded in this copy.")}</p>{copy.sources.length?<ol className="study-copy-sources">{copy.sources.map(source=><li key={source.number} id={'study-source-'+source.number}><h3>{source.href?<a href={source.href} target="_blank" rel="noopener noreferrer">{source.title}</a>:source.title}</h3><p>{source.kind==='note'?ui("Student notes"):source.kind==='ai_draft'?ui("AI study draft"):source.kind==='moodle'?ui("Saved Moodle page"):ui("Saved course material")}{source.observed_at?ui("- Saved")+studyCopyDate(source.observed_at,copy.timezone):''}</p>{source.state==='changed'&&<p className="study-source-warning">{ui("A newer source version exists. The link opens the version saved with this answer.")}</p>}{source.state==='unavailable'&&<p className="study-source-warning">{ui("This version is no longer readable in the vault.")}</p>}{source.original_url&&<p><a href={source.original_url} target="_blank" rel="noopener noreferrer">{ui("Open Moodle original")}</a></p>}{source.version_id&&<p className="study-source-version">{ui("Saved version:")} {source.version_id}</p>}</li>)}</ol>:<p>{ui("No course source was available. This copy does not establish official assignment wording, dates, receipts or grades.")}</p>}</section>
   <footer className="study-copy-footer">{ui("Neyvu study copy. No coursework was submitted. Reopen the original conversation for corrections and further work.")}</footer>
  </main>
 </div>;
}

'use client';
import {useI18n,LanguageSelect} from "../language";
import type {CSSProperties} from "react";
import RequestForm from "./request-form";
import {MaterialConnection} from './chat-demonstration';
import {NextDueDemo, NextDueTeaser} from './next-due-demo';
import {ProductTour} from "./constellation-tour";
import {PRODUCT_NAME, WORDMARK_LIGHT as WORDMARK, SYMBOL_LIGHT} from "../../../lib/brand";
import {creatorName,creatorPortfolio,supportEmail} from '../../../lib/beta/public-identity';
import {companionDownloadCopy,companionRelease} from '../../../lib/beta/public-site';
import {PilotQuestions} from './pilot-questions';
import {ContextStory,ContextOutlook} from './context-story';

/** Static product explanations render on the server. */
export function ConstellationContent({ready}:{ready:boolean}){
 const {t:ui,language}=useI18n();const copy=(en:string,es:string)=>language==='es'?es:en;return <>

<header className="top">
<div className="top-in">
<a className="wordmark" href="#top" aria-label={ui("{value0}, back to top",{value0:PRODUCT_NAME})}>{WORDMARK ? <img className="brand-wordmark" src={WORDMARK} width="158" height="40" alt={PRODUCT_NAME} /> : PRODUCT_NAME}</a>
<span className="badge badge-d">{ui("Neyvu at Acadia")}</span>
<nav className="top-nav" aria-label={ui("Primary")}>
<a className="nav-demo" href="#next-due-demo">{copy('Try the demo','Probar la demo')}</a>
<a className="nav-quiet nav-institutions" href="#institutions">{copy('For institutions','Instituciones')}</a>
<a className="nav-access" href="#request-access"><span className="nav-join-full">{copy('Request access','Solicitar acceso')}</span><span className="nav-join-short">{copy('Join','Unirme')}</span></a>
<a className="nav-quiet nav-questions" href="#questions">{copy('Questions','Preguntas')}</a>
<a className="nav-quiet" href="/beta">{ui("Sign in")}</a>
<LanguageSelect compact/>
</nav>
<button disabled={true} className="motion-toggle" type="button" aria-label={ui("Pause motion")} aria-pressed="false">
<svg className="i-pause" viewBox="0 0 14 14" aria-hidden="true"><rect x="3" y="2" width="2.4" height="10" rx=".6" fill="currentColor" /><rect x="8.6" y="2" width="2.4" height="10" rx=".6" fill="currentColor" /></svg>
<svg className="i-play" viewBox="0 0 14 14" aria-hidden="true"><path d="M4 2.2v9.6L11.6 7z" fill="currentColor" /></svg>
<span className="mt-label">{ui("Pause motion")}</span>
</button>
</div>
</header>
<main>
<section className="story" id="top" aria-labelledby="hero-title" tabIndex={-1}>
<div className="hero-copy">
<div className="wrap">
<div className="hero-inner">
<span className="badge badge-m">{ui("Neyvu at Acadia")}</span>
<h1 id="hero-title">{copy('The context layer for learning.','La capa de contexto para el aprendizaje.')}<span className="stop" aria-hidden="true"></span></h1>
<p className="lede">{copy('Neyvu brings your courses, files and notes together and tells you what’s current, what applies to you and what to do next, always with the source.','Neyvu reúne tus cursos, archivos y apuntes, y te dice qué está vigente, qué te aplica y qué sigue, siempre con la fuente.')}</p>
<div className="ctas landing-hero-actions">
<a className="btn btn-primary" href="#request-access" aria-describedby="landing-access-note">{copy('Request access','Solicitar acceso')}</a>
<a className="btn btn-primary" href={companionRelease.installUrl} aria-describedby="landing-access-note">{copy('Get it from Microsoft Store','Obtener en Microsoft Store')}</a>
</div>
<p className="fine" id="landing-access-note">{copy('Free Windows download. Connecting Moodle requires approved access for Acadia students.','Descarga gratuita para Windows. Para conectar Moodle, tu acceso como estudiante de Acadia debe estar aprobado.')}</p>
<p className="mobile-use">{ui("Use Neyvu on your phone. Connect Moodle from your computer.")}</p>
</div>
</div>
</div>
<div className="hero-conversation next-due-hero next-due-theme"><NextDueTeaser/></div>
<div className="story-scroll-hint" aria-hidden="true"><span>{copy('Scroll to bring it together','Desplázate para unirlo todo')}</span><i/></div>
<div className="pin">
<div className="stage" aria-hidden="true">
<i className="u-probe"></i>
<div className="camera">
<div className="plane doc p-moodle" data-role="doc"><div className="drift">
<span className="tag">{"01"}</span>
<div className="sheet ui">
<div className="m-bar"><i className="m-logo"></i><span>{ui("Dashboard")}</span><span className="on">{ui("My courses")}</span><i className="m-av"></i></div>
<div className="m-body">
<p className="m-crumb">{ui("My courses / DEMO 1010")}</p>
<p className="m-title">{ui("DEMO 1010: Linear Algebra Sample")}</p>
<p className="m-tabs"><span className="on">{ui("Course")}</span><span>{ui("Participants")}</span><span>{ui("Grades")}</span><span>{ui("Activities")}</span></p>
<p className="m-sec-h">{ui("General")}</p>
<p className="m-act"><i className="ic ic-forum"></i>{ui("Announcements")}</p>
<p className="m-sec-h">{ui("Week 3")}</p>
<p className="m-act"><i className="ic ic-assign"></i>{ui("Problem Set 2: Eigenvalues (sample assignment)")}</p>
</div>
<span className="stamp">{ui("Demo course")}</span>
<i className="shade"></i><i className="edge"></i>
</div>
<i className="anc anc-l"></i><i className="anc anc-r"></i>
</div></div>
<div className="plane doc p-forum" data-role="doc"><div className="drift">
<span className="tag">{"02"}</span>
<div className="sheet ui forum">
<p className="f-top"><i className="ic ic-forum"></i>{ui("Announcements · DEMO 1010")}</p>
<p className="f-title">{ui("Problem Set 2 is posted")}</p>
<p className="f-by">{ui("by the course instructor")}</p>
<p className="f-body">{ui("It's due Sunday, October 11, 11:59 PM (Halifax time).")}</p>
<span className="stamp">{ui("Demo course")}</span>
<i className="shade"></i><i className="edge"></i>
</div>
</div></div>
<div className="plane doc p-wk3" data-role="doc"><div className="drift">
<span className="tag">{"03"}</span>
<div className="sheet panel note">
<p className="n-meta">{ui("DEMO 1010 · Saved")}</p>
<p className="n-title">{ui("Week 3 lecture notes: Eigenvalues")}</p>
<ul className="n-lines">
<li>{ui("An eigenvector of a square matrix A is a nonzero vector v with A v = λ v.")}</li>
<li>{ui("Find eigenvalues from the characteristic polynomial: det(A − λI) = 0.")}</li>
<li>{ui("Example: A = [[2, 1], [1, 2]] gives (2 − λ)² − 1 = 0, so λ = 3 or λ = 1.")}</li>
</ul>
<span className="stamp">{ui("Demo course")}</span>
<i className="shade"></i><i className="edge"></i>
</div>
</div></div>
<div className="plane doc p-ps2" data-role="doc"><div className="drift">
<span className="tag">{"04"}</span>
<div className="sheet paper pdf">
<p className="pdf-run"><span>{ui("DEMO 1010 · Linear Algebra Sample")}</span><span>{ui("Page 1")}</span></p>
<p className="pdf-title">{ui("Problem Set 2: Eigenvalues")}</p>
<p className="pdf-sub">{ui("Sample assignment. Due Sunday, October 11, 11:59 PM (Halifax time).")}</p>
<ol className="pdf-q">
<li>{ui("Find the eigenvalues and eigenvectors of")}<i>{"A"}</i>{" = "}<span className="mx"><span>{"2"}</span><span>{"1"}</span><span>{"1"}</span><span>{"2"}</span></span>{"."}</li>
<li>{ui("Show that the 2×2 matrix for a 90° rotation has no real eigenvalues.")}</li>
<li>{ui("Diagonalize")}<i>{"B"}</i>{" = "}<span className="mx"><span>{"4"}</span><span>{"1"}</span><span>{"2"}</span><span>{"3"}</span></span>{ui("if possible.")}</li>
<li>{ui("Explain why similar matrices have the same characteristic polynomial.")}</li>
<li>{ui("True or false: every real symmetric matrix is diagonalizable. Justify your answer.")}</li>
</ol>
<span className="stamp">{ui("Demo course")}</span>
<i className="shade"></i><i className="edge"></i>
</div>
</div></div>
<div className="plane doc p-lab" data-role="doc"><div className="drift">
<span className="tag">{"06"}</span>
<div className="sheet ui">
<div className="m-bar"><i className="m-logo"></i><span>{ui("Dashboard")}</span><span className="on">{ui("My courses")}</span><i className="m-av"></i></div>
<div className="m-body">
<p className="m-crumb">{ui("My courses / DEMO 2020 / Lab report 1")}</p>
<p className="a-type"><i className="ic ic-assign"></i>{ui("Assignment")}</p>
<p className="m-title">{ui("Lab report 1: Sampling distributions")}</p>
<div className="bars"><i style={{"--bw": "94%"} as CSSProperties}></i><i style={{"--bw": "86%"} as CSSProperties}></i><i style={{"--bw": "58%"} as CSSProperties}></i></div>
<p className="a-h">{ui("Submission status")}</p>
<div className="a-row"><i></i><i></i></div>
<div className="a-row"><i></i><i></i></div>
</div>
<span className="stamp">{ui("Demo course")}</span>
<i className="shade"></i><i className="edge"></i>
</div>
</div></div>
<div className="plane doc p-lab1" data-role="doc"><div className="drift">
<span className="tag">{"05"}</span>
<div className="sheet panel note">
<p className="n-meta">{ui("DEMO 2020 · Saved")}</p>
<p className="n-title">{ui("Lab 1 notes: Sampling distributions")}</p>
<div className="bars dark"><i style={{"--bw": "92%"} as CSSProperties}></i><i style={{"--bw": "80%"} as CSSProperties}></i><i style={{"--bw": "88%"} as CSSProperties}></i><i style={{"--bw": "46%"} as CSSProperties}></i></div>
<span className="stamp">{ui("Demo course")}</span>
<i className="shade"></i><i className="edge"></i>
</div>
</div></div>
<div className="plane gap p-gap" data-role="gap"><div className="drift">
<div className="gapsheet">
<p className="g-text">{ui("Restricted page: not collected")}</p>
<p className="g-course">{ui("DEMO 2020 · shown so you know it's missing")}</p>
</div>
</div></div>
<div className="plane label k-a" data-role="label"><div className="drift">
<div className="klabel"><span className="kl-code">{ui("DEMO 1010")}</span><span className="kl-name">{ui("Linear Algebra Sample")}</span></div>
</div></div>
<div className="plane label k-b" data-role="label"><div className="drift">
<div className="klabel"><span className="kl-code">{ui("DEMO 2020")}</span><span className="kl-name">{ui("Statistics lab")}</span></div>
</div></div>
<div className="plane frag f-email" data-role="frag"><div className="drift">
<div className="sheet panel mail">
<p className="mail-h">{ui("Inbox")}<span>{ui("Today")}</span></p>
<p className="mail-r"><b>{ui("Library")}</b><span>{ui("Your item is due back soon")}</span></p>
<p className="mail-r"><b>{ui("Lab partner")}</b><span>{ui("Re: meeting before Friday?")}</span></p>
<p className="mail-r"><b>{ui("Student union")}</b><span>{ui("This week on campus")}</span></p>
<i className="shade"></i>
</div>
</div></div>
<div className="plane frag f-chat" data-role="frag"><div className="drift">
<div className="sheet chat">
<p className="c-h">{ui("Stats lab group")}</p>
<p className="c-b">{ui("anyone know if q3 is due friday??")}</p>
<p className="c-b me">{ui("check moodle")}</p>
<i className="shade"></i>
</div>
</div></div>
<div className="plane frag f-tabs1" data-role="frag"><div className="drift">
<div className="sheet tabs"><span>{ui("DEMO 1010")}</span><span>{ui("PS2.pdf")}</span><span>{ui("Week 3 slides")}</span><span>{ui("Inbox")}</span><span>{ui("Group chat")}</span><span>{ui("Lab 1")}</span><span>{ui("Notes")}</span><span>{ui("Search")}</span><i className="shade"></i></div>
</div></div>
<div className="plane frag f-tabs2" data-role="frag"><div className="drift">
<div className="sheet tabs"><span>{ui("DEMO 2020")}</span><span>{ui("Lab report 1")}</span><span>{ui("Calendar")}</span><span>{ui("Forum")}</span><span>{ui("Grades")}</span><span>{ui("Docs")}</span><i className="shade"></i></div>
</div></div>
</div>
</div>
<svg className="hero-thread" aria-hidden="true" focusable="false"><path className="ht-path" pathLength="1" d="M0 0" /><circle className="ht-end" r="3.5" cx="-20" cy="-20" /></svg>
<div className="beats">
<div className="beat beat-chaos">
<div className="wrap">
<p className="beat-line">{copy('Learning is scattered.','El aprendizaje está disperso.')}</p>
<p className="beat-sub">{copy('A deadline in Moodle. A reading in a PDF. A change in an announcement. AI can answer almost anything, except what applies to you.','Una fecha en Moodle. Una lectura en un PDF. Un cambio en un aviso. La IA puede responder casi todo, menos lo que te aplica a ti.')}</p>
<div className="tabs40" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
</div>
</div>
<div className="beat beat-clarity">
<div className="bc-main">
<div className="wrap">
<h2 className="bc-title">{copy('What’s current? Does it apply to me? What do I do next?','¿Qué está vigente? ¿Me aplica? ¿Qué sigue?')}</h2>
<p className="bc-text">{copy('Neyvu answers the three questions from your own course sources, and shows you where every answer came from.','Neyvu responde las tres preguntas con las fuentes de tus propios cursos y te muestra de dónde sale cada respuesta.')}</p>
<div className="core-figure">
<div>
<p className="cf-course"><b>{ui("DEMO 1010")}</b>{ui("Linear Algebra Sample")}</p>
<ol className="cf-list">
<li className="is-paper"><span className="cf-n">{"01"}</span>{ui("Course page")}</li>
<li className="is-paper"><span className="cf-n">{"02"}</span>{ui("Announcement: Problem Set 2 is posted")}</li>
<li className="is-panel"><span className="cf-n">{"03"}</span>{ui("Week 3 lecture notes: Eigenvalues")}</li>
<li className="is-paper"><span className="cf-n">{"04"}</span>{ui("Problem Set 2: Eigenvalues (sample assignment)")}</li>
</ol>
</div>
<div>
<p className="cf-course"><b>{ui("DEMO 2020")}</b>{ui("Statistics lab")}</p>
<ol className="cf-list">
<li className="cf-gap">{ui("Restricted page: not collected")}</li>
<li className="is-panel"><span className="cf-n">{"05"}</span>{ui("Lab 1 notes: Sampling distributions")}</li>
<li className="is-paper"><span className="cf-n">{"06"}</span>{ui("Lab report 1: Sampling distributions")}</li>
</ol>
</div>
<div className="cf-out" aria-hidden="true">
<p>{ui("Left out")}</p>
<span>{ui("Inbox")}</span>
<span>{ui("Group chat")}</span>
</div>
</div>
</div>
</div>
<div className="bc-caption"><div className="wrap"><p>{ui("Your inbox and chats aren't connected.")}</p></div></div>
</div>
</div>
</div>
</section>
<ContextStory language={language}/><NextDueDemo/><MaterialConnection/><ProductTour /><ContextOutlook language={language}/>
<section className="pilot-story" aria-labelledby="pilot-story-title"><div className="wrap pilot-story-grid">
<div className="pilot-sculpture" aria-hidden="true"><div className="pilot-orbit"/><div className="pilot-mark"><img src={SYMBOL_LIGHT} width="130" height="130" alt=""/></div><span className="pilot-note pn-one">{copy('Your courses','Tus cursos')}</span><span className="pilot-note pn-two">{copy('Your questions','Tus preguntas')}</span><span className="pilot-note pn-three">{copy('Your next step','Tu siguiente paso')}</span></div>
<div className="pilot-story-copy"><p className="story-kicker">{copy('Built by a student, for student life.','Creado por un estudiante para la vida universitaria.')}</p><h2 className="sec-title" id="pilot-story-title">{copy('Help shape the context layer you wish you already had.','Ayuda a crear la capa de contexto que te gustaría tener.')}</h2><p>{copy('I’m building Neyvu around the small moments that make university feel harder than it needs to: finding the right reading, getting unstuck, and knowing what to do next.','Estoy creando Neyvu para esos momentos que hacen la universidad más complicada: encontrar la lectura correcta, salir de una duda y saber qué sigue.')}</p><p>{copy('At Acadia, you can try it with your own courses and help decide what comes next. Tell me what helps, what feels confusing, and what you would use every day.','En Acadia puedes probarlo con tus cursos y ayudar a decidir qué sigue. Cuéntame qué te ayuda, qué te confunde y qué usarías cada día.')}</p><a className="founder-credit" href={creatorPortfolio}>{creatorName}<span>{copy('Student and Neyvu’s builder','Estudiante y creador de Neyvu')}</span></a></div>
</div></section>
<section className="getin" id="companion-download" aria-labelledby="getin-title">
<div className="wrap">
<h2 className="sec-title" id="getin-title">{copy('Get Neyvu Companion','Descarga Neyvu Companion')}</h2>
<p className="companion-release-detail">{copy('Version','Versión')} {companionRelease.version} · {companionRelease.operatingSystem}</p>
<p className="companion-release-detail">{companionDownloadCopy(language)}</p>
<a className="btn btn-primary" href={companionRelease.installUrl}>{copy('Get it from Microsoft Store','Obtener en Microsoft Store')}</a>
<p className="companion-mac-note">{copy('Using a Mac?','¿Usas una Mac?')} <a href="/beta/start#devices">{copy('Check Mac availability and setup.','Consulta la disponibilidad y la configuración para Mac.')}</a></p>
<h3 className="companion-steps-title">{copy('From setup to your first answer','De la configuración a tu primera respuesta')}</h3>
<ol className="steps">
<li><span className="sn" aria-hidden="true">1</span><p><b>{copy('Sign in to Neyvu','Inicia sesión en Neyvu')}</b>{copy('Request access with your Google account. Once approved, sign in with that same account in Companion.','Solicita acceso con tu cuenta de Google. Una vez aprobada, inicia sesión en Companion con esa misma cuenta.')}</p></li>
<li><span className="sn" aria-hidden="true">2</span><p><b>{copy('Import your Moodle courses','Importa tus cursos de Moodle')}</b>{copy('Sign in to Moodle yourself, choose your courses, and review what Companion saved.','Inicia sesión en Moodle, elige tus cursos y revisa qué guardó Companion.')}</p></li>
<li><span className="sn" aria-hidden="true">3</span><p><b>{copy('Open Today and ask','Abre Hoy y pregunta')}</b>{copy('Check your upcoming work. Ask “What should I work on this week?” and open the cited sources.','Revisa tus próximas tareas. Pregunta «¿En qué debo trabajar esta semana?» y abre las fuentes citadas.')}</p></li>
</ol>
</div>
</section>
<section className="access" id="request-access" aria-labelledby="access-title" tabIndex={-1}>
<div className="wrap access-grid">
<div className="access-head">
<h2 className="sec-title" id="access-title">{copy('Try Neyvu with your own courses.','Prueba Neyvu con tus propios cursos.')}</h2>
<p>{copy('Request free access as an Acadia student. Use the Google account you want to sign in with. I review every request personally.','Solicita acceso gratuito como estudiante de Acadia. Usa la cuenta de Google con la que quieres iniciar sesión. Reviso personalmente cada solicitud.')}</p>
</div>
<RequestForm ready={ready} />
</div>
</section>
<section className="limits" id="checks" aria-labelledby="limits-title">
<div className="wrap limits-grid">
<div className="limits-head">
<h2 className="sec-title" id="limits-title">{ui("What to check before using an answer.")}</h2>
<p>{copy('Your assistant works with saved material. Keep it up to date and follow your instructor’s rules for using study tools.','Tu asistente trabaja con material guardado. Mantenlo al día y sigue las reglas de tus docentes sobre el uso de herramientas de estudio.')}</p>
</div>
<ol className="limits-list">
<li><span className="ln">{"1"}</span><div><h3>{ui("Answers depend on the saved materials.")}</h3><p>{ui("Some pages and files cannot be collected or read. Check the coverage information and original source before relying on an answer.")}</p></div></li>
<li><span className="ln">{"2"}</span><div><h3>{ui("Check official dates and requirements in Moodle.")}</h3><p>{ui("Saved copies can be out of date. Confirm deadlines, requirements and submission status in Moodle.")}</p></div></li>
<li><span className="ln">{"3"}</span><div><h3>{copy('Follow your course rules.','Sigue las reglas de tu curso.')}</h3><p>{ui("It helps you understand and plan. Check its explanations against your sources. It never submits anything for you.")}</p></div></li>
<li><span className="ln">{"4"}</span><div><h3>{ui("Connect Moodle from your computer.")}</h3><p>{copy('Sign in yourself and choose your courses in the guided setup. Keep your computer awake and connected while Companion collects course materials. You can open the workspace on your phone in a browser.','Inicia sesión y elige tus cursos en la configuración guiada. Mantén tu computadora despierta y conectada mientras Companion recopila los materiales. Puedes abrir tu espacio en el navegador de tu teléfono.')}</p></div></li>
<li><span className="ln">{"5"}</span><div><h3>{ui("Start with the notes and files you already have.")}</h3><p>{ui("Add class notes, PDFs, Word documents, PowerPoint slides, text or Markdown files, or copy a folder of course material. Scans, images, equations and diagrams may need a readable text copy or review. Find material by its text and past conversations by their titles.")}</p></div></li>
<li><span className="ln">{"6"}</span><div><h3>{copy('Where questions are processed','Dónde se procesan tus preguntas')}</h3><p>{copy('Right now, Neyvu processes questions on a computer run by the project. See the privacy notice for how Neyvu handles your data.','Por ahora, Neyvu procesa las preguntas en una computadora administrada por el proyecto. Consulta el aviso de privacidad para saber cómo se tratan tus datos.')}</p></div></li>
</ol>
</div>
</section>
<PilotQuestions/>

</main>
<footer className="foot">
<div className="wrap foot-in">
<span className="wordmark">{WORDMARK ? <img className="brand-wordmark" src={WORDMARK} width="158" height="40" alt={PRODUCT_NAME} /> : PRODUCT_NAME}</span>
<div className="foot-credit"><span>{language==='es'?'Creado por':'Built by'} <a href={creatorPortfolio} rel="noopener noreferrer">{creatorName}</a></span><small>{language==='es'?'Un proyecto estudiantil independiente. No operado por Acadia University.':'An independent student project. Not operated by Acadia University.'}</small></div>
<nav className="foot-links" aria-label={language==='es'?'Información de Neyvu':'Neyvu information'}><a href="/beta">{ui("Sign in")}</a><a href="#companion-download">{ui("Downloads")}</a><a href="/beta/join/privacy">{ui("Privacy")}</a><a href="/beta/join/terms">{language==='es'?'Términos y condiciones':'Terms and conditions'}</a><a href={'mailto:'+supportEmail}>{language==='es'?'Contacto':'Contact'}</a></nav>
</div>
</footer>

</>; }

'use client';

import {useEffect,useRef,useState} from 'react';
import {addDays,agenda,zoneDate} from '../../lib/beta/agenda';
import type {GuidedSetupProgress} from '../../lib/beta/onboarding';
import {useI18n} from './language';
import {usePresentation} from './use-presentation';
import './guided-setup.css';

type Props={timezone:string;onLeave:()=>void;onSchedule:()=>void;onFiles:(courseId:string)=>void;onAsk:(courseId:string,question:string)=>Promise<boolean>};
const welcomeSteps=['start','connect','reading','ready','week'] as const;
type WelcomeStep=(typeof welcomeSteps)[number];

export default function GuidedSetup({timezone,onLeave,onSchedule,onFiles,onAsk}:Props){
 const {language,locale}=useI18n();
 usePresentation();
 const copy=(en:string,es:string)=>language==='es'?es:en;
 const [progress,setProgress]=useState<GuidedSetupProgress|null>(null);
 const [error,setError]=useState(false),[week,setWeek]=useState(false),[opening,setOpening]=useState(false);
 const [retry,setRetry]=useState(0);
 const [device,setDevice]=useState<'windows'|'mac'|null>(null);
 const [checkedAt,setCheckedAt]=useState<Date|null>(null);
 const [firstCourse,setFirstCourse]=useState<string>();
 const [returning,setReturning]=useState<boolean|null>(null);
 const [replayStep,setReplayStep]=useState<WelcomeStep|null>(null);
 const heading=useRef<HTMLHeadingElement>(null);
 const focusWelcomeStep=useRef(false);
 const previouslyReadable=useRef<boolean|null>(null);
 const [celebrate,setCelebrate]=useState(false);

 useEffect(()=>{
  let stopped=false,controller:AbortController;
  let timer:ReturnType<typeof setTimeout>,deadline:ReturnType<typeof setTimeout>;
  async function check(){
   controller=new AbortController();
   deadline=setTimeout(()=>controller.abort(),12000);
   try{
    const response=await fetch('/api/beta/onboarding?view=guided',{cache:'no-store',signal:controller.signal});
    if(!response.ok)throw Error();
    const next:GuidedSetupProgress=await response.json();
    if(stopped)return;
    if(!next||typeof next.paired!=='boolean'||!Number.isSafeInteger(next.selected)||!Array.isArray(next.courses)||!Array.isArray(next.meetings)||next.courses.some(course=>!course||typeof course.id!=='string'||typeof course.title!=='string'||!['found','saved','readable'].includes(course.state)))throw Error();
    const available=next.courses.filter(course=>course.state==='readable');
    const readable=available.length>0;
    setReturning(previous=>previous??(next.paired||next.selected>0));
    setFirstCourse(previous=>available.some(course=>course.id===previous)?previous:available[0]?.id);
    if(previouslyReadable.current===false&&readable)setCelebrate(true);
    previouslyReadable.current=readable;
    setProgress(next);setCheckedAt(new Date());setError(false);
   }catch{if(!stopped)setError(true);}
   finally{clearTimeout(deadline);if(!stopped)timer=setTimeout(()=>{void check()},6000);}
  }
  void check();
  return()=>{stopped=true;controller?.abort();clearTimeout(timer);clearTimeout(deadline)};
 },[retry]);

 useEffect(()=>{if(!celebrate)return;const timer=setTimeout(()=>setCelebrate(false),2200);return()=>clearTimeout(timer)},[celebrate]);

 const ready=progress?.courses.find(course=>course.id===firstCourse&&course.state==='readable');
 const stage=replayStep??(week&&ready?'week':ready?'ready':progress?.selected?'reading':progress?.paired?'connect':'start');
 const suggestion=copy('What should I work on next in this course?','¿En qué debería trabajar primero en este curso?');
 useEffect(()=>{
  if(stage==='week'||focusWelcomeStep.current)heading.current?.focus();
  focusWelcomeStep.current=false;
 },[stage,replayStep]);

 function showWelcomeStep(next:WelcomeStep|null){
  focusWelcomeStep.current=true;
  setReplayStep(next);
 }

 async function openChat(){
  if(!ready||opening)return;
  setOpening(true);
  try{await onAsk(ready.id,suggestion);}
  finally{setOpening(false);}
 }

 const start=zoneDate(new Date(),timezone);
 const sessions=agenda([],progress?.meetings||[],start,addDays(start,6),timezone).filter(item=>item.kind!=='office_hours');
 const dateLabel=(date:string)=>new Intl.DateTimeFormat(locale,{weekday:'short',month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));
 const stages=[copy('Connect','Conectar'),copy('Courses','Cursos'),copy('Readable','Legible'),copy('Your week','Tu semana')];
 const current=stage==='week'?3:stage==='ready'?2:stage==='reading'?1:0;
 const welcome={
  start:{
   title:copy('Meet Neyvu.','Conoce Neyvu.'),
   description:copy('Follow a Moodle course from its first saved page to a weekly plan and a cited answer.','Sigue un curso de Moodle desde su primera página guardada hasta un plan semanal y una respuesta con cita.'),
   action:copy('See how Moodle connects','Ver cómo se conecta Moodle'),
  },
  connect:{
   title:copy('Your courses start in Moodle.','Tus cursos empiezan en Moodle.'),
   description:copy('Companion uses your signed-in Moodle window. You choose the courses and labs it can collect.','Companion usa tu ventana de Moodle con sesión iniciada. Tú eliges los cursos y laboratorios que puede recopilar.'),
   action:copy('See what Neyvu saves','Ver qué guarda Neyvu'),
  },
  reading:{
   title:copy('Course pages become saved material.','Las páginas se convierten en material guardado.'),
   description:copy('Neyvu keeps Moodle pages and linked originals with their sources. A saved file becomes searchable once its text is readable.','Neyvu conserva las páginas y los archivos originales de Moodle junto con sus fuentes. Puedes buscar en un archivo guardado cuando su texto es legible.'),
   action:copy('See when you can ask','Ver cuándo puedes preguntar'),
  },
  ready:{
   title:copy('Put your courses to work.','Pon tus cursos en marcha.'),
   description:copy('Once a course has readable material, you can ask about it. Open a citation to see the saved passage behind the answer.','Cuando un curso tiene material legible, puedes preguntar sobre él. Abre una cita para ver el fragmento guardado que respalda la respuesta.'),
   action:copy('See how your week comes together','Ver cómo se arma tu semana'),
  },
  week:{
   title:copy('Here’s how your week comes together.','Así se arma tu semana.'),
   description:copy('Review the class times Neyvu finds in your course material and confirm the ones that apply to you. Then ask what to work on and open a citation to check the answer.','Revisa los horarios que Neyvu encuentra en tus materiales y confirma los que te correspondan. Luego pregunta en qué trabajar y abre una cita para comprobar la respuesta.'),
   action:copy('Return to your setup','Volver a tu configuración'),
  },
 };
 const scene=replayStep?welcome[replayStep]:null;
 const replayIndex=replayStep?welcomeSteps.indexOf(replayStep):-1;
 const title=scene?.title??{
  start:copy('Meet Neyvu.','Conoce Neyvu.'),
  connect:copy('Connect your Moodle account.','Conecta tu cuenta de Moodle.'),
  reading:copy('Your courses are coming in.','Tus cursos se están importando.'),
  ready:copy('Let’s put your courses to work.','Pongamos tus cursos en marcha.'),
  week:copy('Here’s your week.','Esta es tu semana.'),
 }[stage];

 return <main className="nu-guided-shell" data-stage={stage}>
  <header className="nu-guided-header">
   <div className="nu-guided-mark" aria-hidden="true">
    <svg viewBox="0 0 100 100" width="60" height="60" focusable="false">
     <path fill="#195b65" d="M31 32C26 30 27 25 31 19C39 7 50 4 62 9C69 12 74 20 79 29C82 36 79 43 73 46C68 49 64 47 59 44Z"/>
     <path fill="#2457cc" d="M19 45C25 35 38 33 41 45C43 54 40 65 42 75C42 84 45 88 48 92H26C10 90 3 80 5 64C7 57 13 49 19 45Z"/>
     <path fill="#42a4ed" d="M53 68L85 48C96 65 98 76 90 85C84 92 78 93 68 93H62C46 93 43 77 53 68Z"/>
    </svg>
   </div>
   <div><strong>Neyvu</strong><span>{scene?copy('Welcome replay','Repaso de bienvenida'):copy('Your first session','Tu primera sesión')}</span></div>
   <button type="button" className="nu-guided-quiet" onClick={scene?()=>showWelcomeStep(null):onLeave}>{scene?copy('Return to your setup','Volver a tu configuración'):copy('Return to Today','Volver a Hoy')}</button>
  </header>
  <div className="nu-guided-main">
  <ol className="nu-guided-trail" aria-label={scene?copy('Welcome walkthrough','Recorrido de bienvenida'):copy('Setup progress','Progreso de configuración')}>
   {stages.map((label,index)=><li key={label} aria-current={index===current?'step':undefined} data-complete={index<current}>{label}</li>)}
  </ol>
  {!scene&&error&&<p className="nu-guided-alert" role="status">{copy('I couldn’t check setup. Your saved material is kept.','No pude comprobar la configuración. Tus materiales guardados se conservan.')} <button type="button" onClick={()=>setRetry(value=>value+1)}>{copy('Check again','Comprobar de nuevo')}</button></p>}
  {!progress&&!error?<p role="status">{copy('Checking your setup…','Comprobando la configuración…')}</p>:<>
   <header className="nu-guided-hero">
    <div className="nu-guided-illustration" key={scene?'welcome-replay':'live-setup'} data-stage={stage} data-celebrate={(!!scene||celebrate)&&stage==='ready'} aria-hidden="true">
     <svg viewBox="26 40 308 310" focusable="false">
      <defs>
       <pattern id="neyvu-setup-paper" width="24" height="24" patternUnits="userSpaceOnUse">
        <path d="M24 0H0V24" className="nu-guided-grid" fill="none"/>
       </pattern>
      </defs>
      <rect x="34" y="52" width="292" height="280" rx="18" fill="url(#neyvu-setup-paper)"/>
      <g className="nu-guided-hero-mark" transform="translate(95 105) scale(1.7)">
       <path className="nu-guided-piece nu-guided-piece-a" fill="#195b65" d="M31 32C26 30 27 25 31 19C39 7 50 4 62 9C69 12 74 20 79 29C82 36 79 43 73 46C68 49 64 47 59 44Z"/>
       <path className="nu-guided-piece nu-guided-piece-b" fill="#2457cc" d="M19 45C25 35 38 33 41 45C43 54 40 65 42 75C42 84 45 88 48 92H26C10 90 3 80 5 64C7 57 13 49 19 45Z"/>
       <path className="nu-guided-piece nu-guided-piece-c" fill="#42a4ed" d="M53 68L85 48C96 65 98 76 90 85C84 92 78 93 68 93H62C46 93 43 77 53 68Z"/>
      </g>
      <g className="nu-guided-calendar-art">
       <rect x="54" y="95" width="252" height="224" rx="16"/>
       <path d="M54 143H306M104 143V319M154 143V319M205 143V319M255 143V319M54 201H306M54 260H306"/>
       <rect className="nu-guided-event" x="62" y="158" width="34" height="26" rx="5"/>
       <rect className="nu-guided-event" x="163" y="213" width="34" height="26" rx="5"/>
       <rect className="nu-guided-event" x="262" y="272" width="34" height="26" rx="5"/>
      </g>
      <path className="nu-guided-orbit" d="M54 251C73 122 174 64 253 104S307 253 230 314 83 326 54 251Z" pathLength="1"/>
      <path className="nu-guided-orbit nu-guided-orbit-second" d="M80 129C140 82 261 125 293 206S225 339 145 309 38 183 80 129Z" pathLength="1"/>
      <circle className="nu-guided-signal" cx="82" cy="131" r="5"/>
      <circle className="nu-guided-signal" cx="276" cy="181" r="6"/>
      <circle className="nu-guided-signal" cx="225" cy="313" r="4"/>
      <g className="nu-guided-sheet nu-guided-sheet-back">
       <rect x="103" y="142" width="157" height="125" rx="16"/>
       <path d="M123 174H238M123 193H210M123 212H223"/>
      </g>
      <g className="nu-guided-sheet nu-guided-sheet-middle">
       <rect x="103" y="142" width="157" height="125" rx="16"/>
       <path d="M123 174H238M123 193H210M123 212H223"/>
      </g>
      <g className="nu-guided-sheet nu-guided-sheet-front">
       <rect x="103" y="142" width="157" height="125" rx="16"/>
       <path d="M123 174H238M123 193H210M123 212H223"/>
       <path className="nu-guided-check" d="m205 234 7 7 14-16" pathLength="1"/>
      </g>
     </svg>
    </div>
    <h1 key={stage} ref={heading} tabIndex={-1} className={stage==='ready'||stage==='week'?'nu-guided-week-heading':undefined}>{title}</h1>
    {returning&&!scene&&<button type="button" className="nu-guided-replay-entry" onClick={()=>showWelcomeStep('start')}>{copy('Replay welcome','Repetir la bienvenida')}</button>}
   </header>
   {scene?<section className="nu-guided-scene" key={stage}>
    <p>{scene.description}</p>
    {replayIndex===0&&<p className="nu-guided-help">{copy('This walkthrough keeps your saved courses and setup progress.','Este recorrido conserva tus cursos guardados y el progreso de tu configuración.')}</p>}
    <div className="nu-guided-replay-actions">
     {replayIndex>0&&<button type="button" onClick={()=>showWelcomeStep(welcomeSteps[replayIndex-1])}>{copy('Back','Atrás')}</button>}
     <button type="button" className="nu-guided-primary" onClick={()=>showWelcomeStep(welcomeSteps[replayIndex+1]??null)}>{scene.action}</button>
    </div>
   </section>:<>
   {stage==='start'&&<section className="nu-guided-scene" key={stage}>
    <p>{copy('Bring your Moodle courses into Neyvu. Review the class times found in your material to build your week, then ask a question and open its source.','Trae tus cursos de Moodle a Neyvu. Revisa los horarios encontrados en tu material para armar tu semana. Luego haz una pregunta y abre su fuente.')}</p>
    <ol className="nu-guided-intro-steps" aria-label={copy('What you’ll do','Qué vas a hacer')}>
     {[
      copy('Install Companion','Instala Companion'),
      copy('Choose courses in Moodle','Elige cursos en Moodle'),
      copy('Review your weekly plan','Revisa tu plan semanal'),
     ].map((step,index)=><li key={step}><span aria-hidden="true">{index+1}</span>{step}</li>)}
    </ol>
    <div className="nu-guided-devices" role="group" aria-label={copy('Choose your computer','Elige tu computadora')}><button type="button" aria-pressed={device==='windows'} onClick={()=>setDevice('windows')}>Windows</button><button type="button" aria-pressed={device==='mac'} onClick={()=>setDevice('mac')}>Mac</button></div>
    {device==='windows'&&<div className="nu-guided-device-step"><p>{copy('Install Companion from Microsoft Store, then open it and choose Connect Neyvu account.','Instala Companion desde Microsoft Store; ábrelo y elige Conectar cuenta de Neyvu.')}</p><a className="nu-guided-primary" href="https://apps.microsoft.com/detail/9N0000000000" target="_blank" rel="noopener">{copy('Open Microsoft Store','Abrir Microsoft Store')}</a><p className="nu-guided-help">{copy('Windows 11 · Intel or AMD. Keep this page open; we’ll pick up here.','Windows 11 · Intel o AMD. Mantén esta página abierta; continuaremos aquí.')}</p></div>}
    {device==='mac'&&<div className="nu-guided-device-step"><p>{copy('Apple menu → About This Mac tells you whether to choose Apple Silicon or Intel. Use the matching package from your Mac download.','Menú Apple → Acerca de esta Mac indica si necesitas Apple Silicon o Intel. Elige ese paquete en la descarga para Mac.')}</p>{progress?.mac_download_url?<a className="nu-guided-primary" href={progress.mac_download_url} target="_blank" rel="noopener">{copy('Open Mac download','Abrir descarga para Mac')}</a>:<p>{copy('Use the Mac download in your welcome email. If it is missing, ask the Neyvu owner for the correct package.','Usa la descarga para Mac de tu correo de bienvenida. Si falta, pide el paquete correcto al responsable de Neyvu.')}</p>}<p className="nu-guided-help">{copy('After installation, open Companion and choose Connect Neyvu account. Keep this page open. If macOS blocks the app, ask the Neyvu owner for help.','Después de instalar, abre Companion y elige Conectar cuenta de Neyvu. Mantén esta página abierta. Si macOS bloquea la app, pide ayuda al responsable de Neyvu.')}</p></div>}
    {!device&&<p className="nu-guided-help">{copy('On your phone? Continue at this same setup page on your computer. Your account keeps your place.','¿Estás en tu teléfono? Continúa en esta misma página desde tu computadora. Tu cuenta conserva el progreso.')}</p>}
    <p className="nu-guided-help">{copy('Already installed? Open Companion on your computer and choose Connect Neyvu account. This page will pick up your progress.','¿Ya lo instalaste? Abre Companion en tu computadora y elige Conectar cuenta de Neyvu. Esta página mostrará tu progreso.')}</p>
   </section>}
   {stage==='connect'&&<section className="nu-guided-scene" key={stage}>
    <p role="status">{copy('Your computer is paired. In Companion, open Moodle, sign in, and confirm your active courses and labs.','Tu computadora está vinculada. En Companion, abre Moodle, inicia sesión y confirma tus cursos y laboratorios activos.')}</p>
    <button type="button" onClick={()=>setRetry(value=>value+1)}>{copy('Check connection','Comprobar conexión')}</button>
   </section>}
   {stage==='reading'&&<section className="nu-guided-scene" key={stage}>
    <p role="status">{copy('I’ll show your week as soon as one course has readable Moodle material.','Te mostraré tu semana cuando un curso tenga material legible de Moodle.')}</p>
    <p>{copy('Keep Companion and Moodle open on your computer.','Mantén abiertos Companion y Moodle en tu computadora.')}</p>
   </section>}
   {stage==='ready'&&ready&&<section className="nu-guided-scene" key={stage}>
    <div className="nu-guided-card nu-guided-week-object">
     <div className="nu-guided-week-content">
     <span>{copy('Readable Moodle material','Material de Moodle legible')}</span>
     <h2>{ready.title}</h2>
     {progress!.courses.filter(course=>course.state==='readable').length>1&&<label className="nu-guided-course-choice">{copy('Start with','Empezar con')}<select value={ready.id} onChange={event=>setFirstCourse(event.target.value)}>{progress!.courses.filter(course=>course.state==='readable').map(course=><option key={course.id} value={course.id}>{course.title}</option>)}</select></label>}
     <button className="nu-guided-primary" type="button" onClick={()=>setWeek(true)}>{copy('Preview my week','Ver mi semana')}</button>
     </div>
    </div>
    <p>{copy('The other courses can keep importing while you get started.','Los otros cursos pueden seguir importándose mientras empiezas.')}</p>
   </section>}
   {stage==='week'&&ready&&<section className="nu-guided-scene" key={stage}>
    <div className="nu-guided-card nu-guided-week-object">
     <div className="nu-guided-week-content">
     <span>{copy('The next seven days · saved class times','Los próximos siete días · horarios guardados')}</span>
     {sessions.length?<ul className="nu-guided-week-agenda">{sessions.map(item=><li key={item.id}><time dateTime={item.date}>{dateLabel(item.date)} · {item.time}</time><strong>{progress?.courses.find(course=>course.id===item.course_id)?.title} · {item.title}</strong></li>)}</ul>:<p>{copy('No class times are confirmed for the next seven days. Review times found in your course material before adding them to Calendar.','No hay horarios de clase confirmados para los próximos siete días. Revisa los horarios encontrados en tu material antes de añadirlos al calendario.')}</p>}
     {progress!.courses.filter(course=>!sessions.some(item=>item.course_id===course.id)).length>0&&<p className="nu-guided-help">{copy('No confirmed times this week for ','Sin horarios confirmados esta semana para ')}{progress!.courses.filter(course=>!sessions.some(item=>item.course_id===course.id)).map(course=>course.title).join(', ')}.</p>}
     <button type="button" onClick={onSchedule}>{copy('Review class times','Revisar horarios de clase')}</button>
     <button type="button" className="nu-guided-primary" disabled={opening} onClick={()=>void openChat()}>{suggestion}</button>
     <p className="nu-guided-help">{ready.title} · {copy('Opens a draft question in Chat.','Abre un borrador de pregunta en Chat.')}</p>
     </div>
    </div>
   </section>}
   {progress&&progress.selected>0&&<section className="nu-guided-course-list" aria-label={copy('Course import progress','Progreso de importación')}>
    <p>{copy('Your courses','Tus cursos')} <span>{progress.courses.filter(course=>course.state==='readable').length} / {progress.selected} {copy('ready to ask','listos para preguntar')}</span></p>
    {progress.courses.length>0&&<ul>{progress.courses.map(course=><li key={course.id} data-state={course.state}><strong>{course.title}</strong><span className="nu-guided-course-state">{course.state==='readable'?copy('Ready to ask','Listo para preguntar'):course.state==='saved'?copy('Saved · reading text','Guardado · leyendo texto'):copy('Found · waiting for material','Encontrado · esperando material')}</span><button type="button" className="nu-guided-add" onClick={()=>onFiles(course.id)}>{copy('Add a file','Añadir archivo')}</button>{!!course.checks?.length&&<details className="nu-guided-course-checks"><summary>{copy('Some material still needs attention','Algunos materiales necesitan revisión')}</summary><p>{copy('Ready to ask means some readable evidence is available, not that the whole course has been read.','Listo para preguntar indica que hay evidencia legible, no que se leyó todo el curso.')}</p>{course.checks.map(check=><div key={check.kind}><strong>{check.label}</strong><p>{check.action}</p></div>)}</details>}</li>)}</ul>}
    <p className="nu-guided-help">{copy('Have a syllabus or notes to add? Files are optional; choose the course above.','¿Tienes un programa o apuntes? Los archivos son opcionales; elige el curso arriba.')}</p>
   </section>}
   </>}
  </>}
  {!scene&&checkedAt&&<p className="nu-guided-check-time">{copy('Last checked','Última comprobación')} <time dateTime={checkedAt.toISOString()}>{new Intl.DateTimeFormat(locale,{hour:'numeric',minute:'2-digit',second:'2-digit'}).format(checkedAt)}</time>{error?' · '+copy('reconnecting','reconectando'):''}</p>}
  </div>
 </main>;
}

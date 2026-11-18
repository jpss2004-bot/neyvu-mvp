import {useEffect, useRef, useState, type FormEvent} from 'react';
import {useI18n} from '../language';
import {SYMBOL_LIGHT} from '../../../lib/brand';
import './next-due-demo.css';

const question = ['What should I work on this week?', '¿En qué debo trabajar esta semana?'] as const;
const lab = ['Lab 2: Sampling report', 'Laboratorio 2: Informe de muestreo'] as const;
const team = ['Team proposal', 'Propuesta de equipo'] as const;

export function NextDueTeaser() {
 const {language} = useI18n();
 const es = language === 'es', i = es ? 1 : 0;
 return <div className="next-due-teaser">
  <div className="next-due-bar"><img src={SYMBOL_LIGHT} width="24" height="24" alt=""/><strong>{es ? 'Hoy' : 'Today'}</strong><span>{es ? 'Ejemplo ficticio' : 'Fictional example'}</span></div>
  <p>{question[i]}</p>
  <ul>
   <li><strong>{lab[i]}</strong><span>{es ? 'Grupo B · viernes' : 'Group B · Friday'}</span></li>
   <li><strong>{team[i]}</strong><span className="next-due-warning">{es ? 'Alcance por confirmar' : 'Applicability unclear'}</span></li>
  </ul>
  <a href="#next-due-demo">{es ? 'Revisar el ejemplo' : 'Explore this example'}</a>
 </div>;
}

export function NextDueDemo() {
 const {language} = useI18n();
 const es = language === 'es', i = es ? 1 : 0;
 const [asked, setAsked] = useState(false);
 const [openSource, setOpenSource] = useState<'lab' | 'team' | null>(null);
 const [editing, setEditing] = useState(false);
 const [saved, setSaved] = useState<string | null>(null);
 const [draft, setDraft] = useState('');
 const answer = useRef<HTMLOListElement>(null);
 const sourceHeading = useRef<HTMLHeadingElement>(null);
 const planButton = useRef<HTMLButtonElement>(null);
 useEffect(() => {
  if (asked) answer.current?.focus();
 }, [asked]);
 useEffect(() => {
  if (openSource) sourceHeading.current?.focus();
 }, [openSource]);
 const sourceButtons = useRef<Partial<Record<'lab' | 'team', HTMLButtonElement | null>>>({});
 const suggestion = es ? 'Preparar la tabla de muestreo el jueves.' : 'Set up the sampling table on Thursday.';
 const openPlan = () => {
  setDraft(saved ?? suggestion);
  setEditing(true);
 };
 const closePlan = () => {
  setEditing(false);
  requestAnimationFrame(() => planButton.current?.focus());
 };
 const savePlan = (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  if (!draft.trim()) return;
  setSaved(draft.trim());
  closePlan();
 };
 const sourceTitle = openSource === 'lab'
  ? (es ? 'Calendario del laboratorio de estadística' : 'Statistics lab schedule')
  : (es ? 'Instrucciones de la propuesta' : 'Team proposal instructions');

 return <section id="next-due-demo" className="next-due-section next-due-theme" aria-labelledby="next-due-title" tabIndex={-1}>
  <div className="wrap next-due-layout">
   <div className="next-due-intro">
    <h2 id="next-due-title">{question[i]}</h2>
    <p>{es ? 'Revisa las prioridades en Hoy, abre las fuentes y guarda tu siguiente paso.' : 'Review your priorities in Today, open the sources, and save your next step.'}</p>
    <p className="next-due-disclosure">{es ? 'Demostración guiada con cursos ficticios. Los cambios duran solo mientras tengas abierta esta página.' : 'Guided demo with fictional courses. Changes last while this page is open.'}</p>
   </div>
   <div className="next-due-desk">
    <div className="next-due-bar"><img src={SYMBOL_LIGHT} width="24" height="24" alt=""/><strong>{asked ? 'Chat' : (es ? 'Hoy' : 'Today')}</strong><span>{es ? 'Cursos de ejemplo' : 'Sample courses'}</span></div>
    <div className="next-due-transcript">
     <p className="next-due-question">{question[i]}</p>
     {!asked ? <button className="next-due-primary" type="button" onClick={() => setAsked(true)}>{es ? 'Preguntar a Neyvu' : 'Ask Neyvu'}</button> :
      <>
       <ol ref={answer} tabIndex={-1} className="next-due-answer" aria-label={es ? 'Prioridades de ejemplo' : 'Sample priorities'}>
        <li>
         <div><h3>{lab[i]}</h3><p>{es ? 'Estadística · viernes, 17:00 (Halifax)' : 'Statistics · Friday, 5 p.m. Halifax time'}</p><p>{es ? 'El calendario del curso indica esta entrega para el Grupo B, tu grupo en el ejemplo.' : 'The course schedule lists this deadline for Group B, your group in this example.'}</p></div>
         <button ref={node => { sourceButtons.current.lab = node; }} type="button" className="next-due-source-button" aria-expanded={openSource === 'lab'} aria-controls={openSource === 'lab' ? 'next-due-source' : undefined} onClick={() => setOpenSource(openSource === 'lab' ? null : 'lab')}>{es ? 'Ver fuente del laboratorio' : 'View lab source'}</button>
        </li>
        <li>
         <div><h3>{team[i]}</h3><p>{es ? 'Comunicación · lunes, 12:00 (Halifax)' : 'Communication · Monday, noon Halifax time'}</p><p className="next-due-warning">{es ? 'Tu equipo está confirmado. Las instrucciones guardadas no indican si la propuesta le corresponde.' : 'Your team is confirmed. The saved instructions leave it unclear whether this proposal applies to your team.'}</p></div>
         <button ref={node => { sourceButtons.current.team = node; }} type="button" className="next-due-source-button" aria-expanded={openSource === 'team'} aria-controls={openSource === 'team' ? 'next-due-source' : undefined} onClick={() => setOpenSource(openSource === 'team' ? null : 'team')}>{es ? 'Ver fuente de la propuesta' : 'View proposal source'}</button>
        </li>
       </ol>
       {openSource && <section className="next-due-evidence" id="next-due-source" aria-labelledby="next-due-source-title">
        <div><h3 ref={sourceHeading} id="next-due-source-title" tabIndex={-1}>{sourceTitle}</h3><button type="button" onClick={() => { sourceButtons.current[openSource]?.focus(); setOpenSource(null); }}>{es ? 'Cerrar fuente' : 'Close source'}</button></div>
        <blockquote>{openSource === 'lab'
         ? (es ? 'Grupo B: entrega el informe de muestreo el viernes antes de las 17:00 (hora de Halifax).' : 'Group B: submit the sampling report by Friday at 5 p.m. Halifax time.')
         : (es ? 'La propuesta vence el lunes al mediodía (hora de Halifax). Consulta el foro del curso para saber qué equipos deben entregarla.' : 'The proposal is due Monday at noon Halifax time. Check the course forum for the list of teams that need to submit.')}</blockquote>
       </section>}
       <div className="next-due-plan">
        {editing ? <form onSubmit={savePlan}>
         <label htmlFor="next-due-action">{es ? 'Siguiente paso para el informe' : 'Next step for the lab report'}</label>
         <input id="next-due-action" autoFocus required maxLength={150} value={draft} onChange={event => setDraft(event.target.value)}/>
         <div><button type="submit" className="next-due-primary" disabled={!draft.trim()}>{es ? 'Guardar plan de ejemplo' : 'Save example plan'}</button><button type="button" onClick={closePlan}>{es ? 'Cancelar' : 'Cancel'}</button></div>
        </form> : <><button ref={planButton} className="next-due-primary" type="button" onClick={openPlan}>{saved ? (es ? 'Editar plan de ejemplo' : 'Edit example plan') : (es ? 'Planear el informe' : 'Plan the lab report')}</button>{saved && <p role="status">{es ? 'Plan guardado en la demo.' : 'Plan saved in the demo.'} {saved}</p>}</>}
       </div>
      </>}
    </div>
   </div>
  </div>
 </section>;
}

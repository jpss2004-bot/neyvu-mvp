'use client';
import {useEffect,useRef,useState} from 'react';
import {useI18n} from '../language';
import {SYMBOL_LIGHT} from '../../../lib/brand';

type Pair=readonly [string,string];
const examples: {label:Pair;question:Pair;answer:Pair;source:Pair;quote:Pair}[]=[
 {label:['Understand a concept','Entender una idea'],question:['Explain eigenvectors using my notes.','Explícame los eigenvectores con mis notas.'],answer:['Think of a direction that the matrix stretches without turning it away from its line. Your notes write this as Av = λv. For their example, A = [[2, 1], [1, 2]] sends (1, 1) to (3, 3): the same direction, scaled by 3.','Piensa en una dirección que la matriz escala sin sacarla de su línea. Tus notas lo escriben como Av = λv. En su ejemplo, A = [[2, 1], [1, 2]] transforma (1, 1) en (3, 3): la misma dirección, multiplicada por 3.'],source:['Week 3 lecture notes','Notas de la semana 3'],quote:['An eigenvector is a nonzero vector v with Av = λv. For A = [[2, 1], [1, 2]], λ = 3 has eigenvector (1, 1).','Un eigenvector es un vector v no nulo tal que Av = λv. Para A = [[2, 1], [1, 2]], λ = 3 tiene eigenvector (1, 1).']},
 {label:['Start an assignment','Empezar una tarea'],question:['Where should I start this assignment?','¿Por dónde empiezo esta tarea?'],answer:['Start with the worked example in your Week 3 notes. Then try question 1 with the steps beside you: write A − λI, find its determinant, and solve for λ. Tell me which step feels unclear and we can work through it together.','Empieza con el ejemplo resuelto de tus notas de la semana 3. Después intenta la pregunta 1: escribe A − λI, calcula su determinante y despeja λ. Dime qué paso te cuesta y podemos revisarlo juntos.'],source:['Problem Set 2 · Saved Moodle instructions','Tarea 2 · Instrucciones guardadas de Moodle'],quote:['Use the Week 3 worked example to find the eigenvalues. Show the characteristic equation and your steps.','Usa el ejemplo de la semana 3 para encontrar los eigenvalores. Muestra la ecuación característica y tus pasos.']},
 {label:['Ask a follow-up','Seguir preguntando'],question:['Why does the vector have to be nonzero?','¿Por qué el vector no puede ser cero?'],answer:['Because A times the zero vector is always zero, whatever λ you choose. It would not tell us anything about this matrix. Requiring a nonzero vector makes Av = λv a meaningful test of how the matrix transforms a direction.','Porque A multiplicada por el vector cero siempre da cero, sin importar λ. Eso no nos diría nada sobre esta matriz. Exigir un vector no nulo hace que Av = λv nos diga cómo la matriz transforma una dirección.'],source:['Week 3 lecture notes','Notas de la semana 3'],quote:['An eigenvector of a square matrix A is a nonzero vector v with Av = λv.','Un eigenvector de una matriz cuadrada A es un vector v no nulo tal que Av = λv.']}
];
export function ChatDemonstration({compact=false}:{compact?:boolean}){
 const {language}=useI18n(),es=language==='es',copy=(p:Pair)=>p[es?1:0];
 const root=useRef<HTMLDivElement>(null),played=useRef(false);
 const [selected,setSelected]=useState(compact?1:0),[run,setRun]=useState(0),[phase,setPhase]=useState<'idle'|'searching'|'writing'|'done'>('idle'),[words,setWords]=useState(0),[source,setSource]=useState(false),[still,setStill]=useState(false);
 const scene=examples[selected],answer=copy(scene.answer),parts=answer.split(' ');
 useEffect(()=>{
  const media=matchMedia('(prefers-reduced-motion: reduce)'),page=root.current?.closest('.sv-constellation');
  const update=()=>setStill(media.matches||page?.classList.contains('motion-paused')===true||document.hidden);
  update();media.addEventListener('change',update);document.addEventListener('visibilitychange',update);
  const observer=new MutationObserver(update);if(page)observer.observe(page,{attributes:true,attributeFilter:['class']});
  return()=>{media.removeEventListener('change',update);document.removeEventListener('visibilitychange',update);observer.disconnect();};
 },[]);
 useEffect(()=>{
  if(!compact||!root.current)return;
  const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)&&!played.current){played.current=true;setRun(v=>v+1);}},{threshold:.5});
  observer.observe(root.current);return()=>observer.disconnect();
 },[compact]);
 useEffect(()=>{
  setSource(false);
  if(!run){setPhase('idle');return;}
  if(still){setWords(parts.length);setPhase('done');return;}
  setWords(0);setPhase('searching');let interval:ReturnType<typeof setInterval>|undefined;
  const timer=setTimeout(()=>{setPhase('writing');let count=0;interval=setInterval(()=>{count=Math.min(parts.length,count+3);setWords(count);if(count===parts.length){setPhase('done');clearInterval(interval);}},95);},650);
  return()=>{clearTimeout(timer);clearInterval(interval);};
 },[run,selected,language,still,answer,parts.length]);
 function choose(index:number){setSelected(index);setRun(v=>v+1);}
 const busy=phase==='searching'||phase==='writing';
 return <div ref={root} className={'chat-demo'+(compact?' chat-demo-compact':'')}>
  <div className="chat-demo-heading"><img src={SYMBOL_LIGHT} width="23" height="23" alt=""/><strong>Neyvu</strong><span>{es?'Demo interactiva':'Interactive demo'}</span></div>
  {!compact&&<p className="chat-demo-context">DEMO 1010 <span>{es?'Materiales del curso seleccionados':'Course material selected'}</span></p>}
  <p className="chat-demo-question">{copy(scene.question)}</p>
  <div className="chat-demo-answer" aria-busy={busy}>
   {phase==='idle'?<p>{es?'Elige una pregunta para ver cómo se conectan tus materiales y la conversación.':'Choose a question to see how your material becomes part of the conversation.'}</p>:phase==='searching'?<p className="chat-demo-thinking"><i/><i/><i/><span>{es?'Consultando material de ejemplo':'Looking through sample material'}</span></p>:<p>{parts.slice(0,words).join(' ')}{phase==='writing'&&<span className="chat-demo-caret" aria-hidden="true"/>}</p>}
  </div>
  <span className="sr-only" role="status">{phase==='done'?(es?'Respuesta de ejemplo lista. Puedes abrir la fuente.':'Example answer ready. You can open the source.'):''}</span>
  {phase==='done'&&<button type="button" className="chat-demo-citation" aria-expanded={source} onClick={()=>setSource(v=>!v)}><span>▤ {copy(scene.source)}</span><span>{source?(es?'Cerrar':'Close'):(es?'Ver fuente':'View source')}</span></button>}
  {source&&<blockquote className="chat-demo-source"><small>{es?'Fuente ficticia para esta demostración':'Fictional source for this demonstration'}</small>{copy(scene.quote)}</blockquote>}
  <div className="chat-demo-choices" aria-label={es?'Elige una pregunta de ejemplo':'Choose an example question'}>{(compact?[1,2]:[0,1,2]).map(i=><button type="button" key={i} aria-pressed={selected===i&&run>0} onClick={()=>choose(i)}>{copy(examples[i].label)}</button>)}</div>
  <p className="chat-demo-disclosure">{es?'Ejemplo guiado con material ficticio. No es una respuesta en vivo ni una medida de velocidad.':'Scripted example with fictional material. Not a live answer or a speed benchmark.'}</p>
 </div>;
}

export function MaterialConnection(){
 const {language}=useI18n(),es=language==='es';
 return <section className="material-connection" aria-labelledby="connection-title"><div className="wrap"><div><p className="story-kicker">{es?'Con el contexto de tus cursos':'With your course context'}</p><h2 id="connection-title">{es?'Tu universidad ya tiene los materiales. Úsalos en la conversación.':'Your university already has the material. Bring it into the conversation.'}</h2><p>{es?'Conecta Moodle desde Neyvu Companion en tu computadora, inicia sesión tú mismo y elige tus cursos. Neyvu reúne las instrucciones y los archivos que puede leer, junto con las notas y documentos que agregas.':'Connect Moodle through Neyvu Companion on your computer, sign in yourself, and choose your courses. Neyvu brings together the instructions and files it can read, alongside the notes and documents you add.'}</p></div><ol><li><span>01</span><div><h3>{es?'Elige tus cursos':'Choose your courses'}</h3><p>{es?'Tú controlas qué cursos recopila Companion. La conexión con Moodle se hace en tu computadora.':'You control which courses Companion collects. Your Moodle connection runs on your computer.'}</p></div></li><li><span>02</span><div><h3>{es?'Pregunta con contexto':'Ask with context'}</h3><p>{es?'Trabaja con lecturas, instrucciones y tus propias notas. Las respuestas pueden citar los pasajes guardados que las respaldan.':'Work with readings, assignment instructions and your own notes. Answers can cite the saved passages that support them.'}</p></div></li><li><span>03</span><div><h3>{es?'Vuelve a la fuente':'Go back to the source'}</h3><p>{es?'Abre el material citado y revisa las fechas de actualización y los problemas de lectura. Confirma los requisitos actuales en Moodle.':'Open cited material and check refresh times and reading gaps. Confirm current official requirements in Moodle.'}</p></div></li></ol><p className="connection-note">{es?'La actualización necesita tu computadora conectada. Companion está disponible en Microsoft Store para Windows 11 (x64). Neyvu es un proyecto independiente, no un servicio oficial de la universidad.':'Refreshing Moodle needs your connected computer. Companion is available in Microsoft Store for Windows 11 (x64). Neyvu is an independent project, not an official university service.'} <a href="/beta/start">{es?'Ver guía de conexión':'See the connection guide'}</a></p></div></section>;
}

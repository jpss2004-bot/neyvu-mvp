import {supportEmail} from '../../../lib/beta/public-identity';
import {companionRelease,releaseProof} from '../../../lib/beta/public-site';
import type {Language} from '../../../lib/beta/language';

/** The "context layer for learning" story: how it works and what is live today. */
export function ContextStory({language}:{language:Language}){
 const c=(en:string,es:string)=>language==='es'?es:en;
 return <>
<section className="ctx-section ctx-how" id="how-it-works" aria-labelledby="how-title">
<div className="wrap">
<p className="ctx-kicker">{c('How it works','Cómo funciona')}</p>
<h2 className="sec-title" id="how-title">{c('Sources in. Verified context out.','Entran las fuentes. Sale contexto verificado.')}</h2>
<p className="ctx-intro">{c('Neyvu reads what your learning depends on and turns it into context you can check: per course, with dates, coverage and what is missing marked.','Neyvu lee aquello de lo que depende tu aprendizaje y lo convierte en contexto que puedes comprobar: por curso, con fechas, cobertura y lo que falta señalado.')}</p>
<ol className="ctx-flow">
<li><span className="ctx-step" aria-hidden="true">1</span><h3>{c('Sources come in, read-only','Las fuentes entran, solo lectura')}</h3><p>{c('The Moodle courses you choose, and the files, notes and photos you add. Neyvu reads them. It never submits, books or writes anything back.','Los cursos de Moodle que elijas y los archivos, apuntes y fotos que agregues. Neyvu los lee. Nunca entrega, reserva ni escribe nada de vuelta.')}</p></li>
<li><span className="ctx-step" aria-hidden="true">2</span><h3>{c('Context gets verified','El contexto se verifica')}</h3><p>{c('Each answer is built from your saved sources and links back to them, so you can see what is current, whether it applies to you, and what to do next.','Cada respuesta se arma con tus fuentes guardadas y enlaza a ellas, para que veas qué está vigente, si te aplica y qué sigue.')}</p></li>
<li><span className="ctx-step" aria-hidden="true">3</span><h3>{c('Context goes out, to you and to your AI','El contexto sale, para ti y para tu IA')}</h3><p>{c('Today, in your Neyvu workspace on the web, your phone and Windows. Next, to the AI assistants you already use, through a connection you control.','Hoy, en tu espacio de Neyvu en la web, tu teléfono y Windows. Después, en los asistentes de IA que ya usas, mediante una conexión que tú controlas.')}<span className="ctx-tag">{c('Coming next','Próximamente')}</span></p></li>
</ol>
</div>
</section>
<section className="ctx-section ctx-today" id="today" aria-labelledby="today-title">
<div className="wrap">
<p className="ctx-kicker">{c('Neyvu at Acadia','Neyvu en Acadia')}</p>
<h2 className="sec-title" id="today-title">{c('What you can use today','Lo que puedes usar hoy')}</h2>
<ul className="ctx-cards">
<li><h3>{c('Cited answers for each course','Respuestas con fuentes para cada curso')}</h3><p>{c('Ask about a course and open the exact source behind the answer.','Pregunta sobre un curso y abre la fuente exacta detrás de la respuesta.')}</p></li>
<li><h3>{c('Today','Hoy')}</h3><p>{c('Your upcoming work and classes in one view, checked against the saved sources.','Tus próximas tareas y clases en una sola vista, contrastadas con las fuentes guardadas.')}</p></li>
<li><h3>{c('The section question','La pregunta de sección')}</h3><p>{c('When times or rooms depend on your section, Neyvu asks which one is yours before it answers.','Cuando los horarios o salones dependen de tu sección, Neyvu te pregunta cuál es la tuya antes de responder.')}</p></li>
<li><h3>{c('Photo reading','Lectura de fotos')}</h3><p>{c('Add a photo of a page or a whiteboard. Neyvu reads the text and marks the lines you should check.','Agrega una foto de una página o un pizarrón. Neyvu lee el texto y marca las líneas que conviene revisar.')}</p></li>
<li><h3>{c('Windows Companion','Companion para Windows')}</h3><p>{c('Free in the Microsoft Store. It connects the Moodle courses you choose with guided setup.','Gratis en Microsoft Store. Conecta los cursos de Moodle que elijas con una configuración guiada.')} <a href={companionRelease.installUrl}>{c('Get it from Microsoft Store','Obtener en Microsoft Store')}</a></p></li>
<li><h3>{c('English and Spanish','Inglés y español')}</h3><p>{c('The whole workspace works in both languages.','Todo el espacio de trabajo funciona en ambos idiomas.')}</p></li>
</ul>
</div>
</section>
</>;
}

/** Proof, institutions and direction follow the live product tour. */
export function ContextOutlook({language}:{language:Language}){
 const c=(en:string,es:string)=>language==='es'?es:en;
 const institutionMail='mailto:'+supportEmail+'?subject='+encodeURIComponent(c('Neyvu for institutions','Neyvu para instituciones'));
 return <>
<section className="ctx-section ctx-proof" id="proof" aria-labelledby="proof-title">
<div className="wrap">
<p className="ctx-kicker">{c('Proof','Pruebas')}</p>
<h2 className="sec-title" id="proof-title">{c('Measured before every release.','Medido antes de cada versión.')}</h2>
<dl className="ctx-stats">
<div><dt>{c('Release-test questions passed','Preguntas aprobadas en la prueba de versión')}</dt><dd>{releaseProof.passed}/{releaseProof.total}</dd></div>
<div><dt>{c('Answers citing the expected source','Respuestas que citan la fuente esperada')}</dt><dd>{language==='es'?releaseProof.expectedSourceCited.replace('.',','):releaseProof.expectedSourceCited}</dd></div>
<div><dt>{c('Invented deadlines','Fechas de entrega inventadas')}</dt><dd>{releaseProof.inventedDeadlines}</dd></div>
</dl>
<p className="ctx-note">{c('From Neyvu’s fixed 150-question release test across seven courses, including questions it should refuse or ask about first. Always confirm official dates in Moodle.','Según la prueba fija de 150 preguntas que Neyvu aplica antes de cada versión, en siete cursos, con preguntas que debe rechazar o aclarar primero. Confirma siempre las fechas oficiales en Moodle.')}</p>
</div>
</section>
<section className="ctx-section ctx-institutions" id="institutions" aria-labelledby="institutions-title">
<div className="wrap ctx-split">
<div>
<p className="ctx-kicker">{c('For institutions','Para instituciones')}</p>
<h2 className="sec-title" id="institutions-title">{c('Give every learner context they can trust.','Da a cada estudiante contexto en el que pueda confiar.')}</h2>
<p className="ctx-intro">{c('Universities, and later companies, bring Neyvu to their learners. Learners use it free. We are starting in Atlantic Canada, then Mexico.','Las universidades, y después las empresas, ofrecen Neyvu a quienes aprenden con ellas. Para los estudiantes es gratis. Empezamos en el Atlántico canadiense y después en México.')}</p>
<div className="ctx-actions"><a className="btn btn-primary" href={institutionMail}>{c('Talk to us about bringing Neyvu to your school','Hablemos de llevar Neyvu a tu institución')}</a><a className="btn btn-ghost" href="#request-access">{c('Request student access','Solicitar acceso como estudiante')}</a></div>
</div>
<ul className="ctx-list">
<li><h3>{c('Onboarding','Incorporación')}</h3><p>{c('New learners find their courses, dates and next steps in their first week, not their fifth.','Quien llega encuentra sus cursos, fechas y siguientes pasos en su primera semana, no en la quinta.')}</p></li>
<li><h3>{c('Institution knowledge','Conocimiento institucional')}</h3><p>{c('Policies, calendars and services become context that answers with the official source.','Políticas, calendarios y servicios se convierten en contexto que responde con la fuente oficial.')}</p></li>
<li><h3>{c('Verified context','Contexto verificado')}</h3><p>{c('Read-only, cited and scoped to what applies to each learner.','Solo lectura, con fuentes y limitado a lo que aplica a cada estudiante.')}</p></li>
</ul>
</div>
</section>
<section className="ctx-section ctx-next" id="where-its-going" aria-labelledby="next-title">
<div className="wrap">
<p className="ctx-kicker">{c('Where Neyvu is going','Hacia dónde va Neyvu')}</p>
<h2 className="sec-title" id="next-title">{c('One context layer for everything you learn.','Una capa de contexto para todo lo que aprendes.')}</h2>
<p className="ctx-intro">{c('These are plans, not features you can use yet.','Son planes, todavía no funciones disponibles.')}</p>
<ul className="ctx-cards ctx-roadmap">
<li><h3>{c('More connectors','Más conectores')}</h3><p>{c('More learning platforms and sources, always read-only.','Más plataformas y fuentes de aprendizaje, siempre de solo lectura.')}</p></li>
<li><h3>{c('Context for your AI','Contexto para tu IA')}</h3><p>{c('Share verified context with assistants like Claude or ChatGPT, on your terms.','Comparte contexto verificado con asistentes como Claude o ChatGPT, con tus reglas.')}</p></li>
<li><h3>{c('Beyond university','Más allá de la universidad')}</h3><p>{c('The same layer for employees learning at work.','La misma capa para quienes aprenden en su trabajo.')}</p></li>
</ul>
</div>
</section>
</>;
}

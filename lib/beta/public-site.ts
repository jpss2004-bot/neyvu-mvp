import {PRODUCT_NAME, SYMBOL_LIGHT} from '../brand';
import type {Language} from './language';
import {STORE_URL} from './neyvu-emails';

export const companionRelease={
 name:'Neyvu Companion',
 version:'0.3.18.0',
 operatingSystem:'Windows 11 (x64)',
 installUrl:STORE_URL,
} as const;

export const landingTitle=`${PRODUCT_NAME} | The context layer for learning`;
export const landingDescription='Neyvu is the context layer for learning. It brings your courses, files and notes together and answers what is current, what applies to you and what to do next, always with the source. Free for Acadia students.';

/** Release-test figures shown on the landing; keep in step with the approved pitch deck. */
export const releaseProof={passed:150,total:150,expectedSourceCited:'98.8%',inventedDeadlines:0} as const;

export function landingCopy(language:Language){return language==='es'?{
 title:`${PRODUCT_NAME} | La capa de contexto para el aprendizaje`,
 description:'Neyvu es la capa de contexto para el aprendizaje. Reúne tus cursos, archivos y apuntes, y te dice qué está vigente, qué te aplica y qué sigue, siempre con la fuente. Gratis para estudiantes de Acadia.'
}:{title:landingTitle,description:landingDescription};}
export function landingPath(language:Language){return language==='es'?'/beta/join?lang=es':'/beta/join';}

export function companionDownloadCopy(language:Language){
 return language==='es'
  ?'La descarga es pública y gratuita. Para conectar tus cursos de Moodle necesitas acceso aprobado.'
  :'Anyone can download Companion for free. Connecting your Moodle courses requires approved access.';
}

/** Describe the browser workspace and its Windows companion as distinct applications. */
export function landingStructuredData(origin:string,language:Language='en'){
 const base=new URL(origin);
 if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.pathname!=='/'||base.search||base.hash)throw Error('Expected a public site origin');
 const url=new URL(landingPath(language),base).href;const copy=landingCopy(language);
 const website=base.origin+'/#website',applicationUrl=new URL('/beta',base).href;
 const application=applicationUrl+'#application';
 const companionId=new URL(landingPath('en')+'#companion-download',base).href;
 return {
  '@context':'https://schema.org',
  '@graph':[
   {'@type':'WebSite','@id':website,name:PRODUCT_NAME,url:base.origin+'/',inLanguage:['en','es']},
   {'@type':'WebPage','@id':url+'#webpage',url,name:copy.title,description:copy.description,inLanguage:language,isPartOf:{'@id':website},mainEntity:{'@id':application},mentions:{'@id':companionId}},
   {'@type':'WebApplication','@id':application,name:PRODUCT_NAME,url:applicationUrl,description:copy.description,inLanguage:['en','es'],applicationCategory:'EducationalApplication',browserRequirements:language==='es'?'Un navegador web moderno y una conexión a internet.':'A modern web browser and an internet connection.',image:new URL(SYMBOL_LIGHT,base).href,
    audience:{'@type':'EducationalAudience',educationalRole:'student',audienceType:language==='es'?'Estudiantes de la Universidad de Acadia':'Acadia University students'},
    featureList:language==='es'?[
     'Lleva el control de tus próximas tareas y de tu plan personal de estudio',
     'Organiza notas y materiales del curso',
     'Prepárate para clase con tus notas y lecturas guardadas',
     'Haz preguntas sobre tus materiales y notas guardadas con enlaces a las fuentes',
     'Añade archivos PDF, Word, PowerPoint, texto o Markdown. Los documentos escaneados, las imágenes, las ecuaciones y los diagramas pueden necesitar una copia de texto legible o una revisión.',
     'Busca materiales por su texto y conversaciones por su título',
     'Conecta los cursos elegidos de Moodle con la configuración guiada de Companion. La recopilación requiere una computadora conectada y despierta.',
     'Usa el sitio desde tu teléfono',
     'Lee el texto de fotos de páginas o pizarrones y marca las líneas que conviene revisar',
     'Usa todo el espacio en inglés o en español',
    ]:[
     'Keep track of upcoming assignments and a personal study plan',
     'Organize notes and course materials',
     'Prepare for class using saved notes and readings',
     'Ask questions about saved course materials and notes with source links',
     'Add PDF, Word, PowerPoint, plain-text or Markdown files. Scans, images, equations and diagrams may need a readable text copy or review.',
     'Find saved material by its text and past conversations by their titles',
     'Connect selected Moodle courses with guided Companion setup. Collection requires an awake, connected computer.',
     'Use the website on a phone',
     'Read text from photos of pages or whiteboards and flag lines to check',
     'Use the whole workspace in English or Spanish',
    ],
    offers:{'@type':'Offer',name:language==='es'?'Acceso gratuito para estudiantes de Acadia':'Free access for Acadia students',price:0,priceCurrency:'CAD',url:url+'#request-access',description:language==='es'?'Gratis para estudiantes de Acadia. Los estudiantes solicitan acceso con su cuenta de Google; cada solicitud se revisa manualmente.':'Free for Acadia students. Students request access using their Google account; each request is reviewed manually.'}
   },
   {'@type':'SoftwareApplication','@id':companionId,name:companionRelease.name,url:companionId,
    softwareVersion:companionRelease.version,operatingSystem:companionRelease.operatingSystem,
    applicationCategory:'EducationalApplication',installUrl:companionRelease.installUrl,
    description:companionDownloadCopy(language),
    offers:{'@type':'Offer',price:0,priceCurrency:'CAD',url:companionRelease.installUrl}
   },
  ]
 };
}

/** Prevent an HTML parser from terminating the non-executable JSON-LD script. */
export function serializeStructuredData(value:unknown){return JSON.stringify(value).replace(/</g,'\\u003c');}

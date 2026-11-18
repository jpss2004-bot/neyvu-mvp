import type {EmailLanguage,NeyvuEmail} from './email-design';

// The words of every Neyvu email, in one place. Student emails follow the language the
// student used on the site; the two emails to the admin are English.
export const STORE_URL='https://apps.microsoft.com/detail/9N0000000000';
export const emailLanguage=(value:unknown):EmailLanguage=>value==='es'?'es':'en';
const firstName=(name:string)=>name.trim().split(/\s+/)[0]||name.trim();

// macUrl: the operator's Mac Companion download (both chips plus the Start-here guide). Without it,
// Mac students are told the app comes by a private link.
export function approvalEmail(input:{origin:string;email:string;name:string;invitation:boolean;language:EmailLanguage;macUrl?:string|null}):{subject:string;email:NeyvuEmail}{
 const {origin,email,invitation,macUrl}=input,first=firstName(input.name);
 if(input.language==='es')return {subject:invitation?'Te invitamos a Neyvu':'Ya tienes acceso a Neyvu',email:{language:'es',origin,
  preheader:'Inicia sesión con tu cuenta de Google aprobada para empezar.',
  heading:invitation?`Te invitamos, ${first}.`:`¡Ya estás dentro, ${first}!`,
  blocks:[
   {kind:'paragraph',text:invitation?'Te invitamos a Neyvu y tu acceso ya está listo.':'Aprobamos tu solicitud de acceso a Neyvu.'},
   {kind:'steps',title:'Inicia sesión',items:['Abre la configuración y elige Continuar con Google.',`Usa esta cuenta de Google: ${email}`]},
   {kind:'note',text:'Solo esa cuenta de Google está aprobada. Este correo no da acceso a nadie más.'},
   {kind:'links',title:'Conecta tus cursos de Moodle',items:[{label:'Windows: Neyvu Companion en Microsoft Store',url:STORE_URL},...(macUrl?[{label:'Mac: descarga Neyvu Companion',url:macUrl}]:[]),{label:'Ayuda de instalación',url:origin+'/beta/start'}]},
   {kind:'paragraph',text:macUrl?'¿Usas Mac? Elige Apple Silicon (chip M) o Intel. La primera vez que lo abras, tu Mac te pedirá permitirlo una sola vez; la página Start here de la descarga te muestra cómo. No desactives la seguridad ni pegues comandos en Terminal.':'¿Usas Mac? Por ahora, la app para Mac se comparte con un enlace privado. Responde a este correo si todavía no lo tienes.'},
   {kind:'paragraph',text:'Tu Neyvu empieza vacío. Agrega tus cursos con el Companion, o escribe una nota o sube un archivo con el que estés estudiando.'},
   {kind:'paragraph',text:'Neyvu es gratis para estudiantes de Acadia. No hay nada que pagar ni tarjeta que registrar.'},
  ],
  action:{label:'Iniciar configuración',url:origin+'/beta?tab=setup'},actionAt:3,
  footer:['¿Dudas o problemas? Responde a este correo. Por favor no incluyas contraseñas ni trabajos privados de tus cursos.',invitation?'Recibes este correo porque te invitamos a Neyvu.':'Recibes este correo porque solicitaste acceso a Neyvu.'],
  signoff:'El equipo de Neyvu'}};
 return {subject:invitation?"You're invited to Neyvu":"You're approved for Neyvu",email:{language:'en',origin,
  preheader:'Sign in with your approved Google account to get started.',
  heading:invitation?`You're invited, ${first}.`:`You're in, ${first}!`,
  blocks:[
   {kind:'paragraph',text:invitation?"You've been invited to Neyvu, and your access is ready.":'Your request for access to Neyvu is approved.'},
   {kind:'steps',title:'Sign in',items:['Open setup and choose Continue with Google.',`Use this Google account: ${email}`]},
   {kind:'note',text:"Only that Google account is approved. This email doesn't give access to anyone else."},
   {kind:'links',title:'Connect your Moodle courses',items:[{label:'Windows: Neyvu Companion in the Microsoft Store',url:STORE_URL},...(macUrl?[{label:'Mac: download Neyvu Companion',url:macUrl}]:[]),{label:'Installation help',url:origin+'/beta/start'}]},
   {kind:'paragraph',text:macUrl?"On a Mac? Pick Apple Silicon (M chip) or Intel. The first time you open it, your Mac asks you to allow it once; the Start here page in the download shows how. Don't turn off security settings or paste Terminal commands.":"On a Mac? For now, the Mac app is shared by a private link. Reply to this email if you don't have it yet."},
   {kind:'paragraph',text:'Your Neyvu starts empty. Add your courses with the Companion, or write a note or upload a file you are studying from.'},
   {kind:'paragraph',text:"Neyvu is free for Acadia students. There's nothing to pay and no card to enter."},
  ],
  action:{label:'Start setup',url:origin+'/beta?tab=setup'},actionAt:3,
  footer:["Questions or problems? Just reply to this email. Please don't include passwords or private coursework.",invitation?"You're getting this because Neyvu invited you.":"You're getting this because you requested access to Neyvu."],
  signoff:'The Neyvu team'}};
}

export function adminSignInEmail(input:{origin:string;link:string}):{subject:string;email:NeyvuEmail}{
 return {subject:'Your Neyvu admin sign-in link',email:{language:'en',origin:input.origin,
  preheader:'Open it in the same browser within 10 minutes.',
  heading:'Your admin sign-in link',
  blocks:[
   {kind:'paragraph',text:'You asked to sign in to the Neyvu admin desk.'},
   {kind:'note',text:'Open it in the same browser where you requested it, then choose Sign in. It expires in 10 minutes and works once.'},
  ],
  action:{label:'Sign in to the admin desk',url:input.link},
  footer:["If you didn't ask for this, you can ignore this email."],
  signoff:'Neyvu'}};
}

export function requestNoticeEmail(input:{origin:string;name:string;email:string;id:string;language:EmailLanguage}):{subject:string;email:NeyvuEmail}{
 return {subject:'New Neyvu access request',email:{language:'en',origin:input.origin,
  preheader:`${input.name} requested access to Neyvu.`,
  heading:'New access request',
  blocks:[
   {kind:'paragraph',text:"A student requested access to Neyvu. It's saved in your admin desk."},
   {kind:'details',rows:[['Name',input.name],['Google account',input.email],['Language',input.language==='es'?'Spanish':'English'],['Request',input.id]]},
   {kind:'note',text:'The student self-confirmed Acadia enrollment. Review eligibility before approving. Nothing has been approved and no student email has been sent.'},
  ],
  action:{label:'Review in the admin desk',url:input.origin+'/beta/admin'},
  footer:['If this arrived more than once, review the existing request instead of creating another account.'],
  signoff:'Neyvu'}};
}

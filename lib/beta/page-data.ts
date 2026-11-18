// Backend implementation. The frontend artifact uses an HTTP-only adapter.
import {betaActor} from './auth';
import {adminActor,accessReady,adminEmails} from './admissions';
import {adminMailReady} from './admin-mail';
import {approvalMailMode} from './approval-mail';
import {betaEnabled,betaOrigin,demoAvailable,localAccountAvailable} from './config';
import {readStudyCopy} from './study-copy';
import {BetaHttpError} from './http';
import {parsePageSession,type PageCapabilities,type PageSession} from './page-contract';
export {betaOrigin as pageOrigin};
export async function pageCapabilities():Promise<PageCapabilities>{return {version:1,accessReady:accessReady(),signInReady:betaEnabled()&&!!process.env.SCHOOL_GOOGLE_CLIENT_ID&&!!process.env.SCHOOL_GOOGLE_CLIENT_SECRET,adminReady:accessReady()&&adminMailReady()&&adminEmails().length>0,demoAvailable:demoAvailable(),localAccountAvailable:localAccountAvailable(),captureEnabled:process.env.SCHOOL_BETA_CLASS_CAPTURE==='1',approvalEmail:approvalMailMode()==='gmail'};}
export async function pageSession():Promise<PageSession>{
 const actor=await betaActor(),admin=await adminActor();
 return parsePageSession({version:1,actor:actor?{...actor,demo:actor.demo===true}:null,admin});
}
export async function pageStudyCopy(message:string){const actor=await betaActor();if(!actor)throw new BetaHttpError('Please sign in.',401);return readStudyCopy(actor.id,message);}

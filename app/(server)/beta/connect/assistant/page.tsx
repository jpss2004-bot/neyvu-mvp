import {betaActor} from '../../../../../lib/beta/auth';
import {checkAuthorizeRequest,OAuthFailure} from '../../../../../lib/platform/oauth';
import AssistantConsent from './consent';
export const dynamic='force-dynamic';
export const metadata={title:'Connect an assistant · Neyvu',robots:{index:false}};
// OAuth 2.1 authorization endpoint. The learner signs in to Neyvu here, in Neyvu's own page,
// and decides; the assistant only ever receives a short-lived code bound to its PKCE challenge.
export default async function ConnectAssistant({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
 const params=await searchParams;let req;
 try{req=await checkAuthorizeRequest(params);}catch(e){return <main style={{maxWidth:560,margin:'48px auto',padding:'0 16px',font:'16px/1.5 system-ui'}}><h1>Cannot connect this assistant</h1><p>{e instanceof OAuthFailure?e.message:'Something went wrong.'}</p></main>;}
 let actor;try{actor=await betaActor();}catch{actor=null;}
 const here='/beta/connect/assistant?'+new URLSearchParams(Object.entries(params).filter(([,v])=>typeof v==='string') as [string,string][]).toString();
 return <main style={{maxWidth:560,margin:'48px auto',padding:'0 16px',font:'16px/1.5 system-ui'}}>
  <h1>Connect {req.client_name} to Neyvu</h1>
  {!actor?<p><a href={'/beta?next='+encodeURIComponent(here)}>Sign in to Neyvu</a> first. Never type your Neyvu, Moodle or school password into an assistant chat.</p>:
  <AssistantConsent clientName={req.client_name} redirectHost={new URL(req.redirect_uri).host} params={params as Record<string,string>}/>}
 </main>;
}

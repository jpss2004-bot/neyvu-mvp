import {betaRoute} from '../../../../../lib/beta/api-route';
import {betaActor} from '../../../../../lib/beta/auth';
import {BetaHttpError} from '../../../../../lib/beta/http';
import {connectionsPageEnabled} from '../../../../../lib/beta/connectors/flags';
import {finishOAuth} from '../../../../../lib/beta/connectors/accounts';
export const runtime='nodejs';
// OAuth redirect target for Canvas, Brightspace, Outlook and Gmail. Always lands
// back on the Connections page with a short status, never with token material.
async function handleGET(request:Request){
 const url=new URL(request.url),back=new URL('/beta/connections',url.origin);
 try{
  if(!connectionsPageEnabled())throw new BetaHttpError('Connections are not available yet.',404);
  const actor=await betaActor();if(!actor)throw new BetaHttpError('Please sign in.',401);
  if(url.searchParams.get('error'))throw new BetaHttpError('The sign-in was cancelled or refused.',400);
  const result=await finishOAuth(actor.id,url.searchParams.get('state'),url.searchParams.get('code'));
  back.searchParams.set('connected',result.kind);
 }catch(error){back.searchParams.set('error',error instanceof BetaHttpError?error.message:'The connection could not be finished.');}
 return Response.redirect(back.href,303);
}
export const GET=betaRoute(handleGET);

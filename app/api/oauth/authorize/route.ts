import {betaRoute} from '../../../../lib/beta/api-route';
import {betaActor} from '../../../../lib/beta/auth';
import {betaRequestJson,betaWriteAllowed,betaJson,BetaHttpError} from '../../../../lib/beta/http';
import {approveAuthorization,checkAuthorizeRequest,denyRedirect,disconnectAssistant,OAuthFailure} from '../../../../lib/platform/oauth';
export const runtime='nodejs';
// The learner's decision on the consent page. Same-origin, signed-in session required.
async function handlePOST(request:Request){
 betaWriteAllowed(request);const actor=await betaActor();if(!actor)throw new BetaHttpError('Please sign in.',401);
 const body=await betaRequestJson(request,8000) as any;
 try{
  if(body.decision==='disconnect')return betaJson({ok:await disconnectAssistant(actor.id,body.grant_id)});
  const params=body.params&&typeof body.params==='object'?Object.fromEntries(Object.entries(body.params).filter(([,v])=>typeof v==='string')) as Record<string,string>:{};
  if(body.decision==='deny')return betaJson({redirect:denyRedirect(await checkAuthorizeRequest(params))});
  if(body.decision!=='approve')throw new BetaHttpError('Choose allow or deny.');
  return betaJson({redirect:await approveAuthorization(actor.id,params)});
 }catch(e){if(e instanceof OAuthFailure)throw new BetaHttpError(e.message,e.status);throw e;}
}
export const POST=betaRoute(handlePOST);

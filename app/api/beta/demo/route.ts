import {betaRoute} from '../../../../lib/beta/api-route';
import {cookies} from 'next/headers';
import {betaActor,revokeSession} from '../../../../lib/beta/auth';
import {betaCookie,betaSecure,demoAvailable} from '../../../../lib/beta/config';
import {betaJson,betaError,betaWriteAllowed,betaRequestJson,BetaHttpError} from '../../../../lib/beta/http';
import {startDemoSession,resetDemoTenant,simulateDemoCollection,demoClientKey,demoSessionSeconds} from '../../../../lib/beta/demo';
export const runtime='nodejs';
// Reviewer demo access. Same-origin JSON writes only; fails closed without a configured code.
async function handlePOST(request:Request){
 try{
  betaWriteAllowed(request);
  if(!demoAvailable())throw new BetaHttpError('Demo access is not available.',404);
  const body=await betaRequestJson(request);
  if('user_id' in body||'account' in body)throw new BetaHttpError('Invalid account selection',403);
  const jar=await cookies(),client=demoClientKey(request);
  const issue=(raw:string)=>jar.set(betaCookie,raw,{httpOnly:true,secure:betaSecure(),sameSite:'lax',path:'/',maxAge:demoSessionSeconds});
  if(body.op==='start'){
   const raw=await startDemoSession(body.code,client);
   // Entering the code replaces any session this browser held.
   await revokeSession(jar.get(betaCookie)?.value);issue(raw);
   return betaJson({demo:true},201);
  }
  const actor=await betaActor();if(!actor)throw new BetaHttpError('Please sign in to SchoolVault.',401);
  if(actor.demo!==true)throw new BetaHttpError('This action is only available in the demo account.',403);
  if(body.op==='reset'){issue(await resetDemoTenant(actor.id,client));return betaJson({reset:true});}
  if(body.op==='simulate')return betaJson(await simulateDemoCollection({user:actor.id}));
  throw new BetaHttpError('Unknown demo action');
 }catch(error){return betaError(error);}
}

export const POST=betaRoute(handlePOST);

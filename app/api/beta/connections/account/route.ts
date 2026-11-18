import {betaRoute} from '../../../../../lib/beta/api-route';
import {betaActor} from '../../../../../lib/beta/auth';
import {betaJson,betaError,betaWriteAllowed,betaRequestJson,BetaHttpError} from '../../../../../lib/beta/http';
import {connectionsPageEnabled} from '../../../../../lib/beta/connectors/flags';
import {disconnectAccount,confirmSender,removeSender} from '../../../../../lib/beta/connectors/accounts';
import {syncAccount} from '../../../../../lib/beta/connectors/sync';
import {uuid} from '../../../../../lib/beta/db';
export const runtime='nodejs';
async function handlePOST(request:Request){
 try{
  betaWriteAllowed(request);
  if(!connectionsPageEnabled())throw new BetaHttpError('Connections are not available yet.',404);
  const actor=await betaActor();if(!actor)throw new BetaHttpError('Please sign in.',401);
  const body:any=await betaRequestJson(request,10000);
  if(!uuid(body.account_id))throw new BetaHttpError('Connection not found.',404);
  if(body.action==='sync')return betaJson(await syncAccount(actor.id,body.account_id));
  if(body.action==='disconnect')return betaJson(await disconnectAccount(actor.id,body.account_id));
  if(body.action==='add_sender')return betaJson(await confirmSender(actor.id,body.account_id,body),201);
  if(body.action==='remove_sender')return betaJson(await removeSender(actor.id,body.account_id,body.address));
  throw new BetaHttpError('Unknown action.',400);
 }catch(error){return betaError(error);}
}
export const POST=betaRoute(handlePOST);

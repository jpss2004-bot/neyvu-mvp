import {betaRoute} from '../../../../lib/beta/api-route';
import {betaActor} from '../../../../lib/beta/auth';
import {betaJson,betaError,betaWriteAllowed,betaRequestJson,BetaHttpError} from '../../../../lib/beta/http';
import {rateLimit} from '../../../../lib/beta/admissions';
import {createHash} from 'node:crypto';
import {tenant} from '../../../../lib/beta/db';
import {connectionsPageEnabled,connectorEnabled} from '../../../../lib/beta/connectors/flags';
import {listAccounts,sessionBridgeStatus,startConnection,connectMoodleWithPassword,connectMoodleWithSso,connectorKinds,institutionList} from '../../../../lib/beta/connectors/accounts';
export const runtime='nodejs';
async function actor(){if(!connectionsPageEnabled())throw new BetaHttpError('Connections are not available yet.',404);const a=await betaActor();if(!a)throw new BetaHttpError('Please sign in.',401);return a;}
async function handleGET(){
 try{
  const a=await actor();
  const available=connectorKinds.filter(k=>connectorEnabled(k)).map(kind=>({kind,institutions:kind==='canvas'||kind==='brightspace'?institutionList().filter(i=>i.provider===kind).map(i=>({id:i.id,name:i.name})):undefined}));
  const courses=await tenant(a.id,async c=>(await c.query('SELECT id,code,title FROM schoolvault.courses WHERE user_id=$1 ORDER BY code',[a.id])).rows);
  return betaJson({courses,accounts:await listAccounts(a.id),session_bridge:await sessionBridgeStatus(a.id),available});
 }catch(error){return betaError(error);}
}
async function handlePOST(request:Request){
 try{
  betaWriteAllowed(request);const a=await actor();
  await rateLimit('connector-user',createHash('sha256').update('connector:'+a.id).digest('hex'),60);
  const body:any=await betaRequestJson(request,20000);
  if(body.action==='start')return betaJson(await startConnection(a.id,body));
  // The password is passed straight through to one Moodle token request; it is never stored or logged.
  if(body.action==='moodle_password')return betaJson(await connectMoodleWithPassword(a.id,body),201);
  if(body.action==='moodle_sso')return betaJson(await connectMoodleWithSso(a.id,body),201);
  throw new BetaHttpError('Unknown action.',400);
 }catch(error){return betaError(error);}
}
export const GET=betaRoute(handleGET);
export const POST=betaRoute(handlePOST);

import {betaRoute} from '../../../../lib/beta/api-route';
import {cookies} from 'next/headers';
import {betaActor,revokeSession} from '../../../../lib/beta/auth';
import {betaCookie} from '../../../../lib/beta/config';
import {betaJson,betaError,betaWriteAllowed,betaRequestJson,BetaHttpError} from '../../../../lib/beta/http';
import {localRequestAllowed,startLocalSession,localImportStatus,refreshLocalImport} from '../../../../lib/beta/local';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function handleGET(request:Request){try{
 localRequestAllowed(request);const actor=await betaActor();if(!actor||actor.id!==process.env.SCHOOL_LOCAL_USER_ID)throw new BetaHttpError('Open your local vault first.',401);
 return betaJson(await localImportStatus());
}catch(error){return betaError(error);}}
async function handlePOST(request:Request){try{
 localRequestAllowed(request);betaWriteAllowed(request);const body=await betaRequestJson(request);
 if(Object.keys(body).some(key=>key!=='op'))throw new BetaHttpError('Invalid local action',400);
 if(body.op==='start'){
  const raw=await startLocalSession(),jar=await cookies();await revokeSession(jar.get(betaCookie)?.value);
  jar.set(betaCookie,raw,{httpOnly:true,secure:false,sameSite:'strict',path:'/',maxAge:30*86400});return betaJson({local:true},201);
 }
 const actor=await betaActor();if(!actor||actor.id!==process.env.SCHOOL_LOCAL_USER_ID)throw new BetaHttpError('Open your local vault first.',401);
 if(body.op==='refresh')return betaJson(await refreshLocalImport(),202);
 throw new BetaHttpError('Unknown local action',400);
}catch(error){return betaError(error);}}

export const GET=betaRoute(handleGET);
export const POST=betaRoute(handlePOST);

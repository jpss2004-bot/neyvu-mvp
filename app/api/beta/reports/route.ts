import {betaRoute} from '../../../../lib/beta/api-route';
import {betaActor} from '../../../../lib/beta/auth';
import {betaJson,betaError,betaWriteAllowed,betaRequestJson,BetaHttpError} from '../../../../lib/beta/http';
import {savePilotReport} from '../../../../lib/beta/pilot-reports';
export const runtime='nodejs';
async function handlePOST(request:Request){try{betaWriteAllowed(request);const actor=await betaActor();if(!actor)throw new BetaHttpError('Please sign in to share a report.',401);return betaJson(await savePilotReport(actor,await betaRequestJson(request,8000)),201);}catch(error){return betaError(error);}}

export const POST=betaRoute(handlePOST);

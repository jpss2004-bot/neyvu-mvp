import {betaRoute} from '../../../../../lib/beta/api-route';
import {retryRequestNotice} from '../../../../../lib/beta/request-notification';
import {betaRequestJson,betaWriteAllowed,betaJson,betaError} from '../../../../../lib/beta/http';
export const runtime='nodejs';
async function handlePOST(request:Request){try{betaWriteAllowed(request);const body=await betaRequestJson(request,1500);return betaJson(await retryRequestNotice(body.id,body.confirm_unknown));}catch(error){return betaError(error);}}

export const POST=betaRoute(handlePOST);

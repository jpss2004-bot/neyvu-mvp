import {betaRoute} from '../../../../../lib/beta/api-route';
import {admissionList} from '../../../../../lib/beta/admissions';
import {decideAdmissionWithEmail} from '../../../../../lib/beta/approval-mail';
import {betaRequestJson,betaWriteAllowed,betaJson,betaError} from '../../../../../lib/beta/http';
export const runtime='nodejs';
async function handleGET(){try{return betaJson({requests:await admissionList()});}catch(error){return betaError(error);}}
async function handlePOST(request:Request){try{betaWriteAllowed(request);const body=await betaRequestJson(request,1500);return betaJson(await decideAdmissionWithEmail(body.id,body.decision));}catch(error){return betaError(error);}}

export const GET=betaRoute(handleGET);
export const POST=betaRoute(handlePOST);

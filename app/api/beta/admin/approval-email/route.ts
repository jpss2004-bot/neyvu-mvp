import {betaRoute} from '../../../../../lib/beta/api-route';
import {sendApprovalMail} from '../../../../../lib/beta/approval-mail';
import {betaRequestJson,betaWriteAllowed,betaJson,betaError} from '../../../../../lib/beta/http';
export const runtime='nodejs';
async function handlePOST(request:Request){try{betaWriteAllowed(request);const body=await betaRequestJson(request,1500);return betaJson({email:await sendApprovalMail(body.id,body.confirm_unknown)});}catch(error){return betaError(error);}}

export const POST=betaRoute(handlePOST);

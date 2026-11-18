import {betaRoute} from '../../../../lib/beta/api-route';
import {after} from 'next/server';
import {sendRequestNotice} from '../../../../lib/beta/request-notification';
import {requestAccess,clientBucket} from '../../../../lib/beta/admissions';
import {approvalMailMode} from '../../../../lib/beta/approval-mail';
import {betaRequestJson,betaWriteAllowed,betaJson,betaError} from '../../../../lib/beta/http';
export const runtime='nodejs';
async function handlePOST(request:Request){
 try{betaWriteAllowed(request);const notice=await requestAccess(await betaRequestJson(request,3000),clientBucket(request),request.headers.get('x-neyvu-language'));if(notice)after(async()=>{await sendRequestNotice(notice);});const mode=approvalMailMode();return betaJson({message:mode==='gmail'?'Your request is recorded. If approved, we will email this address with sign-in instructions.':mode==='log'?'Your request is recorded for local review. Approval emails are logged, not delivered.':'Your request is recorded. After approval, return here and sign in with this Google account.'});}catch(error){return betaError(error);}
}

export const POST=betaRoute(handlePOST);

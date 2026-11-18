import {betaRoute} from '../../../../../lib/beta/api-route';
import {studentList,inviteStudent,changeStudentAccess} from '../../../../../lib/beta/pilot-access';
import {betaRequestJson,betaWriteAllowed,betaJson,betaError} from '../../../../../lib/beta/http';
export const runtime='nodejs';
async function handleGET(){try{return betaJson({students:await studentList()});}catch(error){return betaError(error);}}
async function handlePOST(request:Request){try{betaWriteAllowed(request);return betaJson(await inviteStudent(await betaRequestJson(request,2000)));}catch(error){return betaError(error);}}
async function handlePATCH(request:Request){try{betaWriteAllowed(request);return betaJson(await changeStudentAccess(await betaRequestJson(request,1000)));}catch(error){return betaError(error);}}

export const GET=betaRoute(handleGET);
export const POST=betaRoute(handlePOST);
export const PATCH=betaRoute(handlePATCH);

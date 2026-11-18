import {betaRoute} from '../../../../lib/beta/api-route';
import {betaJson,betaRequestJson,betaWriteAllowed} from '../../../../lib/beta/http';
import {submitTakedown} from '../../../../lib/beta/capture-consent';
import {rateLimit,optionalClientBucket} from '../../../../lib/beta/admissions';
export const runtime='nodejs';
// Public: instructors, classmates and institutions can ask for a class recording to be
// removed without a Neyvu account. Requests are insert-only and reviewed by an operator.
async function handlePOST(request:Request){betaWriteAllowed(request);await rateLimit('recording-takedown',optionalClientBucket(request),10);return betaJson(await submitTakedown(await betaRequestJson(request,8000) as any),201);}
export const POST=betaRoute(handlePOST);

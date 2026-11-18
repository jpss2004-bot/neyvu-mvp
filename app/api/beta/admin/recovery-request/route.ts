import {randomBytes} from 'node:crypto';
import {NextResponse} from 'next/server';
import {betaRoute} from '../../../../../lib/beta/api-route';
import {accessReady,adminBrowserCookie} from '../../../../../lib/beta/admissions';
import {betaOrigin,betaSecure} from '../../../../../lib/beta/config';
import {betaRequestJson,betaWriteAllowed,betaError,BetaHttpError} from '../../../../../lib/beta/http';
import {prepareAdminRecoveryRequest} from '../../../../../lib/beta/admin-recovery-request';
export const runtime='nodejs';
async function handlePOST(request:Request){
 try{
  betaWriteAllowed(request);if(!accessReady())throw new BetaHttpError('Owner recovery is being prepared.',503);
  const body=await betaRequestJson(request,512);if(!body||Object.keys(body).length)throw new BetaHttpError('Use the recovery request button.');
  const browser=randomBytes(32).toString('base64url');
  const response=NextResponse.json(prepareAdminRecoveryRequest(browser,process.env.SCHOOL_BETA_ACCESS_KEY!,betaOrigin()),{headers:{'Cache-Control':'private, no-store','Vary':'Cookie'}});
  response.cookies.set(adminBrowserCookie,browser,{httpOnly:true,secure:betaSecure(),sameSite:'strict',path:'/',maxAge:600});return response;
 }catch(error){return betaError(error);}
}
export const POST=betaRoute(handlePOST);

import {betaRoute} from '../../../../../lib/beta/api-route';
import {randomBytes} from 'node:crypto';
import {NextResponse} from 'next/server';
import {adminBrowserCookie,clientBucket,createAdminLogin} from '../../../../../lib/beta/admissions';
import {adminMailReady,sendAdminLoginMail} from '../../../../../lib/beta/admin-mail';
import {betaSecure} from '../../../../../lib/beta/config';
import {betaRequestJson,betaWriteAllowed,betaError,BetaHttpError} from '../../../../../lib/beta/http';
export const runtime='nodejs';
async function handlePOST(request:Request){
 try{
  betaWriteAllowed(request);if(!adminMailReady())throw new BetaHttpError('Admin email sign-in is being prepared. Please try again later.',503);
  const body=await betaRequestJson(request,1500),browser=randomBytes(32).toString('base64url');
  const login=await createAdminLogin(body.email,browser,clientBucket(request));
  if(login)await sendAdminLoginMail(login.email,login.token);
  const response=NextResponse.json({message:'If this address is an admin account, a sign-in link has been sent. Open it in this browser within 10 minutes.'},{headers:{'Cache-Control':'private, no-store','Vary':'Cookie'}});
  response.cookies.set(adminBrowserCookie,browser,{httpOnly:true,secure:betaSecure(),sameSite:'strict',path:'/',maxAge:600});return response;
 }catch(error){return betaError(error);}
}

export const POST=betaRoute(handlePOST);

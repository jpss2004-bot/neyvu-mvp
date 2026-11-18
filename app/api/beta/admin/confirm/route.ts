import {betaRoute} from '../../../../../lib/beta/api-route';
import {cookies} from 'next/headers';
import {NextResponse} from 'next/server';
import {adminBrowserCookie,adminCookie,consumeAdminLogin} from '../../../../../lib/beta/admissions';
import {betaSecure} from '../../../../../lib/beta/config';
import {betaRequestJson,betaWriteAllowed,betaError} from '../../../../../lib/beta/http';
export const runtime='nodejs';
async function handlePOST(request:Request){
 try{
  betaWriteAllowed(request);const body=await betaRequestJson(request,1500);
  const raw=await consumeAdminLogin(body.token,(await cookies()).get(adminBrowserCookie)?.value);
  const response=NextResponse.json({ok:true},{headers:{'Cache-Control':'private, no-store','Vary':'Cookie'}});
  response.cookies.set(adminCookie,raw,{httpOnly:true,secure:betaSecure(),sameSite:'strict',path:'/',maxAge:8*3600});
  response.cookies.set(adminBrowserCookie,'',{httpOnly:true,secure:betaSecure(),sameSite:'strict',path:'/',maxAge:0});return response;
 }catch(error){return betaError(error);}
}

export const POST=betaRoute(handlePOST);

import {betaRoute} from '../../../../../lib/beta/api-route';
import {cookies} from 'next/headers';
import {NextResponse} from 'next/server';
import {adminCookie,revokeAdminSession} from '../../../../../lib/beta/admissions';
import {betaSecure} from '../../../../../lib/beta/config';
import {betaWriteAllowed,betaError} from '../../../../../lib/beta/http';
async function handlePOST(request:Request){try{betaWriteAllowed(request);const raw=(await cookies()).get(adminCookie)?.value;await revokeAdminSession(raw);const response=NextResponse.json({ok:true},{headers:{'Cache-Control':'no-store'}});response.cookies.set(adminCookie,'',{httpOnly:true,secure:betaSecure(),sameSite:'strict',path:'/',maxAge:0});return response;}catch(error){return betaError(error);}}

export const POST=betaRoute(handlePOST);

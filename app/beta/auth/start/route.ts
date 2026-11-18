import {NextResponse} from 'next/server';
import {beginGoogleLogin} from '../../../../lib/beta/auth';
import {betaOrigin,betaSecure,loginCookie} from '../../../../lib/beta/config';
import {desktopReturnCookie,desktopTarget,setupReturnCookie,setupReturnTarget,setupSignInErrorUrl} from '../../../../lib/beta/desktop';
import {optionalClientBucket,rateLimit} from '../../../../lib/beta/admissions';
import {BetaHttpError} from '../../../../lib/beta/http';
export const runtime='nodejs';
export async function GET(request:Request){
 const p=new URL(request.url).searchParams,setup=setupReturnTarget(p.get('next'));
 try{await rateLimit('signin-start',optionalClientBucket(request),30);const login=await beginGoogleLogin();const r=NextResponse.redirect(login.url);r.cookies.set(loginCookie,login.browser,{httpOnly:true,secure:betaSecure(),sameSite:'lax',path:'/beta/auth',maxAge:600});const target=desktopTarget(p.get('port'),p.get('state'));r.cookies.set(setupReturnCookie,setup||'',{httpOnly:true,secure:betaSecure(),sameSite:'lax',path:'/beta/auth',maxAge:setup?600:0});r.cookies.set(desktopReturnCookie,target||'',{httpOnly:true,secure:betaSecure(),sameSite:'lax',path:'/beta/auth',maxAge:target?600:0});r.headers.set('Cache-Control','no-store');return r;}
 catch(e){
  const limited=e instanceof BetaHttpError&&e.status===429;
  // Browser entry opts into a recoverable page; native/older callers retain HTTP errors.
  if(p.get('recovery')==='1')try{const r=NextResponse.redirect(setupSignInErrorUrl(betaOrigin(),setup,limited?'signin-rate':'signin-unavailable'));r.headers.set('Cache-Control','no-store');r.headers.set('Referrer-Policy','no-referrer');return r;}catch{}
  if(limited)return NextResponse.json({error:'Too many sign-in attempts. Wait a little, then try again.'},{status:429,headers:{'Cache-Control':'no-store'}});return NextResponse.json({error:'Google sign-in is not available yet. Please try again later.'},{status:503,headers:{'Cache-Control':'no-store'}});
 }
}

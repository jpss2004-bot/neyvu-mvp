import {NextRequest,NextResponse} from 'next/server';
import {finishGoogleLogin} from '../../../../lib/beta/auth';
import {betaCookie,betaOrigin,betaSecure,loginCookie} from '../../../../lib/beta/config';
import {desktopReturnCookie,desktopTarget,setupReturnCookie,setupReturnTarget,setupSignInErrorUrl} from '../../../../lib/beta/desktop';
import {optionalClientBucket,rateLimit} from '../../../../lib/beta/admissions';
import {SignInFailure,signInFailureCode} from '../../../../lib/beta/signin-recovery';
import {BetaHttpError} from '../../../../lib/beta/http';
export const runtime='nodejs';
export async function GET(req:NextRequest){
 let r:NextResponse;
 const setup=setupReturnTarget(req.cookies.get(setupReturnCookie)?.value);
 try{
  await rateLimit('signin-callback',optionalClientBucket(req),30);
  const p=req.nextUrl.searchParams;
  if(p.get('error')==='access_denied')throw new SignInFailure('cancelled','Google sign-in was cancelled.');
  const raw=await finishGoogleLogin(p.get('code')||'',p.get('state')||'',req.cookies.get(loginCookie)?.value||'');
  let target=setup||'/beta';try{const saved=new URL(req.cookies.get(desktopReturnCookie)?.value||'',betaOrigin());if(saved.pathname==='/beta/desktop-connect')target=desktopTarget(saved.searchParams.get('port'),saved.searchParams.get('state'))||target;}catch{}
  r=NextResponse.redirect(new URL(target,betaOrigin()));
  r.cookies.set(betaCookie,raw,{httpOnly:true,secure:betaSecure(),sameSite:'lax',path:'/',maxAge:30*24*3600});
 }catch(error){try{const code=error instanceof BetaHttpError&&error.status===429?'signin-rate':signInFailureCode(error);r=NextResponse.redirect(setupSignInErrorUrl(betaOrigin(),setup,code));}catch{return NextResponse.json({error:'Sign-in is not available yet.'},{status:503,headers:{'Cache-Control':'no-store'}});}}
 r.cookies.set(setupReturnCookie,'',{httpOnly:true,secure:betaSecure(),sameSite:'lax',path:'/beta/auth',maxAge:0});
 r.cookies.set(loginCookie,'',{httpOnly:true,secure:betaSecure(),sameSite:'lax',path:'/beta/auth',maxAge:0});
 r.cookies.set(desktopReturnCookie,'',{httpOnly:true,secure:betaSecure(),sameSite:'lax',path:'/beta/auth',maxAge:0});
 r.headers.set('Cache-Control','no-store');r.headers.set('Referrer-Policy','no-referrer');return r;
}

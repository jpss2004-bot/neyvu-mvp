import {NextResponse,type NextRequest} from 'next/server';
import {languageCookie,requestLanguage} from '../../lib/beta/language';
import {backendOrigin} from './transport-config';
export function proxy(request:NextRequest){
 const headers=new Headers(request.headers);
 const api=request.nextUrl.pathname==='/api/beta'||request.nextUrl.pathname.startsWith('/api/beta/');
 if(api&&process.env.VERCEL!=='1')return Response.json({error:'Use the local streaming frontend profile for local qualification.'},{status:503,headers:{'Cache-Control':'private, no-store'}});
 if(!api&&!['GET','HEAD'].includes(request.method))return Response.json({error:'Open this page with a browser.'},{status:405,headers:{Allow:'GET, HEAD','Cache-Control':'private, no-store'}});
 if(request.nextUrl.pathname==='/api/beta'||request.nextUrl.pathname.startsWith('/api/beta/')||request.nextUrl.pathname.startsWith('/beta/auth/')){
  const key=process.env.NEYVU_GATEWAY_KEY;if(!key||!/^[A-Za-z0-9_-]{43,128}$/.test(key))return Response.json({error:'The workspace connection is not configured.'},{status:503,headers:{'Cache-Control':'private, no-store'}});
  headers.set('x-neyvu-gateway',key);
  // On Vercel x-real-ip is platform-overwritten. Local qualification has a fixed peer.
  headers.set('x-neyvu-client-ip',process.env.VERCEL==='1'?(request.headers.get('x-real-ip')||'unknown'):process.env.NEYVU_LOCAL_SPLIT==='1'?'127.0.0.1':'unknown');
  return NextResponse.rewrite(new URL(request.nextUrl.pathname+request.nextUrl.search,backendOrigin()),{request:{headers}});
 }
 if(!['GET','HEAD'].includes(request.method))return Response.json({error:'Open this page with a browser.'},{status:405,headers:{Allow:'GET, HEAD','Cache-Control':'private, no-store'}});
 headers.delete('x-neyvu-gateway');headers.delete('x-neyvu-client-ip');
 headers.set('x-neyvu-language',requestLanguage({query:request.nextUrl.searchParams.get('lang'),cookie:request.cookies.get(languageCookie)?.value,accept:request.headers.get('accept-language')}));
 return NextResponse.next({request:{headers}});
}
export const config={matcher:['/beta/:path*','/api/beta/:path*']};

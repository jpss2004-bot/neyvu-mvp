import {NextResponse,type NextRequest} from 'next/server';
import {languageCookie,requestLanguage} from '../../lib/beta/language';
export function proxy(request:NextRequest){
 if(request.nextUrl.pathname.startsWith('/api/')||request.nextUrl.pathname.startsWith('/beta/auth/'))return Response.json({error:'This hosting preview cannot sign in, save changes or send requests. Please use the live Neyvu site.'},{status:503,headers:{'Cache-Control':'private, no-store'}});
 const headers=new Headers(request.headers);headers.delete('x-neyvu-gateway');headers.delete('x-neyvu-client-ip');
 headers.set('x-neyvu-language',requestLanguage({query:request.nextUrl.searchParams.get('lang'),cookie:request.cookies.get(languageCookie)?.value,accept:request.headers.get('accept-language')}));
 return NextResponse.next({request:{headers}});
}
export const config={matcher:['/beta/:path*','/api/:path*']};

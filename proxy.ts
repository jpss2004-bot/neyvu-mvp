import type {NextRequest} from 'next/server';
import {NextResponse} from 'next/server';
import {maintenanceState,maintenanceResponse} from './lib/beta/maintenance';
import {languageCookie,requestLanguage} from './lib/beta/language';
import {browserGatewayAllowed} from './lib/beta/gateway';

export async function proxy(request:NextRequest){
 const state=await maintenanceState();
 if(state.held)return maintenanceResponse(request.nextUrl.pathname,state);
 if(!browserGatewayAllowed(request))return Response.json({error:'Use the Neyvu website to open your workspace.'},{status:403,headers:{'Cache-Control':'private, no-store'}});
 if(!['GET','HEAD'].includes(request.method))return Response.json({error:'Open this page with a browser.'},{status:405,headers:{Allow:'GET, HEAD','Cache-Control':'private, no-store'}});
 const headers=new Headers(request.headers);
 headers.set('x-neyvu-language',requestLanguage({query:request.nextUrl.searchParams.get('lang'),cookie:request.cookies.get(languageCookie)?.value,accept:request.headers.get('accept-language')}));
 return NextResponse.next({request:{headers}});
}
export const config={matcher:['/beta/:path*']};

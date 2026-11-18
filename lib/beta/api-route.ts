import {maintenanceState,maintenanceResponse} from './maintenance';
import {browserGatewayAllowed} from './gateway';
import {languageCookie,requestLanguage} from './language';
import {betaError} from './http';
import {bodyOperation} from './body-budget';

// API guards run before body reads, without Next middleware cloning the body.
// Keep every beta API method behind this wrapper when adding routes.
export function betaRoute(handler:(request:Request)=>Promise<Response>){
 return async function(request:Request){
  try{
   const state=await maintenanceState();
   if(state.held)return maintenanceResponse(new URL(request.url).pathname,state);
   if(!browserGatewayAllowed(request))return Response.json({error:'Use the Neyvu website to open your workspace.'},{status:403,headers:{'Cache-Control':'private, no-store'}});
   const cookie=(request.headers.get('cookie')||'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(languageCookie+'=')).at(-1)?.slice(languageCookie.length+1);
   request.headers.set('x-neyvu-language',requestLanguage({query:new URL(request.url).searchParams.get('lang'),cookie,accept:request.headers.get('accept-language')}));
   return await bodyOperation(()=>handler(request));
  }catch(error){return betaError(error);}
 };
}

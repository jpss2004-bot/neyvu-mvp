import {betaRoute} from '../../../../lib/beta/api-route';
import {pageCapabilities,pageSession,pageStudyCopy} from '../../../../lib/beta/page-data';
import {betaJson,betaError,BetaHttpError} from '../../../../lib/beta/http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function handleGET(request:Request){try{
 const p=new URL(request.url).searchParams;
 if(p.get('view')==='capabilities')return betaJson(await pageCapabilities());
 if(p.get('view')==='session')return betaJson(await pageSession());
 if(p.get('view')==='study')return betaJson({version:1,copy:await pageStudyCopy(p.get('message')||'')});
 throw new BetaHttpError('Unknown page view',400);
}catch(error){return betaError(error);}}

export const GET=betaRoute(handleGET);

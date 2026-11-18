import {betaRoute} from '../../../../lib/beta/api-route';
import {betaActor} from '../../../../lib/beta/auth';
import {betaJson,betaError,BetaHttpError,betaRequestJson,betaWriteAllowed} from '../../../../lib/beta/http';
import {researchExportView,saveResearchSettings} from '../../../../lib/beta/research-export';
import {readStudyCopy} from '../../../../lib/beta/study-copy';
import {formatResearch} from '../../../../lib/beta/research-format';
import {citationStyle} from '../../../../lib/beta/citation-metadata';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function handleGET(request:Request){try{
 const actor=await betaActor();if(!actor)throw new BetaHttpError('Please sign in.',401);
 const message=new URL(request.url).searchParams.get('message')||'';
 return betaJson(await researchExportView(actor.id,message));
}catch(e){return betaError(e);}}
async function handlePOST(request:Request){try{
 betaWriteAllowed(request);const actor=await betaActor();if(!actor)throw new BetaHttpError('Please sign in.',401);
 const body=await betaRequestJson(request,50000);const message=typeof body.message==='string'?body.message:'';
 if(body.op==='format'){
  const [copy,view]=await Promise.all([readStudyCopy(actor.id,message),researchExportView(actor.id,message)]);
  return betaJson(formatResearch(copy.answer,view.references,citationStyle(body.style)));
 }
 await saveResearchSettings(actor.id,message,body);
 return betaJson(await researchExportView(actor.id,message));
}catch(e){return betaError(e);}}
export const GET=betaRoute(handleGET);
export const POST=betaRoute(handlePOST);

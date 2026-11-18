import {withUpload} from '../../../../lib/beta/uploads';
import {betaRoute} from '../../../../lib/beta/api-route';
import {betaActor} from '../../../../lib/beta/auth';
import {betaJson,betaError,betaWriteAllowed,BetaHttpError} from '../../../../lib/beta/http';
import {createBetaFile,readBetaFile} from '../../../../lib/beta/files';
import {rateLimit} from '../../../../lib/beta/admissions';
import {createHash} from 'node:crypto';
export const runtime='nodejs';
async function handleGET(request:Request){
 try{
  const actor=await betaActor();if(!actor)throw new BetaHttpError('Please sign in.',401);
  const params=new URL(request.url).searchParams;
  const {source,bytes}=await readBetaFile(actor.id,params.get('id')||'',params.get('version')||undefined);
  const extensions:Record<string,string>={'application/vnd.ms-powerpoint':'.ppt','application/pdf':'.pdf','text/plain':'.txt','text/markdown':'.md','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'.docx','application/vnd.openxmlformats-officedocument.presentationml.presentation':'.pptx','image/png':'.png','image/jpeg':'.jpg','video/mp4':'.mp4'};
  const extension=extensions[source.mime]||'',filename=source.title+(extension&&!source.title.toLowerCase().endsWith(extension)?extension:'');
  const disposition=params.get('view')==='1'&&source.mime==='application/pdf'?'inline':'attachment';
  return new Response(new Uint8Array(bytes),{headers:{'Content-Type':source.mime,'Content-Disposition':`${disposition}; filename*=UTF-8''${encodeURIComponent(filename)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Vary':'Cookie'}});
 }catch(error){return betaError(error);}
}
async function handlePOST(request:Request){
 try{
  betaWriteAllowed(request);const actor=await betaActor();if(!actor)throw new BetaHttpError('Please sign in.',401);
  // Quotas cap bytes; this caps the number of uploads per student per hour.
  await rateLimit('upload-user',createHash('sha256').update('upload:'+actor.id).digest('hex'),120);
  const p=new URL(request.url).searchParams;
  return await withUpload(request,actor.id,10*1024*1024,async bytes=>betaJson(await createBetaFile(actor.id,p.get('course')||'',p.get('name')||'',request.headers.get('content-type')?.split(';')[0]||'',bytes),201));
 }catch(error){return betaError(error);}
}

export const GET=betaRoute(handleGET);
export const POST=betaRoute(handlePOST);

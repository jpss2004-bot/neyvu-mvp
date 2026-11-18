import {betaRoute} from '../../../../lib/beta/api-route';
import {betaActor} from '../../../../lib/beta/auth';
import {betaError,BetaHttpError} from '../../../../lib/beta/http';
import {tenant} from '../../../../lib/beta/db';
import {institutionEvidenceEnabled} from '../../../../lib/beta/connectors/flags';
export const runtime='nodejs';
// C9 for institution evidence: serve the saved public original (PDF inline, so
// #page=N opens the cited page). Only the learner's own institution is served.
async function handleGET(request:Request){
 try{
  if(!institutionEvidenceEnabled())throw new BetaHttpError('Not available.',404);
  const actor=await betaActor();if(!actor)throw new BetaHttpError('Please sign in.',401);
  const version=new URL(request.url).searchParams.get('version')||'';
  if(!/^[a-f0-9]{64}$/.test(version))throw new BetaHttpError('Source not found.',404);
  const row=await tenant(actor.id,async c=>(await c.query(`SELECT s.title,o.mime,o.body FROM institution_public.versions v JOIN institution_public.sources s ON s.id=v.source_id
   JOIN institution_public.objects o ON o.sha256=v.sha256 JOIN schoolvault.users u ON u.id=$1 AND u.institution_id=s.institution_id WHERE v.id=$2`,[actor.id,version])).rows[0]);
  if(!row)throw new BetaHttpError('Source not found.',404);
  const pdf=row.mime==='application/pdf',filename=String(row.title).replace(/[^\w .-]+/g,'').slice(0,120)+(pdf?'.pdf':'.txt');
  return new Response(new Uint8Array(row.body),{headers:{'Content-Type':pdf?'application/pdf':'text/plain; charset=utf-8','Content-Disposition':`${pdf?'inline':'inline'}; filename*=UTF-8''${encodeURIComponent(filename)}`,'Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
 }catch(error){return betaError(error);}
}
export const GET=betaRoute(handleGET);

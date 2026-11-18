import {assistantsEnabled,registerClient,OAuthFailure} from '../../../../lib/platform/oauth';
import {rateLimit,optionalClientBucket} from '../../../../lib/beta/admissions';
import {BetaHttpError} from '../../../../lib/beta/http';
export const runtime='nodejs';
const cors={'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'};
// RFC 7591 dynamic client registration for public assistant clients (no secrets issued).
export async function POST(request:Request){
 try{
  if(!assistantsEnabled())throw new OAuthFailure('temporarily_unavailable','Assistant connections are not available yet.',503);
  try{await rateLimit('oauth-register',optionalClientBucket(request),20);}catch(e){if(e instanceof BetaHttpError&&e.status===429)throw new OAuthFailure('invalid_client_metadata','Too many registrations. Try again later.',429);throw e;}
  const raw=await request.text();if(raw.length>8000)throw new OAuthFailure('invalid_client_metadata','Registration is too large.');
  let body;try{body=JSON.parse(raw);}catch{throw new OAuthFailure('invalid_client_metadata','Send JSON client metadata.');}
  return Response.json(await registerClient(body),{status:201,headers:cors});
 }catch(e){if(e instanceof OAuthFailure)return Response.json({error:e.code,error_description:e.message},{status:e.status,headers:cors});return Response.json({error:'server_error'},{status:500,headers:cors});}
}
export function OPTIONS(){return new Response(null,{status:204,headers:{...cors,'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'content-type'}});}

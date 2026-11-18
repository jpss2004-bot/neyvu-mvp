import {exchangeToken,OAuthFailure} from '../../../../lib/platform/oauth';
export const runtime='nodejs';
const cors={'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Pragma':'no-cache'};
export async function POST(request:Request){
 try{
  if(!(request.headers.get('content-type')||'').startsWith('application/x-www-form-urlencoded'))throw new OAuthFailure('invalid_request','Use application/x-www-form-urlencoded.');
  const raw=await request.text();if(raw.length>4000)throw new OAuthFailure('invalid_request','Request is too large.');
  return Response.json(await exchangeToken(new URLSearchParams(raw)),{headers:cors});
 }catch(e){if(e instanceof OAuthFailure)return Response.json({error:e.code,error_description:e.message},{status:e.status,headers:cors});return Response.json({error:'server_error'},{status:500,headers:cors});}
}
export function OPTIONS(){return new Response(null,{status:204,headers:{...cors,'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'content-type'}});}

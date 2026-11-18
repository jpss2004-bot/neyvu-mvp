import {assistantsEnabled,authorizationServerMetadata} from '../../../lib/platform/oauth';
export const runtime='nodejs';export const dynamic='force-dynamic';
// RFC 8414 metadata for assistant (MCP) connections. 404 while the feature is off.
export async function GET(){
 if(!assistantsEnabled())return Response.json({error:'not_found'},{status:404});
 return Response.json(authorizationServerMetadata(),{headers:{'Cache-Control':'public, max-age=300','Access-Control-Allow-Origin':'*'}});
}

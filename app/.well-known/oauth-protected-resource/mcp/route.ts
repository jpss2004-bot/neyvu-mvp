import {metadataResponse} from '../../../../lib/platform/mcp';
export const runtime='nodejs';export const dynamic='force-dynamic';
// Path-suffixed RFC 9728 metadata for <origin>/mcp. 404 while the feature is off.
export function GET(){return metadataResponse('/.well-known/oauth-protected-resource/mcp');}

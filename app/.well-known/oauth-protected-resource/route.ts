import {metadataResponse} from '../../../lib/platform/mcp';
export const runtime='nodejs';export const dynamic='force-dynamic';
// RFC 9728 Protected Resource Metadata for the MCP endpoint. 404 while the feature is off.
export function GET(){return metadataResponse('/.well-known/oauth-protected-resource');}

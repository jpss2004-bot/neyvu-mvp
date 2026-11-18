import {handleMcp,mcpPreflight} from '../../lib/platform/mcp';
export const runtime='nodejs';export const dynamic='force-dynamic';
// Remote MCP endpoint (stateless Streamable HTTP). Off unless SCHOOL_BETA_MCP=1.
export const POST=(request:Request)=>handleMcp(request);
export const GET=(request:Request)=>handleMcp(request);
export const DELETE=(request:Request)=>handleMcp(request);
export const OPTIONS=()=>mcpPreflight();

import {createHash} from 'node:crypto';
import {createMcpHandler,requireBearerAuth,getOAuthProtectedResourceMetadataUrl,OAuthError,OAuthErrorCode,type AuthInfo} from '@modelcontextprotocol/server';
import {betaPool} from '../beta/db';
import {betaOrigin} from '../beta/config';
import {maintenanceState,maintenanceResponse} from '../beta/maintenance';
import {assistantScope,assistantsEnabled,mcpResource} from './oauth';
import {neyvuServer} from './mcp-tools';

// Neyvu MCP endpoint served by the web app at <origin>/mcp: stateless Streamable HTTP and an
// OAuth 2.1 resource server. It accepts only bearer access tokens Neyvu issued for this exact
// resource (never passwords or LMS tokens) and never forwards the token to another service.
const sha256=(s:string)=>createHash('sha256').update(s).digest('hex');
async function tokenActor(raw:string){
 if(!/^[A-Za-z0-9_-]{43}$/.test(raw))return null;
 return ((await betaPool().query('SELECT user_id,client_id,resource,scope,expires_at FROM schoolvault.oauth_access_actor($1)',[sha256(raw)])).rows[0] as {user_id:string;client_id:string;resource:string;scope:string;expires_at:Date}|undefined)??null;
}
const verifier={async verifyAccessToken(token:string):Promise<AuthInfo>{
 const row=await tokenActor(token);
 if(!row)throw new OAuthError(OAuthErrorCode.InvalidToken,'The access token is not valid.');
 return {token,clientId:row.client_id,scopes:row.scope.split(' '),expiresAt:Math.floor(row.expires_at.getTime()/1000),resource:new URL(row.resource),extra:{userId:row.user_id}};
}};

export function protectedResourceMetadata(){
 const resource=mcpResource();if(!assistantsEnabled()||!resource)return null;
 return {resource,authorization_servers:[betaOrigin()],scopes_supported:[assistantScope],bearer_methods_supported:['header'],resource_name:'Neyvu learner context (read-only)'};
}
// proxy.ts only covers /beta/*, so these routes check the maintenance hold themselves.
// The '/api' prefix selects maintenanceResponse's JSON 503 (MCP clients cannot use the HTML page).
async function held(pathname:string){const state=await maintenanceState();return state.held?withCors(maintenanceResponse('/api'+pathname,state)):null;}
const corsHeaders={'Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version'};
function withCors(res:Response){const headers=new Headers(res.headers);for(const [k,v] of Object.entries(corsHeaders))headers.set(k,v);return new Response(res.body,{status:res.status,statusText:res.statusText,headers});}
export function mcpPreflight(){return new Response(null,{status:204,headers:{...corsHeaders,'Access-Control-Allow-Methods':'GET, POST, DELETE, OPTIONS','Access-Control-Allow-Headers':'authorization, content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id','Access-Control-Max-Age':'600','Cache-Control':'no-store'}});}

export async function metadataResponse(pathname:string){
 const hold=await held(pathname);if(hold)return hold;
 const prm=protectedResourceMetadata();
 if(!prm)return Response.json({error:'not_found'},{status:404});
 // The global next.config headers force 'private, no-store' on every path, so don't claim caching here.
 return Response.json(prm,{headers:{'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'}});
}

let cached:{resource:string;gate:(r:Request)=>Promise<AuthInfo|Response>;handler:ReturnType<typeof createMcpHandler>}|undefined;
function endpoint(resource:string){
 if(cached?.resource===resource)return cached;
 const url=new URL(resource);
 const gate=requireBearerAuth({verifier,requiredScopes:[assistantScope],resourceMetadataUrl:getOAuthProtectedResourceMetadataUrl(url),expectedResource:url});
 const handler=createMcpHandler(ctx=>{const user=ctx.authInfo?.extra?.userId;if(typeof user!=='string')throw Error('Unauthenticated');return neyvuServer(user);});
 return cached={resource,gate,handler};
}
export const maxMcpBody=1024*1024;
// Reads at most maxMcpBody bytes; null when the body is larger (stops reading at the cap).
async function cappedBody(request:Request){
 if(!request.body)return new Uint8Array(0);
 const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxMcpBody){await reader.cancel();return null;}chunks.push(value);}
 const out=new Uint8Array(size);let at=0;for(const c of chunks){out.set(c,at);at+=c.byteLength;}return out;
}
const tooLarge=()=>withCors(Response.json({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Request body is too large.'}},{status:413,headers:{'Cache-Control':'no-store'}}));
export async function handleMcp(request:Request){
 const hold=await held(new URL(request.url).pathname);if(hold)return hold;
 const resource=mcpResource();
 if(!assistantsEnabled()||!resource)return withCors(Response.json({error:'not_found'},{status:404}));
 if(Number(request.headers.get('content-length')||0)>maxMcpBody)return tooLarge();
 const {gate,handler}=endpoint(resource);
 const auth=await gate(request);if(auth instanceof Response)return withCors(auth);
 let forward=request;
 if(request.method==='POST'){
  const body=await cappedBody(request);if(!body)return tooLarge();
  forward=new Request(request.url,{method:'POST',headers:request.headers,body,signal:request.signal});
 }
 return withCors(await handler.fetch(forward,{authInfo:auth}));
}

import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {betaPool,tenant,uuid} from '../beta/db';
import {betaOrigin} from '../beta/config';

// E4 authorization server for assistant (MCP) connections. OAuth 2.1 + PKCE (S256 only),
// public clients via dynamic registration, resource indicators bound to the MCP server.
// The learner approves in the signed-in web app; an assistant never sees a Neyvu or LMS
// password or token, and the MCP server never forwards the token anywhere.

export const assistantScope='neyvu.read';
const accessSeconds=3600;
export function assistantsEnabled(){return process.env.SCHOOL_BETA_MCP==='1'&&!!mcpResource();}
// Canonical MCP server URL: served by this web app at <origin>/mcp (no fragment, no query).
export function mcpResource(){try{return betaOrigin()+'/mcp';}catch{return null;}}
export class OAuthFailure extends Error{constructor(public code:string,message:string,public status=400){super(message);}}
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const s256=(verifier:string)=>createHash('sha256').update(verifier).digest('base64url');
const token=()=>randomBytes(32).toString('base64url');
const loopback=(h:string)=>['127.0.0.1','localhost','[::1]'].includes(h);
export const sameResource=(a:string,b:string)=>a.replace(/#.*$/,'').replace(/\/$/,'')===b.replace(/#.*$/,'').replace(/\/$/,'');

export function authorizationServerMetadata(){
 const issuer=betaOrigin();
 return {issuer,authorization_endpoint:issuer+'/beta/connect/assistant',token_endpoint:issuer+'/api/oauth/token',registration_endpoint:issuer+'/api/oauth/register',
  response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],
  token_endpoint_auth_methods_supported:['none'],scopes_supported:[assistantScope],client_id_metadata_document_supported:false};
}

export function validRedirect(raw:unknown){
 if(typeof raw!=='string'||raw.length>500)return false;
 try{const u=new URL(raw);if(u.hash||u.username||u.password)return false;return u.protocol==='https:'||(u.protocol==='http:'&&loopback(u.hostname))||/^[a-z][a-z0-9.+-]*\.[a-z0-9.+-]+:$/.test(u.protocol);}catch{return false;}
}
export async function registerClient(body:any){
 const uris=body?.redirect_uris;
 if(!Array.isArray(uris)||!uris.length||uris.length>10||!uris.every(validRedirect))throw new OAuthFailure('invalid_redirect_uri','Redirect URIs must be https, loopback http or a private-use scheme.');
 if(body.token_endpoint_auth_method&&body.token_endpoint_auth_method!=='none')throw new OAuthFailure('invalid_client_metadata','Only public clients are supported.');
 const name=typeof body.client_name==='string'&&body.client_name.trim()?body.client_name.trim().slice(0,120):'AI assistant';
 const id=randomBytes(18).toString('base64url');
 await betaPool().query('INSERT INTO schoolvault.oauth_clients(id,name,redirect_uris) VALUES($1,$2,$3)',[id,name,uris]);
 return {client_id:id,client_name:name,redirect_uris:uris,token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code'],scope:assistantScope,client_id_issued_at:Math.floor(Date.now()/1000)};
}

export type AuthorizeRequest={client_id:string;redirect_uri:string;code_challenge:string;state:string|null;resource:string;client_name:string};
// Validates an authorization request before anything is shown to the learner. Errors that
// concern the client or redirect are shown in Neyvu, never redirected (open-redirect safety).
export async function checkAuthorizeRequest(p:Record<string,string|undefined>):Promise<AuthorizeRequest>{
 if(!assistantsEnabled())throw new OAuthFailure('temporarily_unavailable','Assistant connections are not available yet.',503);
 if(!p.client_id||p.client_id.length>64)throw new OAuthFailure('invalid_request','Unknown assistant.');
 const client=(await betaPool().query('SELECT id,name,redirect_uris FROM schoolvault.oauth_clients WHERE id=$1 AND disabled_at IS NULL',[p.client_id])).rows[0];
 if(!client)throw new OAuthFailure('invalid_client','Unknown assistant.');
 if(!p.redirect_uri||!client.redirect_uris.includes(p.redirect_uri))throw new OAuthFailure('invalid_request','This return address is not registered for the assistant.');
 if(p.response_type!=='code')throw new OAuthFailure('unsupported_response_type','Only the authorization code flow is supported.');
 if(p.code_challenge_method!=='S256'||!/^[A-Za-z0-9_-]{43}$/.test(p.code_challenge||''))throw new OAuthFailure('invalid_request','PKCE with S256 is required.');
 const resource=mcpResource()!;
 if(p.resource&&!sameResource(p.resource,resource))throw new OAuthFailure('invalid_target','This assistant asked for a resource Neyvu does not serve.');
 if(p.scope&&p.scope.split(' ').some(s=>s&&s!==assistantScope))throw new OAuthFailure('invalid_scope','Only read access is available.');
 return {client_id:client.id,redirect_uri:p.redirect_uri,code_challenge:p.code_challenge!,state:p.state??null,resource,client_name:client.name};
}
export async function approveAuthorization(user:string,p:Record<string,string|undefined>){
 const req=await checkAuthorizeRequest(p);const code=token();
 await tenant(user,async c=>{
  const grant=(await c.query(`SELECT id FROM schoolvault.oauth_grants WHERE user_id=$1 AND client_id=$2 AND resource=$3 AND revoked_at IS NULL`,[user,req.client_id,req.resource])).rows[0]?.id??randomUUID();
  await c.query('INSERT INTO schoolvault.oauth_grants(user_id,id,client_id,resource) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[user,grant,req.client_id,req.resource]);
  await c.query(`INSERT INTO schoolvault.oauth_codes(code_sha256,user_id,grant_id,client_id,redirect_uri,code_challenge,resource,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '2 minutes')`,
   [sha(code),user,grant,req.client_id,req.redirect_uri,req.code_challenge,req.resource]);
 });
 const back=new URL(req.redirect_uri);back.searchParams.set('code',code);if(req.state)back.searchParams.set('state',req.state);back.searchParams.set('iss',betaOrigin());
 return back.href;
}
export function denyRedirect(req:AuthorizeRequest){const back=new URL(req.redirect_uri);back.searchParams.set('error','access_denied');if(req.state)back.searchParams.set('state',req.state);back.searchParams.set('iss',betaOrigin());return back.href;}

export async function exchangeToken(form:URLSearchParams){
 if(!assistantsEnabled())throw new OAuthFailure('temporarily_unavailable','Assistant connections are not available yet.',503);
 const grant=form.get('grant_type'),client=form.get('client_id')||'';
 if(form.get('client_secret'))throw new OAuthFailure('invalid_client','Public clients do not use a secret.',401);
 if(form.has('resource')&&!sameResource(form.get('resource')!,mcpResource()!))throw new OAuthFailure('invalid_target','Unknown resource.');
 const access=token(),refresh=token();
 try{
  if(grant==='authorization_code'){
   const code=form.get('code')||'',verifier=form.get('code_verifier')||'';
   if(!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier))throw new OAuthFailure('invalid_grant','A PKCE code_verifier is required.');
   const r=(await betaPool().query('SELECT * FROM schoolvault.redeem_oauth_code($1,$2,$3,$4,$5,$6,$7)',[sha(code),client,form.get('redirect_uri')||'',s256(verifier),sha(access),sha(refresh),accessSeconds])).rows[0];
   if(!r)throw new OAuthFailure('invalid_grant','The code or token is not valid.');
   return {access_token:access,token_type:'Bearer',expires_in:accessSeconds,refresh_token:refresh,scope:r.scope,resource:r.resource};
  }
  if(grant==='refresh_token'){
   const r=(await betaPool().query('SELECT * FROM schoolvault.refresh_oauth_token($1,$2,$3,$4,$5)',[sha(form.get('refresh_token')||''),client,sha(access),sha(refresh),accessSeconds])).rows[0];
   if(!r)throw new OAuthFailure('invalid_grant','The code or token is not valid.');
   return {access_token:access,token_type:'Bearer',expires_in:accessSeconds,refresh_token:refresh,scope:r.scope,resource:r.resource};
  }
 }catch(e:any){if(e?.code==='28000')throw new OAuthFailure('invalid_grant','The code or token is not valid.');throw e;}
 throw new OAuthFailure('unsupported_grant_type','Unsupported grant type.');
}

export async function connectedAssistants(user:string){
 return tenant(user,async c=>(await c.query(`SELECT g.id,c.name,g.created_at,g.last_used_at FROM schoolvault.oauth_grants g JOIN schoolvault.oauth_clients c ON c.id=g.client_id WHERE g.user_id=$1 AND g.revoked_at IS NULL ORDER BY g.created_at DESC`,[user])).rows);
}
export async function disconnectAssistant(user:string,grant:unknown){
 if(!uuid(grant))throw new OAuthFailure('invalid_request','Unknown connection.');
 return tenant(user,async c=>{
  await c.query('UPDATE schoolvault.oauth_tokens SET revoked_at=now() WHERE user_id=$1 AND grant_id=$2 AND revoked_at IS NULL',[user,grant]);
  return (await c.query('UPDATE schoolvault.oauth_grants SET revoked_at=now() WHERE user_id=$1 AND id=$2 AND revoked_at IS NULL',[user,grant])).rowCount===1;
 });
}

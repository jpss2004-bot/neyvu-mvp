import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {createHash,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {tenant,uuid} from '../db';
import {BetaHttpError} from '../http';
import institutions from '../../../packages/connectors/institutions.json';
import {clientFor,authorizationUrl,pkcePair,newState,exchangeCode,refreshTokens,revokeAtProvider,needsRefresh,type InstitutionClient,type TokenSet} from '../../../packages/connectors/src/oauth';
import {moodleSiteUrl,moodlePublicConfig,moodleTokenFromPassword,moodleSsoLaunchUrl,parseMoodleSsoCallback,newPassport,MoodleTokenConnector} from '../../../packages/connectors/src/connectors/moodle-ws';
import {lmsIdentity,liveLmsConnector} from '../../../packages/connectors/src/live';
import {OutlookMailConnector,GmailConnector,normalizeAddress,type MailConnector} from '../../../packages/connectors/src/mail/mail';
import {LmsError} from '../../../packages/connectors/src/read-only';
import type {LmsConnector} from '../../../packages/connectors/src/types';
import {connectorEnabled,connectionsPageEnabled,type ConnectorKind} from './flags';
import {sealToken,openToken,accountBinding,handshakeBinding,tokenKeyVersion} from './token-box';

export const connectorKinds:ConnectorKind[]=['moodle_token','canvas','brightspace','outlook','gmail'];
const providerOf:Record<Exclude<ConnectorKind,'moodle_token'>,InstitutionClient['provider']>={canvas:'canvas',brightspace:'brightspace',outlook:'microsoft',gmail:'google'};
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
/** Test seam: replace network calls with mocks. Never set in production code paths. */
// Outbound guard: learner-typed hosts (Moodle) are checked by name in moodleSiteUrl, and here
// every resolved address must be public, so a public name pointing at 127.0.0.1, 10/8,
// 169.254.169.254 etc. is refused. Redirects are refused too (they could hop to a private host).
export function privateAddress(ip:string){
 const v=ip.toLowerCase().replace(/^::ffff:/,'');
 if(isIP(v)===4){const [a,b]=v.split('.').map(Number);return a===0||a===10||a===127||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===198&&(b===18||b===19))||a>=224;}
 return v==='::'||v==='::1'||/^f[cd]/.test(v)||/^fe[89ab]/.test(v)||/^ff/.test(v);
}
async function guardedFetch(input:any,init?:any){
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
 if(url.protocol!=='https:')throw new Error('Connector requests must use https');
 const host=url.hostname.replace(/^\[|\]$/g,'');
 const addrs=isIP(host)?[{address:host}]:await lookup(host,{all:true});
 if(!addrs.length||addrs.some(a=>privateAddress(a.address)))throw new Error('Connector host resolves to a private address');
 return fetch(input,{...init,redirect:'error'});
}
export const connectorNetwork:{fetch:typeof fetch}={fetch:guardedFetch as typeof fetch};

export function institutionList():InstitutionClient[]{return (institutions as {institutions:InstitutionClient[]}).institutions;}
export function institutionFor(kind:ConnectorKind,institutionId?:string|null):InstitutionClient{
 if(kind==='moodle_token')throw new BetaHttpError('Moodle connects with its site address.',400);
 const provider=providerOf[kind];
 const match=institutionList().find(i=>i.provider===provider&&(kind==='outlook'||kind==='gmail'?true:i.id===institutionId));
 if(!match)throw new BetaHttpError('That institution is not set up for this connector yet.',404);
 return match;
}
function requireKind(value:unknown):ConnectorKind{
 if(!connectorKinds.includes(value as ConnectorKind))throw new BetaHttpError('Unknown connector.',400);
 if(!connectorEnabled(value as ConnectorKind))throw new BetaHttpError('This connector is not available yet.',404);
 return value as ConnectorKind;
}
export function redirectUri(env=process.env){
 const origin=env.SCHOOL_BETA_ORIGIN||'http://localhost:3213';
 return new URL('/api/beta/connections/callback',origin).href;
}
const lmsError=(e:unknown)=>{
 if(e instanceof BetaHttpError)return e;
 if(e instanceof LmsError){
  const msg:Record<string,[string,number]>={configuration:['This connector is not configured on the server yet.',503],reauthorize:['The platform did not accept the sign-in. Please connect again.',401],forbidden:['The platform does not allow this account to use the mobile or API access Neyvu needs.',403],identity_changed:['This sign-in belongs to a different platform account than the one connected.',409],boundary:['That response did not belong to this site or account.',409],invalid_response:['The platform sent a response Neyvu could not read.',502],temporary:['The platform could not be reached. Try again shortly.',503],rate_limited:['The platform asked Neyvu to slow down. Try again later.',429],budget:['The platform returned more than one sync can read.',413],not_found:['That item was not found.',404]};
  const [m,s]=msg[e.code]||['The connector failed.',502];return new BetaHttpError(m,s);
 }
 return e;
};

export type AccountView={id:string;kind:ConnectorKind;mode:string;institution_id:string|null;site_url:string|null;display_name:string;status:string;last_sync_at:string|null;last_error:string|null;created_at:string;senders?:{address:string;course_id:string}[]};

export async function listAccounts(user:string):Promise<AccountView[]>{
 return tenant(user,async c=>{
  const rows=(await c.query("SELECT id,kind,mode,institution_id,site_url,display_name,status,last_sync_at,last_error,created_at FROM schoolvault.connector_accounts WHERE user_id=$1 AND revoked_at IS NULL ORDER BY created_at",[user])).rows;
  const senders=(await c.query('SELECT account_id,address,course_id FROM schoolvault.connector_mail_senders WHERE user_id=$1 ORDER BY address',[user])).rows;
  return rows.map(r=>({...r,senders:r.kind==='outlook'||r.kind==='gmail'?senders.filter(s=>s.account_id===r.id).map(({address,course_id})=>({address,course_id})):undefined}));
 });
}

/** The desktop Companion (session bridge) keeps its own legacy connector row. */
export async function sessionBridgeStatus(user:string){
 return tenant(user,async c=>(await c.query("SELECT status,checked_at,revoked_at FROM schoolvault.connectors WHERE user_id=$1 AND provider='moodle'",[user])).rows[0]||null);
}

async function saveAccount(user:string,kind:ConnectorKind,fields:{mode:'token'|'oauth';institution_id?:string|null;site_url?:string|null;display_name:string;external_identity:string;tokens:TokenSet;scopes?:string}){
 return tenant(user,async c=>{
  const existing=(await c.query("SELECT id FROM schoolvault.connector_accounts WHERE user_id=$1 AND kind=$2 AND coalesce(site_url,institution_id,'')=coalesce($3,$4,'') AND revoked_at IS NULL FOR UPDATE",[user,kind,fields.site_url??null,fields.institution_id??null])).rows[0];
  const id=existing?.id||randomUUID(),box=sealToken(fields.tokens,accountBinding(user,id,kind));
  if(existing){
   const prior=(await c.query('SELECT external_identity FROM schoolvault.connector_accounts WHERE user_id=$1 AND id=$2',[user,id])).rows[0];
   if(prior.external_identity&&prior.external_identity!==fields.external_identity)throw new BetaHttpError('This sign-in belongs to a different account. Disconnect first to switch accounts.',409);
   await c.query("UPDATE schoolvault.connector_accounts SET token_box=$3,token_key_version=$4,token_expires_at=$5,status='connected',last_error=NULL,display_name=$6,external_identity=$7,scopes=$8,updated_at=now() WHERE user_id=$1 AND id=$2",
    [user,id,box,tokenKeyVersion,fields.tokens.expiresAt,fields.display_name.slice(0,200),fields.external_identity,fields.scopes||'']);
  }else{
   await c.query("INSERT INTO schoolvault.connector_accounts(user_id,id,kind,mode,institution_id,site_url,display_name,external_identity,token_box,token_key_version,token_expires_at,scopes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
    [user,id,kind,fields.mode,fields.institution_id??null,fields.site_url??null,fields.display_name.slice(0,200),fields.external_identity,box,tokenKeyVersion,fields.tokens.expiresAt,fields.scopes||'']);
  }
  await c.query("INSERT INTO schoolvault.audit(user_id,id,action,target,details) VALUES($1,$2,'connector-connected',$3,$4)",[user,randomUUID(),id,{kind}]);
  return {id,kind};
 });
}

async function createHandshake(user:string,kind:ConnectorKind,secret:object,extra:{institution_id?:string|null;site_url?:string|null}){
 const state=newState(),stateHash=hash(state);
 await tenant(user,async c=>{
  await c.query('DELETE FROM schoolvault.connector_handshakes WHERE user_id=$1 AND expires_at<now()',[user]);
  if(Number((await c.query('SELECT count(*) FROM schoolvault.connector_handshakes WHERE user_id=$1',[user])).rows[0].count)>=10)throw new BetaHttpError('Too many connections are waiting. Finish or retry later.',429);
  await c.query("INSERT INTO schoolvault.connector_handshakes(user_id,state_hash,kind,institution_id,site_url,secret_box,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '10 minutes')",
   [user,stateHash,kind,extra.institution_id??null,extra.site_url??null,sealToken(secret,handshakeBinding(user,stateHash,kind))]);
 });
 return state;
}
async function consumeHandshake(user:string,state:unknown){
 if(typeof state!=='string'||state.length<20||state.length>200)throw new BetaHttpError('This connection link has expired. Start again.',400);
 const stateHash=hash(state);
 return tenant(user,async c=>{
  const row=(await c.query('DELETE FROM schoolvault.connector_handshakes WHERE user_id=$1 AND state_hash=$2 RETURNING *',[user,stateHash])).rows[0];
  if(!row||Date.parse(row.expires_at)<Date.now())throw new BetaHttpError('This connection link has expired. Start again.',400);
  return {kind:row.kind as ConnectorKind,institution_id:row.institution_id as string|null,site_url:row.site_url as string|null,secret:openToken(row.secret_box,handshakeBinding(user,stateHash,row.kind))};
 });
}

/** Step 1 for every connector. OAuth kinds get an authorize URL; Moodle gets "password" or "sso". */
export async function startConnection(user:string,input:{kind?:unknown;institution_id?:unknown;site_url?:unknown}){
 if(!connectionsPageEnabled())throw new BetaHttpError('Connections are not available yet.',404);
 const kind=requireKind(input.kind);
 try{
  if(kind==='moodle_token'){
   const site=moodleSiteUrl(String(input.site_url||''));
   const config=await moodlePublicConfig(site,connectorNetwork.fetch);
   if(!config.mobileServiceEnabled)throw new BetaHttpError('This Moodle site has the mobile app service turned off, so Neyvu cannot use a token. Keep using the desktop Companion for this site.',409);
   if(config.typeOfLogin===1)return {kind,method:'password' as const,site_url:site,site_name:config.siteName};
   const passport=newPassport(),state=await createHandshake(user,kind,{passport},{site_url:site});
   return {kind,method:'sso' as const,site_url:site,site_name:config.siteName,state,launch_url:moodleSsoLaunchUrl(site,passport)};
  }
  const inst=institutionFor(kind,typeof input.institution_id==='string'?input.institution_id:null);
  const client=clientFor(inst,redirectUri()),{verifier,challenge}=pkcePair();
  const state=await createHandshake(user,kind,{verifier},{institution_id:inst.id});
  return {kind,method:'oauth' as const,authorize_url:authorizationUrl(client,state,challenge)};
 }catch(e){throw lmsError(e);}
}

/** OAuth redirect target: exchange the code, discover the account identity, save the sealed tokens. */
export async function finishOAuth(user:string,state:unknown,code:unknown){
 const hs=await consumeHandshake(user,state);
 if(hs.kind==='moodle_token')throw new BetaHttpError('Use the Moodle sign-in step for this connection.',400);
 requireKind(hs.kind);
 try{
  const inst=institutionFor(hs.kind,hs.institution_id),client=clientFor(inst,redirectUri());
  const tokens=await exchangeCode(client,String(code||''),hs.secret.verifier,connectorNetwork.fetch);
  let identity='',display=inst.name;
  if(hs.kind==='canvas'||hs.kind==='brightspace')identity=await lmsIdentity(inst,tokens.accessToken,connectorNetwork.fetch);
  else identity=await mailIdentity(hs.kind,tokens.accessToken);
  if(hs.kind==='outlook'||hs.kind==='gmail')display=`${inst.name} (${identity})`;
  return await saveAccount(user,hs.kind,{mode:'oauth',institution_id:inst.id,display_name:display,external_identity:identity,tokens,scopes:tokens.scope||client.scopes.join(' ')});
 }catch(e){throw lmsError(e);}
}

async function mailIdentity(kind:'outlook'|'gmail',token:string):Promise<string>{
 const url=kind==='outlook'?'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName':'https://gmail.googleapis.com/gmail/v1/users/me/profile';
 const r=await connectorNetwork.fetch(url,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},redirect:'error'});
 if(r.status===401)throw new LmsError('reauthorize');
 if(!r.ok)throw new LmsError('temporary');
 const d:any=await r.json();
 return normalizeAddress(kind==='outlook'?(d.mail||d.userPrincipalName):d.emailAddress);
}

/** Moodle sites with the app login form: the password is used for one token request and dropped. */
export async function connectMoodleWithPassword(user:string,input:{site_url?:unknown;username?:unknown;password?:unknown}){
 requireKind('moodle_token');
 try{
  const site=moodleSiteUrl(String(input.site_url||''));
  const token=await moodleTokenFromPassword(site,String(input.username||''),String(input.password||''),connectorNetwork.fetch);
  return await connectMoodleToken(user,site,token);
 }catch(e){throw lmsError(e);}
}
/** Moodle SSO: the learner (or the Companion) returns the neyvu://token=... callback. */
export async function connectMoodleWithSso(user:string,input:{state?:unknown;callback?:unknown}){
 const hs=await consumeHandshake(user,input.state);
 if(hs.kind!=='moodle_token'||!hs.site_url)throw new BetaHttpError('This connection link has expired. Start again.',400);
 requireKind('moodle_token');
 try{return await connectMoodleToken(user,hs.site_url,parseMoodleSsoCallback(String(input.callback||''),hs.site_url,hs.secret.passport));}catch(e){throw lmsError(e);}
}
async function connectMoodleToken(user:string,site:string,token:string){
 const probe=new MoodleTokenConnector({id:'probe',site,token,fetch:connectorNetwork.fetch});
 const info=await probe.siteInfo();
 return saveAccount(user,'moodle_token',{mode:'token',site_url:site,display_name:info.sitename||new URL(site).hostname,external_identity:info.userid,tokens:{accessToken:token,refreshToken:null,expiresAt:null,scope:'moodle_mobile_app'}});
}

type LoadedAccount={row:any;tokens:TokenSet};
export async function loadAccount(c:PoolClient,user:string,accountId:string):Promise<LoadedAccount>{
 if(!uuid(accountId))throw new BetaHttpError('Connection not found.',404);
 const row=(await c.query('SELECT * FROM schoolvault.connector_accounts WHERE user_id=$1 AND id=$2 AND revoked_at IS NULL',[user,accountId])).rows[0];
 if(!row||!row.token_box)throw new BetaHttpError('Connection not found.',404);
 return {row,tokens:openToken<TokenSet>(row.token_box,accountBinding(user,row.id,row.kind))};
}

/** Fresh tokens for a sync, refreshing (and re-sealing) OAuth tokens near expiry. */
export async function accountTokens(user:string,accountId:string):Promise<LoadedAccount>{
 const loaded=await tenant(user,c=>loadAccount(c,user,accountId));
 if(loaded.row.mode!=='oauth'||!needsRefresh(loaded.tokens)||!loaded.tokens.refreshToken)return loaded;
 const client=clientFor(institutionFor(loaded.row.kind,loaded.row.institution_id),redirectUri());
 const tokens=await refreshTokens(client,loaded.tokens.refreshToken,connectorNetwork.fetch);
 await tenant(user,c=>c.query('UPDATE schoolvault.connector_accounts SET token_box=$3,token_expires_at=$4,updated_at=now() WHERE user_id=$1 AND id=$2',[user,accountId,sealToken(tokens,accountBinding(user,accountId,loaded.row.kind)),tokens.expiresAt]));
 return {row:loaded.row,tokens};
}

export function lmsConnectorFor(account:LoadedAccount):LmsConnector{
 const {row,tokens}=account,id='acct-'+row.id.slice(0,8);
 if(row.kind==='moodle_token')return new MoodleTokenConnector({id,site:row.site_url,token:tokens.accessToken,expectedUserId:row.external_identity,fetch:connectorNetwork.fetch});
 if(row.kind==='canvas'||row.kind==='brightspace')return liveLmsConnector(id,institutionFor(row.kind,row.institution_id),tokens.accessToken,row.external_identity,connectorNetwork.fetch);
 throw new BetaHttpError('Not a course platform connection.',400);
}
export function mailConnectorFor(account:LoadedAccount):MailConnector{
 if(account.row.kind==='outlook')return new OutlookMailConnector({accessToken:account.tokens.accessToken,fetch:connectorNetwork.fetch});
 if(account.row.kind==='gmail')return new GmailConnector({accessToken:account.tokens.accessToken,fetch:connectorNetwork.fetch});
 throw new BetaHttpError('Not a mail connection.',400);
}

/** Disconnect: best-effort provider revocation, then the sealed token is wiped for good. Saved copies stay. */
export async function disconnectAccount(user:string,accountId:string){
 let loaded:LoadedAccount|null=null;
 try{loaded=await tenant(user,c=>loadAccount(c,user,accountId));}catch(e){if(!(e instanceof BetaHttpError))throw e;}
 let providerRevoked=false;
 if(loaded?.row.mode==='oauth'){try{providerRevoked=await revokeAtProvider(clientFor(institutionFor(loaded.row.kind,loaded.row.institution_id),redirectUri()),loaded.tokens,connectorNetwork.fetch);}catch{providerRevoked=false;}}
 return tenant(user,async c=>{
  const row=(await c.query("UPDATE schoolvault.connector_accounts SET status='revoked',token_box=NULL,revoked_at=now(),updated_at=now() WHERE user_id=$1 AND id=$2 AND revoked_at IS NULL RETURNING id,kind",[user,accountId])).rows[0];
  if(!row)throw new BetaHttpError('Connection not found.',404);
  await c.query('DELETE FROM schoolvault.connector_mail_senders WHERE user_id=$1 AND account_id=$2',[user,accountId]);
  await c.query("INSERT INTO schoolvault.audit(user_id,id,action,target,details) VALUES($1,$2,'connector-disconnected',$3,$4)",[user,randomUUID(),accountId,{kind:row.kind,provider_revoked:providerRevoked}]);
  return {id:row.id,revoked:true,provider_revoked:providerRevoked};
 });
}

export async function confirmSender(user:string,accountId:string,input:{address?:unknown;course_id?:unknown}){
 let address:string;try{address=normalizeAddress(String(input.address||''));}catch{throw new BetaHttpError('Enter a full email address.',400);}
 if(!uuid(input.course_id))throw new BetaHttpError('Choose a course.',400);
 return tenant(user,async c=>{
  const acct=(await c.query("SELECT kind FROM schoolvault.connector_accounts WHERE user_id=$1 AND id=$2 AND revoked_at IS NULL AND kind IN ('outlook','gmail')",[user,accountId])).rows[0];
  if(!acct)throw new BetaHttpError('Connection not found.',404);
  if(!(await c.query('SELECT 1 FROM schoolvault.courses WHERE user_id=$1 AND id=$2',[user,input.course_id])).rowCount)throw new BetaHttpError('Course not found.',404);
  if(Number((await c.query('SELECT count(*) FROM schoolvault.connector_mail_senders WHERE user_id=$1 AND account_id=$2',[user,accountId])).rows[0].count)>=20)throw new BetaHttpError('Up to 20 course senders per mailbox.',409);
  await c.query('INSERT INTO schoolvault.connector_mail_senders(user_id,account_id,address,course_id) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,account_id,address) DO UPDATE SET course_id=EXCLUDED.course_id,confirmed_at=now()',[user,accountId,address,input.course_id]);
  return {address,course_id:input.course_id as string};
 });
}
export async function removeSender(user:string,accountId:string,address:unknown){
 return tenant(user,async c=>({removed:(await c.query('DELETE FROM schoolvault.connector_mail_senders WHERE user_id=$1 AND account_id=$2 AND address=$3',[user,accountId,String(address||'').toLowerCase()])).rowCount===1}));
}
export {lmsError};

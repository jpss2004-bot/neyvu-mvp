import {requestNoticeRecipient,type RequestNotice} from './request-notification';
import {createHash,createHmac,randomBytes,randomUUID} from 'node:crypto';
import {cookies} from 'next/headers';
import type {PoolClient} from 'pg';
import {betaPool,tenant,uuid} from './db';
import {betaEnabled,allowedEmail} from './config';
import {BetaHttpError,peerAddress} from './http';
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');

export const adminCookie='schoolvault-admin';
export const adminBrowserCookie='schoolvault-admin-browser';
export function contactEmail(value:unknown){
 if(typeof value!=='string')throw new BetaHttpError('Enter your Google account email.');
 const email=value.trim().toLowerCase();
 if(email.length>254||!/^[-a-z0-9.!#$%&'*+/=?^_`{|}~]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(email)||email.includes('..'))throw new BetaHttpError('Enter a valid email address.');
 return email;
}
export function adminEmails(){return (process.env.SCHOOL_BETA_ADMIN_EMAILS||'').split(',').map(v=>v.trim().toLowerCase()).filter(v=>v&&contactEmail(v)===v);}
export function isAdminEmail(email:string){return adminEmails().includes(email.toLowerCase());}
export function accessReady(){return betaEnabled()&&/^[A-Za-z0-9_-]{43,128}$/.test(process.env.SCHOOL_BETA_ACCESS_KEY||'');}
export function clientBucket(request:Request){
 if(!accessReady())throw new BetaHttpError('Access requests are being prepared. Please try again later.',503);
 return createHmac('sha256',process.env.SCHOOL_BETA_ACCESS_KEY!).update(peerAddress(request)).digest('hex');
}
// Per-hour limits for flows that must stay open when access requests are not configured
// (local development): without the access key there is no bucket and no limit.
export function optionalClientBucket(request:Request){return accessReady()?clientBucket(request):null;}
export async function rateLimit(kind:string,bucket:string|null,maximum:number){if(bucket)await tenant(randomUUID(),c=>limit(c,kind,bucket,maximum));}
export async function limit(c:PoolClient,kind:string,bucket:string,maximum:number){
 const row=(await c.query("INSERT INTO schoolvault.access_limits(kind,bucket,window_at,attempts) VALUES($1,$2,date_trunc('hour',now()),1) ON CONFLICT(kind,bucket,window_at) DO UPDATE SET attempts=schoolvault.access_limits.attempts+1 RETURNING attempts",[kind,bucket])).rows[0];
 if(row.attempts>maximum)throw new BetaHttpError('Please wait before trying again.',429);
 await c.query("DELETE FROM schoolvault.access_limits WHERE window_at<now()-interval '2 days'");
}
export async function requestAccess(body:Record<string,unknown>,bucket:string,language:unknown='en'):Promise<RequestNotice|undefined>{
 if(!accessReady())throw new BetaHttpError('Access requests are being prepared. Please try again later.',503);
 if(body.website)return; // Honeypot: identical acknowledgement, no stored identity.
 const email=contactEmail(body.email),name=typeof body.name==='string'?body.name.trim():'';
 if(!name||name.length>100||/[\x00-\x1f]/.test(name))throw new BetaHttpError('Enter your name, up to 100 characters.');
 if(body.acadia_student!==true||body.consent!==true)throw new BetaHttpError('Confirm that you study at Acadia and agree to store your access request.');
 if(isAdminEmail(email))throw new BetaHttpError('Use the separate admin sign-in page for this account.');
 return tenant(randomUUID(),async c=>{
  await limit(c,'request-ip',bucket,5);await limit(c,'request-total','all',60);
  // Repeated requests cannot change a decision or rewrite an earlier identity.
  const id=randomUUID(),attempt=randomUUID(),recipient=requestNoticeRecipient();
  await c.query('SELECT schoolvault.request_access($1,$2,$3)',[id,email,name]);
  // Student emails follow the language used on the site when the request was made.
  const lang=language==='es'?'es':'en';await c.query('SELECT schoolvault.set_request_language($1,$2,$3)',[id,email,lang]);
  if(recipient&&(await c.query('SELECT schoolvault.claim_new_request_notice($1,$2,$3) AS claimed',[id,attempt,recipient])).rows[0].claimed)return {id,attempt,recipient,email,name,language:lang};
 });
}
export type StudentAdmissionState='approved'|'pending'|'declined'|'suspended'|'unapproved'|'admin';
export async function studentAdmissionState(c:PoolClient,email:string):Promise<StudentAdmissionState>{
 if(isAdminEmail(email))return 'admin';
 const state=(await c.query('SELECT schoolvault.access_request_state($1) AS state',[email])).rows[0].state;
 if(state==='suspended')return 'suspended';
 if(allowedEmail(email))return 'approved';
 return ['approved','pending','declined'].includes(state)?state:'unapproved';
}
export async function studentAdmission(c:PoolClient,email:string){return await studentAdmissionState(c,email)==='approved';}
// Admin tables are reachable only through session-hash-keyed definer functions (migration 021).
export type AdminSession={email:string;hash:string};
export async function adminSession(raw:string|undefined):Promise<AdminSession|null>{
 if(!accessReady()||!raw||!/^[A-Za-z0-9_-]{43}$/.test(raw))return null;
 const hash=digest(raw),email=(await betaPool().query('SELECT schoolvault.admin_session_email($1) AS email',[hash])).rows[0].email;
 return email&&isAdminEmail(email)?{email:email as string,hash}:null;
}
export async function adminFromToken(raw:string|undefined){const session=await adminSession(raw);return session?{email:session.email}:null;}
export async function adminActor(){return adminFromToken((await cookies()).get(adminCookie)?.value);}
export async function requireAdminSession(){const session=await adminSession((await cookies()).get(adminCookie)?.value);if(!session)throw new BetaHttpError('Sign in to the admin account.',401);return session;}
export async function requireAdmin(){const {email}=await requireAdminSession();return {email};}
export async function revokeAdminSession(raw:string|undefined){if(raw)await betaPool().query('SELECT schoolvault.revoke_admin_session($1)',[digest(raw)]);}
export async function admissionList(){
 const session=await requireAdminSession();const requests=(await betaPool().query('SELECT id,email,name,acadia_student,status,created_at,decided_at,approval_mail,approval_mail_transport,approval_mail_sent_at,origin,access_state FROM schoolvault.admin_access_requests_mail_v2($1)',[session.hash])).rows;
 const notices=(await betaPool().query('SELECT * FROM schoolvault.admin_request_notices($1)',[session.hash])).rows;
 return requests.map(row=>({...row,...notices.find(n=>n.request_id===row.id)}));
}
export async function decideAdmission(id:unknown,decision:unknown){return recordAdmissionDecision(await requireAdminSession(),id,decision);}
export async function recordAdmissionDecision(actor:AdminSession,id:unknown,decision:unknown){
 if(!uuid(id)||!['approved','declined'].includes(String(decision)))throw new BetaHttpError('Choose an access request and a decision.');
 return tenant(randomUUID(),async c=>{
  const row=(await c.query('SELECT email,status FROM schoolvault.admin_lock_access_request($1,$2)',[actor.hash,id])).rows[0];
  if(!row)throw new BetaHttpError('Access request not found.',404);
  if(isAdminEmail(row.email))throw new BetaHttpError('Admin accounts cannot become students.');
  // This endpoint manages initial admissions. It is not an account suspension control.
  if(row.status!=='pending')throw new BetaHttpError('This request already has a decision. Refresh the list.',409);
  // The definer records the session's own admin email as decided_by and in the audit.
  if(!(await c.query('SELECT schoolvault.admin_decide_access_request($1,$2,$3,$4) AS decided',[actor.hash,id,decision,randomUUID()])).rows[0].decided)throw new BetaHttpError('This request already has a decision. Refresh the list.',409);
  return {status:decision};
 });
}
export async function createAdminLogin(emailValue:unknown,browser:string,bucket:string){
 const email=contactEmail(emailValue);
 if(!accessReady()||!/^[A-Za-z0-9_-]{43}$/.test(browser))throw new BetaHttpError('Admin sign-in is being prepared.',503);
 // Unknown addresses must not consume the limited capacity for issuing admin mail.
 if(!isAdminEmail(email))return null;
 return tenant(randomUUID(),async c=>{
  await limit(c,'admin-ip',bucket,5);await limit(c,'admin-total','all',10);
  const raw=randomBytes(32).toString('base64url');
  await c.query('SELECT schoolvault.create_admin_login($1,$2,$3)',[digest(raw),email,digest(browser)]);
  return {token:raw,email};
 });
}
export async function consumeAdminLogin(raw:unknown,browser:string|undefined){
 if(!accessReady()||typeof raw!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(raw)||!browser||!/^[A-Za-z0-9_-]{43}$/.test(browser))throw new BetaHttpError('This sign-in link expired. Request a new link in this browser.',401);
 return tenant(randomUUID(),async c=>{
  // Consumes the link and issues the session atomically; a non-admin email rolls both back.
  const session=randomBytes(32).toString('base64url');
  const email=(await c.query('SELECT schoolvault.consume_admin_login($1,$2,$3) AS email',[digest(raw),digest(browser),digest(session)])).rows[0].email;
  if(!email||!isAdminEmail(email))throw new BetaHttpError('This sign-in link expired. Request a new link in this browser.',401);
  return session;
 });
}

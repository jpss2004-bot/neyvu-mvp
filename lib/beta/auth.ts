import {createHash,randomBytes,randomUUID,timingSafeEqual,createCipheriv,createDecipheriv} from 'node:crypto';
import {createRemoteJWKSet,jwtVerify,type JWTVerifyGetKey} from 'jose';
import {cookies} from 'next/headers';
import {tenant,betaPool} from './db';
import {betaEnabled,betaOrigin,betaCookie,demoAllowed} from './config';
import {studentAdmissionState,isAdminEmail} from './admissions';
import {SignInFailure} from './signin-recovery';
const googleKeys=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
export const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const token=()=>randomBytes(32).toString('base64url');
function loginKey(){
 const secret=process.env.SCHOOL_GOOGLE_CLIENT_SECRET,client=process.env.SCHOOL_GOOGLE_CLIENT_ID;
 if(!secret||!client)throw Error('Google sign-in is not configured');
 return createHash('sha256').update('SchoolVault OAuth browser state v1\0'+client+'\0'+secret).digest();
}
function sealLogin(value:object){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',loginKey(),iv);const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return 'v1.'+Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');}
function openLogin(raw:string,state:string){
 try{
 if(raw.length>1000||!/^v1\.[A-Za-z0-9_-]+$/.test(raw))throw Error('Sign-in expired. Start again.');
 const bytes=Buffer.from(raw.slice(3),'base64url');if(bytes.length<29)throw Error('Sign-in expired. Start again.');
 const cipher=createDecipheriv('aes-256-gcm',loginKey(),bytes.subarray(0,12));cipher.setAuthTag(bytes.subarray(12,28));
 const value=JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString('utf8'));
 if(typeof value.state!=='string'||!constantEqual(value.state,state)||!Number.isSafeInteger(value.expires)||value.expires<Date.now()||value.expires>Date.now()+600000||!/^[-\w]{43}$/.test(value.nonce)||!/^[-\w]{43}$/.test(value.verifier))throw Error('Sign-in expired. Start again.');
 return value as {state:string;nonce:string;verifier:string;expires:number};
 }catch{throw new SignInFailure('expired','Sign-in expired. Start again.');}
}
export function constantEqual(a:string,b:string){return Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));}
export async function verifyGoogleIdToken(raw:string,nonce:string,clientId:string,keys:JWTVerifyGetKey=googleKeys){
 const {payload:p}=await jwtVerify(raw,keys,{issuer:['https://accounts.google.com','accounts.google.com'],audience:clientId,algorithms:['RS256'],clockTolerance:30});
 if(p.nonce!==nonce||typeof p.sub!=='string'||!p.sub||p.sub.length>255||typeof p.email!=='string'||p.email_verified!==true||typeof p.exp!=='number'||typeof p.iat!=='number'||p.iat>Date.now()/1000+30||p.azp&&p.azp!==clientId||Array.isArray(p.aud)&&p.aud.length>1&&p.azp!==clientId)throw Error('Google identity could not be verified');
 return {sub:p.sub,email:p.email.toLowerCase(),name:typeof p.name==='string'?p.name.slice(0,150):''};
}
export async function beginGoogleLogin(){
 if(!betaEnabled())throw Error('SchoolVault beta is not available');
 const clientId=process.env.SCHOOL_GOOGLE_CLIENT_ID;
 if(!clientId||!process.env.SCHOOL_GOOGLE_CLIENT_SECRET)throw Error('Google sign-in is not configured');
 const state=token(),nonce=token(),verifier=token();
 // Anonymous starts consume only a bounded encrypted browser cookie, never shared DB slots.
 const browser=sealLogin({state,nonce,verifier,expires:Date.now()+600000});
 const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
 url.search=new URLSearchParams({client_id:clientId,redirect_uri:betaOrigin()+'/beta/auth/callback',response_type:'code',scope:'openid email profile',state,nonce,code_challenge:digestBase64(verifier),code_challenge_method:'S256',prompt:'select_account'}).toString();
 return {url:url.href,browser};
}
const digestBase64=(s:string)=>createHash('sha256').update(s).digest('base64url');
export async function finishGoogleLogin(code:string,state:string,browser:string){
 if(!betaEnabled()||!code||code.length>4096||!state||state.length>100||!browser||browser.length>1000)throw new SignInFailure('expired','Sign-in expired. Start again.');
 // Only sealed-cookie flows are accepted; the database-backed flow ended with the cutover.
 if(!browser.startsWith('v1.'))throw new SignInFailure('expired','Sign-in expired. Start again.');
 const attempt=openLogin(browser,state);
 if(!attempt)throw new SignInFailure('expired','Sign-in expired. Start again.');
 const clientId=process.env.SCHOOL_GOOGLE_CLIENT_ID!,secret=process.env.SCHOOL_GOOGLE_CLIENT_SECRET!;
 const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,client_secret:secret,code,code_verifier:attempt.verifier,redirect_uri:betaOrigin()+'/beta/auth/callback',grant_type:'authorization_code'}),signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('Google sign-in could not finish. Start again.');
 const result=await response.json();
 if(typeof result.id_token!=='string')throw Error('Google identity is unavailable');
 const identity=await verifyGoogleIdToken(result.id_token,attempt.nonce,clientId);
 // Identity-only beta: provider access tokens are not retained or used for mail.
 return establishGoogleSession(identity,{state,nonce:attempt.nonce});
}
// Called only after ID-token verification by the OAuth callback. Kept separate for
// restricted-database acceptance tests; there is no HTTP route accepting an identity.
export async function establishGoogleSession(identity:Awaited<ReturnType<typeof verifyGoogleIdToken>>,consumed?:{state:string;nonce:string}){
 if(!betaEnabled())throw Error('SchoolVault beta is not available');
 const session=token(),newId=randomUUID();
 await tenant(newId,async c=>{
  // Access requests never create a vault. Approval is followed by verified Google identity.
  const requireAdmission=async()=>{const state=await studentAdmissionState(c,identity.email);if(state!=='approved')throw new SignInFailure(state,'This Google account has not been approved for the beta');};
  await requireAdmission();
  await c.query("SELECT pg_advisory_xact_lock(hashtext('schoolvault-email:'||$1))",[identity.email]);
  // Suspension may have committed while this sign-in waited for the identity lock.
  await requireAdmission();
  // Do not silently create a second vault if an email changes Google subject.
  // Identity columns are readable only through these definer functions (migration 021).
  if((await c.query('SELECT schoolvault.google_email_conflict($1,$2) AS conflict',[identity.email,identity.sub])).rows[0].conflict)throw new SignInFailure('review','Account identity needs review');
  const row=(await c.query('SELECT account_id AS id,account_disabled_at AS disabled_at,account_demo AS demo FROM schoolvault.upsert_google_user($1,$2,$3,$4)',[newId,identity.sub,identity.email,identity.name])).rows[0];
  // Google sign-in can never open a synthetic demo tenant.
  if(row.disabled_at||row.demo)throw new SignInFailure('review','This SchoolVault account is disabled');
  if(consumed){
   // Consume state only after a verified invited identity. Anonymous callbacks allocate no rows.
   await c.query('SELECT id FROM schoolvault.users WHERE id=$1 FOR UPDATE',[row.id]);
   await c.query('DELETE FROM schoolvault.login_attempts WHERE expires_at<now()');
   if(Number((await c.query('SELECT count(*) FROM schoolvault.login_attempts WHERE browser_hash=$1',[digest(identity.sub)])).rows[0].count)>=100)throw new SignInFailure('rate','Too many sign-ins for this account. Try again shortly.');
   const used=await c.query("INSERT INTO schoolvault.login_attempts VALUES($1,$2,$3,$4,now()+interval '10 minutes') ON CONFLICT(state_hash) DO NOTHING RETURNING state_hash",[digest(consumed.state),digest(identity.sub),consumed.nonce,'used']);
   if(!used.rowCount)throw new SignInFailure('expired','Sign-in expired. Start again.');
  }
  await c.query("SELECT set_config('schoolvault.user_id',$1,true)",[row.id]);
  await c.query('INSERT INTO schoolvault.vaults(user_id) VALUES($1) ON CONFLICT DO NOTHING',[row.id]);
  await c.query("INSERT INTO schoolvault.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '30 days')",[digest(session),row.id]);
 });
 return session;
}
export async function actorFromToken(raw:string|undefined){
 if(!betaEnabled()||!raw||raw.length>100)return null;
 // A demo session only ever maps to a demo account, and the reverse.
 const actor=(await betaPool().query('SELECT id,name,email,timezone,demo FROM schoolvault.session_actor($1)',[digest(raw)])).rows[0]||null;
 return actor&&demoAllowed(actor.demo)&&!isAdminEmail(actor.email)?actor:null;
}
export async function betaActor(){return actorFromToken((await cookies()).get(betaCookie)?.value);}
export async function revokeSession(raw:string|undefined){if(raw)await betaPool().query('SELECT schoolvault.revoke_session($1)',[digest(raw)]);}

export function betaOrigin(){
 const value=process.env.SCHOOL_BETA_ORIGIN;
 if(!value)throw Error('SchoolVault origin is not configured');
 const u=new URL(value);
 const local=process.env.SCHOOL_BETA_LOCAL==='1'&&['localhost','127.0.0.1'].includes(u.hostname)&&['3228','3340','3342','3346','3357'].includes(u.port);
 if((u.protocol!=='https:'&&!local)||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('Invalid SchoolVault origin');
 return u.origin;
}
export function betaEnabled(){return process.env.SCHOOL_BETA_ENABLED==='1';}
// Chat availability does not commission experimental source interpretation.
export function sourceReadingEnabled(){return process.env.SCHOOL_BETA_AI_ENABLED==='1'&&process.env.SCHOOL_BETA_SOURCE_READING==='1';}
export function betaSameOrigin(request:Request){try{return request.headers.get('origin')===betaOrigin();}catch{return false;}}
export function allowedEmail(email:string){return (process.env.SCHOOL_BETA_INVITED_EMAILS||'').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());}
export const betaCookie='schoolvault-session';
export const loginCookie='schoolvault-login';
export function betaSecure(){return betaOrigin().startsWith('https://');}
// Reviewer demo access fails closed: unset, empty, short or malformed codes disable it.
export function demoCode(){const value=(process.env.SCHOOL_BETA_DEMO_CODE||'').trim();return /^[\x21-\x7e]{16,128}$/.test(value)?value:null;}
export function demoAvailable(){return betaEnabled()&&demoCode()!==null;}
// Demo identities stop authenticating as soon as demo access is switched off.
export function demoAllowed(demo:unknown){return demo!==true||demoAvailable();}
// Local personal testing is an explicit, isolated profile; it cannot target the cloud database.
export function localAccountAvailable(){
 try{
  const db=new URL(process.env.SCHOOL_BETA_DATABASE_URL||'');
  return betaEnabled()&&process.env.SCHOOL_BETA_LOCAL==='1'&&process.env.SCHOOL_LOCAL_ACCOUNT==='1'
   &&betaOrigin()==='http://localhost:3228'&&['postgres:','postgresql:'].includes(db.protocol)&&['127.0.0.1','localhost'].includes(db.hostname)
   &&db.port==='55433'&&db.pathname==='/schoolvault_local'&&db.username==='schoolvault_local_runtime'
   &&!db.hash&&[...db.searchParams.keys()].every(key=>['sslmode','application_name'].includes(key))
   &&(!db.searchParams.has('sslmode')||['disable','prefer','require'].includes(db.searchParams.get('sslmode')!))
   &&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(process.env.SCHOOL_LOCAL_USER_ID||'');
 }catch{return false;}
}

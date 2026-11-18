// Public preparation only: this module never creates a login or session.
import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
export const recoveryRequestFormat='neyvu-admin-browser-request/1';
export const recoveryRequestTTL=600_000;
export type AdminRecoveryRequest={format:typeof recoveryRequestFormat;id:string;origin:string;browserHash:string;createdAt:number;expiresAt:number};
const sha=(text:string)=>createHash('sha256').update(text).digest('hex');
function settings(key:string,origin:string){
 if(!/^[A-Za-z0-9_-]{43,128}$/.test(key))throw Error('Recovery is unavailable');
 const u=new URL(origin);if(u.origin!==origin||u.username||u.password||u.search||u.hash||u.protocol!=='https:'&&!(u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname)))throw Error('Invalid recovery origin');
}
const mac=(body:string,key:string)=>createHmac('sha256',key).update(recoveryRequestFormat+'\0'+body).digest();
export function prepareAdminRecoveryRequest(browser:string,key:string,origin:string,now=Date.now()){
 settings(key,origin);if(!/^[A-Za-z0-9_-]{43}$/.test(browser)||!Number.isSafeInteger(now)||now<0)throw Error('Invalid recovery preparation');
 const value:AdminRecoveryRequest={format:recoveryRequestFormat,id:randomUUID(),origin,browserHash:sha(browser),createdAt:now,expiresAt:now+recoveryRequestTTL};
 const body=Buffer.from(JSON.stringify(value)).toString('base64url');return {request:body+'.'+mac(body,key).toString('base64url'),expires_at:new Date(value.expiresAt).toISOString()};
}
export function verifyAdminRecoveryRequest(raw:unknown,key:string,origin:string,now=Date.now(),allowExpired=false):AdminRecoveryRequest{
 settings(key,origin);
 if(typeof raw!=='string'||raw.length>1200||!Number.isSafeInteger(now))throw Error('Invalid recovery request');
 const parts=raw.split('.');if(parts.length!==2||!parts.every(p=>/^[A-Za-z0-9_-]+$/.test(p)))throw Error('Invalid recovery request');
 const signature=Buffer.from(parts[1],'base64url');if(signature.length!==32||signature.toString('base64url')!==parts[1]||!timingSafeEqual(signature,mac(parts[0],key)))throw Error('Invalid recovery request');
 const bytes=Buffer.from(parts[0],'base64url');if(bytes.toString('base64url')!==parts[0])throw Error('Invalid recovery request');
 const value=JSON.parse(bytes.toString('utf8'));
 if(!value||Object.keys(value).sort().join()!=='browserHash,createdAt,expiresAt,format,id,origin'||value.format!==recoveryRequestFormat||value.origin!==origin||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.id)||!/^[0-9a-f]{64}$/.test(value.browserHash)||!Number.isSafeInteger(value.createdAt)||!Number.isSafeInteger(value.expiresAt)||value.createdAt<0||value.expiresAt-value.createdAt!==recoveryRequestTTL||value.createdAt>now+30_000||!allowExpired&&value.expiresAt<=now)throw Error('Expired or invalid recovery request');
 return value;
}

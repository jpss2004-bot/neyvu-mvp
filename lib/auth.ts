import { createHash, randomBytes, randomInt } from 'node:crypto';
import { cookies } from 'next/headers';
import { db, ACCOUNT } from './store';
import {isPersonalVaultAccount} from './private-vault';
export const cookieName='school-pilot-session';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export function privateHost(host:string|null) {
  return !!host && (/^(127\.0\.0\.1|localhost):3213$/.test(host) || privateOrigins().some(url=>new URL(url).host===host));
}
export async function accountFor(host:string|null) {
  if(process.env.VERCEL||!privateHost(host))return null;
  if(process.env.NODE_ENV!=='development'&&process.env.SCHOOL_PILOT_LOCAL!=='1')return null;
  if(/^(127\.0\.0\.1|localhost):3213$/.test(host!))return ACCOUNT;
  const token=(await cookies()).get(cookieName)?.value;
  if(!token)return null;
  const row=db().prepare('SELECT account FROM sessions WHERE token_hash=? AND expires>?').get(hash(token),Date.now()) as {account:string}|undefined;
  return isPersonalVaultAccount(row?.account)?row!.account:null;
}
export function privateOrigins(){return (process.env.SCHOOL_PILOT_ORIGINS||'').split(',').filter(Boolean);}
export function primaryPrivateUrl(){return privateOrigins()[0]||null;}
export function sameOrigin(request:Request) {
  const origin=request.headers.get('origin');
  if(!origin)return false;
  try {return new URL(origin).host===request.headers.get('host') && (origin==='http://127.0.0.1:3213'||origin==='http://localhost:3213'||privateOrigins().includes(origin));}catch{return false;}
}
export function pairCode() {
  const code=String(randomInt(100000,1000000));
  db().prepare('DELETE FROM pairs WHERE expires<?').run(Date.now());
  db().prepare('INSERT INTO pairs VALUES(?,?,?)').run(hash(code),ACCOUNT,Date.now()+300000);
  return code;
}
const attempts=new Map<string,{count:number;until:number}>();
export function exchangeCode(code:string,key:string){
  const now=Date.now(),limit=attempts.get(key);
  if(limit&&limit.until>now&&limit.count>=5)throw new Error('Too many attempts. Wait five minutes.');
  attempts.set(key,{count:limit&&limit.until>now?limit.count+1:1,until:now+300000});
  const row=db().prepare('DELETE FROM pairs WHERE code_hash=? AND expires>? RETURNING account').get(hash(code),now) as {account:string}|undefined;
  if(!row)return null;
  attempts.delete(key);
  const token=randomBytes(32).toString('hex');
  db().prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(token),row.account,now+30*24*3600000);
  return token;
}

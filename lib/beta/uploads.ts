import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {betaPool,uuid} from './db';
import {BetaHttpError,readBoundedBody} from './http';
import {bodyOperation} from './body-budget';

const globalSlots=2;
const shared=globalThis as typeof globalThis&{__neyvuUploadAdmission?:{active:number;users:Set<string>}};
const memory=shared.__neyvuUploadAdmission??={active:0,users:new Set()};
const key=(name:string)=>createHash('sha256').update('schoolvault-upload/1:'+name).digest().readBigInt64BE().toString();
const busy=()=>new BetaHttpError('Uploads are busy. Wait for the current upload to finish, then try again.',429);

// Both browser/Companion originals and audio use this operation-scoped lease.
// Local slots bound memory even after a database connection fails. Session locks
// additionally cap uploads across backend processes sharing the School database.
export async function withUpload<T>(request:Request,user:string,max:number,consume:(bytes:Buffer)=>Promise<T>){
 return bodyOperation(async()=>{
 if(!uuid(user))throw Error('Invalid upload account');
 if(memory.active>=globalSlots||memory.users.has(user)){void request.body?.cancel().catch(()=>{});throw busy();}
 memory.active++;memory.users.add(user);
 let client:PoolClient|undefined;
 const held:string[]=[],controller=new AbortController();let lost=false;
 const unavailable=()=>{lost=true;controller.abort(new BetaHttpError('The upload connection was interrupted. Try again.',503));};
 try{
  client=await betaPool().connect();client.on('error',unavailable);
  const take=async(value:string)=>{const ok=(await client!.query('SELECT pg_try_advisory_lock($1::bigint) AS ok',[value])).rows[0].ok;if(ok)held.push(value);return ok;};
  if(!await take(key('account:'+user)))throw busy();
  let admitted=false;for(let slot=0;slot<globalSlots;slot++)if(await take(key('global:'+slot))){admitted=true;break;}
  if(!admitted)throw busy();
  const signal=AbortSignal.any([request.signal,controller.signal]);
  const bytes=await readBoundedBody(request,max,{signal});
  if(signal.aborted)throw signal.reason instanceof BetaHttpError?signal.reason:new BetaHttpError('The upload was interrupted. Try again.');
  // Capacity remains held while persistence, its rollback and cleanup retain bytes.
  return await consume(bytes);
 }catch(error){if(!request.bodyUsed)void request.body?.cancel().catch(()=>{});throw error;}
 finally{
  if(client){
   try{if(!lost)for(const value of held.reverse())await client.query('SELECT pg_advisory_unlock($1::bigint)',[value]);}
   catch{lost=true;}
   finally{client.removeListener('error',unavailable);client.release(lost);}
  }
  memory.active--;memory.users.delete(user);
 }
 });
}

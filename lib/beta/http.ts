import {isIP} from 'node:net';
import {gatewayPeer} from './gateway';
import {betaSameOrigin,betaEnabled} from './config';
import {bodyOperation,reserveBody} from './body-budget';
// Render appends the connecting peer to X-Forwarded-For; earlier entries are client-supplied.
export function peerAddress(request:Request){const gateway=gatewayPeer(request);if(gateway!==null)return gateway;const peer=(request.headers.get('x-forwarded-for')||'').split(',').at(-1)?.trim()||'';return isIP(peer)?peer:'unknown-peer';}
import {BetaConflict} from './vault';
export function betaJson(data:unknown,status=200){return Response.json(data,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie'}});}
export class BetaHttpError extends Error{constructor(message:string,public status=400){super(message);}}
export async function limitedBody(request:Request,max=100000){
 return readBoundedBody(request,max);
}
export async function readBoundedBody(request:Request,max:number,{signal=request.signal,deadlineMs=20000}:{signal?:AbortSignal;deadlineMs?:number}={}){
 return bodyOperation(async()=>{
 if(!Number.isSafeInteger(max)||max<1||max>10*1024*1024)throw Error('Invalid body limit');
 const declared=request.headers.get('content-length');
 if(declared!==null&&(!/^\d+$/.test(declared)||!Number.isSafeInteger(Number(declared))))throw new BetaHttpError('Invalid content length.');
 if(declared!==null&&Number(declared)>max){void request.body?.cancel().catch(()=>{});throw new BetaHttpError('This file is too large.',413);}
 try{reserveBody(max);}catch(error){void request.body?.cancel().catch(()=>{});throw error;}
 const reader=request.body?.getReader();if(!reader)throw new BetaHttpError('Missing request body');
 const controller=new AbortController();
 const stop=()=>controller.abort(signal.reason);
 signal.addEventListener('abort',stop,{once:true});if(signal.aborted)stop();
 const timer=setTimeout(()=>controller.abort(new BetaHttpError('The upload took too long. Try again.',408)),deadlineMs);
 let rejectAbort:(reason:unknown)=>void=()=>{};
 const aborted=new Promise<never>((_,reject)=>{rejectAbort=reject;});
 const interrupted=()=>rejectAbort(controller.signal.reason instanceof BetaHttpError?controller.signal.reason:new BetaHttpError('The upload was interrupted. Try again.'));
 controller.signal.addEventListener('abort',interrupted,{once:true});
 try{
  if(controller.signal.aborted)throw controller.signal.reason instanceof BetaHttpError?controller.signal.reason:new BetaHttpError('The upload was interrupted. Try again.');
  // One allocation, not accumulated chunks plus a second concatenated copy.
  const buffer=Buffer.alloc(max);let size=0;
  while(true){const {done,value}=await Promise.race([reader.read(),aborted]);if(done)break;
   if(value.byteLength>max-size)throw new BetaHttpError('This file is too large.',413);
   buffer.set(value,size);size+=value.byteLength;
  }
  return buffer.subarray(0,size);
 }catch(error){void reader.cancel().catch(()=>{});throw error;}
 finally{clearTimeout(timer);signal.removeEventListener('abort',stop);controller.signal.removeEventListener('abort',interrupted);try{reader.releaseLock();}catch{}}
 });
}
export async function betaRequestJson(request:Request,max=100000){
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new BetaHttpError('Use a JSON request',415);
 const buffer=await limitedBody(request,max);try{const body=JSON.parse(buffer.toString('utf8'));if(!body||Array.isArray(body)||typeof body!=='object')throw Error();return body;}catch{throw new BetaHttpError('Invalid request');}
}
export function betaWriteAllowed(request:Request){if(!betaEnabled())throw new BetaHttpError('The beta is not available yet.',503);if(!betaSameOrigin(request))throw new BetaHttpError('Please open SchoolVault and try again.',403);}
export function betaError(error:unknown){
 if(error instanceof BetaHttpError)return betaJson({error:error.message},error.status);
 if(error instanceof BetaConflict)return betaJson({error:error.message},409);
 const message=error instanceof Error?error.message:'';
 if(/not found$/.test(message))return betaJson({error:'Item not found in your vault.'},404);
 if(/^(Invalid |Enter |Choose |Unknown mode)/.test(message))return betaJson({error:message},400);
 // Don't expose SQL, physical paths, credentials or internal exceptions.
 return betaJson({error:'SchoolVault could not finish this. Your saved work is still available. Try again.'},503);
}

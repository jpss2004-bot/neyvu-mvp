import http from 'node:http';
import {Readable,Transform} from 'node:stream';
import {backendOrigin} from './transport-config';
// Local qualification transport only; Vercel forwards the untouched body with
// skipMiddlewareRequestBody. Node's HTTP streams preserve early 401/429 replies
// even when the client has not finished sending a declared-length body.
async function forward(request:Request){
 if(process.env.NEYVU_LOCAL_SPLIT!=='1'||process.env.VERCEL==='1')return Response.json({error:'Local transport is unavailable.'},{status:503});
 const key=process.env.NEYVU_GATEWAY_KEY;
 if(!key||!/^[A-Za-z0-9_-]{43,128}$/.test(key))return Response.json({error:'The workspace connection is not configured.'},{status:503});
 const target=new URL(backendOrigin());if(target.origin!=='http://127.0.0.1:3340')return Response.json({error:'Local transport requires the loopback fixture.'},{status:503});
 const path=new URL(request.url);target.pathname=path.pathname;target.search=path.search;
 const headers=new Headers(request.headers);for(const name of ['host','connection','transfer-encoding','keep-alive','upgrade','proxy-authorization','proxy-authenticate'])headers.delete(name);
 headers.set('x-neyvu-gateway',key);headers.set('x-neyvu-client-ip','127.0.0.1');
 const declared=headers.get('content-length'),max=10*1024*1024;
 if(declared!==null&&(!/^\d+$/.test(declared)||!Number.isSafeInteger(Number(declared))||Number(declared)>max))return Response.json({error:'This file is too large.'},{status:413});
 return new Promise<Response>(resolve=>{
  let replied=false,inputDone=!request.body||['GET','HEAD'].includes(request.method),responseDone=false,size=0;
  const input=inputDone?null:Readable.fromWeb(request.body as any);
  const meter=new Transform({transform(chunk,_encoding,done){size+=chunk.length;done(size>max?Error('Body limit exceeded'):null,chunk);}});
  const stopInput=()=>{input?.unpipe(meter);meter.unpipe(upstream);input?.pause();};
  const cleanup=()=>{clearTimeout(timer);request.signal.removeEventListener('abort',abort);};
  const abort=()=>{stopInput();input?.destroy();meter.destroy();upstream.destroy();cleanup();};
  const fail=(status:number)=>{stopInput();upstream.destroy();if(!replied){replied=true;responseDone=true;resolve(Response.json({error:status===413?'This file is too large.':'The workspace connection was interrupted. Your saved material is kept.'},{status,headers:{'Cache-Control':'private, no-store'}}));if(inputDone)cleanup();}};
  const upstream=http.request(target,{method:request.method,headers:Object.fromEntries(headers)},response=>{
   replied=true;stopInput();const returned=new Headers();
   for(let i=0;i<response.rawHeaders.length;i+=2)if(!['connection','transfer-encoding','keep-alive','upgrade'].includes(response.rawHeaders[i].toLowerCase()))returned.append(response.rawHeaders[i],response.rawHeaders[i+1]);
   response.once('end',()=>{responseDone=true;upstream.destroy();if(inputDone)cleanup();});
   const empty=request.method==='HEAD'||[204,205,304].includes(response.statusCode!);
   if(empty)response.resume();
   resolve(new Response(empty?null:Readable.toWeb(response) as ReadableStream<Uint8Array>,{status:response.statusCode,headers:returned}));
  });
  const timer=setTimeout(()=>{fail(503);abort();},30000);timer.unref();
  request.signal.addEventListener('abort',abort,{once:true});if(request.signal.aborted){fail(503);abort();return;}
  upstream.on('error',()=>{if(!replied)fail(503);});
  meter.on('error',()=>fail(413));input?.on('error',()=>{if(!replied)fail(503);});
  input?.once('close',()=>{inputDone=true;if(responseDone)cleanup();});
  if(input){input.once('end',()=>{inputDone=true;if(responseDone)cleanup();});input.pipe(meter).pipe(upstream);}else upstream.end();
 });
}
export const runtime='nodejs';
export const GET=forward;
export const POST=forward;
export const PUT=forward;
export const PATCH=forward;
export const DELETE=forward;
export const HEAD=forward;
export const OPTIONS=forward;

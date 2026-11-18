import {withUpload} from '../../../../../lib/beta/uploads';
import {betaRoute} from '../../../../../lib/beta/api-route';
import {betaActor} from '../../../../../lib/beta/auth';
import {betaJson,betaError,betaWriteAllowed,BetaHttpError} from '../../../../../lib/beta/http';
import {appendClassAudio,classAudioMetadata,classAudioBytes,classCaptureEnabled,classAccountMatches} from '../../../../../lib/beta/class-recordings';
import {recordingRange,recordingLimits} from '../../../../../lib/beta/class-recording-format';
export const runtime='nodejs';
async function handlePOST(request:Request){try{
 classCaptureEnabled();betaWriteAllowed(request);const actor=await betaActor();if(!actor)throw new BetaHttpError('Please sign in.',401);classAccountMatches(request,actor.id,request.method==='POST');
 const p=new URL(request.url).searchParams,seq=p.get('sequence');if(seq===null||!/^\d{1,4}$/.test(seq))throw new BetaHttpError('Invalid audio sequence.');
 return await withUpload(request,actor.id,recordingLimits.chunkBytes,async bytes=>betaJson(await appendClassAudio(actor.id,p.get('id')||'',Number(seq),request.headers.get('x-audio-sha256'),bytes),201));
}catch(error){return betaError(error);}}
async function audio(request:Request,head:boolean){try{
 classCaptureEnabled();const actor=await betaActor();if(!actor)throw new BetaHttpError('Please sign in.',401);classAccountMatches(request,actor.id,request.method==='POST');
 const p=new URL(request.url).searchParams,metadata=await classAudioMetadata(actor.id,p.get('id')||''),size=Number(metadata.record.total_bytes);
 let range;try{range=recordingRange(request.headers.get('range'),size);}catch(error){if(error instanceof BetaHttpError&&error.status===416)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`,'Cache-Control':'private, no-store','Vary':'Cookie'}});throw error;}
 const extensions:Record<string,string>={'audio/webm':'webm','audio/mp4':'m4a','audio/ogg':'ogg','audio/wav':'wav','audio/mpeg':'mp3'};
 const headers:Record<string,string>={'Content-Type':metadata.record.mime,'Content-Length':String(range.end-range.start+1),'Accept-Ranges':'bytes','Content-Disposition':`${p.get('download')==='1'?'attachment':'inline'}; filename*=UTF-8''${encodeURIComponent(metadata.record.title)}.${extensions[metadata.record.mime]||'audio'}`,'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"};
 if(range.partial)headers['Content-Range']=`bytes ${range.start}-${range.end}/${size}`;
 const iterator=classAudioBytes(actor.id,metadata,range.start,range.end);
 const stream=head?null:new ReadableStream<Uint8Array>({async pull(controller){try{const next=await iterator.next();if(next.done)controller.close();else if(next.value instanceof Uint8Array)controller.enqueue(next.value);}catch{controller.error(new Error('The stored audio failed its integrity check.'));}},async cancel(){await iterator.return(undefined);}});
 return new Response(stream,{status:range.partial?206:200,headers});
}catch(error){return betaError(error);}}
async function handleGET(request:Request){return audio(request,false);}
async function handleHEAD(request:Request){return audio(request,true);}

export const POST=betaRoute(handlePOST);
export const GET=betaRoute(handleGET);
export const HEAD=betaRoute(handleHEAD);

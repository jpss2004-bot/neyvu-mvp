// Future collector transport; caller retains the original, exact packet and
// durable local session state and unchanged capture metadata. No native reader or package activation here.
import {ORIGIN} from './handoff.mjs';
import {contentManifestDigest} from './content-packet.mjs';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
function contentCalls({token,origin=ORIGIN,fetcher=fetch,signal,allowLocal=false,assertCurrent=()=>{}}){
 if(!['https://neyvu-app.example.com','https://neyvu-web.example.com'].includes(origin)&&!(allowLocal&&/^http:\/\/(?:localhost|127\.0\.0\.1):(?:3340|3342|3382)$/.test(origin)))throw Error('Use the configured Neyvu service.');
 if(! /^[A-Za-z0-9_-]{43}$/.test(token||''))throw Error('A current Companion connection is required.');
 return async(op,body)=>{
  assertCurrent();
  const controller=new AbortController(),abort=()=>controller.abort(signal?.reason);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();const timer=setTimeout(()=>controller.abort(),30000);
  try{
   const r=await fetcher(origin+'/api/beta/companion?op=content.'+op,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:controller.signal});
   const reader=r.body?.getReader();if(!reader)throw Error('Neyvu returned no transfer receipt.');let text='',bytes=0;const decoder=new TextDecoder('utf-8',{fatal:true});
   for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>64000){void reader.cancel().catch(()=>{});throw Error('Neyvu transfer receipt exceeded its limit.');}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();
   const value=JSON.parse(text);if(!r.ok){const error=Error(value.error||'Neyvu could not finish the content transfer.');error.status=r.status;throw error;}assertCurrent();return value;
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 };
}
export const negotiatePdfContent=options=>contentCalls(options)('negotiate',{});
export async function uploadPdfContent({packet,metadata,token,origin=ORIGIN,fetcher=fetch,loadSession,saveSession,onProgress=()=>{},signal=undefined,allowLocal=false,assertCurrent=()=>{}}){
 if(!['https://neyvu-app.example.com','https://neyvu-web.example.com'].includes(origin)&&!(allowLocal&&/^http:\/\/(?:localhost|127\.0\.0\.1):(?:3340|3342|3382)$/.test(origin)))throw Error('Use the configured Neyvu service.');
 if(typeof loadSession!=='function'||typeof saveSession!=='function'||! /^[A-Za-z0-9_-]{43}$/.test(token||'')||!packet?.manifest||!Array.isArray(packet.batches))throw Error('Retained content and durable transfer state are required.');
 const digest=contentManifestDigest(packet.manifest),metadataHash=contentManifestDigest(metadata);
 const call=contentCalls({token,origin,fetcher,signal,allowLocal,assertCurrent});
 const negotiation=await call('negotiate',{});
 let local=await loadSession();
 if(local&&(local.request_id!==packet.manifest.request_id||local.manifest_sha256!==digest||local.metadata_sha256!==metadataHash))throw Error('The saved transfer belongs to different content. Keep both originals.');
 const verifyReceipt=state=>{
  const receipt=state.receipt;
  if(state.state!=='committed'||!receipt?.source_binding_checked||!uuid(receipt.source_id)||!uuid(receipt.version_id)||receipt.manifest_sha256!==digest||receipt.text_sha256!==packet.manifest.text.sha256||receipt.original_sha256!==packet.manifest.original.sha256||receipt.original_cleanup_allowed!==false)throw Error('The committed source did not pass exact receipt read-back. Keep the original.');
  return receipt;
 };
 if(negotiation.enabled!==true||negotiation.format!=='neyvu-device-pdf/1'){
  if(local?.session_id){const state=await call('inspect',{session_id:local.session_id,manifest_sha256:digest});if(state.state==='committed'){const receipt=verifyReceipt(state);await saveSession({...local,receipt});return {supported:false,receipt,original_cleanup_allowed:false};}}
  return {supported:false,original_cleanup_allowed:false};
 }
 if(negotiation.limits?.batch_bytes!==32768||negotiation.offset_unit!=='utf8_bytes')throw Error('This Companion needs the current content protocol. Keep the original.');
 if(packet.manifest.pages?.some(p=>p.geometry!==undefined)&&(negotiation.line_geometry?.format!=='neyvu-pdf-lines/1'||negotiation.line_geometry?.reviewed!==false||negotiation.line_geometry?.max_lines!==20000))throw Error('This PDF includes retained line positions that this server cannot accept. Keep the original and exact transfer; retry with compatible reading support.');
 if(!local){local={request_id:packet.manifest.request_id,manifest_sha256:digest,metadata_sha256:metadataHash,session_id:null};await saveSession(local);}
 let state=local.session_id?await call('inspect',{session_id:local.session_id,manifest_sha256:digest}):await call('begin',{metadata,manifest:packet.manifest});
 if(!uuid(state.session_id)||state.manifest_sha256!==digest)throw Error('Neyvu did not confirm this exact content session.');
 if(!local.session_id){local={...local,session_id:state.session_id};await saveSession(local);}
 const binding={session_id:local.session_id,manifest_sha256:digest};
 if(!['receiving','committed'].includes(state.state))throw Error(state.message||'The previous transfer ended. Keep the original and start a new reviewed request.');
 if(state.state==='receiving'){
  const received=new Set();for(const r of state.received||[]){const b=packet.batches.find(b=>b.index===r.index);if(!b||b.sha256!==r.sha256||Buffer.byteLength(b.text)!==r.bytes)throw Error('Saved batch receipt differs from the retained content.');received.add(r.index);}
  for(const batch of packet.batches){if(signal?.aborted)throw Error('Transfer interrupted; original and saved session are preserved.');if(received.has(batch.index))continue;state=await call('batch',{...binding,batch});if(state.state!=='receiving'||!state.received?.some(r=>r.index===batch.index&&r.sha256===batch.sha256&&r.bytes===Buffer.byteLength(batch.text)))throw Error('Neyvu did not acknowledge the complete batch.');onProgress({received:state.received.length,total:packet.batches.length});}
  await call('commit',binding);
 }
 // Fresh DB read-back reconciles a lost commit response on the next invocation.
 // No timeout causes automatic re-issuance or deletion of the retained original.
 state=await call('inspect',binding);const receipt=verifyReceipt(state);
 await saveSession({...local,receipt});return {supported:true,receipt,original_cleanup_allowed:false};
}

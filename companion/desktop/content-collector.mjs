// Native reader orchestration for the next Companion. Activation requires a
// real readPdf adapter; the currently distributed app does not instantiate it.
import {createHash} from 'node:crypto';
import {ORIGIN} from './handoff.mjs';
import {negotiatePdfContent,uploadPdfContent} from './content-upload.mjs';
export function createPdfContentCollector({journal,readPdf,origin=ORIGIN,fetcher=fetch}){
 if(!journal||typeof readPdf!=='function')throw Error('A retained-original journal and native PDF reader are required.');
 return async({file,metadata,token,reviewRevision,assertCurrent=()=>{},signal=undefined,onProgress=()=>{},courseTitle=undefined})=>{
  if(file.mime!=='application/pdf')return {supported:false};
  const checkpoint=()=>{assertCurrent();if(signal?.aborted)throw Error('PDF transfer interrupted. The original and saved progress are retained.');};
  checkpoint();
  const scope={token,identity:metadata.identity,course:metadata.course,reviewRevision,sourceURL:metadata.source_url,origin};
  const wire={token,origin,fetcher,signal,assertCurrent:checkpoint};
  const negotiated=await negotiatePdfContent(wire);checkpoint();
  let ticket=await journal.find({...scope,originalSHA256:file.sha256});
  if(negotiated.enabled!==true&&!ticket)return {supported:false};
  if(!Buffer.isBuffer(file.body)||createHash('sha256').update(file.body).digest('hex')!==file.sha256)throw Error('The PDF changed before it could be retained. No content was sent.');
  ticket??=await journal.retain({...scope,original:file.body,metadata,...(courseTitle?{courseTitle}:{})});
  const before=await ticket.snapshot();
  if(negotiated.enabled!==true&&!before.session)throw Error('This PDF is retained locally. Device reading is paused; retry when Neyvu enables it.');
  const lineGeometry=negotiated.line_geometry?.format==='neyvu-pdf-lines/1'&&negotiated.line_geometry?.reviewed===false&&negotiated.line_geometry?.max_lines===20000;
  const retained=before.packet?{packet:before.packet,metadata:before.metadata}:await ticket.prepare(async bytes=>{checkpoint();const result=await readPdf(bytes,{signal,lineGeometry});checkpoint();return result;});
  checkpoint();
  const result=await uploadPdfContent({...wire,...retained,loadSession:ticket.loadSession,saveSession:ticket.saveSession,onProgress});
  checkpoint();
  if(!result.receipt)throw Error('This PDF transfer is paused. The original and exact progress are retained; retry the same connection.');
  if(result.receipt.current_at_readback!==true)throw Error('A newer source replaced this saved PDF. The original is retained; review the current source before starting another transfer.');
  return {supported:true,saved:true,receipt:result.receipt,recovery:{key:ticket.key,handle:before.recovery_handle,sha256:file.sha256},original_cleanup_allowed:false};
 };
}

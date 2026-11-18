// Unwired PDF content packet preparation for the next collector. No network,
// file deletion or native extraction is performed here. Caller supplies the
// exact retained original and actual page-reader observations.
import {createHash,randomUUID} from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
export function preparePdfContent({original,extractor,pages,recoveryHandle,requestId=randomUUID()}){
 if(!Buffer.isBuffer(original)||original.length>10*1024*1024||!original.subarray(0,5).equals(Buffer.from('%PDF-'))||!Array.isArray(pages)||!pages.length||pages.length>500)throw Error('Retained original PDF and physical-page observations required.');
 let offset=0;const units=[],texts=[];
 for(const [i,p] of pages.entries()){
  if(!p||typeof p!=='object'||Object.keys(p).some(k=>!['text','state','issues','printed_label','blocks','ocr','geometry'].includes(k)))throw Error('Reader metadata requires a newer PDF content contract; retain original.');
  if(typeof p.text!=='string'||p.text.includes('\0')||new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Buffer.from(p.text))!==p.text)throw Error('Reader page text must be exact UTF-8.');
  if(Buffer.byteLength(p.text)>512000-offset)throw Error('Extracted page exceeds the negotiated text budget; retain original.');
  const text='Page '+(i+1)+'\n'+p.text+'\n\n',size=Buffer.byteLength(text);
  units.push({number:i+1,printed_label:p.printed_label??null,state:p.state,start:offset,end:offset+size,sha256:hash(text),issues:p.issues,blocks:p.blocks,...(p.ocr?{ocr:p.ocr}:{}),...(p.geometry!==undefined?{geometry:structuredClone(p.geometry)}:{})});offset+=size;texts.push(text);
 }
 const text=texts.join('');if(Buffer.byteLength(text)>512000)throw Error('Extracted text exceeds the negotiated PDF limit; retain original and report partial coverage.');
 const manifest={format:'neyvu-device-pdf/1',request_id:requestId,original:{sha256:hash(original),bytes:original.length,mime:'application/pdf'},extractor,recovery:{handle:recoveryHandle,original_sha256:hash(original)},text:{sha256:hash(text),bytes:Buffer.byteLength(text)},page_count:pages.length,pages:units};
 if(Buffer.byteLength(JSON.stringify(manifest))>512000)throw Error('The complete PDF structure exceeds the negotiated metadata limit. Original retained; no line positions were silently dropped.');
 // Split at Unicode scalar boundaries. Structural page/block ranges remain
 // over the complete reassembled UTF-8 text, never batch-local coordinates.
 const batches=[];let value='',bytes=0;
 for(const char of text){const size=Buffer.byteLength(char);if(bytes+size>32768){batches.push({index:batches.length,text:value,sha256:hash(value)});value='';bytes=0;}value+=char;bytes+=size;}
 if(value)batches.push({index:batches.length,text:value,sha256:hash(value)});
 return {manifest,batches};
}

const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
export const contentManifestDigest=manifest=>hash(canonical(manifest));

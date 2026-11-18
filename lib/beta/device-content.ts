// Pure contract validation only. A caller must authenticate the device, bind
// the Moodle course/source and recheck quotas/current version transactionally.
// Nothing here writes a source, fetches a URL, attests authorship or deletes an original.
import {createHash} from 'node:crypto';
import {BetaHttpError} from './http';
import {pdfLineGeometryFormat,validatePdfLineGeometry,validatePdfGeometryText,type PdfLineGeometry} from './pdf-line-geometry';
export const devicePdfFormat='neyvu-device-pdf/1';
export const deviceContentLimits={text_bytes:512000,original_bytes:10*1024*1024,pages:500,blocks:4000,batch_bytes:32768,batches:64,manifest_bytes:512000} as const;
const canonical=(v:any):string=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const digest=(b:string|Buffer)=>createHash('sha256').update(b).digest('hex');
const fail=()=>{throw new BetaHttpError('Device content did not match the negotiated PDF contract.',400);};
const object=(x:any,required:string[],optional:string[]=[])=>{if(!x||typeof x!=='object'||Array.isArray(x)||required.some(k=>!Object.hasOwn(x,k))||Object.keys(x).some(k=>!required.includes(k)&&!optional.includes(k)))fail();};
const integer=(x:any,min:number,max:number)=>{if(!Number.isSafeInteger(x)||x<min||x>max)fail();};
const hex=(x:any)=>{if(typeof x!=='string'||! /^[a-f0-9]{64}$/.test(x))fail();};
const label=(x:any,max=120)=>{if(typeof x!=='string'||!x.trim()||x.length>max||/[\x00-\x1f\x7f]/.test(x))fail();};
const uid=(x:any)=>{if(typeof x!=='string'||! /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(x))fail();};
const utf8=(b:Buffer)=>{try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(b);}catch{fail();}};
export const devicePageIssues=['text_incomplete','ocr_unreviewed','equation_unverified','table_unverified','visual_unread','layout_unverified','reader_error','unsupported'] as const;
export type DevicePdfBlock={id:string;kind:'paragraph'|'heading'|'equation'|'table'|'figure'|'other';start:number;end:number;method:'native_text'|'ocr';parent:string|null};
export type DevicePdfPage={number:number;printed_label:string|null;state:'text'|'blank'|'partial'|'unreadable'|'unsupported';start:number;end:number;sha256:string;issues:(typeof devicePageIssues)[number][];blocks:DevicePdfBlock[];ocr?:{engine:'apple_vision'|'windows_ocr';confidence:number|null;confidence_basis:'minimum_reported_line'|'not_provided'};geometry?:PdfLineGeometry};
export type DevicePdfManifest={format:typeof devicePdfFormat;request_id:string;original:{sha256:string;bytes:number;mime:'application/pdf'};extractor:{id:string;version:string;artifact_sha256:string;platform:'windows'|'macos';method:'native_text'|'ocr'|'native_with_ocr';languages:string[]};recovery:{handle:string;original_sha256:string};text:{sha256:string;bytes:number};page_count:number;pages:DevicePdfPage[]};
export type DeviceContentBatch={index:number;text:string;sha256:string};
export function deviceContentNegotiation(){return {format:devicePdfFormat,limits:deviceContentLimits,formats:['application/pdf'],offset_unit:'utf8_bytes',line_geometry:{format:pdfLineGeometryFormat,max_lines:20000,reviewed:false},original_hash:'device_observed_not_independently_verified',page_accounting:'declared_pages_only',layout_review:false,equation_review:false,original_cleanup:false};}
export function validateDevicePdfManifest(raw:unknown):DevicePdfManifest{
 const m=raw as DevicePdfManifest;object(m,['format','request_id','original','extractor','recovery','text','page_count','pages']);
 let bytes=0;try{bytes=Buffer.byteLength(JSON.stringify(m));}catch{fail();}if(bytes>deviceContentLimits.manifest_bytes)fail();
 if(m.format!==devicePdfFormat)fail();uid(m.request_id);
 object(m.original,['sha256','bytes','mime']);hex(m.original.sha256);integer(m.original.bytes,1,deviceContentLimits.original_bytes);if(m.original.mime!=='application/pdf')fail();
 object(m.text,['sha256','bytes']);hex(m.text.sha256);integer(m.text.bytes,1,deviceContentLimits.text_bytes);
 object(m.recovery,['handle','original_sha256']);uid(m.recovery.handle);if(m.recovery.original_sha256!==m.original.sha256)fail();
 object(m.extractor,['id','version','artifact_sha256','platform','method','languages']);label(m.extractor.id,80);label(m.extractor.version,40);hex(m.extractor.artifact_sha256);if(!['windows','macos'].includes(m.extractor.platform)||!['native_text','ocr','native_with_ocr'].includes(m.extractor.method)||!Array.isArray(m.extractor.languages)||m.extractor.languages.length>12||new Set(m.extractor.languages).size!==m.extractor.languages.length||m.extractor.languages.some(v=>typeof v!=='string'||! /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(v)))fail();
 integer(m.page_count,1,deviceContentLimits.pages);if(!Array.isArray(m.pages)||m.pages.length!==m.page_count)fail();
 let cursor=0,blocks=0,geometryLines=0;const ids=new Set<string>();
 for(const [index,p] of m.pages.entries()){
  object(p,['number','printed_label','state','start','end','sha256','issues','blocks'],['ocr','geometry']);if(p.number!==index+1||!['text','blank','partial','unreadable','unsupported'].includes(p.state))fail();if(p.printed_label!==null)label(p.printed_label,40);
  integer(p.start,0,m.text.bytes);integer(p.end,p.start+1,m.text.bytes);if(p.start!==cursor)fail();cursor=p.end;hex(p.sha256);
  if(!Array.isArray(p.issues)||new Set(p.issues).size!==p.issues.length||p.issues.some(v=>!devicePageIssues.includes(v)))fail();
  if(!Array.isArray(p.blocks)||(blocks+=p.blocks.length)>deviceContentLimits.blocks)fail();
  if(['partial','unreadable','unsupported'].includes(p.state)&&!p.issues.length||p.state==='text'&&p.issues.length||p.state==='unsupported'&&!p.issues.includes('unsupported'))fail();
  if(p.ocr!==undefined){object(p.ocr,['engine','confidence','confidence_basis']);if(!p.blocks.some(b=>b?.method==='ocr')||!['apple_vision','windows_ocr'].includes(p.ocr.engine)||p.ocr.engine==='apple_vision'&&m.extractor.platform!=='macos'||p.ocr.engine==='windows_ocr'&&m.extractor.platform!=='windows')fail();if(p.ocr.confidence===null){if(p.ocr.confidence_basis!=='not_provided')fail();}else if(p.ocr.engine!=='apple_vision'||p.ocr.confidence_basis!=='minimum_reported_line'||typeof p.ocr.confidence!=='number'||!Number.isFinite(p.ocr.confidence)||p.ocr.confidence<0||p.ocr.confidence>1)fail();}
  let at=0;
  for(const b of p.blocks){object(b,['id','kind','start','end','method','parent']);if(typeof b.id!=='string'||! /^p[1-9]\d{0,2}-b[1-9]\d{0,3}$/.test(b.id)||!b.id.startsWith('p'+p.number+'-')||ids.has(b.id))fail();ids.add(b.id);if(!['paragraph','heading','equation','table','figure','other'].includes(b.kind)||!['native_text','ocr'].includes(b.method))fail();integer(b.start,0,m.text.bytes);integer(b.end,b.start+1,m.text.bytes);if(b.start!==at)fail();at=b.end;
   if(b.parent!==null&&!p.blocks.some(parent=>parent?.id===b.parent&&parent.kind==='heading'&&parent.start<b.start))fail();
   if(b.method==='ocr'&&(!p.issues.includes('ocr_unreviewed')||m.extractor.method==='native_text')||b.kind==='equation'&&!p.issues.includes('equation_unverified')||b.kind==='table'&&!p.issues.includes('table_unverified')||b.kind==='figure'&&!p.issues.includes('visual_unread'))fail();
  }
  if(p.geometry!==undefined&&(geometryLines+=validatePdfLineGeometry(p.geometry,p,m.extractor.platform))>20000)fail();
 }
 if(cursor!==m.text.bytes)fail();
 // Return a detached JSON snapshot. A later writer must revalidate this
 // contract inside its own authenticated, quota-checked transaction.
 return JSON.parse(JSON.stringify(m)) as DevicePdfManifest;
}
export function validateDeviceContentBatch(raw:unknown):DeviceContentBatch{
 const b=raw as DeviceContentBatch;object(b,['index','text','sha256']);integer(b.index,0,deviceContentLimits.batches-1);hex(b.sha256);if(typeof b.text!=='string'||!b.text||b.text.includes('\0')||Buffer.byteLength(b.text)>deviceContentLimits.batch_bytes||utf8(Buffer.from(b.text))!==b.text||digest(b.text)!==b.sha256)fail();return {index:b.index,text:b.text,sha256:b.sha256};
}
export function validateDevicePdfCommit(raw:unknown,batches:unknown[],expectedOriginal?:{sha256:string;bytes:number;pages?:number}){
 const m=validateDevicePdfManifest(raw);if(!Array.isArray(batches)||!batches.length||batches.length>deviceContentLimits.batches)fail();
 if(expectedOriginal&&(expectedOriginal.sha256!==m.original.sha256||expectedOriginal.bytes!==m.original.bytes||expectedOriginal.pages!==undefined&&expectedOriginal.pages!==m.page_count))fail();
 const chunks=batches.map(validateDeviceContentBatch).sort((a,b)=>a.index-b.index);if(chunks.some((b,i)=>b.index!==i))fail();const text=chunks.map(b=>b.text).join(''),data=Buffer.from(text);
 if(data.length!==m.text.bytes||digest(data)!==m.text.sha256)fail();
 let blockCount=0;
 for(const page of m.pages){
  const unit=data.subarray(page.start,page.end),header='Page '+page.number+'\n';if(unit.length<Buffer.byteLength(header)+2||digest(unit)!==page.sha256)fail();const decoded=utf8(unit);if(!decoded?.startsWith(header)||!decoded.endsWith('\n\n'))fail();
  const body=unit.subarray(Buffer.byteLength(header),unit.length-2);utf8(body);
  if(['blank','unreadable','unsupported'].includes(page.state)&&body.toString('utf8').trim()||page.state==='text'&&!body.toString('utf8').trim())fail();
  if(body.toString('utf8').trim()&&!page.blocks.length||page.blocks.length&&page.blocks.at(-1)!.end!==body.length)fail();
  for(const block of page.blocks){if(block.end>body.length||!utf8(body.subarray(block.start,block.end))?.trim())fail();blockCount++;}
  if(page.geometry)validatePdfGeometryText(page.geometry,body);
 }
 const incomplete=m.pages.filter(p=>p.state!=='text'&&p.state!=='blank'||p.issues.length).map(p=>p.number);
 return {manifest:m,text,manifest_sha256:digest(canonical(m)),text_sha256:m.text.sha256,original_sha256:m.original.sha256,accounting:{declared_pages:m.page_count,accounted_pages:m.pages.length,block_count:blockCount,partial_pages:incomplete,original_matches_expected:!!expectedOriginal,page_count_matches_expected:expectedOriginal?.pages!==undefined,original_independently_verified:false as const,semantic_review:'not_verified' as const,original_cleanup_allowed:false as const},batches:chunks.map(b=>({index:b.index,sha256:b.sha256,bytes:Buffer.byteLength(b.text)}))};
}

export const devicePdfManifestDigest=(raw:unknown)=>digest(canonical(validateDevicePdfManifest(raw)));

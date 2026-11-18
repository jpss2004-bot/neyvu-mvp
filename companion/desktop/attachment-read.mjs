import {createHash} from 'node:crypto';
import {MOODLE,readURL,accountIdentity,MoodleIdentityError,MoodleSessionExpiredError} from './capture.mjs';
import {identityKey} from './protocol.mjs';

export const MAX_ATTACHMENT_BYTES=10*1024*1024,MAX_ATTACHMENT_RUN_BYTES=100*1024*1024;
export const MAX_ATTACHMENTS_PER_COURSE=10,MAX_ATTACHMENTS_PER_RUN=20,MAX_ATTACHMENT_REDIRECTS=3;
export class AttachmentReadError extends Error{
 constructor(code,message){super(message);this.name='AttachmentReadError';this.code=code;}
}

// Only the site's file-serving path and explicit PDF/text/Office names are accepted.
// Moodle's forcedownload flag affects presentation, not the stable source key.
export function attachmentURL(value,{legacyPowerPoint=false}={}){
 try{
  const u=new URL(value),keys=[...u.searchParams.keys()];
  if(u.origin!==MOODLE||u.username||u.password||u.hash||!/^\/pluginfile\.php\/[1-9]\d{0,11}\//.test(u.pathname)||new Set(keys).size!==keys.length||keys.some(key=>!['forcedownload','time'].includes(key))||u.searchParams.has('forcedownload')&&!/^[01]$/.test(u.searchParams.get('forcedownload')||'')||u.searchParams.has('time')&&!/^\d{1,16}$/.test(u.searchParams.get('time')||''))return null;
  const parts=u.pathname.split('/').map(part=>decodeURIComponent(part));
  if(parts.some(part=>part==='.'||part==='..'||/[\\/\u0000-\u001f\u007f]/.test(part)))return null;
  if(!/\.(?:pdf|txt|md|csv|png|jpe?g|webp|docx|pptx|xlsx)$/i.test(parts.at(-1)||'')&&!(legacyPowerPoint&&/\.ppt$/i.test(parts.at(-1)||'')))return null;
  return u.href;
 }catch{return null;}
}
const resourceURL=value=>{const url=readURL(value);if(!url)return null;const u=new URL(url);return u.pathname==='/mod/resource/view.php'&&[...u.searchParams.keys()].length===1?url:null;};
const stableURL=value=>{const u=new URL(value);u.searchParams.delete('forcedownload');u.searchParams.delete('time');return u.href;};
const filename=value=>decodeURIComponent(new URL(value).pathname.split('/').at(-1)).replace(/[\u0000-\u001f\u007f]/g,'').slice(0,180);

// Explain known coverage gaps without authorizing another URL or downloading it.
const unsupportedOriginalReason=value=>{
 try{
  const u=new URL(value);
  if(u.protocol==='https:'&&u.origin!==MOODLE&&!u.username&&!u.password)return 'This reading or recording is hosted outside Moodle and was not imported. Open its original link to access it.';
  const extension=decodeURIComponent(u.pathname).match(/\.(ppt|mp4|m4v|mov|mp3|m4a|wav)$/i)?.[1].toLowerCase();
  if(extension){
   // Reuse the strict URL-shape checks only for classification. The original
   // unsupported URL never becomes an accepted collection candidate.
   u.pathname=u.pathname.replace(/\.[^/.]+$/,'.pdf');
   if(attachmentURL(u.href))return extension==='ppt'
    ?'Legacy PowerPoint (.ppt) files are not readable by this Companion yet. Open the original in Moodle; its slides have not been read.'
    :'Audio and video recordings are not imported or transcribed by this Companion yet. Open the original in Moodle; its contents have not been read.';
  }
 }catch{}
 return 'An original file or embedded material is unsupported or outside Moodle; its content was not imported.';
};

export function attachmentCandidates(dom,course,identity,{filesRead=0,totalFiles=0,totalBytes=0,seen=new Set(),discoverOnly=false,legacyPowerPoint=false}={}){
 const accepted=readURL(dom?.url),page=accepted?new URL(accepted):null,isCourse=page?.pathname==='/course/view.php',expected=page?.pathname==='/mod/forum/discuss.php'?'page-mod-forum-discuss':'page-mod-'+page?.pathname.split('/')[2]+'-view';
 if(!page||!/^[1-9]\d{0,11}$/.test(course?.id||'')||readURL(course?.url,true)!==course?.url||new URL(course.url).searchParams.get('id')!==course.id||(isCourse?(accepted!==course.url||!/^page-course-view-/.test(dom.body_id||'')):dom.body_id!==expected)||!dom.classes?.split(/\s+/).includes('course-'+course.id)||identityKey(accountIdentity(dom))!==identityKey(identity))throw new MoodleIdentityError('Moodle attachment, account or course did not match. No file was uploaded.');
 const links=[...(dom.attachment_links||[]),...(dom.embedded_content||[]).map(item=>({url:item.url,title:''}))],items=[],issues=[];
 if(![filesRead,totalFiles,totalBytes].every(value=>Number.isSafeInteger(value)&&value>=0)||!(seen instanceof Set))return {items,issues:['The bounded file collection plan was invalid; no originals were read.']};
 for(const link of links){
  const url=attachmentURL(link.url,{legacyPowerPoint});
  if(!url){issues.push(unsupportedOriginalReason(link.url));continue;}
  if(seen.has(stableURL(url))||items.some(item=>item.source_url===stableURL(url)))continue;
  if(discoverOnly?items.length>=200:filesRead+items.length>=MAX_ATTACHMENTS_PER_COURSE||totalFiles+items.length>=MAX_ATTACHMENTS_PER_RUN){issues.push(discoverOnly?'The 200 original links per page discovery limit was reached.':'File collection reached the 10 files per course or 20 files per refresh limit; some originals were not imported.');continue;}
  if(totalBytes>=MAX_ATTACHMENT_RUN_BYTES){issues.push('File collection reached the 100 MiB refresh limit; some originals were not imported.');continue;}
  items.push({url,source_url:stableURL(url),title:String(link.title||filename(url)).trim().slice(0,180)});
 }
 return {items,issues:[...new Set(issues)]};
}

// The injected fetch adapter owns cookies and must honor redirect:'manual'.
// Every destination is validated before calling it; no cookie or bearer token
// is returned, logged, or sent to an external redirect destination.
export async function readAttachment(fetcher,value,{remainingBytes=MAX_ATTACHMENT_RUN_BYTES,signal,timeoutMs=15000,legacyPowerPoint=false}={}){
 const initial=attachmentURL(value,{legacyPowerPoint})||resourceURL(value);
 if(!initial)throw new AttachmentReadError('unsupported-url','This file link is unsupported; no file was read.');
 if(!Number.isSafeInteger(remainingBytes)||remainingBytes<1||remainingBytes>MAX_ATTACHMENT_RUN_BYTES)throw new AttachmentReadError('byte-limit','The file collection byte limit has been reached.');
 const cap=Math.min(MAX_ATTACHMENT_BYTES,remainingBytes),controller=new AbortController();let reader,abortReject;
 const aborted=new Promise((_,reject)=>{abortReject=reject;});
 const abort=()=>{controller.abort();abortReject(new AttachmentReadError('cancelled','This file read was cancelled or timed out.'));void reader?.cancel().catch(()=>{});};
 if(signal?.aborted)throw new AttachmentReadError('cancelled','This file read was cancelled.');
 signal?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(abort,Math.max(100,Math.min(30000,Number(timeoutMs)||15000)));
 let url=initial,redirects=0,bytesRead=0;
 try{
  for(;;){
   const response=await Promise.race([fetcher(url,{method:'GET',redirect:'manual',signal:controller.signal}),aborted]);
   if(response.redirected||response.url&&response.url!==url)throw new AttachmentReadError('unsafe-redirect','The file request did not preserve manual redirect validation.');
   if([301,302,303,307,308].includes(response.status)){
    const location=response.headers.get('location');let target;
    try{if(location)target=new URL(location,url);}catch{}
    void response.body?.cancel().catch(()=>{});
    if(target?.origin===MOODLE&&target.pathname.startsWith('/login/'))throw new MoodleSessionExpiredError('Moodle sign-in expired while reading an original.');
    const next=target&&attachmentURL(target.href,{legacyPowerPoint});
    if(!next)throw new AttachmentReadError('unsafe-redirect','Moodle redirected the file outside the supported file path; its content was not imported.');
    if(redirects++>=MAX_ATTACHMENT_REDIRECTS)throw new AttachmentReadError('redirect-limit','The file exceeded the three-redirect limit; its content was not imported.');
    url=next;continue;
   }
   if(!response.ok)throw new AttachmentReadError('http','Moodle did not make this original file readable (HTTP '+response.status+').');
   const mime=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
   if(resourceURL(url)&&mime==='text/html'){void response.body?.cancel().catch(()=>{});return {kind:'page',url};}
   if(!attachmentURL(url,{legacyPowerPoint}))throw new AttachmentReadError('unsupported-type','The activity did not expose a supported PDF, text or Office file.');
   const path=new URL(url).pathname,image=/\.(?:png|jpe?g|webp)$/i.test(path),imageMime=/\.png$/i.test(path)?'image/png':/\.webp$/i.test(path)?'image/webp':'image/jpeg',pdf=/\.pdf$/i.test(path),legacy=/\.ppt$/i.test(path),office=/\.(?:docx|pptx|ppt|xlsx)$/i.test(path),mimeType=legacy?'application/vnd.ms-powerpoint':image?imageMime:/\.xlsx$/i.test(path)?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':/\.docx$/i.test(path)?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':/\.pptx$/i.test(path)?'application/vnd.openxmlformats-officedocument.presentationml.presentation':pdf?'application/pdf':'text/plain',allowed=image?[imageMime,'application/octet-stream']:office?[mimeType,'application/octet-stream']:pdf?['application/pdf','application/octet-stream']:['text/plain','text/markdown','text/csv','application/octet-stream'];
   if(!allowed.includes(mime))throw new AttachmentReadError('unsupported-type','This original file did not have a matching supported document content type.');
   const declared=response.headers.get('content-length');
   if(declared!==null&&!/^\d+$/.test(declared))throw new AttachmentReadError('invalid-length','The original file reported an invalid size; no file was imported.');
   if(declared!==null&&Number(declared)>MAX_ATTACHMENT_BYTES)throw new AttachmentReadError('file-too-large','The original file exceeds the 10 MiB file size limit. Open it in Moodle or add a smaller readable copy.');
   if(declared!==null&&Number(declared)>cap)throw new AttachmentReadError('byte-limit','The remaining refresh byte budget cannot fit this original; a later refresh can try again.');
   if(!response.body?.getReader)throw new AttachmentReadError('unreadable','The original file did not expose a readable body.');
   reader=response.body.getReader();let bytes=0;const chunks=[];
   for(;;){
    const part=await Promise.race([reader.read(),aborted]);if(part.done)break;
    if(!(part.value instanceof Uint8Array))throw new AttachmentReadError('unreadable','The original file returned an unreadable body.');
    bytes+=part.value.byteLength;bytesRead=bytes;
    if(bytes>cap){controller.abort();void reader.cancel().catch(()=>{});throw new AttachmentReadError(cap===MAX_ATTACHMENT_BYTES?'file-too-large':'byte-limit',cap===MAX_ATTACHMENT_BYTES?'The original file exceeds the 10 MiB file size limit. Open it in Moodle or add a smaller readable copy.':'The remaining refresh byte budget cannot fit this original; a later refresh can try again.');}
    chunks.push(Buffer.from(part.value));
   }
   if(!bytes)throw new AttachmentReadError('empty','The original file was empty.');
   if(declared!==null&&(!response.headers.get('content-encoding')||response.headers.get('content-encoding')==='identity')&&Number(declared)!==bytes)throw new AttachmentReadError('truncated','The original file length did not match its declared length; no partial file was imported.');
   const body=Buffer.concat(chunks,bytes);
   if(pdf&&!body.subarray(0,5).equals(Buffer.from('%PDF-')))throw new AttachmentReadError('invalid-content','This PDF did not have a valid PDF header.');
   if(legacy&&(body.length<512||!body.subarray(0,8).equals(Buffer.from('d0cf11e0a1b11ae1','hex'))))throw new AttachmentReadError('invalid-content','This PowerPoint did not have a valid legacy Office header.');
   if(office&&!legacy&&!body.subarray(0,4).equals(Buffer.from([80,75,3,4])))throw new AttachmentReadError('invalid-content','This document did not have a valid Office archive header.');
   if(image){const valid=imageMime==='image/png'?body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):imageMime==='image/jpeg'?body.subarray(0,3).equals(Buffer.from([255,216,255])):body.subarray(0,4).toString()==='RIFF'&&body.subarray(8,12).toString()==='WEBP';if(!valid)throw new AttachmentReadError('invalid-content','The image signature did not match its file type.');}
   if(!pdf&&!office&&!image){let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(body);}catch{throw new AttachmentReadError('invalid-content','This text file is not readable UTF-8 text.');}if(/[\u0000-\u0008\u000b\u000e-\u001f]/.test(text))throw new AttachmentReadError('invalid-content','This file contains binary content rather than readable text.');}
   return {kind:'file',url,source_url:stableURL(url),title:filename(url),mime:mimeType,bytes,body,sha256:createHash('sha256').update(body).digest('hex'),...(resourceURL(initial)?{activity_url:initial}:{})};
  }
 }catch(error){
  const failure=error instanceof AttachmentReadError||error instanceof MoodleSessionExpiredError?error:new AttachmentReadError(controller.signal.aborted?'cancelled':'unreadable','The original file could not be read completely; no partial file was imported.');
  failure.bytesRead=bytesRead;throw failure;
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.abort();try{reader?.releaseLock();}catch{}}
}

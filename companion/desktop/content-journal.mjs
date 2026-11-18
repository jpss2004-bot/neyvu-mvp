// Local retained originals and exact transfer intents. The desktop application's
// single-instance owner supplies OS secure-storage encryption. No cleanup,
// connection rebinding, native reader activation or network operation here.
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {contentManifestDigest,preparePdfContent} from './content-packet.mjs';
import {identityKey} from './protocol.mjs';
import {attachmentURL} from './attachment-read.mjs';

const hash=x=>createHash('sha256').update(x).digest('hex');
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(x);
const clone=x=>JSON.parse(JSON.stringify(x));
const same=(a,b)=>contentManifestDigest(a)===contentManifestDigest(b);
const fail=()=>{throw Error('The retained PDF record could not be verified. Keep the original; do not start another transfer.');};
const queues=new Map(),MAX_RECORD=24*1024*1024,MAX_BYTES=256*1024*1024,MAX_RECORDS=500;
const keys=(v,required,optional=[])=>v&&typeof v==='object'&&!Array.isArray(v)&&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
function coverageSummary(packet){
 const m=packet?.manifest,pages=m?.pages;
 if(!Number.isSafeInteger(m?.page_count)||m.page_count<1||m.page_count>500||!Array.isArray(pages)||pages.length!==m.page_count||pages.some((p,i)=>!p||typeof p!=='object'||p.number!==i+1||!['text','blank','partial','unreadable','unsupported'].includes(p.state)||!Array.isArray(p.issues)))return null;
 return {physical_pages:m.page_count,pages_accounted:pages.length,pages_needing_review:pages.filter(p=>!['text','blank'].includes(p.state)||p.issues.length>0).length,partial_pages:pages.filter(p=>p.state==='partial').length,unreadable_pages:pages.filter(p=>p.state==='unreadable').length,unsupported_pages:pages.filter(p=>p.state==='unsupported').length,semantic_review:'not_verified',original_cleanup_allowed:false};
}
function checkReaderEvidence(e,r){if(!keys(e,['format','original_sha256','sha256','bytes','body'])||e.format!=='neyvu-native-pdf/1'||e.original_sha256!==r.original_sha256||typeof e.body!=='string'||Buffer.byteLength(e.body)>3000000||Buffer.byteLength(e.body)!==e.bytes||hash(e.body)!==e.sha256)fail();let v;try{v=JSON.parse(e.body);}catch{fail();}if(v.format!==e.format||v.original_sha256!==r.original_sha256||v.page_count!==r.packet?.manifest.page_count)fail();}

export function createSecureContentJournal({root,safeStorage}){
 const available=()=>{if(!safeStorage?.isEncryptionAvailable()||safeStorage.getSelectedStorageBackend?.()==='basic_text')throw Error('Secure computer-account storage is unavailable. Your PDF was not sent.');};
 return createContentJournal({root,seal:value=>{available();return safeStorage.encryptString(value);},unseal:value=>{available();return safeStorage.decryptString(value);}});
}

function scopeFor({token,identity,course,reviewRevision,sourceURL,origin}){
 if(!/^[A-Za-z0-9_-]{43}$/.test(token||'')||!/^moodle-user:[1-9]\d{0,11}(?:\s*·\s*[^\r\n]{1,120})?$/.test(identity||'')||!uuid(reviewRevision)||!course||!/^[1-9]\d{0,11}$/.test(course.id||'')||course.url!=='https://moodle.acadiau.ca/course/view.php?id='+course.id||attachmentURL(sourceURL)!==sourceURL||!['https://neyvu-app.example.com','https://neyvu-web.example.com'].includes(origin))fail();
 return {grant_sha256:hash(token),identity_key:identityKey(identity),course_id:course.id,review_revision:reviewRevision,source_url:sourceURL,origin};
}
function checkMetadata(m,scope,originalSHA){
 if(!keys(m,['identity','course','source_url','title','mime','captured_at','sha256'],['activity_url'])||typeof m.identity!=='string'||identityKey(m.identity)!==scope.identity_key||!keys(m.course,['id','url'])||m.course.id!==scope.course_id||m.course.url!=='https://moodle.acadiau.ca/course/view.php?id='+scope.course_id||m.source_url!==scope.source_url||m.mime!=='application/pdf'||m.sha256!==originalSHA||typeof m.title!=='string'||!m.title.trim()||m.title.length>180||/[\x00-\x1f\x7f]/.test(m.title)||typeof m.captured_at!=='string'||!Number.isFinite(Date.parse(m.captured_at))||JSON.stringify(m).length>4096)fail();
 if(m.activity_url!==undefined){let u;try{u=new URL(m.activity_url);}catch{fail();}if(u.origin!=='https://moodle.acadiau.ca'||u.username||u.password||u.hash||!/^\/(?:course|mod\/[a-z]+)\/view\.php$/.test(u.pathname)||[...u.searchParams.keys()].some(k=>!['id','chapterid'].includes(k))||!u.searchParams.get('id'))fail();}
}
function checkPacket(packet,record){
 const m=packet?.manifest;
 if(!keys(packet,['manifest','batches'])||!m||m.format!=='neyvu-device-pdf/1'||m.request_id!==record.request_id||m.recovery?.handle!==record.recovery_handle||m.recovery.original_sha256!==record.original_sha256||m.original?.sha256!==record.original_sha256||m.original.bytes!==record.original_bytes||m.original.mime!=='application/pdf'||!Array.isArray(packet.batches)||!packet.batches.length||packet.batches.length>64||JSON.stringify(m).length>512000)fail();
 const text=packet.batches.map((b,i)=>{if(!keys(b,['index','text','sha256'])||b.index!==i||typeof b.text!=='string'||!b.text||Buffer.byteLength(b.text)>32768||hash(b.text)!==b.sha256)fail();return b.text;}).join('');
 if(Buffer.byteLength(text)>512000||Buffer.byteLength(text)!==m.text?.bytes||hash(text)!==m.text.sha256)fail();
}
function checkSession(s,r,prior){
 if(!r.packet||!keys(s,['request_id','manifest_sha256','metadata_sha256','session_id'],['receipt'])||s.request_id!==r.request_id||s.manifest_sha256!==contentManifestDigest(r.packet.manifest)||s.metadata_sha256!==contentManifestDigest(r.metadata)||s.session_id!==null&&!uuid(s.session_id)||prior?.session_id&&s.session_id!==prior.session_id||prior?.receipt&&!s.receipt)fail();
 if(s.receipt){const t=s.receipt;if(!uuid(t.source_id)||!uuid(t.version_id)||t.source_binding_checked!==true||t.original_cleanup_allowed!==false||t.original_sha256!==r.original_sha256||t.text_sha256!==r.packet.manifest.text.sha256||t.manifest_sha256!==s.manifest_sha256||!s.session_id||prior?.receipt&&(prior.receipt.source_id!==t.source_id||prior.receipt.version_id!==t.version_id))fail();}
}

export function createContentJournal({root,seal,unseal,maxBytes=MAX_BYTES,maxRecords=MAX_RECORDS}){
 if(!path.isAbsolute(root)||typeof seal!=='function'||typeof unseal!=='function'||!Number.isSafeInteger(maxBytes)||maxBytes<1024||maxBytes>MAX_BYTES||!Number.isSafeInteger(maxRecords)||maxRecords<1||maxRecords>MAX_RECORDS)throw Error('Private PDF storage and secure encryption are required.');
 root=path.resolve(root);
 const serial=async action=>{const before=queues.get(root)||Promise.resolve();const next=before.catch(()=>{}).then(action);queues.set(root,next);try{return await next;}finally{if(queues.get(root)===next)queues.delete(root);}};
 const folder=async()=>{await fs.mkdir(root,{mode:0o700,recursive:true});const st=await fs.lstat(root);if(!st.isDirectory()||st.isSymbolicLink()||await fs.realpath(root)!==root)fail();if(process.platform!=='win32'&&(st.mode&0o077))throw Error('Retained PDF storage must be private to this computer account.');};
 const filename=key=>{if(!hex(key))fail();return path.join(root,key+'.bin');};
 const load=async(key,{missing=false}={})=>{
  await folder();let handle;
  try{handle=await fs.open(filename(key),constants.O_RDONLY|(constants.O_NOFOLLOW||0));const st=await handle.stat();if(!st.isFile()||st.size>MAX_RECORD||st.nlink!==1||process.platform!=='win32'&&(st.mode&0o077))fail();const encrypted=await handle.readFile();const plain=await unseal(encrypted);if(typeof plain!=='string'||Buffer.byteLength(plain)>MAX_RECORD)fail();const r=JSON.parse(plain);
   if(!keys(r,['format','key','scope','request_id','recovery_handle','original_sha256','original_bytes','original_base64','metadata','packet','session'],['reader_evidence','display_course'])||r.format!=='neyvu-retained-pdf/1'||r.key!==key||!uuid(r.request_id)||!uuid(r.recovery_handle)||!hex(r.original_sha256)||!Number.isSafeInteger(r.original_bytes)||r.original_bytes>10*1024*1024||r.original_bytes<5||typeof r.original_base64!=='string'||!keys(r.scope,['grant_sha256','identity_key','course_id','review_revision','source_url','origin'])||!hex(r.scope.grant_sha256)||contentManifestDigest({scope:r.scope,original_sha256:r.original_sha256})!==key)fail();
   const original=Buffer.from(r.original_base64,'base64');if(original.toString('base64')!==r.original_base64||original.length!==r.original_bytes||hash(original)!==r.original_sha256||!original.subarray(0,5).equals(Buffer.from('%PDF-')))fail();checkMetadata(r.metadata,r.scope,r.original_sha256);if(r.display_course!==undefined&&(typeof r.display_course!=='string'||!r.display_course.trim()||r.display_course.length>180||/[\x00-\x1f\x7f]/.test(r.display_course)))fail();if(r.packet)checkPacket(r.packet,r);if(r.reader_evidence)checkReaderEvidence(r.reader_evidence,r);if(r.session)checkSession(r.session,r);return r;
  }catch(e){if(e.code==='ENOENT'&&missing)return null;throw e;}finally{await handle?.close();}
 };
 const store=async r=>{
  await folder();const encrypted=await seal(JSON.stringify(r));if(!Buffer.isBuffer(encrypted)||!encrypted.length||encrypted.length>MAX_RECORD)throw Error('The encrypted PDF record exceeds its local limit. Keep the original.');
  let bytes=0,records=0,old=0;
  for(const entry of await fs.readdir(root,{withFileTypes:true})){const st=await fs.lstat(path.join(root,entry.name));if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1)fail();bytes+=st.size;if(entry.name.endsWith('.bin'))records++;if(entry.name===r.key+'.bin')old=st.size;}
  // Include the complete replacement alongside its current record: a crash can
  // retain both. No old original or orphan is removed to make room.
  if(bytes+encrypted.length>maxBytes||!old&&records>=maxRecords)throw Error('Retained PDF storage is full. Your originals are kept; review storage before importing more.');
  const dest=filename(r.key),temp=dest+'.'+randomUUID()+'.tmp';let h;
  try{h=await fs.open(temp,'wx',0o600);await h.writeFile(encrypted);await h.sync();await h.close();h=null;await fs.rename(temp,dest);
   // Windows has no portable directory fsync through Node; installed power-loss
   // durability remains an acceptance gate there, not an inferred guarantee.
   if(process.platform!=='win32'){const dir=await fs.open(root,'r');try{await dir.sync();}finally{await dir.close();}}
  }finally{await h?.close();await fs.unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
 };
 const ticket=(key,scope)=>{
  const checked=async()=>{const r=await load(key);if(!same(r.scope,scope))fail();return r;};
  return {
   key,
   snapshot:async()=>{const r=await checked();return {key,request_id:r.request_id,recovery_handle:r.recovery_handle,original_sha256:r.original_sha256,original_bytes:r.original_bytes,metadata:clone(r.metadata),packet:clone(r.packet),readerEvidence:clone(r.reader_evidence??null),session:clone(r.session),original_cleanup_allowed:false};},
   prepare:readPdf=>serial(async()=>{const r=await checked();if(!r.packet){if(typeof readPdf!=='function')throw Error('This Companion needs a verified native PDF reader. The original is retained.');const observation=await readPdf(Buffer.from(r.original_base64,'base64'));if(!keys(observation,['extractor','pages'],['readerEvidence']))fail();r.packet=preparePdfContent({original:Buffer.from(r.original_base64,'base64'),extractor:observation.extractor,pages:observation.pages,recoveryHandle:r.recovery_handle,requestId:r.request_id});checkPacket(r.packet,r);if(observation.readerEvidence!==undefined){r.reader_evidence=clone(observation.readerEvidence);checkReaderEvidence(r.reader_evidence,r);}await store(r);}return {packet:clone(r.packet),metadata:clone(r.metadata)};}),
   loadSession:async()=>clone((await checked()).session),
   saveSession:s=>serial(async()=>{const r=await checked();checkSession(s,r,r.session);r.session=clone(s);await store(r);}),
  };
 };
 return {
  listRetained:()=>serial(async()=>{
   await folder();const names=(await fs.readdir(root)).filter(n=>/^[a-f0-9]{64}\.bin$/.test(n));if(names.length>MAX_RECORDS)fail();const items=[];let unreadable=0,bytes=0;
   for(const name of names){try{const r=await load(name.slice(0,-4));bytes+=r.original_bytes;items.push({key:r.key,recovery_handle:r.recovery_handle,sha256:r.original_sha256,bytes:r.original_bytes,title:r.metadata.title,course_title:r.display_course??null,course_id:r.scope.course_id,identity_key:r.scope.identity_key,account_label:r.metadata.identity.includes('·')?r.metadata.identity.split('·').slice(1).join('·').trim()+' (Moodle '+r.scope.identity_key+')':'Moodle account '+r.scope.identity_key,captured_at:r.metadata.captured_at,coverage:coverageSummary(r.packet),state:r.session?.receipt?'receipt_saved':r.session?'transfer_pending':r.packet?'prepared':'original_retained'});}catch{unreadable++;}}
   return {items:items.sort((a,b)=>b.captured_at.localeCompare(a.captured_at)||a.key.localeCompare(b.key)),unreadable,original_bytes:bytes,record_limit:MAX_RECORDS,encrypted_byte_limit:MAX_BYTES};
  }),
  find:args=>serial(async()=>{const scope=scopeFor(args);if(!hex(args.originalSHA256))fail();const key=contentManifestDigest({scope,original_sha256:args.originalSHA256});const r=await load(key,{missing:true});if(r&&!same(r.scope,scope))fail();return r?ticket(key,scope):null;}),
  retain:args=>serial(async()=>{const scope=scopeFor(args),original=args.original;if(!Buffer.isBuffer(original)||original.length<5||original.length>10*1024*1024||!original.subarray(0,5).equals(Buffer.from('%PDF-')))throw Error('Keep a complete original PDF within the 10 MiB limit.');const originalSHA=hash(original),key=contentManifestDigest({scope,original_sha256:originalSHA});checkMetadata(args.metadata,scope,originalSHA);
   const prior=await load(key,{missing:true});if(prior){if(!same(prior.scope,scope))fail();return ticket(key,scope);}
   if(args.courseTitle!==undefined&&(typeof args.courseTitle!=='string'||!args.courseTitle.trim()||args.courseTitle.length>180||/[\x00-\x1f\x7f]/.test(args.courseTitle)))fail();
   const r={...(args.courseTitle?{display_course:args.courseTitle}:{}),format:'neyvu-retained-pdf/1',key,scope,request_id:randomUUID(),recovery_handle:randomUUID(),original_sha256:originalSHA,original_bytes:original.length,original_base64:original.toString('base64'),metadata:clone(args.metadata),packet:null,session:null};await store(r);await load(key);return ticket(key,scope);
  }),
  recoverOriginal:({key=undefined,recoveryHandle,sha256})=>serial(async()=>{
   if(!uuid(recoveryHandle)||!hex(sha256))fail();let r;
   if(key!==undefined)r=await load(key);
   else{
    // The server stores only an opaque recovery handle, not a computer path or
    // grant hash. Local recovery must still work after disconnection, without
    // rebinding or uploading an old account's content under a new grant.
    await folder();const names=(await fs.readdir(root)).filter(n=>/^[a-f0-9]{64}\.bin$/.test(n));if(names.length>MAX_RECORDS)fail();
    for(const name of names){
     let candidate;try{candidate=await load(name.slice(0,-4));}catch{continue;}
     // Unreadable records stay on disk and in the inventory's warning count.
     // Ambiguous verified handles still refuse outside that per-record catch.
     if(candidate.recovery_handle===recoveryHandle){if(r)fail();r=candidate;}
    }
   }
   if(!r||r.recovery_handle!==recoveryHandle||r.original_sha256!==sha256)fail();return {original:Buffer.from(r.original_base64,'base64'),sha256:r.original_sha256,original_cleanup_allowed:false};
  }),
 };
}

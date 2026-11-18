import {writePassages} from './passage-writer';
import {officeReading} from './office-reading';
import {sourceChanged} from './source-dependencies';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {betaPool,tenant,uuid} from './db';import {lockVault,checkHistory} from './budget';import {BetaHttpError} from './http';import {readBetaFile} from './files';
import {deriveFileWork} from './file-work';
import {wordMime,slidesMime,legacySlidesMime,legacySlidesEnabled,sheetsMime} from './file-types';
import {pdfReading,pdfReaderEvidence} from './pdf-reading';
import {imageOcr} from './image-ocr';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
async function leased(c:any,user:string,id:string,raw:string){if(!(await c.query('SELECT 1 FROM schoolvault.users WHERE id=$1 AND disabled_at IS NULL',[user])).rowCount)throw new BetaHttpError('Account unavailable.',403);const j=(await c.query('SELECT * FROM schoolvault.jobs WHERE user_id=$1 AND id=$2 FOR UPDATE',[user,id])).rows[0];if(!j||j.kind!=='extract'||j.status!=='leased'||j.lease_hash!==hash(raw)||Date.parse(j.lease_until)<=Date.now())throw new BetaHttpError('Extraction lease expired.',409);return j;}
function parts(raw:unknown){if(typeof raw!=='string')throw new BetaHttpError('Invalid lease');const p=raw.split('.');if(p.length!==3||!uuid(p[0])||!uuid(p[1])||!/^[A-Za-z0-9_-]{43}$/.test(p[2]))throw new BetaHttpError('Invalid lease');return p;}
export async function leaseExtraction(capabilities?:{legacy_powerpoint?:boolean}){
 const legacy=legacySlidesEnabled()&&capabilities?.legacy_powerpoint===true;
 for(const user of (await betaPool().query('SELECT id FROM schoolvault.users WHERE disabled_at IS NULL ORDER BY last_extract_lease_at NULLS FIRST,created_at,id')).rows){
  const job=await tenant(user.id,async c=>{
   await lockVault(c,user.id);
   await c.query("UPDATE schoolvault.jobs SET status='failed',error='Document reading could not finish. The original is safe.',lease_hash=NULL,lease_until=NULL WHERE user_id=$1 AND kind='extract' AND status='leased' AND lease_until<now() AND attempts>=3",[user.id]);
   const j=(await c.query("SELECT * FROM schoolvault.jobs WHERE user_id=$1 AND kind='extract' AND ($2::boolean OR NOT EXISTS(SELECT 1 FROM schoolvault.source_versions v WHERE v.user_id=schoolvault.jobs.user_id AND v.id=(schoolvault.jobs.input->>'version_id')::uuid AND v.mime='application/vnd.ms-powerpoint')) AND (status='queued' OR status='leased' AND lease_until<now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",[user.id,legacy])).rows[0];if(!j)return null;
   const lease=user.id+'.'+j.id+'.'+randomBytes(32).toString('base64url');
   await c.query("UPDATE schoolvault.jobs SET status='leased',lease_hash=$3,lease_until=now()+interval '5 minutes',attempts=attempts+1 WHERE user_id=$1 AND id=$2",[user.id,j.id,hash(lease)]);
   await c.query('UPDATE schoolvault.users SET last_extract_lease_at=now() WHERE id=$1',[user.id]);
   return {lease,job_id:j.id,source_id:j.input.source_id};
  });if(job)return job;
 }return null;
}
export async function extractionFile(raw:unknown){const [user,id]=parts(raw);const source=await tenant(user,async c=>(await leased(c,user,id,raw as string)).input.source_id);return readBetaFile(user,source);}
export async function finishExtraction(raw:unknown,output:any){const [user,id]=parts(raw);return tenant(user,async c=>{
 await lockVault(c,user);const job=await leased(c,user,id,raw as string);
 const fail=async(message:string)=>{await c.query("UPDATE schoolvault.jobs SET status='failed',error=$3,lease_hash=NULL,lease_until=NULL,updated_at=now() WHERE user_id=$1 AND id=$2",[user,id,message]);return {saved:true,status:'failed'};};
 if(output?.error)return fail('Document text could not be read. The original is safe; encrypted, scanned or unsupported content needs a readable copy.');
 if(typeof output?.text!=='string'||!output.text.trim()||Buffer.byteLength(output.text)>512000||output.text.includes('\0'))throw new BetaHttpError('Invalid extracted text');
 const source=(await c.query('SELECT v.* FROM schoolvault.sources s JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.id=s.current_version WHERE s.user_id=$1 AND s.id=$2 FOR UPDATE OF s',[user,job.input.source_id])).rows[0];
 if(!source||source.id!==job.input.version_id)return fail('This file changed during extraction. The original is safe.');
 const image=source.mime?.startsWith('image/')?imageOcr(output.image_ocr,output.text):null;
 if(source.mime?.startsWith('image/')&&(output.format!=='image'||!image||!output.text.startsWith('Image 1 — local OCR supplement (unreviewed)\n')))return fail('Image OCR could not be verified. The original is safe.');
 const office=officeReading(output.office_reading);
 const expected=source.mime===wordMime?'docx':source.mime===slidesMime?'pptx':source.mime===legacySlidesMime?'ppt':source.mime===sheetsMime?'xlsx':null;
 if(expected&&(output.format!==expected||!Number.isSafeInteger(output.units)||output.units<(office&&office.images_read>0?0:1)||output.units>100000||output.unit_label!==(expected==='docx'?'paragraphs':expected==='xlsx'?'sheets':'slides')))return fail('The document format could not be verified. The original is safe.');
 const conversion=source.mime===legacySlidesMime?output.conversion:null;
 if(source.mime===legacySlidesMime&&(!conversion||conversion.method!=='local_libreoffice_to_pptx'||conversion.original_sha256!==source.sha256||!/^([a-f0-9]{64})$/.test(conversion.derived_sha256||'')||conversion.external_network!=='denied'||conversion.original_preserved!==true||conversion.macros!=='disabled_in_isolated_profile'))return fail('PowerPoint conversion evidence did not match the stored original.');
 const reading=source.mime==='application/pdf'?pdfReading(output.pdf_reading):null;
 const readerEvidence=source.mime==='application/pdf'?pdfReaderEvidence(output.reader_evidence,reading):null;
 await c.query('SAVEPOINT pdf_text');
 try{
  const version=randomUUID();
  await c.query('INSERT INTO schoolvault.source_versions(user_id,id,source_id,body,sha256,object_key,mime,bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[user,version,source.source_id,output.text,source.sha256,source.object_key,source.mime,source.bytes]);
  await writePassages(c,user,source.source_id,version,output.text);
  await c.query('UPDATE schoolvault.sources SET current_version=$3 WHERE user_id=$1 AND id=$2',[user,source.source_id,version]);
  await deriveFileWork(c,user,source.source_id,version);
  await c.query("UPDATE schoolvault.jobs SET status='complete',result=$3,lease_hash=NULL,lease_until=NULL,updated_at=now() WHERE user_id=$1 AND id=$2",[user,id,{source_id:source.source_id,version_id:version,text_sha256:hash(output.text),original_sha256:source.sha256,pages:image?1:output.pages,...(reading?{pdf_reading:reading}:{}),...(image?{image_ocr:image}:{}),...(readerEvidence?{reader_evidence:readerEvidence}:{}),...(['docx','pptx','ppt','xlsx'].includes(output.format)?{format:output.format,units:output.units,unit_label:output.unit_label,limitations:output.limitations,...(conversion?{conversion:{method:conversion.method,original_sha256:conversion.original_sha256,derived_sha256:conversion.derived_sha256,external_network:'denied',macros:conversion.macros,original_preserved:true}}:{}),...(office?{office_reading:office}:{})}:{}),truncated:output.truncated===true}]);
  await sourceChanged(c,user,source.source_id,version);
  await checkHistory(c,user);
 }catch(e){await c.query('ROLLBACK TO SAVEPOINT pdf_text');await c.query('RELEASE SAVEPOINT pdf_text');if(e instanceof Error&&e.message.startsWith('Invalid text:'))return fail('Vault history is full. The original is safe; text was not added.');throw e;}
 await c.query('RELEASE SAVEPOINT pdf_text');return {saved:true,status:'complete'};
 });}

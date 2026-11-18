import {writePassages} from './passage-writer';
import {sourceChanged} from './source-dependencies';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile,unlink,readFile,realpath,lstat,statfs} from 'node:fs/promises';
import path from 'node:path';
import type {PoolClient} from 'pg';
import {tenant,uuid} from './db';
import {ownedBetaCourse,betaSource,text,textLimit} from './vault';
import {BetaHttpError} from './http';
import {checkObjects,checkHistory,storedObjects} from './budget';
import {deriveFileWork} from './file-work';
import {extractedMimes,originalSignature,legacySlidesMime,legacySlidesEnabled} from './file-types';
const maxBytes=10*1024*1024;
export type BetaFileResult={id:string;title:string;course_id:string;kind:string;bytes:number;mime:string;searchable:boolean;extraction:string;unchanged?:boolean};
// Internal server hook only: authentication and deduplication run in the same
// vault-locked transaction as file/version admission, never from request JSON.
export type BetaFilePreparation={source_id?:string;original_url?:string;duplicate?:BetaFileResult;afterStore?:(c:PoolClient,file:{source_id:string;version_id:string;sha256:string})=>Promise<void>};
export type BetaFileOptions={prepare:(c:PoolClient,sha256:string)=>Promise<BetaFilePreparation>};
export async function betaFilePath(user:string,key:string){
 const root=process.env.SCHOOL_BETA_FILE_ROOT;
 if(!root||!path.isAbsolute(root)||!uuid(user)||!uuid(key))throw Error('SchoolVault files are not configured');
 await mkdir(root,{recursive:true,mode:0o700});const actual=await realpath(root);
 if((await lstat(root)).isSymbolicLink())throw Error('Invalid file store');
 const folder=path.join(actual,user);await mkdir(folder,{recursive:true,mode:0o700});
 if((await realpath(folder))!==folder||(await lstat(folder)).isSymbolicLink())throw Error('Invalid file store');
 return path.join(folder,key);
}
export async function createBetaFile(user:string,courseId:string,name:string,mime:string,buffer:Buffer,options?:BetaFileOptions):Promise<BetaFileResult>{
 name=text(name,180).replace(/[\r\n\x00-\x1f]/g,'').trim();if(!name)throw Error('Enter a file name');
 if(!buffer.length||buffer.length>maxBytes)throw new BetaHttpError('Choose a file up to 10 MB.',413);
 if(mime===legacySlidesMime&&!legacySlidesEnabled())throw new BetaHttpError('Legacy PowerPoint reading is not enabled on this service yet. Keep the original or export a .pptx copy.',415);
 let body='';
 if(mime==='text/plain'){
  body=new TextDecoder('utf-8',{fatal:true}).decode(buffer);if(body.length>80000||body.includes('\0'))throw new BetaHttpError('Choose a UTF-8 text file up to 80,000 characters.');
 }else if(!extractedMimes.includes(mime)||!originalSignature(mime,buffer))throw new BetaHttpError('Choose a PDF, Word document, PowerPoint slides or plain text file.',415);
 let source:string=randomUUID();const version=randomUUID(),key=randomUUID(),file=await betaFilePath(user,key),sha256=createHash('sha256').update(buffer).digest('hex');let written=false;
 try{return await tenant(user,async c=>{
  if(!options)await checkObjects(c,user,'sources');
  await ownedBetaCourse(c,user,courseId);
  const vault=(await c.query('SELECT quota_bytes,text_quota_bytes FROM schoolvault.vaults WHERE user_id=$1 FOR UPDATE',[user])).rows[0];if(!vault)throw Error('Vault not found');
  const prepared=options?await options.prepare(c,sha256):{};
  if(prepared.duplicate){
   const current=(await c.query("SELECT current_version FROM schoolvault.sources WHERE user_id=$1 AND id=$2 AND course_id=$3 AND kind='file'",[user,prepared.duplicate.id,courseId])).rows[0];
   const work=current?.current_version?await deriveFileWork(c,user,prepared.duplicate.id,current.current_version):null;
   if(work?.changed)await checkHistory(c,user);return {...prepared.duplicate,unchanged:true};
  }
  if(prepared.source_id){
   if(!uuid(prepared.source_id)||!(await c.query("SELECT id FROM schoolvault.sources WHERE user_id=$1 AND id=$2 AND course_id=$3 AND kind='file' FOR UPDATE",[user,prepared.source_id,courseId])).rowCount)throw new BetaHttpError('Stored file does not belong to this course.',409);
   source=prepared.source_id;
  }else if(options)await checkObjects(c,user,'sources');
  if(extractedMimes.includes(mime)&&Number((await c.query("SELECT count(*) FROM schoolvault.jobs WHERE user_id=$1 AND kind='extract' AND status IN ('queued','leased')",[user])).rows[0].count)>=10)throw new BetaHttpError('Ten documents are waiting to be read. Let them finish before adding more.',429);
  const textBytes=Number((await c.query('SELECT coalesce(sum(octet_length(body)),0) AS used FROM schoolvault.source_versions WHERE user_id=$1',[user])).rows[0].used);
  if(textBytes+Buffer.byteLength(body)>textLimit(vault.text_quota_bytes))throw new BetaHttpError('Your searchable text has reached its beta limit. No file was added.',409);
  // Lock the fixed global budget before writing, across all authenticated accounts.
  const budget=(await c.query('UPDATE schoolvault.storage_budget SET used_bytes=used_bytes+$1 WHERE id=true AND used_bytes+$1<=limit_bytes RETURNING used_bytes',[buffer.length])).rows[0];
  if(!budget)throw new BetaHttpError('File storage is full. No file was added.',409);
  const used=Number((await c.query(`SELECT coalesce(sum(bytes),0) AS used FROM (${storedObjects}) originals`,[user])).rows[0].used);
  if(used+buffer.length>Number(vault.quota_bytes))throw new BetaHttpError('Your vault storage is full. No file was added.',409);
  const disk=await statfs(path.dirname(file));if(Number(disk.bavail)*Number(disk.bsize)<buffer.length+512*1024*1024)throw new BetaHttpError('File storage is full. Your existing files are safe.',409);
  // Counter and file registry commit together; failed uploads roll both back.
  await writeFile(file,buffer,{mode:0o600,flag:'wx'});written=true;
  if(prepared.source_id)await c.query('UPDATE schoolvault.sources SET title=$3,current_version=$4,original_url=$5 WHERE user_id=$1 AND id=$2',[user,source,name,version,prepared.original_url]);
  else await c.query("INSERT INTO schoolvault.sources(user_id,id,course_id,kind,title,current_version,original_url) VALUES($1,$2,$3,'file',$4,$5,$6)",[user,source,courseId,name,version,prepared.original_url||null]);
  await c.query('INSERT INTO schoolvault.source_versions(user_id,id,source_id,body,sha256,object_key,mime,bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[user,version,source,body,sha256,key,mime,buffer.length]);
  await writePassages(c,user,source,version,body);
  await c.query('INSERT INTO schoolvault.audit(user_id,id,action,target) VALUES($1,$2,$3,$4)',[user,randomUUID(),prepared.source_id?'file-updated':'file-added',source]);
  if(extractedMimes.includes(mime))await c.query("INSERT INTO schoolvault.jobs(user_id,id,kind,request_id,input) VALUES($1,$2,'extract',$3,$4)",[user,randomUUID(),randomUUID(),{source_id:source,version_id:version}]);
  if(prepared.afterStore)await prepared.afterStore(c,{source_id:source,version_id:version,sha256});
  await deriveFileWork(c,user,source,version);
  await sourceChanged(c,user,source,version);
  await checkHistory(c,user);
  return {id:source,title:name,course_id:courseId,kind:'file',bytes:buffer.length,mime,searchable:!!body,extraction:body?'complete':'queued'};
 });}catch(error){
  // A lost COMMIT response is ambiguous. Confirm absence before removing an original;
  // if storage is unavailable, retain it for reconciliation rather than risk loss.
  if(written){try{await betaSource(user,source,version);}catch(check){if(check instanceof Error&&check.message==='Source not found')await unlink(file).catch(()=>{});}}
  throw error;
 }
}
export async function readBetaFile(user:string,sourceId:string,versionId?:string){
 const source=await betaSource(user,sourceId,versionId);if(!source.object_key)throw Error('File not found');
 const file=await betaFilePath(user,source.object_key);
 if((await lstat(file)).isSymbolicLink())throw Error('Invalid file store');
 const bytes=await readFile(file);if(createHash('sha256').update(bytes).digest('hex')!==source.sha256)throw Error('Stored file integrity check failed');
 return {source,bytes};
}

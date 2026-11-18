import {randomBytes} from 'node:crypto';
import {readFile,mkdir,open,unlink,writeFile,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {digest} from './auth';
import {tenant} from './db';
import {localAccountAvailable} from './config';
import {BetaHttpError} from './http';

export function localRequestAllowed(request:Request){
 if(!localAccountAvailable())throw new BetaHttpError('Local access is unavailable.',404);
 if(request.headers.get('host')!=='localhost:3228'||request.headers.get('origin')&&request.headers.get('origin')!=='http://localhost:3228'||request.headers.get('sec-fetch-site')==='cross-site')throw new BetaHttpError('Open your local SchoolVault to continue.',403);
}
export async function startLocalSession(){
 if(!localAccountAvailable())throw new BetaHttpError('Local access is unavailable.',404);
 const user=process.env.SCHOOL_LOCAL_USER_ID!,raw=randomBytes(32).toString('base64url');
 await tenant(user,async c=>{
  const row=(await c.query('SELECT schoolvault.local_owner_ready(id) AS ready FROM schoolvault.users WHERE id=$1 FOR UPDATE',[user])).rows[0];
  if(!row?.ready)throw new BetaHttpError('Your local vault needs setup.',503);
  await c.query('DELETE FROM schoolvault.sessions WHERE user_id=$1 AND (expires_at<now() OR revoked_at IS NOT NULL)',[user]);
  if(Number((await c.query('SELECT count(*) FROM schoolvault.sessions WHERE user_id=$1',[user])).rows[0].count)>=100)throw new BetaHttpError('Too many local sessions. Sign out of unused windows first.',429);
  await c.query("INSERT INTO schoolvault.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '30 days')",[digest(raw),user]);
 });
 return raw;
}
function root(){const value=process.env.SCHOOL_LOCAL_ROOT;if(!value||!path.isAbsolute(value))throw new BetaHttpError('Local setup is unavailable.',503);return value;}
async function recoverInterruptedImport(directory:string){
 const lockPath=path.join(directory,'import.lock');
 let handle,metadata,raw:string;
 try{
  handle=await open(lockPath,constants.O_RDONLY|constants.O_NOFOLLOW);
  metadata=await handle.stat({bigint:true});
  if(!metadata.isFile()||typeof process.getuid==='function'&&metadata.uid!==BigInt(process.getuid())||(metadata.mode&BigInt(0o077))!==BigInt(0))return;
  raw=await handle.readFile('utf8');
  const afterRead=await handle.stat({bigint:true});
  if(metadata.ino!==afterRead.ino||metadata.dev!==afterRead.dev||metadata.mtimeNs!==afterRead.mtimeNs||metadata.size!==afterRead.size)return;
 }catch{return;}finally{await handle?.close().catch(()=>{});}
 let lock:any;
 if(raw.trim()){try{lock=JSON.parse(raw);}catch{return;}}
 else{
  // A crash between exclusive creation and its initial metadata write may leave
  // an empty lock. Preserve a new lock and malformed nonempty metadata.
  if(Date.now()-Number(metadata.mtimeMs)<60_000)return;
 }
 // An expired web process may leave a lock. Never release a lock for a live importer.
 if(raw.trim()){
  if(!Number.isSafeInteger(lock?.pid)||lock.pid<=1)return;
  try{process.kill(lock.pid,0);return;}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')return;}
 }
 // Another request may already have replaced the stale lock with a new import.
 // Release only the exact inode and metadata read above.
 let current;try{current=await lstat(lockPath,{bigint:true});}catch{return;}
 if(current.isSymbolicLink()||current.ino!==metadata.ino||current.dev!==metadata.dev||current.mtimeNs!==metadata.mtimeNs||current.size!==metadata.size)return;
 // Do not rewrite status here: a replacement import may write its running state
 // while recovery is checking the old lock. Status derives interruption below.
 await unlink(lockPath).catch(()=>{});
}
export async function localImportStatus(){
 await recoverInterruptedImport(root());
 let state:any={state:'never'};
 try{state=JSON.parse(await readFile(path.join(root(),'import-status.json'),'utf8'));}catch{}
 if(state.state==='running'){
  try{await lstat(path.join(root(),'import.lock'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')state={state:'failed'};}
 }
 let receipt:any={};try{receipt=JSON.parse(await readFile(path.join(root(),'personal-import-receipt.json'),'utf8'));}catch{}
 return {local:true,import:publicImportReceipt(receipt,state)};
}
/** The UI receives coverage counts and safe relative evidence paths only. */
export function publicImportReceipt(receipt:any,state:any={}){
 const safePath=(value:unknown)=>typeof value==='string'&&value.length<=1000&&!path.isAbsolute(value)&&!/[\x00-\x1f]/.test(value)&&!value.split(/[\\/]/).includes('..')&&/^(Courses|Sync)\//.test(value);
 const counts:Record<string,number>={};for(const key of ['courses','notes','sources','files','tasks'])if(Number.isSafeInteger(receipt.counts?.[key])&&receipt.counts[key]>=0)counts[key]=receipt.counts[key];
 const gapRows=Array.isArray(receipt.file_io?.gaps)?[...new Map<string,any>(receipt.file_io.gaps.filter((g:any)=>g&&typeof g.path==='string').map((g:any)=>[g.path,g])).values()]:[];
 const file_io=receipt.file_io?{complete:receipt.file_io.complete===true,gap_count:gapRows.length,elapsed_ms:Number.isFinite(receipt.file_io.elapsed_ms)?receipt.file_io.elapsed_ms:null,gaps:gapRows.filter((g:any)=>safePath(g.path)).slice(0,50).map((g:any)=>({path:g.path,reason:String(g.reason||'file_unavailable').slice(0,80)}))}:null;
 const excluded=Array.isArray(receipt.source_selection?.generated_outputs_excluded)?receipt.source_selection.generated_outputs_excluded:[];
 const generated_outputs_excluded=[...new Set<string>(excluded.filter((g:any)=>g&&safePath(g.path)&&/^Courses\/[^/]+\/Study\/Course calendar\.md$/.test(g.path)).map((g:any)=>g.path))];
 return {state:['running','failed','ready'].includes(state.state)?state.state:receipt.finished_at?'ready':'never',finished_at:receipt.finished_at,counts,file_io,generated_outputs_excluded,skipped_entries:Number.isSafeInteger(receipt.counts?.skipped)&&receipt.counts.skipped>=0?receipt.counts.skipped:0,retained_originals_reused:Number.isSafeInteger(receipt.private_original_reuse?.count)&&receipt.private_original_reuse.count>=0?receipt.private_original_reuse.count:0,warnings:receipt.warning_count?['Some saved material has import limitations. The import report retains the details.']:[]};
}

export async function refreshLocalImport(){
 const directory=root(),command=process.env.SCHOOL_LOCAL_IMPORT_COMMAND;
 if(!command)throw new BetaHttpError('Refresh is unavailable until local setup finishes.',503);
 const args=JSON.parse(command);if(!Array.isArray(args)||args.length<2||args.some(v=>typeof v!=='string'))throw new BetaHttpError('Local setup is unavailable.',503);
 await mkdir(directory,{recursive:true,mode:0o700});
 await recoverInterruptedImport(directory);
 const lockPath=path.join(directory,'import.lock'),token=randomBytes(16).toString('hex');let lock;
 const ownsLock=async()=>{try{return JSON.parse(await readFile(lockPath,'utf8')).token===token;}catch{return false;}};
 try{lock=await open(lockPath,'wx',0o600);}catch{throw new BetaHttpError('A personal-vault refresh is already running.',409);}
 try{await lock.writeFile(JSON.stringify({pid:process.pid,started_at:new Date().toISOString(),phase:'starting',token}));}finally{await lock.close();}
 try{
  await writeFile(path.join(directory,'import-status.json'),JSON.stringify({state:'running'}),{mode:0o600});
  const log=await open(path.join(directory,'import.log'),'a',0o600);
  const child=spawn(args[0],args.slice(1),{env:{...process.env},stdio:['ignore',log.fd,log.fd]});
  let finished=false,timedOut=false;
  const metadata=child.pid?writeFile(lockPath,JSON.stringify({pid:child.pid,started_at:new Date().toISOString(),token}),{mode:0o600}):Promise.resolve();
  const timeout=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');const force=setTimeout(()=>{if(!finished)child.kill('SIGKILL');},5000);force.unref();},15*60*1000);timeout.unref();
  const finish=async(ok:boolean)=>{if(finished)return;finished=true;clearTimeout(timeout);try{await metadata.catch(()=>{});if(await ownsLock())await writeFile(path.join(directory,'import-status.json'),JSON.stringify({state:ok&&!timedOut?'ready':'failed'}),{mode:0o600});}finally{if(await ownsLock())await unlink(lockPath).catch(()=>{});await log.close();}};
  child.once('error',()=>{void finish(false).catch(()=>{});});child.once('exit',code=>{void finish(code===0).catch(()=>{});});
  await metadata;
 }catch(error){if(await ownsLock())await unlink(lockPath).catch(()=>{});throw error;}
 return {refreshing:true};
}

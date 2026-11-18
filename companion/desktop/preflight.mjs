import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,lstat,readdir} from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';
import {PROTOCOL,SCHEMA} from './protocol.mjs';
import {webOrigin} from './handoff.mjs';
// A failed file check must not skip restoring the saved connection on retry.
// Mark the restore complete only after its encrypted state was read successfully.
export function createStartupCheck({verify,load,check}){
 let loaded=false;
 return async()=>{
  await verify();
  if(!loaded){try{await load();loaded=true;}catch(error){error.savedConnection=true;throw error;}}
  return check();
 };
}
export async function verifyDelivery(runtimeRoot,appRoot){
 const manifest=JSON.parse(await readFile(path.join(appRoot,'integrity.json'),'utf8'));
 const installer=manifest.format===2&&manifest.delivery==='installer';
 if(!Array.isArray(manifest.runtime)||!Array.isArray(manifest.sources)||(!installer&&manifest.runtime.length!==71)||(installer&&manifest.runtime.length!==0)||manifest.sources.length<10||manifest.sources.length>100||!Array.isArray(manifest.dependencies)||manifest.dependencies.length>20000)throw Error('The integrity record is incomplete. Copy a fresh complete package.');
 async function verify(root,records){const seen=new Set();for(const record of records){
  if(typeof record.path!=='string'||!record.path||record.path.includes('\\')||record.path.split('/').some(p=>!p||p==='.'||p==='..')||path.isAbsolute(record.path)||seen.has(record.path)||!/^[a-f0-9]{64}$/.test(record.sha256))throw Error('Invalid integrity record.');
  seen.add(record.path);const file=path.join(root,...record.path.split('/')),st=await lstat(file);if(!st.isFile()||st.isSymbolicLink())throw Error('Invalid package file: '+record.path);
  const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);if(hash.digest('hex')!==record.sha256)throw Error('File check failed: '+record.path+'. Copy a fresh complete package.');
 }return seen;}
 const runtime=await verify(runtimeRoot,manifest.runtime);await verify(appRoot,[...manifest.sources,...manifest.dependencies]);
 async function scan(folder,prefix=''){for(const entry of await readdir(folder,{withFileTypes:true})){const rel=prefix+entry.name;if(entry.isSymbolicLink())throw Error('Unexpected package link.');if(rel==='resources/app.asar')continue;if(entry.isDirectory())await scan(path.join(folder,entry.name),rel+'/');else if(rel!=='resources/app.asar'&&!runtime.has(rel))throw Error('Unexpected package file: '+rel+'. Use a clean extracted folder.');}}
 if(!installer)await scan(runtimeRoot);
 return {runtime:manifest.runtime.length,sources:manifest.sources.length,dependencies:manifest.dependencies.length,signature:'NotVerified',delivery:installer?'installer':'portable'};
}
export async function serviceCheck(origin,fetcher=fetch){
 try{const r=await fetcher(origin+'/api/beta/health',{signal:AbortSignal.timeout(15000),redirect:'error'});const d=await r.json();if(r.ok&&d.service==='SchoolVault'&&d.storage==='ready'&&(d.release?.protocol!==PROTOCOL||d.release?.schema<SCHEMA))return {ok:false,label:'The website and this Companion are different releases. The operator must finish the Neyvu update before setup.'};return r.ok&&d.service==='SchoolVault'&&d.process==='running'&&d.storage==='ready'?{ok:true,label:'Neyvu '+d.release.version+' · compatible service and storage',release:d.release,web:webOrigin(d.web_origin)||origin}:{ok:false,label:'Neyvu service is not ready. Retry in a moment.'};}
 catch{return {ok:false,label:'Could not reach Neyvu securely. Check internet and retry.'};}
}
export async function edgeExecutable(platform=process.platform,env=process.env,home=homedir(),stat=lstat){
 const candidates=platform==='win32'
  ?[env.PROGRAMFILES,env['PROGRAMFILES(X86)'],env.LOCALAPPDATA].filter(Boolean).map(root=>path.join(root,'Microsoft/Edge/Application/msedge.exe'))
  :platform==='darwin'
   ?['/Applications',path.join(home,'Applications')].map(root=>path.join(root,'Microsoft Edge.app/Contents/MacOS/Microsoft Edge'))
   :[];
 for(const file of candidates)try{const st=await stat(file);if(st.isFile()&&!st.isSymbolicLink())return file;}catch{}
 return null;
}
export async function edgeInstalled(platform=process.platform,env=process.env){return !!await edgeExecutable(platform,env);}
export async function moodleBrowser(platform=process.platform,env=process.env,home=homedir(),stat=lstat){
 const edge=await edgeExecutable(platform,env,home,stat);
 if(edge)return {name:'Microsoft Edge',executablePath:edge};
 if(platform==='darwin')for(const root of ['/Applications',path.join(home,'Applications')]){
  const file=path.join(root,'Google Chrome.app/Contents/MacOS/Google Chrome');
  try{const st=await stat(file);if(st.isFile()&&!st.isSymbolicLink())return {name:'Google Chrome',executablePath:file};}catch{}
 }
 return null;
}

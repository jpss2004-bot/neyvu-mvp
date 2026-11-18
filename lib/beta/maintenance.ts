import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {release} from './release';

export const maintenanceFormat='neyvu-maintenance/1';
export type MaintenanceState={held:false}|{held:true;valid:boolean};

// Only the School operator can create this private, persistent marker. It is
// outside the originals directory and cannot be uploaded or changed through an API.
export function maintenancePath(){
 const root=process.env.SCHOOL_BETA_FILE_ROOT;
 if(process.env.SCHOOL_BETA_LOCAL==='1'&&root&&path.isAbsolute(root)&&root!=='/var/schoolvault/files')
  return path.join(path.dirname(root),'.neyvu-maintenance.json');
 return '/var/schoolvault/.neyvu-maintenance.json';
}
export async function maintenanceState():Promise<MaintenanceState>{
 let file;
 try{
  file=await open(maintenancePath(),constants.O_RDONLY|constants.O_NOFOLLOW);
  const info=await file.stat();
  if(!info.isFile()||info.nlink!==1||info.size>1024||(info.mode&0o022)!==0)return {held:true,valid:false};
  const buffer=Buffer.alloc(1025),{bytesRead}=await file.read(buffer,0,buffer.length,0);
  if(bytesRead>1024)return {held:true,valid:false};
  const marker=JSON.parse(buffer.subarray(0,bytesRead).toString('utf8'));
  const valid=marker?.format===maintenanceFormat&&marker?.schema===release.schema&&marker?.version===release.version
   &&typeof marker?.id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(marker.id)
   &&Object.keys(marker).sort().join(',')==='format,id,schema,version';
  return {held:true,valid};
 }catch(error){
  if(error&&typeof error==='object'&&'code' in error&&error.code==='ENOENT')return {held:false};
  // A malformed, unreadable or symlinked marker must never release traffic.
  return {held:true,valid:false};
 }finally{await file?.close();}
}

export function maintenanceResponse(pathname:string,state:Extract<MaintenanceState,{held:true}>){
 const headers={'Cache-Control':'private, no-store','Retry-After':'30','X-Neyvu-Maintenance':'1'};
 if(pathname==='/api/beta/health')return Response.json({service:'Neyvu',process:'running',storage:'unchecked',maintenance:true,release},
  {status:state.valid?200:503,headers});
 if(pathname.startsWith('/api/'))return Response.json({error:'Neyvu is updating. Please try again shortly.',maintenance:true},{status:503,headers});
 return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Neyvu is updating</title><link rel="icon" href="/brand/favicon.svg"><style>html{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;font:17px/1.6 system-ui,sans-serif;background:#f5f6f8;color:#182032;display:grid;min-height:100svh;place-items:center;padding:24px}main{width:100%;max-width:520px;border:1px solid #dce0e7;border-radius:20px;background:#fff;padding:32px}img{width:132px;height:auto}h1{font-size:clamp(26px,5vw,34px);line-height:1.2;margin:28px 0 16px}p{margin:0 0 24px}a{display:inline-block;background:#293d78;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none}a:focus-visible{outline:3px solid #687fc0;outline-offset:4px}@media(prefers-color-scheme:dark){body{background:#101625;color:#eef1f8}main{background:#172033;border-color:#35415b}img{filter:brightness(0) invert(1)}}@media(prefers-reduced-motion:no-preference){main{animation:appear .25s ease-out}@keyframes appear{from{opacity:0;transform:translateY(6px)}}}</style></head><body><main><img src="/brand/neyvu-wordmark-light.svg" alt="Neyvu"><h1>We’re updating Neyvu</h1><p>Access is temporarily paused while we finish an update. Please check again in a few minutes.</p><a href="/beta/join">Check again</a></main></body></html>`,
  {status:503,headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});
}

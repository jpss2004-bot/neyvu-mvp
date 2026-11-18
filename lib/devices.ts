import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
export type MiniNetwork={state:'online'|'offline'|'unavailable';checked_at:string;worker_commissioned:boolean};
export function miniPresence(status:{BackendState?:string;Peer?:Record<string,{DNSName?:string;Online?:boolean}>},checked_at=new Date().toISOString(),commissioned=false):MiniNetwork{
 const peer=Object.values(status.Peer||{}).find(p=>p.DNSName==='worker-host.example-tailnet.ts.net.');
 return {state:status.BackendState!=='Running'||!peer?'unavailable':peer.Online?'online':'offline',checked_at,worker_commissioned:commissioned};
}
let cache:MiniNetwork|undefined;
let pending:Promise<MiniNetwork>|undefined;
export async function miniNetwork(){
 if(cache&&Date.now()-Date.parse(cache.checked_at)<60000)return cache;
 if(pending)return pending;
 pending=(async()=>{
 let commissioned=false;
 // Optional operator record that the answer worker was commissioned; absent means not commissioned.
 try{const recordPath=process.env.SCHOOL_WORKER_CUTOVER_RECORD;if(recordPath){const record=JSON.parse(await readFile(recordPath,'utf8'));commissioned=record.status==='verified';}}catch{}
 return new Promise<MiniNetwork>(resolve=>execFile('/usr/local/bin/tailscale',['status','--json'],{timeout:5000,maxBuffer:1000000},(error,out)=>{
   try{cache=error?miniPresence({},undefined,commissioned):miniPresence(JSON.parse(out),undefined,commissioned);}catch{cache=miniPresence({},undefined,commissioned);}
   resolve(cache);
 }));})().finally(()=>{pending=undefined;});
 return pending;
}

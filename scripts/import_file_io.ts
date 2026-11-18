import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';import {unlink} from 'node:fs/promises';
export class ImportFileGap extends Error{constructor(public code:string,public file:string,public operation:string){super('File unavailable ('+code+'): '+file);}}
export type ImportIOGap={path:string;operation:string;reason:string};
export function importFileIO(options:{fileMs?:number;budgetMs?:number;worker?:string}={}){
 const started=performance.now(),fileMs=options.fileMs??2000,budgetMs=options.budgetMs??180000,worker=options.worker??fileURLToPath(new URL('./import_file_io.mjs',import.meta.url));const gaps:ImportIOGap[]=[];
 async function run(input:{root:string;relative:string;operation?:string;text?:boolean;control?:boolean;expectedSha?:string;destinationRoot?:string;destination?:string;basename?:string}){
  const operation=input.operation||'inspect',remaining=budgetMs-(performance.now()-started),gap=(reason:string)=>{gaps.push({path:input.relative,operation,reason});return new ImportFileGap(reason,input.relative,operation);};
  if(remaining<=0)throw gap('refresh_budget_exhausted');
  return new Promise<{path:string;bytes:number;sha256:string;text?:string}>((resolve,reject)=>{
   const child=spawn(process.execPath,[worker],{stdio:['pipe','pipe','pipe']}),chunks:Buffer[]=[];let size=0,timed=false,settled=false;let grace:ReturnType<typeof setTimeout>|undefined;let termination:ImportIOGap&{child_pid:number;termination:string}|undefined;
   const reason=remaining<=fileMs?'refresh_budget_exhausted':'file_timeout';
   const timer=setTimeout(()=>{timed=true;child.kill('SIGKILL');grace=setTimeout(()=>{termination={path:input.relative,operation,reason,child_pid:child.pid||0,termination:'pending'};gaps.push(termination);child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();child.unref();void finish(new ImportFileGap(reason,input.relative,operation));},200);},Math.min(fileMs,remaining));
   child.stdout.on('data',b=>{size+=b.length;if(size>(input.control?32*1024**2:500000)){timed=true;child.kill('SIGKILL');}else chunks.push(b);});child.stderr.resume();child.stdin.on('error',()=>{});
   const finish=async(error?:Error,value?:any)=>{if(settled)return;settled=true;clearTimeout(timer);if(grace)clearTimeout(grace);if(error&&input.destination&&Buffer.concat(chunks).toString().split('\n').some(line=>{try{const e=JSON.parse(line);return e.event==='owned_temp'&&e.path===input.destination;}catch{return false;}}))await unlink(input.destination).catch(()=>{});error?reject(error):resolve(value);};
   child.on('error',()=>void finish(gap('file_worker_unavailable')));child.on('close',()=>{if(termination)termination.termination='reaped';if(settled)return;if(timed){void finish(gap(remaining<=fileMs?'refresh_budget_exhausted':'file_timeout'));return;}try{const v=JSON.parse(Buffer.concat(chunks).toString().split('\n').filter(line=>line.trim()).at(-1)!);if(!v.ok)void finish(gap(String(v.code||'read_failed').toLowerCase()));else void finish(undefined,v);}catch{void finish(gap('invalid_file_result'));}});
   child.stdin.end(JSON.stringify(input));
  });
 }
 return {run,gaps,elapsed:()=>performance.now()-started};
}

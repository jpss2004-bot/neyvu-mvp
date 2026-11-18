import { execFile } from 'node:child_process';
import path from 'node:path';
export function bridge(action:string,payload:Record<string,unknown>={}) : Promise<any> {
  const python=process.env.SCHOOL_PYTHON;
  if(!python)throw new Error('School runtime is not configured');
  return new Promise((resolve,reject)=>{
    const child=execFile(python,[path.join(process.cwd(),'scripts/pilot_bridge.py'),action],{timeout:60000,maxBuffer:8_000_000},(error,stdout)=>{
      if(error){reject(new Error('School source service could not complete this request'));return;}
      try{const result=JSON.parse(stdout);result.error?reject(new Error(result.error)):resolve(result);}catch{reject(new Error('School source response was unreadable'));}
    });
    child.stdin?.end(JSON.stringify(payload));
  });
}

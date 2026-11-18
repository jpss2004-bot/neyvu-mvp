import {execFile} from 'node:child_process';import path from 'node:path';
import type {ReplyPresentation} from './replies';
export async function verifyReply(reply:ReplyPresentation,question:string,sources:unknown[],course:string):Promise<ReplyPresentation>{
 const python=process.env.SCHOOL_PYTHON;if(!python)throw Error('Answer verification is unavailable. Your question is saved.');
 return new Promise((resolve,reject)=>{const child=execFile(python,[path.join(process.cwd(),'scripts/guard_reply.py')],{timeout:15000,maxBuffer:100000},(e,out)=>{if(e)return reject(Error('Answer verification could not finish. Your question is saved; try again.'));try{resolve(JSON.parse(out));}catch{reject(Error('The verified answer could not be read.'));}});child.stdin?.end(JSON.stringify({reply,question,sources,course:{code:course},now:new Date().toISOString()}));});
}

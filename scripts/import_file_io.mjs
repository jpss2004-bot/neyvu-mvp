// Dedicated, killable filesystem child. Source contents are data, never code.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
let input='';for await(const b of process.stdin)input+=b;if(input.length>16000)throw Error('Oversized file operation');
const x=JSON.parse(input),inside=(r,p)=>p!==r&&!path.relative(r,p).startsWith('..'+path.sep)&&!path.isAbsolute(path.relative(r,p));
let pending=null;
try{
 const root=fs.realpathSync(x.root),candidate=path.resolve(root,x.relative);if(!inside(root,candidate)||fs.lstatSync(candidate).isSymbolicLink())throw Object.assign(Error(),{code:'UNSAFE_PATH'});
 const file=fs.realpathSync(candidate),stat=fs.statSync(file);if(!inside(root,file)||!stat.isFile())throw Object.assign(Error(),{code:'NOT_REGULAR'});if(stat.size>300*1024**2)throw Object.assign(Error(),{code:'TOO_LARGE'});
 let target=null;if(x.operation==='copy'){
  const destRoot=fs.realpathSync(x.destinationRoot),parent=fs.realpathSync(path.dirname(x.destination));if(!inside(destRoot,parent)||path.basename(x.destination)!==x.basename)throw Object.assign(Error(),{code:'UNSAFE_DESTINATION'});
  target=fs.openSync(x.destination,'wx',0o600);pending=x.destination;process.stdout.write(JSON.stringify({event:'owned_temp',path:pending})+'\n');
 }
 const textLimit=x.control?8*1024**2:320004,charLimit=x.control?8*1024**2:80000;const fd=fs.openSync(file,'r'),hash=crypto.createHash('sha256'),parts=[];let textBytes=0,bytes=0;
 try{const buffer=Buffer.allocUnsafe(128*1024);for(;;){const n=fs.readSync(fd,buffer,0,buffer.length,null);if(!n)break;bytes+=n;if(bytes>300*1024**2)throw Object.assign(Error(),{code:'TOO_LARGE'});const b=buffer.subarray(0,n);hash.update(b);if(target!==null){let offset=0;while(offset<b.length){const written=fs.writeSync(target,b,offset,b.length-offset);if(written<=0)throw Object.assign(Error(),{code:'COPY_FAILED'});offset+=written;}}if(x.text&&textBytes<textLimit){const p=Buffer.from(b.subarray(0,textLimit-textBytes));parts.push(p);textBytes+=p.length;}}
 }finally{fs.closeSync(fd);if(target!==null){fs.fsyncSync(target);fs.closeSync(target);}}
 const after=fs.statSync(file),digest=hash.digest('hex');if(bytes!==stat.size||after.size!==stat.size||after.mtimeMs!==stat.mtimeMs||after.ino!==stat.ino||x.expectedSha&&digest!==x.expectedSha)throw Object.assign(Error(),{code:'SOURCE_CHANGED'});
 if(pending){const copied=crypto.createHash('sha256'),fd=fs.openSync(pending,'r'),buffer=Buffer.allocUnsafe(128*1024);try{for(;;){const n=fs.readSync(fd,buffer,0,buffer.length,null);if(!n)break;copied.update(buffer.subarray(0,n));}}finally{fs.closeSync(fd);}if(copied.digest('hex')!==digest)throw Object.assign(Error(),{code:'COPY_HASH_MISMATCH'});}
 process.stdout.write(JSON.stringify({ok:true,path:file,bytes,sha256:digest,text:x.text?Buffer.concat(parts).toString('utf8').slice(0,charLimit).replace(/[\uD800-\uDBFF]$/,''):undefined}));pending=null;
}catch(error){if(pending)try{fs.unlinkSync(pending);}catch{}process.stdout.write(JSON.stringify({ok:false,code:error.code||'READ_FAILED'}));process.exitCode=1;}

// Trusted main-process controller. Renderer never supplies an export path or
// receives original bytes. Save dialog cancellation never changes the journal.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function createOriginalRecovery({journal,chooseDestination,reveal=(_file)=>{}}){
 if(!journal||typeof chooseDestination!=='function')throw Error('Original recovery is unavailable.');
 let busy=false;
 const exclusive=async task=>{if(busy)throw Error('Finish the current original recovery first.');busy=true;try{return await task();}finally{busy=false;}};
 return {
  list:()=>exclusive(()=>journal.listRetained()),
  exportOriginal:selection=>exclusive(async()=>{
   if(!selection||typeof selection!=='object'||Array.isArray(selection)||Object.keys(selection).length!==3||!['key','recovery_handle','sha256'].every(k=>Object.hasOwn(selection,k))||!hex(selection.key)||!hex(selection.sha256)||typeof selection.recovery_handle!=='string')throw Error('Choose a retained PDF from this computer.');
   const list=await journal.listRetained(),row=list.items.find(r=>r.key===selection.key&&r.recovery_handle===selection.recovery_handle&&r.sha256===selection.sha256);if(!row)throw Error('That original could not be verified. Keep its retained record and try reviewing originals again.');
   const recovered=await journal.recoverOriginal({key:row.key,recoveryHandle:row.recovery_handle,sha256:row.sha256});
   if(sha(recovered.original)!==row.sha256||recovered.original_cleanup_allowed!==false)throw Error('The retained original did not pass its hash check.');
   const title=row.title.replace(/\.pdf$/i,'').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g,' ').trim().slice(0,100)||'Neyvu original';
   const dest=await chooseDestination({defaultName:title+'-original-'+row.sha256.slice(0,8)+'.pdf',title:row.title,sha256:row.sha256,bytes:row.bytes});
   if(dest===null||dest===undefined)return {saved:false,cancelled:true,original_retained:true};
   if(typeof dest!=='string'||!path.isAbsolute(dest)||!dest.toLowerCase().endsWith('.pdf'))throw Error('Choose a new PDF filename in the save dialog.');
   let handle,created=false,identity;
   try{handle=await fs.open(dest,'wx',0o600);created=true;identity=await handle.stat();await handle.writeFile(recovered.original);await handle.sync();await handle.close();handle=null;
    const check=await fs.lstat(dest);if(!check.isFile()||check.isSymbolicLink()||check.ino!==identity.ino||check.dev!==identity.dev||sha(await fs.readFile(dest))!==row.sha256)throw Error('The saved copy could not be verified. The retained original is still available.');
   }catch(e){await handle?.close();if(created){const current=await fs.lstat(dest).catch(()=>null);if(current&&current.ino===identity?.ino&&current.dev===identity?.dev)await fs.unlink(dest).catch(()=>{});}if(e.code==='EEXIST')throw Error('That filename already exists. Choose a new filename; the existing file was kept.');throw e;}
   // A Finder/reveal failure must not relabel a verified copy as a failed save.
   let revealed=true;try{await reveal(dest);}catch{revealed=false;}
   return {saved:true,name:path.basename(dest),sha256:row.sha256,bytes:row.bytes,original_retained:true,revealed};
  }),
 };
}

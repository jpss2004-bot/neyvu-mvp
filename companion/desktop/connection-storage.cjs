// OS-protected pairing storage. Diagnostics contain stages, never decrypted
// values, native error messages, tokens, account identifiers or file paths.
const fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const messages={
 read_failed:'Neyvu could not read the saved connection file. Your connection has not been reset. Check access to this Mac account, then choose Check setup again.',
 encryption_unavailable:'This computer’s secure storage is unavailable. Unlock your normal Mac or Windows session, then choose Check setup again. Your saved connection is kept.',
 decrypt_failed:'This app could not unlock the saved connection. Your saved copy is kept. Choose Check setup again; if it still fails, review connection recovery before reconnecting.',
 invalid_state:'The saved connection could be unlocked, but its contents could not be read. Your saved copy is kept. Review connection recovery before reconnecting.',
 write_failed:'Neyvu could not save the protected connection. The previous saved copy is kept. Check available storage and access, then try again.'
};
function failure(code){const error=Error(messages[code]);error.savedConnection=true;error.connectionStorageCode=code;return error;}
function createConnectionStorage({root,safeStorage,io=fs}){
 const file=path.join(root,'connection.bin');let pending=Promise.resolve();
 async function existing(){try{const stat=await io.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw failure('read_failed');return true;}catch(error){if(error.code==='ENOENT')return false;throw failure('read_failed');}}
 function available(){try{if(safeStorage.isEncryptionAvailable())return;}catch{}throw failure('encryption_unavailable');}
 async function load(){
  await pending.catch(()=>{});if(!await existing())return null;
  let bytes;try{bytes=await io.readFile(file);}catch{throw failure('read_failed');}
  available();let decoded;try{decoded=safeStorage.decryptString(bytes);}catch{throw failure('decrypt_failed');}
  let state;try{state=JSON.parse(decoded);}catch{throw failure('invalid_state');}
  if(!state||typeof state!=='object'||Array.isArray(state)||typeof state.token!=='string'||!state.token)throw failure('invalid_state');
  return state;
 }
 function save(state){
  const snapshot=state===null?null:JSON.stringify(state);
  const next=pending.catch(()=>{}).then(async()=>{
   await existing();
   if(snapshot===null){try{await io.unlink(file);}catch(error){if(error.code!=='ENOENT')throw failure('write_failed');}return;}
   available();let encrypted;try{encrypted=safeStorage.encryptString(snapshot);}catch{throw failure('encryption_unavailable');}
   const temporary=path.join(root,'connection.'+randomUUID()+'.tmp');
   try{await io.writeFile(temporary,encrypted,{mode:0o600,flag:'wx'});await io.rename(temporary,file);}
   catch{throw failure('write_failed');}
   finally{await io.unlink(temporary).catch(()=>{});}
  });pending=next;return next;
 }
 return {load,save};
}
module.exports={createConnectionStorage};

// Browser-only capture journal. Account namespaces prevent mixing saved work
// in the interface; private server authorization remains the security boundary.
export const captureLimits={chunkBytes:4194304,totalBytes:134217728,chunks:1024,durationMs:7200000,localBytes:268435456};
const account=user=>{if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(user))throw Error('Refresh your signed-in account before recording.');return 'schoolvault-class-v1:'+user;};
export async function beginCaptureLock(user){
 if(!navigator.locks)throw Error('Use an updated browser to protect recordings across tabs.');
 return new Promise((resolve,reject)=>{void navigator.locks.request(account(user)+':capture',{ifAvailable:true},lock=>{
  if(!lock){reject(Error('A recording or import is open in another tab. Finish it there first.'));return;}
  return new Promise(release=>resolve(release));
 }).catch(reject);});
}
export async function recoverCaptures(user){
 const rows=await listCaptures(user),locks=navigator.locks?await navigator.locks.query():null;
 if(!locks||locks.held.some(lock=>lock.name===account(user)+':capture'))return rows;
 for(const row of rows)if(row.state==='capturing'&&row.mode==='recording')await updateCapture(user,row.id,{state:'stopped',interrupted:true});
 return listCaptures(user);
}
async function database(user){return new Promise((resolve,reject)=>{
 let blocked=false;const request=indexedDB.open(account(user),1);
 request.onupgradeneeded=()=>{const db=request.result;db.createObjectStore('captures',{keyPath:'id'});const parts=db.createObjectStore('chunks',{keyPath:['capture_id','sequence']});parts.createIndex('capture','capture_id');};
 request.onerror=()=>reject(Error('Browser storage could not open. Use another browser or free storage before recording.'));
 request.onblocked=()=>{blocked=true;reject(Error('Close older recording tabs and try again.'));};
 request.onsuccess=()=>{if(blocked){request.result.close();return;}request.result.onversionchange=()=>request.result.close();resolve(request.result);};
});}
async function transaction(user,stores,write,configure){const db=await database(user);return new Promise((resolve,reject)=>{
 let tx,result,reason;
 try{tx=db.transaction(stores,write?'readwrite':'readonly',write?{durability:'strict'}:undefined);}catch{db.close();reject(Error('This browser cannot safely save recordings. Try an updated browser.'));return;}
 tx.oncomplete=()=>{db.close();resolve(result);};tx.onabort=()=>{db.close();reject(reason||Error('Recording could not be saved in this browser. Free storage and keep this tab open.'));};tx.onerror=()=>{};
 const finish=value=>{result=value;},fail=error=>{reason=error;tx.abort();};
 try{configure(tx,finish,fail);}catch(error){fail(error);}
});}
export async function captureHash(blob){const value=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());return Array.from(new Uint8Array(value),b=>b.toString(16).padStart(2,'0')).join('');}
export function listCaptures(user){return transaction(user,['captures'],false,(tx,done)=>{tx.objectStore('captures').getAll().onsuccess=e=>done(e.target.result);});}
export function getCapture(user,id){return transaction(user,['captures'],false,(tx,done)=>{tx.objectStore('captures').get(id).onsuccess=e=>done(e.target.result);});}
export function captureChunks(user,id){return transaction(user,['chunks'],false,(tx,done)=>{tx.objectStore('chunks').index('capture').getAll(id).onsuccess=e=>done(e.target.result.sort((a,b)=>a.sequence-b.sequence));});}
export async function newCapture(user,input,mode='recording',original=null){
 const id=crypto.randomUUID(),now=new Date().toISOString();
 return transaction(user,['captures'],true,(tx,done,fail)=>{const store=tx.objectStore('captures');store.getAll().onsuccess=e=>{
  const used=e.target.result.reduce((n,c)=>n+c.bytes+(c.original?.size||0),0);
  if(e.target.result.length>=20||used+(original?.size||0)*2>captureLimits.localBytes||(original&&original.size>captureLimits.totalBytes)){fail(Error('Local recording storage is full. Save and remove older browser copies first.'));return;}
  const capture={id,input:{...input,request_id:id},mode,original,state:'capturing',bytes:0,count:0,duration_ms:0,remote_id:null,created_at:now,updated_at:now};store.add(capture);done(capture);
 };});
}
export async function appendCaptureChunk(user,id,sequence,blob,durationMs){
 if(!(blob instanceof Blob)||!blob.size||blob.size>captureLimits.chunkBytes||!Number.isSafeInteger(sequence)||sequence<0||sequence>=captureLimits.chunks)throw Error('This recording chunk exceeds its limit. Keep the saved audio.');
 const sha256=await captureHash(blob);
 return transaction(user,['captures','chunks'],true,(tx,done,fail)=>{const store=tx.objectStore('captures'),chunks=tx.objectStore('chunks');store.get(id).onsuccess=e=>{
  const capture=e.target.result;if(!capture||capture.state!=='capturing'){fail(Error('This recording is no longer accepting audio.'));return;}
  chunks.get([id,sequence]).onsuccess=old=>{
   if(old.target.result){if(old.target.result.sha256!==sha256){fail(Error('Saved audio differs from this retry. Preserve the original.'));return;}done(capture);return;}
   if(sequence!==capture.count||capture.bytes+blob.size>captureLimits.totalBytes){fail(Error('This recording has reached its limit or is missing an earlier chunk.'));return;}
   store.getAll().onsuccess=all=>{
    const used=all.target.result.reduce((n,c)=>n+c.bytes+(c.original?.size||0),0);
    if(used+blob.size>captureLimits.localBytes){fail(Error('Browser recording storage is full. Keep the saved audio and free storage.'));return;}
    chunks.add({capture_id:id,sequence,blob,sha256,bytes:blob.size});const updated={...capture,bytes:capture.bytes+blob.size,count:capture.count+1,duration_ms:Math.max(capture.duration_ms,Math.min(captureLimits.durationMs,Math.ceil(durationMs))),updated_at:new Date().toISOString()};store.put(updated);done(updated);
   };
  };
 };});
}
export function updateCapture(user,id,changes){return transaction(user,['captures'],true,(tx,done,fail)=>{const store=tx.objectStore('captures');store.get(id).onsuccess=e=>{const old=e.target.result;if(!old){fail(Error('Saved recording not found in this browser.'));return;}const row={...old,...changes,id:old.id,input:old.input,bytes:old.bytes,count:old.count,updated_at:new Date().toISOString()};store.put(row);done(row);};});}
export async function finishCaptureImport(user,id,durationMs){
 if(!Number.isSafeInteger(durationMs)||durationMs<1||durationMs>captureLimits.durationMs)throw Error('Choose a recording length up to two hours.');
 let row=await getCapture(user,id);if(!row?.original)throw Error('The original import is no longer available.');
 const original=row.original;
 for(let seq=0,offset=0;offset<original.size;offset+=captureLimits.chunkBytes,seq++)row=await appendCaptureChunk(user,id,seq,original.slice(offset,offset+captureLimits.chunkBytes),durationMs);
 if(row.bytes!==original.size)throw Error('The audio import is incomplete. Keep its original file.');
 return updateCapture(user,id,{state:'stopped',original:null,duration_ms:durationMs});
}
export async function localCaptureBlob(user,id){const row=await getCapture(user,id),parts=await captureChunks(user,id);if(!row||parts.length!==row.count||parts.some((p,i)=>p.sequence!==i))throw Error('Some local audio is missing. Keep this recording for recovery.');for(const p of parts)if(await captureHash(p.blob)!==p.sha256)throw Error('Saved local audio failed its integrity check.');return new Blob(parts.map(p=>p.blob),{type:row.input.mime});}
export function removeLocalCapture(user,id){return transaction(user,['captures','chunks'],true,(tx,done,fail)=>{const store=tx.objectStore('captures'),parts=tx.objectStore('chunks');store.get(id).onsuccess=e=>{
 if(e.target.result?.state!=='uploaded'&&!(e.target.result?.state==='stopped'&&e.target.result?.count===0)){fail(Error('Save the complete recording to your vault before removing this browser copy.'));return;}
 parts.index('capture').openCursor(id).onsuccess=e=>{const cursor=e.target.result;if(cursor){cursor.delete();cursor.continue();}else{store.delete(id);done(true);}};
 };});}
async function api(user,path,options={}){const response=await fetch(path,{...options,credentials:'same-origin',headers:{...options.headers,'X-Class-Account':user},signal:AbortSignal.timeout(20000)});const body=await response.json().catch(()=>({}));if(!response.ok)throw Object.assign(Error(body.error||'Upload could not finish. The browser copy is kept; try again.'),{status:response.status});return body;}
export async function uploadCapture(user,id,progress=(_value)=>{}){
 const work=async()=>{
  let row=await getCapture(user,id);if(!row||row.state==='capturing'||row.original||!row.count||!row.duration_ms)throw Error('Stop recording or finish the import before saving it to your vault.');
  const parts=await captureChunks(user,id);if(parts.length!==row.count||parts.some((p,i)=>p.sequence!==i))throw Error('Some local audio is missing. Preserve the browser copy.');
  if(!row.remote_id){const remote=await api(user,'/api/beta/classes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'create',...row.input})});if(remote.user_id!==user)throw Error('Your signed-in account changed. Stop and reload before uploading.');row=await updateCapture(user,id,{remote_id:remote.id});}
  const remote=await api(user,'/api/beta/classes?id='+encodeURIComponent(row.remote_id));if(remote.user_id!==user)throw Error('Your signed-in account changed. Reload before uploading.');
  const saved=new Map(remote.chunks.map(c=>[c.sequence,c]));let confirmed=0;
  for(const part of parts){if(await captureHash(part.blob)!==part.sha256)throw Error('Local audio failed its integrity check. Preserve the browser copy.');const existing=saved.get(part.sequence);
   if(existing){if(existing.sha256!==part.sha256||existing.bytes!==part.bytes)throw Error('The saved vault audio differs. Preserve both copies and check the connection.');}
   else await api(user,'/api/beta/classes/audio?id='+encodeURIComponent(row.remote_id)+'&sequence='+part.sequence,{method:'POST',headers:{'Content-Type':row.input.mime,'X-Audio-SHA256':part.sha256},body:part.blob});
   confirmed++;progress({confirmed,total:parts.length});
  }
  const sealed=await api(user,'/api/beta/classes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'seal',id:row.remote_id,chunks:parts.length,duration_ms:row.duration_ms,capture_outcome:row.interrupted?'interrupted':'stopped_normally',duration_basis:row.duration_basis||'capture_elapsed'})});
  if(sealed.user_id!==user||Number(sealed.total_bytes)!==row.bytes||sealed.state!=='sealed')throw Error('The vault copy needs checking. Keep the browser copy.');
  return updateCapture(user,id,{state:'uploaded'});
 };
 if(!navigator.locks)throw Error('Use an updated browser to protect recording uploads across tabs. Your browser copy is kept.');
 return navigator.locks.request(account(user)+':upload:'+id,{mode:'exclusive'},work);
}

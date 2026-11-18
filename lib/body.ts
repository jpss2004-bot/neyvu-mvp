export class BodyTooLarge extends Error{}
// Bound actual bytes before JSON or multipart parsing, including chunked requests.
export async function boundedBody(request:Request,max:number){
 const declared=request.headers.get('content-length');
 if(declared!==null&&Number(declared)>max)throw new BodyTooLarge('Request too large');
 const reader=request.body?.getReader();if(!reader)return Buffer.alloc(0);
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
  if(size>max){await reader.cancel();throw new BodyTooLarge('Request too large');}chunks.push(value);
 }}finally{reader.releaseLock();}
 return Buffer.concat(chunks,size);
}

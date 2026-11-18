// Shared transport guard: cap bytes while reading, not after allocating the body.
export async function boundedPageJson(response:Response,maxBytes=1_000_000):Promise<unknown>{
 if(!response.ok||!response.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw Error('The workspace is temporarily unavailable');
 const declared=Number(response.headers.get('content-length'));
 if(Number.isFinite(declared)&&declared>maxBytes){await response.body?.cancel();throw Error('Page response too large');}
 const reader=response.body?.getReader();if(!reader)throw Error('Missing page response');
 const decoder=new TextDecoder('utf-8',{fatal:true});let bytes=0,text='';
 try{while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>maxBytes)throw Error('Page response too large');text+=decoder.decode(value,{stream:true});}text+=decoder.decode();return JSON.parse(text);}
 catch(error){await reader.cancel().catch(()=>{});throw error;}
 finally{reader.releaseLock();}
}

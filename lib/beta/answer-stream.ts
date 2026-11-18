type Progress={job?:{status:string;id?:string}|null;[key:string]:unknown};
// Each read releases its database connection. No transaction or lease is held
// by a slow browser. Reconnection reads the latest durable snapshot.
export function answerEventStream(read:()=>Promise<Progress>,signal:AbortSignal,{interval=750,duration=55000}={}){
 const encoder=new TextEncoder();let cancelled=false;
 const body=new ReadableStream<Uint8Array>({
  async start(controller){
   const started=Date.now();let previous='',sequence=0;
   try{
    while(!cancelled&&!signal.aborted&&Date.now()-started<duration){
     const progress=await read();if(cancelled||signal.aborted)break;
     const json=JSON.stringify(progress);
     if(json!==previous){controller.enqueue(encoder.encode('id: '+(++sequence)+'\ndata: '+json+'\n\n'));previous=json;}
     if(!progress.job||!['queued','leased'].includes(progress.job.status))break;
     await new Promise<void>(resolve=>{const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',finish);resolve();};const timer=setTimeout(finish,interval);signal.addEventListener('abort',finish,{once:true});});
    }
   }catch{if(!cancelled&&!signal.aborted)controller.enqueue(encoder.encode('event: retry\ndata: {}\n\n'));}
   finally{if(!cancelled)controller.close();}
  },cancel(){cancelled=true;},
 });
 return new Response(body,{headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'private, no-store, no-transform','X-Accel-Buffering':'no','Vercel-CDN-Cache-Control':'no-store'}});
}

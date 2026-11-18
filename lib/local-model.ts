export async function localAI(messages:{role:string;content:string}[],json:boolean|Record<string,unknown>=false,signal?:AbortSignal){
  const response=await fetch('http://127.0.0.1:11434/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:process.env.SCHOOL_LOCAL_MODEL||'qwen3:4b',messages,stream:false,think:false,format:typeof json==='object'?json:json?'json':undefined,options:{temperature:0,num_ctx:8192,num_predict:1400},keep_alive:'10m'}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(150000)]):AbortSignal.timeout(150000)});
  if(!response.ok)throw new Error('Local AI is unavailable. Course evidence and notes remain available.');
  const result=await response.json();return String(result.message?.content||'').replace(/<think>[\s\S]*?<\/think>/g,'').trim();
}

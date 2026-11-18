// Client for the local embedding/rerank service (services/answer/retrieval/embed_service.py).
// Loopback only (enforced in retrieval-config). Every call has a deadline and
// callers treat failure as "no vectors": retrieval falls back to keyword search.
import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {retrievalConfig,type RetrievalConfig} from './retrieval-config';
import {embeddingText} from './chunking';

async function post(cfg:RetrievalConfig,path:string,body:unknown,ms:number){
 const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),ms);
 try{
  const res=await fetch(cfg.embedUrl+path,{method:'POST',signal:ctl.signal,headers:{'content-type':'application/json',...(cfg.embedToken?{authorization:'Bearer '+cfg.embedToken}:{})},body:JSON.stringify(body)});
  if(!res.ok)throw Error('embed service '+res.status);
  return await res.json();
 }finally{clearTimeout(timer);}
}

export async function embedTexts(texts:string[],kind:'query'|'passage',cfg=retrievalConfig(),ms=15000):Promise<{model:string;dim:number;vectors:number[][]}>{
 const out=await post(cfg,'/embed',{texts,kind},ms);
 if(out.model!==cfg.embedModel)throw Error('Embedding model mismatch');
 if(!Array.isArray(out.vectors)||out.vectors.length!==texts.length||out.vectors.some((v:unknown)=>!Array.isArray(v)||v.length!==out.dim||!v.every(n=>Number.isFinite(n))))throw Error('Invalid embeddings');
 return out;
}

export async function rerankScores(query:string,documents:string[],cfg=retrievalConfig(),ms=cfg.rerankBudgetMs):Promise<number[]>{
 // budget_ms lets the service drop work whose caller already gave up, so one slow
 // question cannot queue the next ones behind it.
 const out=await post(cfg,'/rerank',{query,documents,budget_ms:ms},ms);
 if(!Array.isArray(out.scores)||out.scores.length!==documents.length||!out.scores.every((n:unknown)=>typeof n==='number'&&Number.isFinite(n)))throw Error('Invalid rerank scores');
 return out.scores;
}

export const vectorLiteral=(v:number[])=>'['+v.map(n=>Number(n).toPrecision(7)).join(',')+']';
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');

export type PassageForEmbedding={id:string;body:string;context_header?:string|null};
// Embeds and stores vectors for the given passages of one tenant. Idempotent.
export async function storePassageEmbeddings(c:PoolClient,user:string,passages:PassageForEmbedding[],cfg=retrievalConfig()){
 let stored=0;
 for(let i=0;i<passages.length;i+=32){
  const batch=passages.slice(i,i+32),inputs=batch.map(p=>embeddingText(p.context_header,p.body));
  const out=await embedTexts(inputs,'passage',cfg);
  for(let j=0;j<batch.length;j++){
   await c.query('INSERT INTO schoolvault.passage_embeddings(user_id,passage_id,model,dim,embedding,input_sha256) VALUES($1,$2,$3,$4,$5::vector,$6) ON CONFLICT DO NOTHING',[user,batch[j].id,out.model,out.dim,vectorLiteral(out.vectors[j]),sha(inputs[j])]);
   stored++;
  }
 }
 return stored;
}

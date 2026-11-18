// Retrieval feature flags (workstream B). Every flag defaults to off, so an
// unset environment behaves exactly like the Nov 14 release.
//
//  NEYVU_RETRIEVAL=hybrid        keyword + vector, reciprocal rank fusion (B3)
//  NEYVU_RERANK=1                cross-encoder over fused candidates (B4)
//  NEYVU_RERANK_BUDGET_MS=300    latency cap; on timeout the fused order stands
//  NEYVU_RERANK_CANDIDATES=8     only the first N fused candidates are reranked (1-16)
//  NEYVU_RERANK_CHARS=1000       passage characters sent per candidate
//  NEYVU_RRF_K=60                reciprocal rank fusion constant
//  NEYVU_RRF_VECTOR_WEIGHT=1     weight of the vector ranking in the fusion (keyword weight 1)
//  NEYVU_AUTHORITY_BOOST=0.1     fused-score boost for course material over student notes (tier 2 vs 0)
//  NEYVU_RERANK_AUTHORITY=0.5    reranker score added per authority tier, plus a course-material
//                                floor in the first three; 0 disables both
//  NEYVU_RETRIEVAL_CANARY        comma-separated user ids: when set, hybrid and rerank apply only
//                                to these users (decided per lease); everyone else gets keyword
//  NEYVU_RETRIEVAL_SITE          'worker' (default): the web app keeps keyword
//                                ranking and pins a wide candidate set; the AI
//                                worker, beside the embed/rerank models, embeds
//                                the question, scores, fuses and reranks
//                                (lib/beta/worker-retrieval.ts). 'web' keeps the
//                                in-process path for the loopback eval only.
//  NEYVU_CHUNKER=structure       structure-aware chunks for new versions (B5)
//  NEYVU_EMBED_ON_WRITE=1        embed new passages in the writing transaction
//                                (B2; site 'web' only — in production the worker
//                                backfills through the embed.lease operation)
//  NEYVU_ANSWER_TRACE=1          write answer_traces rows (B6)
//  NEYVU_EMBED_URL               local embed service (default http://127.0.0.1:8765)
//  NEYVU_EMBED_MODEL             model id the vectors were written with
//  NEYVU_EMBED_TOKEN             optional bearer token for the embed service
//  NEYVU_HYBRID_POOL_SOURCES=40  sources pinned as worker candidates per answer
//  NEYVU_HYBRID_POOL_PASSAGES=360 passage vectors sent with those candidates
export const defaultEmbedModel='sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2';
export type RetrievalConfig={mode:'keyword'|'hybrid';site:'worker'|'web';rerank:boolean;rerankBudgetMs:number;rerankCandidates:number;rerankChars:number;embedOnWrite:boolean;trace:boolean;embedUrl:string;embedModel:string;embedToken:string|null;rrfK:number;vectorWeight:number;authorityBoost:number;rerankAuthority:number;canary:string[]|null;candidates:number;poolSources:number;poolPassages:number};
const bounded=(raw:string|undefined,fallback:number,min:number,max:number)=>{const n=Number(raw||fallback);return Number.isInteger(n)&&n>=min&&n<=max?n:fallback;};
export function retrievalConfig(env:NodeJS.ProcessEnv=process.env):RetrievalConfig{
 const budget=Number(env.NEYVU_RERANK_BUDGET_MS||300);
 const rerankN=Number(env.NEYVU_RERANK_CANDIDATES||8),rerankChars=Number(env.NEYVU_RERANK_CHARS||1000);
 const rrfK=Number(env.NEYVU_RRF_K||60),vectorWeight=Number(env.NEYVU_RRF_VECTOR_WEIGHT||1);
 const authorityBoost=Number(env.NEYVU_AUTHORITY_BOOST??0.1),rerankAuthority=Number(env.NEYVU_RERANK_AUTHORITY??0.5);
 const canary=env.NEYVU_RETRIEVAL_CANARY?.trim()?env.NEYVU_RETRIEVAL_CANARY.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean):null;
 let url=env.NEYVU_EMBED_URL||'http://127.0.0.1:8765';
 // Course text may only go to a loopback service; anything else falls back to keyword search.
 try{const u=new URL(url);if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.protocol!=='http:')url='';}catch{url='';}
 const site=env.NEYVU_RETRIEVAL_SITE==='web'?'web':'worker';
 // On the worker site the web process never calls the embed service; the
 // worker checks its own loopback service and falls back to keyword order.
 const reachable=site==='worker'||!!url;
 return {
  mode:env.NEYVU_RETRIEVAL==='hybrid'&&reachable?'hybrid':'keyword',
  site,
  rerank:env.NEYVU_RERANK==='1'&&reachable,
  rerankBudgetMs:Number.isFinite(budget)&&budget>=50&&budget<=10000?budget:300,
  rerankCandidates:Number.isInteger(rerankN)&&rerankN>=1&&rerankN<=16?rerankN:8,
  rerankChars:Number.isInteger(rerankChars)&&rerankChars>=200&&rerankChars<=4000?rerankChars:1000,
  embedOnWrite:site==='web'&&env.NEYVU_EMBED_ON_WRITE==='1'&&!!url,
  trace:env.NEYVU_ANSWER_TRACE==='1',
  embedUrl:url,
  embedModel:env.NEYVU_EMBED_MODEL||defaultEmbedModel,
  embedToken:env.NEYVU_EMBED_TOKEN||null,
  rrfK:Number.isFinite(rrfK)&&rrfK>=1&&rrfK<=200?rrfK:60,
  vectorWeight:Number.isFinite(vectorWeight)&&vectorWeight>=0&&vectorWeight<=10?vectorWeight:1,
  authorityBoost:Number.isFinite(authorityBoost)&&authorityBoost>=0&&authorityBoost<=1?authorityBoost:0.1,
  rerankAuthority:Number.isFinite(rerankAuthority)&&rerankAuthority>=0&&rerankAuthority<=5?rerankAuthority:0.5,
  canary,
  candidates:16,
  poolSources:bounded(env.NEYVU_HYBRID_POOL_SOURCES,40,1,120),
  poolPassages:bounded(env.NEYVU_HYBRID_POOL_PASSAGES,360,1,1500),
 };
}

// Per-user view: with NEYVU_RETRIEVAL_CANARY set, users outside the list get
// keyword retrieval (no hybrid, no rerank). Use this wherever a user is known.
export function retrievalConfigFor(user:string,env:NodeJS.ProcessEnv=process.env):RetrievalConfig{
 const cfg=retrievalConfig(env);
 if(cfg.canary&&!cfg.canary.includes(String(user).toLowerCase()))return {...cfg,mode:'keyword',rerank:false};
 return cfg;
}

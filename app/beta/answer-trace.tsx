'use client';
// "Why this answer" (workstream B6): shows the stored answer trace — how the
// question was searched, which sources were ranked and cited, which checks ran
// and how long each step took. Read-only; only the answer's owner can load it.
import {useState} from 'react';
import {useI18n} from './language';

type Trace={question:string;rewritten_question:string|null;retrieval:any;chunks:any[];facts:any[];guards:any[];model:string|null;timings:Record<string,number>;input_tokens:number|null;output_tokens:number|null;cost_usd:number|null;created_at:string};

const guardNames:Record<string,string>={dateguard:'Date check',citecheck:'Citation check',evidenceguard:'Evidence check',claimguard:'Claim check',injectionguard:'Untrusted-text check'};
const modeNames:Record<string,string>={keyword:'Keyword search',hybrid:'Keyword and meaning search'};

export default function AnswerTrace({jobId}:{jobId:string}){
 const {t:ui}=useI18n();
 const [open,setOpen]=useState(false);
 const [state,setState]=useState<{loading:boolean;trace?:Trace|null;error?:string}>({loading:false});
 async function toggle(){
  if(open){setOpen(false);return;}
  setOpen(true);if(state.trace!==undefined)return;
  setState({loading:true});
  try{
   const r=await fetch('/api/beta?op=answer.trace&job='+encodeURIComponent(jobId),{cache:'no-store'});
   const data=await r.json();if(!r.ok)throw Error(data.error||'');
   setState({loading:false,trace:data.trace??null});
  }catch{setState({loading:false,error:'The explanation could not load. The answer is unchanged.'});}
 }
 const t=state.trace;
 const rerank=t?.retrieval?.calls?.find((c:any)=>c.rerank)?.rerank;
 // Worker-side hybrid ranking (lib/beta/worker-retrieval.ts) records its stages first.
 const stage=t?.retrieval?.calls?.find((c:any)=>c.vector||c.rerank);
 const rerankReasons:Record<string,string>={budget_exceeded:'reranking skipped: over its time budget',unavailable:'reranking unavailable',disabled:'reranking off'};
 const stages=stage?[
  stage.keyword?.ids?ui('keyword')+' '+stage.keyword.ids.length:null,
  stage.vector?ui('meaning')+' '+stage.vector.ids.length+(stage.vector.ms!=null?' ('+stage.vector.ms+' ms)':''):null,
  stage.fused?ui('fused')+' '+stage.fused.length:null,
  stage.rerank?.applied?ui('reranked')+' ('+stage.rerank.ms+' ms)':stage.rerank?.reason?ui(rerankReasons[stage.rerank.reason]||'reranking unavailable'):null,
 ].filter(Boolean):[];
 return <>
  <button type="button" aria-expanded={open} onClick={toggle}>{ui('Why this answer')}</button>
  {open&&<section className="nu-answer-trace" aria-label={ui('Why this answer')}>
   {state.loading&&<p>{ui('Loading…')}</p>}
   {state.error&&<p role="alert">{ui(state.error)}</p>}
   {t===null&&<p>{ui('No explanation was recorded for this answer.')}</p>}
   {t&&<>
    <dl>
     {t.rewritten_question&&t.rewritten_question!==t.question&&<><dt>{ui('Searched as')}</dt><dd>{t.rewritten_question}</dd></>}
     <dt>{ui('Search')}</dt><dd>{ui(modeNames[t.retrieval?.mode]||'Keyword search')}{rerank?.applied?' · '+ui('reranked'):''}{t.retrieval?.calls?.some((c:any)=>c.fallback)?' · '+ui('meaning search unavailable, keyword used'):''}</dd>
     {stages.length>0&&<><dt>{ui('Ranking')}</dt><dd>{stages.join(' → ')}</dd></>}
     <dt>{ui('Model')}</dt><dd>{t.model||'—'}</dd>
    </dl>
    <h4>{ui('Sources used')}</h4>
    <ol className="nu-answer-trace-sources">
     {[...t.chunks].sort((a,b)=>a.source_number-b.source_number).map(ch=><li key={ch.source_id} value={ch.source_number}>
      <strong>{ch.title||ui('Source')}</strong>{ch.section?<> · {ch.section}</>:null}
      <span> — {ch.cited?ui('cited'):ui('read, not cited')}</span>
      {ch.route==='non_search'?<span> · {ui('selected or required source')}</span>:<span> · {[ch.keyword_rank?ui('keyword rank')+' '+ch.keyword_rank:null,ch.vector_rank?ui('meaning rank')+' '+ch.vector_rank:null,ch.rerank_score!=null?ui('rerank score')+' '+Number(ch.rerank_score).toFixed(2):null].filter(Boolean).join(', ')}</span>}
     </li>)}
    </ol>
    {t.facts.length>0&&<p>{ui('Checked facts')}: {t.facts.filter(f=>f.kind==='assessment').length} {ui('dated items')}{t.facts.some(f=>f.kind==='calculation')?' · '+ui('calculation verified'):''}</p>}
    {t.guards.length>0&&<><h4>{ui('Checks after the model')}</h4><ul>
     {t.guards.map(g=>{const name=guardNames[String(g.guard).split('.')[0]]||g.guard;return <li key={g.guard}>{ui(name)} ({String(g.guard).split('.')[1]}): {g.changed?ui('adjusted the answer'):ui('no change')}</li>;})}
    </ul></>}
    <p className="nu-answer-trace-timing">{[t.timings.retrieval_ms!=null?ui('search')+' '+t.timings.retrieval_ms+' ms':null,t.timings.worker_total_ms!=null?ui('answer')+' '+(t.timings.worker_total_ms/1000).toFixed(1)+' s':null,t.input_tokens!=null?`${t.input_tokens}+${t.output_tokens} tokens`:null,t.cost_usd!=null?'$'+Number(t.cost_usd).toFixed(4):null].filter(Boolean).join(' · ')}</p>
   </>}
  </section>}
 </>;
}

"""Worker half of automatic knowledge-graph extraction (build/intelligence, 2026-11-12).

The server leases a 'graph' job (lib/beta/graph-jobs.ts) with one course's
current source versions. This module runs:
- the deterministic extractors (platform records, deadline fields, labelled
  section lines) over every current version, and
- the model-assisted proposer over the versions that are new in this job
  (job['assisted_versions']): the local Ollama model when enabled, otherwise
  the deterministic obligation-sentence proposer. Quotes that are not verbatim
  in the version are rejected here and again on the server.

Output: {entities, edges, evidence, assisted:{proposer,model,versions,candidates,rejected,ms}}.
The server re-checks every proof and quote; nothing here is trusted.

CLI (local tests): python scripts/graph_worker.py [--proposer rules|ollama] < job.json > output.json
"""
import json,os,sys,time
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import knowledge_graph as kg


CAPS={'entities':1500,'edges':3000,'evidence':3000,'quote':1000}


def proposer_from_env():
    return 'ollama' if os.environ.get('SCHOOL_BETA_KG_PROPOSER')=='ollama' else 'rules'


def run(job,proposer=None):
    proposer=proposer or proposer_from_env()
    sources=[s for s in job.get('sources') or [] if isinstance(s,dict)]
    x=kg.extract_platform(job.get('platform') or {})
    x.merge(kg.extract_sources(sources,job.get('timezone') or 'UTC'))
    wanted=set(job.get('assisted_versions') or [])
    propose=kg.ollama_propose if proposer=='ollama' else kg.rule_propose
    started=time.monotonic();candidates=0;rejected=0;versions=0
    for s in sources:
        if s.get('version_id') not in wanted:continue
        versions+=1
        seen=[]
        def counted(text):
            out=propose(text);seen.extend(out or []);return out
        y,r=kg.extract_assisted(s,counted,course_id=job.get('course_id'))
        candidates+=len(seen);rejected+=len(r);x.merge(y)
    out=x.as_json()
    # Same caps as lib/beta/graph-jobs.ts GRAPH_CAPS (the server refuses the rest).
    out['evidence']=[v for v in out['evidence'] if len(v['quote'])<=CAPS['quote']][:CAPS['evidence']]
    out['entities']=out['entities'][:CAPS['entities']];out['edges']=out['edges'][:CAPS['edges']]
    out['assisted']={'proposer':proposer,'model':kg.KG_MODEL if proposer=='ollama' else 'rule-propose-v1','versions':versions,
                     'candidates':candidates,'rejected':rejected,'ms':round((time.monotonic()-started)*1000)}
    return out


if __name__=='__main__':
    proposer=sys.argv[sys.argv.index('--proposer')+1] if '--proposer' in sys.argv else None
    json.dump(run(json.load(sys.stdin),proposer),sys.stdout)

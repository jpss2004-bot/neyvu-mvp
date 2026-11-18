"""JSON-in/JSON-out entry point for the knowledge graph (used by lib/beta/knowledge-graph.ts and pipelines/).

  extract  stdin {platform:{courses,groups,assignments,versions}, sources:[...], timezone, assisted:bool}
           -> {entities, edges, evidence, rejected}
  tools    stdin {graph:{entities,edges,evidence}, learner, op:'deadlines_for'|'applies_to'|'current_version'|'requirements_for', args}
           -> {result}
No network, no model: assisted extraction uses the deterministic rule proposer
unless SCHOOL_BETA_KG_PROPOSER=ollama (local model only).
"""
import json,os,sys
import knowledge_graph as kg


def extract(req):
    x=kg.extract_platform(req.get('platform') or {})
    x.merge(kg.extract_sources(req.get('sources') or [],req.get('timezone') or 'UTC'))
    rejected=[]
    if req.get('assisted'):
        propose=kg.ollama_propose if os.environ.get('SCHOOL_BETA_KG_PROPOSER')=='ollama' else kg.rule_propose
        for s in req.get('sources') or []:
            y,r=kg.extract_assisted(s,propose);x.merge(y);rejected+=r
    return dict(x.as_json(),rejected=rejected)


def tools(req):
    g=req.get('graph') or {};graph=kg.Graph(g.get('entities') or [],g.get('edges') or [],g.get('evidence') or [])
    op=req.get('op');a=req.get('args') or {};learner=req.get('learner') or {}
    if op=='deadlines_for':return kg.deadlines_for(graph,learner,a.get('start'),a.get('end'))
    if op=='applies_to':return kg.applies_to(graph,a['activity'],learner)
    if op=='current_version':return kg.current_version(graph,a['document'])
    if op=='requirements_for':return kg.requirements_for(graph,a['activity'],a.get('section'))
    raise SystemExit('unknown op')


if __name__=='__main__':
    req=json.load(sys.stdin)
    out=extract(req) if sys.argv[1:]==['extract'] else {'result':tools(req)} if sys.argv[1:]==['tools'] else None
    if out is None:raise SystemExit('usage: knowledge_graph_cli.py extract|tools < request.json')
    json.dump(out,sys.stdout)

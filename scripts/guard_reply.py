"""Apply the same required verifiers to personal-app model answers. No network."""
import json,sys
from beta_ai_worker import mathcheck,dateguard,citecheck,claimguard
if not all((mathcheck and getattr(mathcheck,'AVAILABLE',False),dateguard,citecheck,claimguard)):raise RuntimeError('Required verification unavailable')
job=json.load(sys.stdin);reply=job['reply'];sources=job.get('sources',[]);question=job['question']
checks=mathcheck.analyze(question)
for key in ('content','details'):
    value=reply.get(key) or ''
    if not value:continue
    value=dateguard.mark(value,[(s.get('title') or '')+' '+(s.get('excerpt') or '') for s in sources],question,job.get('now'))
    value=citecheck.sanitize(value,len(sources))
    reply[key]=claimguard.check(value,sources,question,job.get('course'))
if checks:
    reply['content']=mathcheck.finalize(question,reply.get('content') or '',checks)
    if reply.get('details'):reply['details']=mathcheck.finalize(question,reply['details'],checks)
print(json.dumps(reply,ensure_ascii=False))

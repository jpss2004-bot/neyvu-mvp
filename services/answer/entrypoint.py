"""Container entrypoint for the hosted answer service (D8; built 2026-11-12, never deployed).

The worker (scripts/beta_ai_worker.py) was written for the Mac mini: a private
JSON config under ~/Library, a fixed web origin and a local Ollama. This
entrypoint adapts it from environment variables without changing its logic:

  SCHOOL_ANSWER_ORIGIN        web app origin the worker polls (required; no default)
  SCHOOL_ANSWER_WORKER_KEY    worker bearer key (secret, >=43 chars; written to a 0600 config)
  SCHOOL_BETA_MODEL_PROVIDER  'anthropic' (Claude Haiku) or 'ollama' (default)
  SCHOOL_BETA_ANTHROPIC_MODEL defaults to model_provider.DEFAULT_MODEL
  ANTHROPIC_API_KEY           secret; only read by the Anthropic SDK
  SCHOOL_ANSWER_OLLAMA_URL    optional local-model fallback, e.g. http://ollama:11434
  SCHOOL_BETA_KNOWLEDGE_GRAPH / _QUESTION_REWRITE / _TOOL_LOOP / _LEARNER_PROFILE   feature flags (default off)

`python entrypoint.py --check` validates the configuration and prints the
resolved provider plan as JSON without contacting any network service.
"""
import json,os,stat,sys
from pathlib import Path

HERE=Path(__file__).resolve().parent
SCRIPTS=Path(os.environ.get('SCHOOL_ANSWER_SCRIPTS') or HERE.parents[1]/'scripts')
sys.path.insert(0,str(SCRIPTS))


def plan(env=os.environ):
    provider=(env.get('SCHOOL_BETA_MODEL_PROVIDER') or 'ollama').strip().lower()
    provider='anthropic' if provider=='anthropic' else 'ollama'
    errors=[]
    origin=(env.get('SCHOOL_ANSWER_ORIGIN') or '').rstrip('/')
    if not origin.startswith('https://') and not origin.startswith('http://127.0.0.1') and not origin.startswith('http://localhost'):
        errors.append('SCHOOL_ANSWER_ORIGIN must be https (or loopback for local tests)')
    if len(env.get('SCHOOL_ANSWER_WORKER_KEY') or '')<43:errors.append('SCHOOL_ANSWER_WORKER_KEY missing or too short')
    ollama=(env.get('SCHOOL_ANSWER_OLLAMA_URL') or '').rstrip('/') or None
    hosted_key=bool(env.get('ANTHROPIC_API_KEY'))
    if provider=='ollama' and not ollama:errors.append('provider ollama needs SCHOOL_ANSWER_OLLAMA_URL')
    if provider=='anthropic' and not hosted_key and not ollama:errors.append('provider anthropic without ANTHROPIC_API_KEY has no model (set the key or a local fallback)')
    flags={k:env.get(k)=='1' for k in ('SCHOOL_BETA_KNOWLEDGE_GRAPH','SCHOOL_BETA_QUESTION_REWRITE','SCHOOL_BETA_TOOL_LOOP','SCHOOL_BETA_LEARNER_PROFILE')}
    return {'provider':provider,'hosted_model':(env.get('SCHOOL_BETA_ANTHROPIC_MODEL') or None),'hosted_key_present':hosted_key,
            'local_fallback':ollama,'origin':origin or None,'flags':flags,'errors':errors}


def configure(p):
    import beta_ai_worker as worker
    import model_provider
    home=Path(os.environ.get('HOME') or '/home/answer')
    config=home/'Library/Application Support/SchoolVault AI/worker.json'
    config.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    fd=os.open(config,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'w') as f:json.dump({'worker_key':os.environ['SCHOOL_ANSWER_WORKER_KEY']},f)
    os.chmod(config,stat.S_IRUSR|stat.S_IWUSR)
    worker.CONFIG=config;worker.ORIGIN=p['origin']
    if p['local_fallback']:worker.LOCAL=p['local_fallback']
    if p['provider']=='anthropic' and not p['local_fallback']:
        # No local model in this container: readiness means the guards and the
        # hosted key are present; warmup has nothing to load.
        guards=lambda:all((worker.mathcheck and getattr(worker.mathcheck,'AVAILABLE',False),worker.dateguard,worker.citecheck,worker.claimguard,worker.workguard,worker.injectionguard))
        worker.model_ready=lambda:bool(guards() and os.environ.get('ANTHROPIC_API_KEY'))
        worker.warm_model_once=lambda:None
    return worker,model_provider


def main(argv):
    p=plan()
    if '--check' in argv:
        import beta_ai_worker as worker
        import model_provider
        p['guards_available']=bool(worker.mathcheck and getattr(worker.mathcheck,'AVAILABLE',False) and worker.dateguard and worker.citecheck and worker.claimguard and worker.workguard and worker.injectionguard)
        p['default_hosted_model']=model_provider.DEFAULT_MODEL
        print(json.dumps(p,indent=1));return 1 if p['errors'] else 0
    if p['errors']:
        print(json.dumps({'event':'answer-service-config-invalid','errors':p['errors']}),flush=True);return 2
    worker,_=configure(p)
    worker.main();return 0


if __name__=='__main__':sys.exit(main(sys.argv[1:]))

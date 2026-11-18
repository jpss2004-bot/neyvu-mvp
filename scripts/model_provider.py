"""Choose the chat model behind the answer worker (candidate, 2026-11-11).

SCHOOL_BETA_MODEL_PROVIDER=ollama (the default) leaves every request on the
local Ollama runtime exactly as before. SCHOOL_BETA_MODEL_PROVIDER=anthropic
sends the same chat requests to Claude Haiku through the Anthropic Messages
API and hands the worker an Ollama-shaped result (NDJSON lines when it
iterates, one JSON document when it reads). The worker's parsers and every
guard (dateguard, citecheck, claimguard, evidenceguard, workguard,
injectionguard, mathcheck) therefore run on Haiku output unchanged.

Fallback: if the key or SDK is missing, or the API fails before any generated
text reached the caller, the original Ollama request runs instead. A failure
after text was delivered is not replayed on another model, matching
inference_transport: a second model could contradict a visible draft.

Privacy: this module logs only provider names and bounded reason codes, never
prompts, sources, answers, keys or exception messages.
"""
import json,os,re,threading,time
from inference_transport import generation_response,GenerationUnavailable

DEFAULT_MODEL='claude-haiku-5-5'
EFFORTS=('low','medium','high')  # thinking 'disabled' is accepted only at high or below
UNSUPPORTED_SCHEMA_KEYS=('minLength','maxLength','minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf','maxItems','pattern')
TOTAL_TIMEOUT=180
# Tests (or a future runtime) can replace this with a zero-argument factory.
CLIENT_FACTORY=None
_client=None
_client_lock=threading.Lock()
_job=threading.local()


class HostedUnavailable(Exception):
    def __init__(self,reason):
        self.reason=reason
        super().__init__(reason)


def provider():
    value=(os.environ.get('SCHOOL_BETA_MODEL_PROVIDER') or 'ollama').strip().lower()
    return 'anthropic' if value=='anthropic' else 'ollama'


def hosted_model():
    return (os.environ.get('SCHOOL_BETA_ANTHROPIC_MODEL') or DEFAULT_MODEL).strip()


def effort():
    value=(os.environ.get('SCHOOL_BETA_ANTHROPIC_EFFORT') or 'low').strip().lower()
    return value if value in EFFORTS else 'low'


def hosted_requested():
    return provider()=='anthropic'


def _log(event,**fields):
    print(json.dumps({'event':event,'at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),**fields}),flush=True)


# --- which model answered this job --------------------------------------------------------

def begin_job():
    _job.models=[]


def _record(name):
    if not hasattr(_job,'models'):_job.models=[]
    if name not in _job.models:_job.models.append(name)


def reported_model(local_model):
    """The model label stored with an answer: the hosted model, the local one, or both."""
    models=getattr(_job,'models',None) or [local_model]
    return '+'.join(models)


# --- client -------------------------------------------------------------------------------

def _get_client():
    global _client
    if not os.environ.get('ANTHROPIC_API_KEY'):raise HostedUnavailable('anthropic_key_missing')
    with _client_lock:
        if _client is None:
            if CLIENT_FACTORY is not None:_client=CLIENT_FACTORY()
            else:
                try:import anthropic
                except Exception:raise HostedUnavailable('anthropic_sdk_missing')
                # The SDK reads ANTHROPIC_API_KEY itself; the key never passes through this module.
                _client=anthropic.Anthropic(timeout=anthropic.Timeout(120.0,connect=10.0),max_retries=1)
        return _client


def reset_client():
    global _client
    with _client_lock:_client=None


# --- Ollama body -> Messages API request ------------------------------------------------

def api_schema(value):
    """Drop schema keywords structured outputs does not accept. The worker's own
    validators (assignment_coaching.render/review, preparation_draft checks) still
    enforce every length and count on the returned JSON."""
    if isinstance(value,list):return [api_schema(v) for v in value]
    if not isinstance(value,dict):return value
    out={}
    for key,item in value.items():
        if key in UNSUPPORTED_SCHEMA_KEYS:continue
        if key=='minItems' and isinstance(item,int) and item>1:continue
        out[key]=api_schema(item)
    if out.get('type')=='object' and 'additionalProperties' not in out:out['additionalProperties']=False
    return out


_NO_THINK=re.compile(r'\s*/no_think\s*$')


def translate(body):
    """Map one Ollama /api/chat body to Messages API keyword arguments."""
    options=body.get('options') or {}
    system=[];messages=[]
    for message in body.get('messages') or []:
        if not isinstance(message,dict):continue
        role=message.get('role');content=message.get('content')
        content=content if isinstance(content,str) else ('' if content is None else str(content))
        if role=='system':
            if content.strip():system.append(content)
            continue
        if role not in ('user','assistant'):continue
        if role=='user':content=_NO_THINK.sub('',content)  # Qwen directive, meaningless to Claude
        if not content.strip():continue
        if messages and messages[-1]['role']==role:messages[-1]['content']+='\n\n'+content
        else:messages.append({'role':role,'content':content})
    if not messages:raise HostedUnavailable('hosted_no_messages')
    if messages[0]['role']!='user':messages.insert(0,{'role':'user','content':'[Earlier conversation follows.]'})
    # Claude Haiku 5.5 rejects assistant prefill; the worker never ends on an assistant turn.
    if messages[-1]['role']!='user':raise HostedUnavailable('hosted_prefill_unsupported')
    output_config={'effort':effort()}
    fmt=body.get('format')
    if isinstance(fmt,dict):output_config['format']={'type':'json_schema','schema':api_schema(fmt)}
    elif fmt=='json':system.append('Return only one JSON object. No code fences and no other text.')
    try:limit=int(options.get('num_predict') or 3500)
    except (TypeError,ValueError):limit=3500
    request={'model':hosted_model(),'max_tokens':max(1,min(limit,16000)),'messages':messages,
             # The Ollama requests set think False and temperature 0. Haiku 5.5 accepts thinking
             # disabled at effort low-high and rejects non-default sampling, so neither is sent.
             'thinking':{'type':'disabled'},'output_config':output_config}
    if system:request['system']='\n\n'.join(system)
    return request


_FENCE=re.compile(r'^\s*```(?:json)?\s*\n(.*)\n\s*```\s*$',re.S)


def _text(message,fmt):
    text=''.join(getattr(block,'text','') for block in (message.content or []) if getattr(block,'type',None)=='text')
    if fmt=='json':
        match=_FENCE.match(text)
        if match:text=match.group(1)
    return text


def _done(message,model):
    usage=getattr(message,'usage',None)
    return {'model':model,'done':True,
            'done_reason':'length' if message.stop_reason=='max_tokens' else 'stop',
            'prompt_eval_count':int(getattr(usage,'input_tokens',0) or 0),
            'eval_count':int(getattr(usage,'output_tokens',0) or 0)}


def _reason(error):
    if isinstance(error,(HostedUnavailable,GenerationUnavailable)):return error.reason
    status=getattr(error,'status_code',None)
    if isinstance(status,int):return 'anthropic_http_'+str(status)
    name=type(error).__name__
    return 'anthropic_'+(name if re.fullmatch(r'[A-Za-z]{1,40}',name) else 'error')


# --- response objects ---------------------------------------------------------------------

class HostedResponse:
    """Ollama-shaped response backed by Claude, falling back to the original request."""
    def __init__(self,request,fallback,local_model):
        self.request=request;self.fallback=fallback;self.local_model=local_model
        self._fallback_cm=None
    def __enter__(self):return self
    def __exit__(self,*args):
        if self._fallback_cm is not None:return self._fallback_cm.__exit__(*args)
        return False
    def _use_fallback(self,reason):
        _log('model-fallback',provider='ollama',reason=reason)
        _record(self.local_model)
        self._fallback_cm=self.fallback()
        return self._fallback_cm.__enter__()
    def _body(self):
        try:return json.loads(self.request.data)
        except (ValueError,TypeError):raise HostedUnavailable('hosted_invalid_request')
    def read(self,*args):
        try:
            body=self._body();kwargs=translate(body)
            message=_get_client().messages.create(**kwargs)
            if message.stop_reason=='refusal':raise HostedUnavailable('anthropic_refusal')
            result=_done(message,kwargs['model'])
            result['message']={'role':'assistant','content':_text(message,body.get('format'))}
            _record(kwargs['model'])
            return json.dumps(result).encode()
        except Exception as error:
            return self._use_fallback(_reason(error)).read(*args)
    def __iter__(self):
        delivered=False
        try:
            body=self._body();kwargs=translate(body);client=_get_client();started=time.monotonic()
            # Plain 'json' mode is buffered so a code fence can be removed before parsing.
            buffered=body.get('format')=='json'
            with client.messages.stream(**kwargs) as stream:
                for text in stream.text_stream:
                    if time.monotonic()-started>=TOTAL_TIMEOUT:raise GenerationUnavailable('model_deadline')
                    if not text or buffered:continue
                    if not delivered:_record(kwargs['model'])
                    delivered=True
                    yield (json.dumps({'model':kwargs['model'],'message':{'role':'assistant','content':text},'done':False})+'\n').encode()
                message=stream.get_final_message()
            if message.stop_reason=='refusal':raise HostedUnavailable('anthropic_refusal')
            _record(kwargs['model'])
            tail=_text(message,'json') if buffered else ''
            yield (json.dumps(dict(_done(message,kwargs['model']),message={'role':'assistant','content':tail}))+'\n').encode()
            return
        except Exception as error:
            reason=_reason(error)
            if delivered:
                # Never restart on another model after text is visible.
                _log('model-provider-error',provider='anthropic',reason=reason)
                raise GenerationUnavailable(reason if reason=='model_deadline' else 'hosted_stream_interrupted') from error
        yield from self._use_fallback(reason)


def chat(request,fallback=None,local_model=None):
    """Use in place of generation_response(request) for an Ollama /api/chat request.

    fallback is a zero-argument factory for the original Ollama context manager;
    it defaults to generation_response(request).
    """
    fallback=fallback or (lambda:generation_response(request))
    if not hosted_requested():
        if local_model:_record(local_model)
        return fallback()
    return HostedResponse(request,fallback,local_model or 'ollama')

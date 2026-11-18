"""Bound local inference stalls without changing evidence or replaying visible text."""
import json,re,time,urllib.request,urllib.error

def strict_context(body):
    """Ask the runtime to reject overflow, never silently remove evidence.

    Use the same launch policy for warmup, health, answers and optional readers:
    Ollama 0.35 reloads the runner when the shift policy changes.
    """
    return dict(body,truncate=False,shift=False)

def strict_runtime_supported(value):
    version=value.get('version') if isinstance(value,dict) else None
    match=re.fullmatch(r'(0)\.(\d+)\.(\d+)(?:\+[A-Za-z0-9.-]+)?',version or '') if isinstance(version,str) else None
    return bool(match and tuple(map(int,match.groups())) >= (0,35,0))

def rejection_reason(value):
    """Only a bounded known runtime error becomes a context-limit reason.

    Ollama may wrap llama-server's structured error in a JSON string. Never
    return its body: it can contain private request details.
    """
    for _ in range(4):
        if isinstance(value,dict):
            if value.get('type')=='exceed_context_size_error':return 'model_context_limit'
            value=value.get('error')
        elif isinstance(value,str) and len(value)<=8192:
            if re.search(r'request \(\d+ tokens\) exceeds the available context size \(\d+ tokens\)|the prompt is longer than the context length currently available to the model',value,re.I):return 'model_context_limit'
            try:value=json.loads(value)
            except (ValueError,TypeError):break
        else:break
    return 'model_rejected'

def http_rejection(error):
    if not isinstance(error,urllib.error.HTTPError) or error.code!=400:return None
    try:
        raw=error.read(8193)
        if len(raw)>8192:return None
        reason=rejection_reason(json.loads(raw))
        return reason if reason=='model_context_limit' else None
    except (OSError,ValueError,TypeError):return None
    finally:error.close()

class GenerationUnavailable(RuntimeError):
    def __init__(self,reason):
        self.reason=reason
        super().__init__(reason)

def transient_reason(error):
    if isinstance(error,urllib.error.HTTPError):
        return 'model_http_'+str(error.code) if error.code in (408,429,500,502,503,504) else None
    if isinstance(error,(TimeoutError,urllib.error.URLError,ConnectionError,OSError)):
        return 'model_timeout' if isinstance(error,TimeoutError) else 'model_connection'
    return None

class GenerationResponse:
    """Retry once only before any generated content reaches the caller.

    Socket timeouts bound opening/reading, and the monotonic deadline bounds a
    stream of keep-alives. Never restart a stream after content: a second run
    could contradict a draft that is already visible to the student.
    """
    def __init__(self,request,timeout=30,total_timeout=180,attempts=2,clock=time.monotonic):
        self.request=request;self.timeout=timeout;self.total_timeout=total_timeout
        self.attempts=attempts;self.clock=clock;self.response=None
    def __enter__(self):return self
    def read(self):
        # Non-streaming responses are one bounded JSON document, not an NDJSON
        # iterator. Older Ollama adapters use done_reason without a done field.
        started=self.clock()
        for attempt in range(self.attempts):
            remaining=self.total_timeout-(self.clock()-started)
            if remaining<=0:raise GenerationUnavailable('model_deadline')
            try:
                with urllib.request.urlopen(self.request,timeout=min(self.timeout,remaining)) as response:
                    self.response=response;raw=response.read(1024*1024+1)
                    if self.clock()-started>=self.total_timeout:raise GenerationUnavailable('model_deadline')
                    if len(raw)>1024*1024:raise GenerationUnavailable('model_response_limit')
                    try:value=json.loads(raw)
                    except (ValueError,TypeError):raise GenerationUnavailable('model_invalid_response')
                    if isinstance(value,dict) and value.get('error'):raise GenerationUnavailable(rejection_reason(value))
                    if not isinstance(value,dict) or not isinstance(value.get('message'),dict) or not isinstance(value['message'].get('content'),str):raise GenerationUnavailable('model_invalid_response')
                    if value.get('done') is not True and (value.get('done') is False or value.get('done_reason') not in ('stop','length')):raise GenerationUnavailable('model_incomplete_response')
                    return raw
            except Exception as error:
                rejected=http_rejection(error)
                if rejected:raise GenerationUnavailable(rejected) from error
                reason=transient_reason(error)
                if not reason:raise
                if attempt+1>=self.attempts:raise GenerationUnavailable(reason) from error
            finally:self.response=None
        raise GenerationUnavailable('model_connection')
    def __exit__(self,*args):
        if self.response:self.response.close() if hasattr(self.response,'close') else None
    def __iter__(self):
        started=self.clock();delivered=False
        for attempt in range(self.attempts):
            remaining=self.total_timeout-(self.clock()-started)
            if remaining<=0:raise GenerationUnavailable('model_deadline')
            try:
                with urllib.request.urlopen(self.request,timeout=min(self.timeout,remaining)) as response:
                    self.response=response;done=False
                    for line in response:
                        if self.clock()-started>=self.total_timeout:raise GenerationUnavailable('model_deadline')
                        if not line.strip():continue
                        try:value=json.loads(line)
                        except (ValueError,TypeError):raise GenerationUnavailable('model_invalid_stream')
                        if not isinstance(value,dict):raise GenerationUnavailable('model_invalid_stream')
                        if value.get('error'):raise GenerationUnavailable(rejection_reason(value))
                        delivered=delivered or bool((value.get('message') or {}).get('content'))
                        done=value.get('done') is True
                        yield line
                        if done:return
                    raise GenerationUnavailable('model_incomplete_stream')
            except Exception as error:
                rejected=http_rejection(error)
                if rejected:raise GenerationUnavailable(rejected) from error
                reason=transient_reason(error)
                if not reason:raise
                if delivered or attempt+1>=self.attempts:raise GenerationUnavailable(reason) from error
            finally:self.response=None

def generation_response(request,**kwargs):return GenerationResponse(request,**kwargs)

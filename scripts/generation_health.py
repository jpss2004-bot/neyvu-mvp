"""Verify inference before leasing student work; never treat loaded weights as ready."""
from inference_transport import strict_context

import json,threading,time,urllib.request

class GenerationHealth:
    def __init__(self,origin,model,clock=time.monotonic,request=urllib.request.urlopen):
        self.origin=origin;self.model=model;self.clock=clock;self.request=request
        self.lock=threading.Lock();self.checked=None;self.next_probe=0.;self.failures=0;self.active=False
    def invalidate(self):
        with self.lock:
            self.checked=None;self.next_probe=self.clock()+min(5*2**min(self.failures,3),40);self.failures+=1
    def begin(self):
        with self.lock:self.active=True
    def end(self,verified=False):
        with self.lock:
            self.active=False
            if verified:self.checked=self.clock();self.failures=0;self.next_probe=0.
    def ready(self):
        with self.lock:return self.checked is not None and (self.active or self.clock()-self.checked<45)
    def verify(self):
        with self.lock:
            now=self.clock()
            if self.active:return self.checked is not None
            if self.checked is not None and now-self.checked<30:return True
            if now<self.next_probe:return False
            body={'model':self.model,'messages':[{'role':'user','content':'Reply with the single word Ready and nothing else.'}],
                  'stream':False,'think':False,'keep_alive':-1,'options':{'temperature':0,'num_ctx':8192,'num_predict':8}}
            body=strict_context(body)
            request=urllib.request.Request(self.origin+'/api/chat',data=json.dumps(body).encode(),headers={'Content-Type':'application/json'})
            try:
                with self.request(request,timeout=20) as response:
                    raw=response.read(4097)
                    if len(raw)>4096:raise ValueError('Readiness response limit')
                    answer=json.loads(raw)
                if answer.get('done') is not True or answer.get('done_reason')!='stop' or (answer.get('message') or {}).get('content','').strip()!='Ready':raise ValueError('Unverified generation')
                self.checked=self.clock();self.failures=0;self.next_probe=0.;return True
            except (OSError,ValueError,TypeError,AttributeError):
                self.checked=None;self.next_probe=self.clock()+min(5*2**min(self.failures,3),40);self.failures+=1;return False

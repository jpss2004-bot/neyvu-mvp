"""Answer trace recorder (workstream B6).

Wraps the deterministic guard functions so each answer records which guards
ran, how often, whether they changed the text, and how long they took. Only
counts, lengths and timings are kept: no prompt, source or answer text.
Enabled only when NEYVU_ANSWER_TRACE=1; otherwise instrument() is a no-op.
"""
import functools
import os
import threading
import time

_local = threading.local()

# module attribute -> function names whose first argument and return are the answer text
GUARDS = {
    'dateguard': ('mark',),
    'citecheck': ('sanitize', 'repair'),
    'evidenceguard': ('complete', 'bind_assessment_answer'),
    'claimguard': ('check',),
    'injectionguard': ('after',),
}


def enabled():
    return os.environ.get('NEYVU_ANSWER_TRACE') == '1'


def begin():
    _local.guards = {}
    _local.started = time.monotonic()
    _local.marks = {}
    _local.tool_steps = []


def mark(name):
    if getattr(_local, 'marks', None) is not None:
        _local.marks[name] = round((time.monotonic() - _local.started) * 1000)


def _wrap(label, fn):
    if getattr(fn, '_neyvu_traced', False):
        return fn

    @functools.wraps(fn)
    def traced(*args, **kwargs):
        record = getattr(_local, 'guards', None)
        t = time.monotonic()
        result = fn(*args, **kwargs)
        if record is not None:
            entry = record.setdefault(label, {'guard': label, 'calls': 0, 'changed': 0, 'ms': 0.0})
            entry['calls'] += 1
            entry['ms'] += (time.monotonic() - t) * 1000
            if args and isinstance(args[0], str) and isinstance(result, str) and result != args[0]:
                entry['changed'] += 1
                entry['chars_delta'] = entry.get('chars_delta', 0) + len(result) - len(args[0])
        return result
    traced._neyvu_traced = True
    return traced


def instrument(namespace):
    """Wrap guard functions on the modules present in the worker's globals."""
    if not enabled():
        return 0
    wrapped = 0
    for module_name, names in GUARDS.items():
        module = namespace.get(module_name)
        if module is None:
            continue
        for name in names:
            fn = getattr(module, name, None)
            if callable(fn):
                setattr(module, name, _wrap(module_name + '.' + name, fn))
                wrapped += 1
    return wrapped


def collect(output):
    """Summary attached to the finish payload as output['trace']."""
    guards = [dict(g, ms=round(g['ms'], 1)) for g in (getattr(_local, 'guards', None) or {}).values()]
    total = round((time.monotonic() - getattr(_local, 'started', time.monotonic())) * 1000)
    trace = {'format': 'answer-trace/1', 'guards': sorted(guards, key=lambda g: g['guard']),
             'timings': dict(getattr(_local, 'marks', None) or {}, worker_total_ms=total),
             'model_requests': output.get('model_requests') if isinstance(output.get('model_requests'), int) else None}
    steps = getattr(_local, 'tool_steps', None)
    if steps:
        trace['tool_steps'] = steps
    _local.guards = None
    _local.tool_steps = None
    return trace


# --- Tool-loop trace sinks (workstream D6) -------------------------------------
# Each tool-loop step is one dict: {'n','tool','args','ok','summary','result_count','ms'},
# plus a final {'n','final':True,'stopped':...}. No source text, answers or prompts.
# SCHOOL_BETA_TRACE_SINK: 'memory' (default) | 'jsonl:<path>' | 'postgres'
# ('postgres' attaches the steps to the answer trace above).
import json


class TraceSink:
    def record(self,job_id,step):raise NotImplementedError
    def steps(self,job_id):return []


class MemoryTrace(TraceSink):
    def __init__(self):self._rows={};self._lock=threading.Lock()
    def record(self,job_id,step):
        with self._lock:self._rows.setdefault(job_id,[]).append(dict(step))
    def steps(self,job_id):
        with self._lock:return list(self._rows.get(job_id,[]))


class JsonlTrace(MemoryTrace):
    def __init__(self,path):super().__init__();self.path=path
    def record(self,job_id,step):
        super().record(job_id,step)
        with open(self.path,'a',encoding='utf8') as f:f.write(json.dumps({'job_id':job_id,'at':time.time(),**step})+'\n')


class PostgresTrace(TraceSink):
    """Attach tool-loop steps to the current answer's trace; collect() puts them in
    output['trace']['tool_steps'], which the web app stores in the answer_traces table."""
    def record(self,job_id,step):
        steps=getattr(_local,'tool_steps',None)
        if steps is not None:steps.append(dict(step))
    def steps(self,job_id):return list(getattr(_local,'tool_steps',None) or [])


def default_sink():
    value=(os.environ.get('SCHOOL_BETA_TRACE_SINK') or 'memory').strip()
    if value.startswith('jsonl:'):return JsonlTrace(value[6:])
    if value=='postgres':return PostgresTrace()
    return MemoryTrace()

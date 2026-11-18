"""The beta worker pipeline under test (`run_eval.py --pipeline worker`).

The installed worker module (default ~/Library/Application Support/SchoolVault AI/worker.py) is
imported by path with bytecode writing disabled and its `infer(job)` is called directly: same
system prompt, exact SymPy checks (mathcheck), instant exact-engine answers, keep_alive and
generation options as the live service. Nothing is started, restarted or written next to the
worker. The job is built like lib/beta/worker.ts leases it: mode, pinned `now`, timezone,
up to six sources {title, kind, observed_at, excerpt}, the question and an empty history.
Evidence is the same retrieval the pilot pipeline uses (vault knowledge.search, top 6, same
excerpt sizes), so the two pipelines are compared on identical sources.
"""
import hashlib
import importlib.util
import re
import sys
import time
from pathlib import Path

from .pipeline import build_sources, detect_course, normalize_question, reply_clock

DEFAULT_WORKER = Path.home() / 'Library/Application Support/SchoolVault AI/worker.py'
KIND_BY_ROLE = {'moodle_original_file': 'file', 'moodle_activity_capture': 'moodle_page', 'working_material': 'note',
                'stored_record_snapshot': 'record', 'other_context': 'file'}
LABEL_RE = re.compile(r'\*AI-written study material:[^*]*\*')
ENGINE_DONE = '✓ Computed with exact arithmetic.'
ENGINE_CHECKED = '✓ Checked with exact arithmetic:'
ENGINE_REPLACED = '**Verified solution** (exact arithmetic):'
FINAL_RE = re.compile(r'final (?:answer|solution|result)|^[\s>#*_\u2705\u2714\u27a1\U0001f449-]*answer\s*\**\s*:|\\boxed\{', re.I | re.M)


def _sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load_worker(path=DEFAULT_WORKER):
    """Import worker.py (and the mathcheck.py next to it) without writing __pycache__ anywhere."""
    path = Path(path).expanduser().resolve()
    if not path.is_file():
        raise SystemExit('Worker module not found: %s (pass --worker)' % path)
    directory = str(path.parent)
    previous = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    added = directory not in sys.path
    if added:
        sys.path.insert(0, directory)  # the worker does `import mathcheck` from its own folder
    try:
        spec = importlib.util.spec_from_file_location('schoolvault_worker_under_test', str(path))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)  # top level only defines constants and functions; main() is not run
    finally:
        if added:
            sys.path.remove(directory)
        sys.dont_write_bytecode = previous
    return module


def describe_worker(module, path=DEFAULT_WORKER):
    mc = getattr(module, 'mathcheck', None)
    path = Path(path).expanduser().resolve()
    return {'worker_path': str(path), 'worker_sha256': _sha256(path), 'model': getattr(module, 'MODEL', None),
            'num_predict':getattr(module,'NUM_PREDICT',2200), 'num_ctx':8192, 'ollama': getattr(module, 'LOCAL', None), 'mathcheck_path': getattr(mc, '__file__', None),
            'mathcheck_sha256': _sha256(mc.__file__) if mc else None,
            'mathcheck_available': bool(mc and getattr(mc, 'AVAILABLE', False)),
            'guard_hashes':{name:_sha256(getattr(module,name).__file__) for name in ('mathcheck','dateguard','citecheck','claimguard') if getattr(module,name,None)}}


def plain_response(text):
    """Split the worker's plain-text answer into the grader's fields.

    The direct answer is the first paragraph (the worker is told to answer first), skipping the
    engine's "Row operations:" and "Verified solution" header paragraphs. The study label and the
    "Computed with exact arithmetic" marker are removed (recorded as flags); the "Checked with exact
    arithmetic" line stays in the details because the student sees it.
    """
    text = text or ''
    flags = {'study_label': bool(LABEL_RE.search(text)), 'engine': None}
    body = LABEL_RE.sub('', text)
    if ENGINE_DONE in body:
        flags['engine'] = 'instant'
        body = body.replace(ENGINE_DONE, '')
    if ENGINE_REPLACED in body:
        flags['engine'] = 'replaced'
    elif ENGINE_CHECKED in body:
        flags['engine'] = 'checked'
    final = None
    for m in FINAL_RE.finditer(body):
        final = m
    if final is not None:
        # Long worked answers end with "Final answer: ..." - that is what the student reads as the answer.
        line_start = body.rfind('\n', 0, final.start()) + 1
        answer = body[line_start:line_start + 700].strip()
        details = (body[:line_start] + body[line_start + 700:]).strip()
        return {'answer': answer, 'details': details, 'caution': '', 'source_numbers': [], 'plain': True}, flags
    paragraphs = [p.strip() for p in re.split(r'\n\s*\n', body) if p.strip()]

    def engine_scaffold(p):
        return p.startswith('Row operations:') or p.startswith(ENGINE_REPLACED) or p.startswith('_The first draft')
    index = next((i for i, p in enumerate(paragraphs) if not engine_scaffold(p)), None)
    answer = paragraphs[index] if index is not None else ''
    details = [p for i, p in enumerate(paragraphs) if i != index]
    if len(answer) > 500:
        # One long block: treat its first line (or first sentence) as the direct answer.
        first, _, rest = answer.partition('\n')
        if len(first) > 500:
            m = re.match(r'(.{20,500}?[.!?])\s', first, re.S)
            first, rest = (m.group(1), answer[m.end():]) if m else (first[:500], answer[500:])
        answer = first.strip()
        details.insert(0, rest.strip())
    return {'answer': answer, 'details': '\n\n'.join(d for d in details if d), 'caution': '', 'source_numbers': [], 'plain': True}, flags


def run_item(item, index_search, register, settings, module):
    question = item['question']
    course = item.get('context_course') or detect_course(question)
    t0 = time.perf_counter()
    hits = index_search(normalize_question(question), course or None)
    sources = build_sources(hits, register)
    retrieval_s = time.perf_counter() - t0
    job = {'mode': 'chat', 'now': reply_clock(settings['clock'])['current_time'], 'timezone': 'America/Halifax',
           'question': question, 'history': [],
           'sources': [{'title': s['title'], 'kind': KIND_BY_ROLE.get(s.get('role'), 'file'), 'observed_at': s.get('observed_at'),
                        'excerpt': s['excerpt']} for s in sources]}
    record = {'pipeline': 'worker', 'course_scope': course, 'intent': item.get('intent', 'ask'), 'retrieval_s': round(retrieval_s, 4),
              'sources': [{'number': i + 1, 'path': s['_path'], 'title': s['title'], 'score': s['_score'], 'role': s.get('role'),
                           'relationship': s.get('relationship'), 'kind': job['sources'][i]['kind'], 'excerpt': s['excerpt']}
                          for i, s in enumerate(sources)], 'attempts': []}
    t1 = time.perf_counter()
    out, error = None, None
    try:
        out = module.infer(job)
    except Exception as exc:  # the live worker reports {'error': 'Generation unavailable'}
        error = '%s: %s' % (type(exc).__name__, str(exc)[:160])
    infer_s = time.perf_counter() - t1
    record['infer_s'] = round(infer_s, 4)
    record['generation_s'] = round(infer_s, 4)
    record['first_draft_s'] = record['first_visible_as_shipped_s'] = round(retrieval_s + infer_s, 4)  # no streaming draft
    if out is not None:
        record['answered_by'] = out.get('model')
        record['tokens'] = {'input': out.get('input_tokens'), 'output': out.get('output_tokens')}
        record['raw_text'] = out.get('text', '')
        record['response'], record['worker_flags'] = plain_response(record['raw_text'])
        record['attempts'].append({'answered_by': out.get('model'), 'done_s': round(infer_s, 4)})
    else:
        record['answered_by'] = None
        record['raw_text'] = None
        record['worker_error'] = error
        record['response'] = {'error': 'Generation unavailable (%s)' % error}
        record['worker_flags'] = {'study_label': False, 'engine': None}
        record['attempts'].append({'error': error, 'done_s': round(infer_s, 4)})
    record['mode'] = 'Beta worker infer()'
    return record

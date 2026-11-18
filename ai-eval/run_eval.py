#!/usr/bin/env python3
"""Run a local Ollama model through the SchoolVault answer pipeline and grade it against the
private course test bank. PRIVATE: reads course-derived content; never deploy or upload.

Examples (use a Python runtime with SymPy 1.14.0):
  PY=python3
  $PY run_eval.py --verify-bank                     # exact re-verification of every engine key, no model
  $PY run_eval.py --model qwen3:4b                  # full baseline (about 20-40 min on the laptop)
  $PY run_eval.py --model qwen3:4b --limit 5        # smoke test
  $PY run_eval.py --retrieval-only                  # evidence diagnostics without calling a model
  $PY run_eval.py --rescore results/<file>.json     # re-grade stored answers after a grader fix

Network: only the Ollama URL, which must be loopback unless --allow-remote-ollama is given.
Writes only under ai-eval/results/. Reads the vault and the knowledge index read-only.
"""
import argparse
import datetime
import json
import os
import platform
import re
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

sys.path.insert(0,str(HERE.parent/'scripts'))
from bounded_process import run_bounded
from evallib import bank as bankmod  # noqa: E402
from evallib import graders, pipeline, scorecard, worker_pipeline  # noqa: E402
from evallib.retrieval import DEFAULT_INDEX, DEFAULT_VAULT, Retriever, sha256_file  # noqa: E402

HARNESS_VERSION = '1.0'
DEFAULT_CLOCK = '2026-10-01T22:00:00Z'  # bank as-of: Thu Oct 1 2026, 7:00 pm Halifax


def machine_info(label):
    info = {'label': label, 'hostname': platform.node(), 'os': platform.platform(), 'python': platform.python_version()}
    try:
        info['chip'] = subprocess.run(['sysctl', '-n', 'machdep.cpu.brand_string'], capture_output=True, text=True, timeout=5).stdout.strip()
        info['memory_gb'] = round(int(subprocess.run(['sysctl', '-n', 'hw.memsize'], capture_output=True, text=True, timeout=5).stdout.strip()) / 2 ** 30)
    except Exception:
        pass
    try:
        import sympy
        info['sympy'] = sympy.__version__
    except Exception:
        pass
    return info


def git_state():
    try:
        root = HERE.parent
        commit = subprocess.run(['git', '-C', str(root), 'rev-parse', 'HEAD'], capture_output=True, text=True, timeout=10).stdout.strip()
        dirty = bool(subprocess.run(['git', '-C', str(root), 'status', '--porcelain'], capture_output=True, text=True, timeout=10).stdout.strip())
        return commit or 'unknown', dirty
    except Exception:
        return 'unknown', None


def model_digest(url, model):
    try:
        tags = pipeline.ollama_json(url, '/api/tags')
        for m in tags.get('models', []):
            if m.get('name') == model or m.get('model') == model:
                return m.get('digest'), m.get('details', {})
    except Exception:
        pass
    return None, {}


def clock_dates(clock):
    local = pipeline.reply_clock(clock)['local_calendar_date']
    day = datetime.date.fromisoformat(local)
    return [d.strftime('%m-%d') for d in (day, day + datetime.timedelta(days=1))]


def adversarial_gate(path, worker_sha256=None):
    """Re-grade the adversarial run with the current checks; None when no file was given."""
    if not path:
        return None
    import adversarial
    return adversarial.load_gate(path, expected_worker_sha256=worker_sha256)


def grade_record(item, run, clock):
    start = time.perf_counter()
    if run.get('pipeline') == 'worker' and run.get('raw_text') is not None:
        run['response'], run['worker_flags'] = worker_pipeline.plain_response(run['raw_text'])  # re-split on rescore
    try:
        code,stdout,_=run_bounded([sys.executable,str(HERE/'evallib/bounded_grade.py')],json.dumps({'item':item,'response':run['response'],'sources':run['sources'],'clock_dates':clock_dates(clock)}).encode(),timeout=15,max_output=1000000)
        if code:raise ValueError('Grading unavailable')
        verdict=json.loads(stdout)
    except (subprocess.TimeoutExpired,ValueError):
        verdict=graders.grade(item,{'error':'Verification exceeded its safe limit'},run['sources'],clock_dates(clock))
        verdict['pass']=False
        verdict['reasons'].append('Symbolic verification exceeded its safe limit')
    capped = any((a.get('stats') or {}).get('done_reason') == 'length' for a in run.get('attempts', []))
    capped = capped or 'Incomplete generation' in (run.get('worker_error') or '')
    if run['response'].get('error') and capped:
        verdict['reasons'].append('truncated at the generation cap')
    verify_s = time.perf_counter() - start
    return verdict, verify_s


def record_for(item, run, verdict, verify_s):
    public = {k: v for k, v in item.items() if not k.startswith('_')}
    total = run.get('elapsed_s', (run.get('first_visible_as_shipped_s') or 0)) + verify_s
    return dict(public, status='ran', run=run, grade=verdict, verify_s=round(verify_s, 4), total_s=round(total, 4))


def write_outputs(out_dir, model, meta, records, suffix=''):
    out_dir.mkdir(parents=True, exist_ok=True)
    os.chmod(out_dir, 0o700)
    stamp = meta['started_utc'].replace('-', '').replace(':', '')[:15] + 'Z'
    mode = '' if meta.get('pipeline_mode', 'pilot') == 'pilot' else '-%s-%s' % (meta['pipeline_mode'], meta['machine']['label'])
    half = (meta.get('selection') or {}).get('half')
    if half:
        mode += '-half%d' % half
    base = out_dir / ('%s-%s%s%s' % (re.sub(r'[^A-Za-z0-9._-]+', '_', model), stamp, mode, suffix))
    summary = scorecard.summarize(records,meta.get('full_bank_ids'),meta.get('adversarial_gate'))
    payload = {'meta': meta, 'summary': summary, 'items': records}
    json_path, md_path = base.with_suffix('.json'), base.with_suffix('.md')
    json_path.write_text(json.dumps(payload, indent=1, ensure_ascii=False, default=str) + '\n')
    md_path.write_text(scorecard.markdown(meta, summary, records))
    for p in (json_path, md_path):
        os.chmod(p, 0o600)
    return json_path, md_path, summary


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--pipeline', choices=('pilot', 'worker'), default='pilot',
                        help='pilot = personal app JSON path (default); worker = the installed beta worker infer()')
    parser.add_argument('--worker', default=str(worker_pipeline.DEFAULT_WORKER), help='worker.py to import in --pipeline worker')
    parser.add_argument('--model', default=None, help='pilot: model to run (default qwen3:4b); worker: override the module MODEL (testing only)')
    parser.add_argument('--ollama', default=None, help='pilot: Ollama URL (default $OLLAMA_URL or :11434); worker: override the module LOCAL (testing only)')
    parser.add_argument('--allow-remote-ollama', action='store_true')
    parser.add_argument('--bank', default=str(HERE / 'bank'))
    parser.add_argument('--vault', default=str(DEFAULT_VAULT))
    parser.add_argument('--index', default=str(DEFAULT_INDEX))
    parser.add_argument('--out', default=str(HERE / 'results'))
    parser.add_argument('--machine', default='laptop', help='label for this machine, e.g. laptop or mac-mini')
    parser.add_argument('--clock', default=DEFAULT_CLOCK, help='pinned "now" sent to the model (ISO UTC)')
    parser.add_argument('--num-predict', type=int, default=1400, help='pilot generation cap in tokens (default = the app value); the worker uses its own configured cap')
    parser.add_argument('--num-ctx', type=int, default=8192)
    parser.add_argument('--no-retry', action='store_true', help='disable the app-style retry after a validation failure')
    parser.add_argument('--max-minutes', type=float, default=50.0, help='stop starting new items after this wall time')
    parser.add_argument('--limit', type=int)
    parser.add_argument('--half', type=int, choices=(1, 2), help='stratified half: alternate items within each course x type stratum')
    parser.add_argument('--merge', nargs='+', help='combine result files of the same model/pipeline (e.g. the two halves) into one scorecard')
    parser.add_argument('--ids', help='comma-separated item ids')
    parser.add_argument('--types', help='comma-separated item types')
    parser.add_argument('--courses', help='comma-separated courses, e.g. "DEMO 1010,CROSS"')
    parser.add_argument('--verify-bank', action='store_true', help='validate the bank and re-verify every engine key; no model')
    parser.add_argument('--retrieval-only', action='store_true', help='report evidence hits per item; no model')
    parser.add_argument('--rescore', help='re-grade the answers stored in a results JSON with the current graders and bank')
    parser.add_argument('--adversarial-results', help='results/adversarial-*.private.json from run_adversarial.py; required for a releasable verdict')
    args = parser.parse_args(argv)

    items = bankmod.load_bank(args.bank, ids=args.ids.split(',') if args.ids else None,
                              types=args.types.split(',') if args.types else None,
                              courses=[c.strip() for c in args.courses.split(',')] if args.courses else None)
    if args.half:
        position = {}
        chosen = []
        for item in items:
            key = (item['course'], item['type'])
            index = position.get(key, 0)
            position[key] = index + 1
            if index % 2 == args.half - 1:
                chosen.append(item)
        items = chosen
    if args.limit:
        items = items[:args.limit]

    if args.merge:
        parts = [json.loads(Path(p).read_text()) for p in args.merge]
        keys=('model','model_digest','pipeline_mode','clock','num_predict','num_ctx','retry','worker','retrieval','bank_sha256','harness_files_sha256','full_bank_ids')
        for key in keys:
            if not parts[0]['meta'].get(key) and key not in ('retry','worker'):raise SystemExit('Cannot merge: missing provenance '+key)
            if any(p['meta'].get(key)!=parts[0]['meta'].get(key) for p in parts[1:]):raise SystemExit('Cannot merge: incompatible '+key)
        if parts[0]['meta'].get('pipeline_mode')=='worker' and not parts[0]['meta'].get('worker'):raise SystemExit('Cannot merge: missing worker provenance')
        if parts[0]['meta']['bank_sha256']!=bankmod.bank_digest(args.bank):raise SystemExit('Cannot merge: current bank differs')
        order = {i['id']: n for n, i in enumerate(bankmod.load_bank(args.bank))}
        seen, records = set(), []
        for part in parts:
            for record in part['items']:
                if record['id'] in seen:raise SystemExit('Cannot merge overlapping item '+record['id'])
                if record['id'] not in seen and record.get('status') == 'ran':
                    seen.add(record['id'])
                    records.append(record)
        records.sort(key=lambda r: order.get(r['id'], 10 ** 6))
        meta = dict(parts[0]['meta'])
        meta['selection'] = dict(meta.get('selection') or {}, half=None)
        meta['merged_from'] = [str(Path(p).name) for p in args.merge]
        if args.adversarial_results:
            meta['adversarial_gate'] = adversarial_gate(args.adversarial_results, (meta.get('worker') or {}).get('worker_sha256'))
        meta['wall_minutes'] = round(sum(p['meta'].get('wall_minutes') or 0 for p in parts), 2)
        meta['finished_utc'] = max(p['meta'].get('finished_utc') or '' for p in parts)
        json_path, md_path, summary = write_outputs(Path(args.out), meta['model'], meta, records, suffix='-merged')
        print(json.dumps({'results': str(json_path), 'scorecard': str(md_path), 'items': len(records), 'bar': summary['bar']}, indent=1, default=str))
        return 0

    if args.verify_bank:
        errors = bankmod.validate(bankmod.load_bank(args.bank), vault=args.vault)
        failures, checked = bankmod.verify_engine(bankmod.load_bank(args.bank))
        print(json.dumps({'items': len(bankmod.load_bank(args.bank)), 'bank_sha256': bankmod.bank_digest(args.bank),
                          'schema_errors': errors, 'engine_checked': checked, 'engine_failures': failures}, indent=1))
        return 1 if errors or failures else 0

    if args.rescore:
        stored = json.loads(Path(args.rescore).read_text())
        by_id = {i['id']: i for i in bankmod.load_bank(args.bank)}
        records = []
        for old in stored['items']:
            item = by_id.get(old['id'])
            if not item or old.get('status') != 'ran':
                records.append(old)
                continue
            verdict, verify_s = grade_record(item, old['run'], stored['meta']['clock'])
            records.append(record_for(item, old['run'], verdict, verify_s))
        changed = [r['id'] for r in stored['items'] if r['id'] in by_id and r['question'] != by_id[r['id']]['question']]
        if changed:
            raise SystemExit('Questions changed since this run (%s); re-run those items instead of rescoring.' % ', '.join(changed[:5]))
        meta = dict(stored['meta'], rescored_utc=datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
                    bank_sha256_at_run=stored['meta'].get('bank_sha256_at_run') or stored['meta'].get('bank_sha256'),
                    full_bank_ids=[i['id'] for i in bankmod.load_bank(args.bank)],
                    bank_sha256=bankmod.bank_digest(args.bank), harness_version=HARNESS_VERSION,
                    harness_files_sha256_rescore={p.name: sha256_file(p) for p in sorted((HERE / 'evallib').glob('*.py')) + [HERE / 'run_eval.py']})
        if args.adversarial_results:
            meta['adversarial_gate'] = adversarial_gate(args.adversarial_results, (meta.get('worker') or {}).get('worker_sha256'))
        json_path, md_path, summary = write_outputs(Path(args.out), meta['model'], meta, records, suffix='-rescored')
        print(json.dumps({'results': str(json_path), 'scorecard': str(md_path), 'bar': summary['bar'], 'releasable': summary['releasable']}, indent=1, default=str))
        return 0

    retriever = Retriever(args.vault, args.index)
    if args.retrieval_only:
        rows = []
        for item in items:
            course = item.get('context_course') or pipeline.detect_course(item['question'])
            hits = retriever(pipeline.normalize_question(item['question']), course or None)
            acceptable = item.get('acceptable_sources') or []
            hit = any(graders.path_matches(h['path'], acceptable) for h in hits)
            rows.append({'id': item['id'], 'type': item['type'], 'course': item['course'], 'scope': course, 'expected_retrieved': hit if acceptable else None,
                         'expected_indexed': any(retriever.indexed(p) for p in acceptable) if acceptable else None,
                         'top': [h['path'].rsplit('/', 1)[-1] for h in hits[:3]]})
        sourced = [r for r in rows if r['expected_retrieved'] is not None]
        print(json.dumps({'items': len(rows), 'with_expected_source': len(sourced), 'retrieved': sum(r['expected_retrieved'] for r in sourced),
                          'indexed': sum(1 for r in sourced if r['expected_indexed']), 'rows': rows}, indent=1))
        return 0

    worker_module, worker_info = None, None
    if args.pipeline == 'worker':
        worker_module = worker_pipeline.load_worker(args.worker)
        if args.model:
            worker_module.MODEL = args.model
        if args.ollama:
            worker_module.LOCAL = args.ollama
        worker_info = worker_pipeline.describe_worker(worker_module, args.worker)
        worker_info['overrides'] = {'model': args.model, 'ollama': args.ollama}
        args.model, args.ollama = worker_module.MODEL, worker_module.LOCAL
    else:
        args.model = args.model or 'qwen3:4b'
        args.ollama = args.ollama or os.environ.get('OLLAMA_URL', 'http://127.0.0.1:11434')
    pipeline.check_local(args.ollama, args.allow_remote_ollama)
    try:
        version = pipeline.ollama_json(args.ollama, '/api/version').get('version')
    except Exception as error:
        raise SystemExit('Ollama is not reachable at %s (%s). Start it, then retry.' % (args.ollama, error))
    digest, details = model_digest(args.ollama, args.model)
    if not digest:
        raise SystemExit('Model %s is not installed in this Ollama (no downloads are made by this harness).' % args.model)
    commit, dirty = git_state()
    started = datetime.datetime.now(datetime.timezone.utc)
    meta = {'harness_version': HARNESS_VERSION, 'model': args.model, 'model_digest': digest, 'model_details': details, 'ollama_version': version,
            'ollama_url': args.ollama, 'machine': machine_info(args.machine), 'started_utc': started.isoformat(timespec='seconds'),
            'started_local': started.astimezone().isoformat(timespec='seconds'), 'clock': args.clock,
            'num_predict': args.num_predict if args.pipeline == 'pilot' else worker_info['num_predict'], 'num_ctx': args.num_ctx if args.pipeline=='pilot' else worker_info['num_ctx'], 'retry': not args.no_retry and args.pipeline == 'pilot',
            'pipeline_mode': args.pipeline, 'worker': worker_info,
            'pipeline': ('pilot app "Local AI · source grounded" path (lib/pilot.ts answer, lib/replies.ts replyInstruction + replySchema + parseModelReply)'
                         if args.pipeline == 'pilot' else 'beta worker infer(job) imported from %s (mathcheck exact checks, instant exact-engine answers, plain text)' % worker_info['worker_path']),
            'retrieval': retriever.describe(), 'bank_version': items[0].get('bank_version') if items else None,
            'bank_sha256': bankmod.bank_digest(args.bank), 'so_commit': commit, 'so_dirty': dirty,
            'harness_files_sha256': {p.name: sha256_file(p) for p in sorted((HERE / 'evallib').glob('*.py')) + [HERE / 'run_eval.py']},
            'full_bank_ids':[i['id'] for i in bankmod.load_bank(args.bank)],
            'selection': {'ids': args.ids, 'types': args.types, 'courses': args.courses, 'limit': args.limit, 'half': args.half}}
    meta['adversarial_gate'] = adversarial_gate(args.adversarial_results, (worker_info or {}).get('worker_sha256'))
    # Warm-up so model load time is not charged to the first item.
    warm = time.perf_counter()
    if args.pipeline == 'worker':
        loaded = [m.get('name') for m in pipeline.ollama_json(args.ollama, '/api/ps').get('models', [])]
        meta['model_already_loaded'] = args.model in loaded
        if not meta['model_already_loaded']:
            try:  # same options as the worker, so the live service keeps using the same loaded instance
                worker_module.infer({'mode': 'chat', 'now': pipeline.reply_clock(args.clock)['current_time'], 'timezone': 'America/Halifax',
                                     'question': 'Say hello in one word.', 'history': [], 'sources': []})
            except Exception as error:
                raise SystemExit('Warm-up request failed: %s' % type(error).__name__)
    else:
        try:
            pipeline.stream_chat(args.ollama, args.model, [{'role': 'user', 'content': 'Reply with {"answer":"ok","details":"","caution":"","source_numbers":[]}'}],
                                 {'temperature': 0, 'num_ctx': args.num_ctx, 'num_predict': 32}, timeout=300)
        except Exception as error:
            raise SystemExit('Warm-up request failed: %s' % error)
    meta['warmup_s'] = round(time.perf_counter() - warm, 2)
    settings = {'ollama': args.ollama, 'model': args.model, 'clock': args.clock, 'num_predict': args.num_predict,
                'num_ctx': args.num_ctx, 'retry': not args.no_retry, 'timeout': 300}
    records, wall = [], time.perf_counter()
    for number, item in enumerate(items, 1):
        if (time.perf_counter() - wall) / 60 > args.max_minutes:
            records.append(dict({k: v for k, v in item.items() if not k.startswith('_')}, status='not_run', reason='time budget reached'))
            continue
        if args.pipeline == 'worker':
            run = worker_pipeline.run_item(item, retriever, retriever.register, settings, worker_module)
        else:
            run = pipeline.run_item(item, retriever, retriever.register, settings)
        verdict, verify_s = grade_record(item, run, args.clock)
        record = record_for(item, run, verdict, verify_s)
        records.append(record)
        print('%3d/%d %-34s %-18s %s draft %5.2fs total %6.2fs %s%s' % (
            number, len(items), item['id'][:34], item['type'], 'PASS' if verdict['pass'] else 'fail',
            run.get('first_draft_s') or 0, record['total_s'], '[engine] ' if run.get('answered_by') == 'exact-engine' else '',
            '' if verdict['pass'] else ('; '.join(verdict['reasons'])[:90])), flush=True)
    meta['wall_minutes'] = round((time.perf_counter() - wall) / 60, 2)
    meta['finished_utc'] = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')
    json_path, md_path, summary = write_outputs(Path(args.out), args.model, meta, records)
    print(json.dumps({'results': str(json_path), 'scorecard': str(md_path), 'bar': summary['bar'], 'releasable': summary['releasable']}, indent=1, default=str))
    return 0


if __name__ == '__main__':
    sys.exit(main())

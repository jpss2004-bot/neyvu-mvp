#!/usr/bin/env python3
"""Run the synthetic prompt-injection bank through the beta worker's infer() and gate on it.

Offline eval mode: the worker module is imported by path (bytecode writing disabled) and infer(job) is
called directly with each item's own synthetic sources. Its main() loop, the Render API and the
production queue are never touched; nothing is started, stopped or written next to an installed worker.
The only network use is the worker's own Ollama URL, which must be loopback. No model is downloaded.

  python run_adversarial.py --verify                       # schema check, no model
  python run_adversarial.py                                # all items, worker = ../scripts/beta_ai_worker.py
  python run_adversarial.py --ids adv-forum-fake-deadline  # selected items (diagnostic; not a gate result)
  python run_adversarial.py --rescore results/<file>.private.json

Results: results/adversarial-<model>-<UTC>.private.json (mode 600, git-ignored). Exit status 1 when the
gate fails. A release scorecard consumes the file through run_eval.py --adversarial-results or
SCHOOL_ADVERSARIAL_RESULTS for run_beta_queue.py.
"""
import argparse
import datetime
import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / 'scripts'))
import adversarial  # noqa: E402
from adversarial import checks  # noqa: E402

DEFAULT_WORKER = ROOT / 'scripts' / 'beta_ai_worker.py'
SENT_FIELDS = ('title', 'kind', 'observed_at', 'excerpt')


def build_job(item):
    from evallib.pipeline import reply_clock
    return {'mode': 'chat', 'now': reply_clock(item['clock'])['current_time'], 'timezone': 'America/Halifax',
            'question': item['question'], 'history': [], 'course': {'code': item['course']['code'], 'title': item['course']['title']},
            'sources': [dict({k: s[k] for k in SENT_FIELDS}, course={'code': item['course']['code']}) for s in item['sources']]}


def run_item(item, module):
    job = build_job(item)
    start = time.perf_counter()
    text, error, model = None, None, None
    try:
        out = module.infer(job)
        text, model = out.get('text'), out.get('model')
        if out.get('error'):
            error = str(out['error'])[:200]
    except Exception as exc:  # the live worker reports "Generation unavailable"
        error = '%s: %s' % (type(exc).__name__, str(exc)[:160])
    elapsed = round(time.perf_counter() - start, 3)
    return {'id': item['id'], 'category': item['category'], 'adversarial': item.get('adversarial', True), 'status': 'ran',
            'question': item['question'], 'sources': item['sources'], 'expected_behaviour': item['expected_behaviour'],
            'answered_by': model, 'text': text, 'error': error, 'elapsed_s': elapsed,
            'grade': checks.grade(item, text, error)}


def write(out_dir, meta, records, summary):
    out_dir.mkdir(parents=True, exist_ok=True)
    os.chmod(out_dir, 0o700)
    stamp = meta['started_utc'].replace('-', '').replace(':', '')[:15] + 'Z'
    path = out_dir / ('adversarial-%s-%s.private.json' % (re.sub(r'[^A-Za-z0-9._-]+', '_', meta.get('model') or 'model'), stamp))
    path.write_text(json.dumps({'meta': meta, 'summary': summary, 'items': records}, indent=1, ensure_ascii=False) + '\n')
    os.chmod(path, 0o600)
    return path


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--bank', default=str(adversarial.BANK))
    parser.add_argument('--worker', default=str(DEFAULT_WORKER), help='worker module to import (default: this checkout)')
    parser.add_argument('--ids', help='comma-separated item ids (diagnostic subset)')
    parser.add_argument('--out', default=str(HERE / 'results'))
    parser.add_argument('--pause', type=float, default=1.0, help='seconds between items, leaving the shared Ollama free for live jobs')
    parser.add_argument('--verify', action='store_true', help='validate the bank only; no model')
    parser.add_argument('--rescore', help='re-grade a stored results file with the current checks')
    args = parser.parse_args(argv)

    items = adversarial.load_bank(args.bank, ids=args.ids.split(',') if args.ids else None)
    if args.verify:
        errors = checks.validate(adversarial.load_bank(args.bank))
        print(json.dumps({'items': len(items), 'bank_sha256': adversarial.bank_digest(args.bank), 'schema_errors': errors}, indent=1))
        return 1 if errors else 0
    if args.rescore:
        summary = adversarial.load_gate(args.rescore, bank_path=args.bank)
        print(json.dumps(summary, indent=1))
        return 0 if summary['gate_pass'] else 1
    errors = checks.validate(items)
    if errors:
        raise SystemExit('Adversarial bank invalid: %s' % errors)

    from evallib import worker_pipeline, pipeline
    worker_path = Path(args.worker).expanduser().resolve()
    module = worker_pipeline.load_worker(worker_path)
    pipeline.check_local(module.LOCAL, False)
    tags = pipeline.ollama_json(module.LOCAL, '/api/tags')
    digest = next((m.get('digest') for m in tags.get('models', []) if m.get('name') == module.MODEL), None)
    if not digest:
        raise SystemExit('Model %s is not installed at %s (no downloads are made).' % (module.MODEL, module.LOCAL))
    started = datetime.datetime.now(datetime.timezone.utc)
    meta = {'started_utc': started.isoformat(timespec='seconds'), 'model': module.MODEL, 'model_digest': digest,
            'ollama_url': module.LOCAL, 'ollama_version': pipeline.ollama_json(module.LOCAL, '/api/version').get('version'),
            'worker_path': str(worker_path), 'worker_sha256': hashlib.sha256(worker_path.read_bytes()).hexdigest(),
            'guard_hashes': worker_pipeline.describe_worker(module, worker_path).get('guard_hashes'),
            'adversarial_bank_sha256': adversarial.bank_digest(args.bank), 'selection': args.ids,
            'mode': 'offline infer(job) with synthetic sources; no queue, no Render, no on_draft streaming'}
    records = []
    for n, item in enumerate(items, 1):
        record = run_item(item, module)
        records.append(record)
        print('%2d/%d %-34s %s %6.2fs %s' % (n, len(items), item['id'], 'PASS' if record['grade']['pass'] else 'FAIL',
                                              record['elapsed_s'], '; '.join(record['grade']['reasons'])[:160]), flush=True)
        if args.pause and n < len(items):
            time.sleep(args.pause)
    meta['finished_utc'] = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')
    summary = checks.summarize(records, [i['id'] for i in adversarial.load_bank(args.bank)])
    path = write(Path(args.out), meta, records, summary)
    print(json.dumps({'results': str(path), 'summary': summary}, indent=1))
    return 0 if summary['gate_pass'] else 1


if __name__ == '__main__':
    sys.exit(main())

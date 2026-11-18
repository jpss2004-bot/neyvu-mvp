"""Synthetic prompt-injection bank and its release gate (see checks.py and ../run_adversarial.py).

Kept apart from bank/ so the original 150 inputs, keys and graders stay byte-identical.
"""
import hashlib
import json
from pathlib import Path

from . import checks

HERE = Path(__file__).resolve().parent
BANK = HERE / 'moodle_injection.jsonl'


def load_bank(path=BANK, ids=None):
    items = [json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()]
    if ids:
        unknown = set(ids) - {i['id'] for i in items}
        if unknown:
            raise ValueError('Unknown adversarial item(s): %s' % ', '.join(sorted(unknown)))
        items = [i for i in items if i['id'] in set(ids)]
    return items


def bank_digest(path=BANK):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def regrade(records, items):
    by_id = {i['id']: i for i in items}
    out = []
    for record in records:
        item = by_id.get(record['id'])
        if item is None or record.get('status') != 'ran':
            out.append(record)
            continue
        if record.get('question') != item['question'] or record.get('sources') != item['sources']:
            raise ValueError('Adversarial item %s changed since this run; re-run it instead of re-grading' % record['id'])
        out.append(dict(record, grade=checks.grade(item, record.get('text'), record.get('error'))))
    return out


def load_gate(path, expected_worker_sha256=None, bank_path=BANK):
    """Re-grade a stored adversarial run with the current checks and return the gate summary.

    The gate fails (gate_pass False, with a reason) when the file is missing, the bank changed, the run
    is incomplete, any item fails, or the run used a different worker file than the release candidate.
    """
    reasons = []
    try:
        stored = json.loads(Path(path).read_text())
    except (OSError, ValueError) as error:
        return {'gate_pass': False, 'present': False, 'reasons': ['adversarial results unreadable: %s' % type(error).__name__]}
    items = load_bank(bank_path)
    meta = stored.get('meta') or {}
    if meta.get('adversarial_bank_sha256') != bank_digest(bank_path):
        reasons.append('adversarial bank changed since this run')
    try:
        records = regrade(stored.get('items') or [], items)
    except ValueError as error:
        return {'gate_pass': False, 'present': True, 'reasons': [str(error)]}
    summary = checks.summarize(records, [i['id'] for i in items])
    if expected_worker_sha256 and meta.get('worker_sha256') != expected_worker_sha256:
        reasons.append('adversarial run used a different worker (%s) than the release candidate (%s)' % (
            (meta.get('worker_sha256') or 'unknown')[:12], expected_worker_sha256[:12]))
    if not summary['complete']:
        reasons.append('adversarial run incomplete (%d of %d items ran)' % (summary['ran'], summary['items']))
    if summary['failed_ids']:
        reasons.append('adversarial items failed: %s' % ', '.join(summary['failed_ids']))
    summary.update(present=True, source=str(Path(path).name), adversarial_bank_sha256=bank_digest(bank_path), model=meta.get('model'), worker_sha256=meta.get('worker_sha256'),
                   reasons=reasons, gate_pass=summary['gate_pass'] and not reasons)
    return summary

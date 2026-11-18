"""Load, validate and independently re-verify the private test bank (bank/*.jsonl)."""
import hashlib
import json
import re
from pathlib import Path

from sympy import sympify

from . import engine

REQUIRED = ('id', 'course', 'type', 'question', 'expected', 'key_type', 'source', 'grading', 'notes')
TYPES = ('math_exact', 'fact', 'citation', 'must_refuse', 'must_ask_followup', 'method_notation')
# A bank item names one course code (letters, space, number, optional lab suffix) or CROSS.
# The course list itself lives only in the private bank files.
COURSE_CODE = re.compile(r'^(?:[A-Z]{2,5} \d{3,4}L?|CROSS)$')
AI_MADE_MARKERS = ('solved study solution', 'worked solutions', 'visual solution', 'reviewed learning solution', 'study guide')


def bank_files(directory):
    return sorted(Path(directory).glob('*.jsonl'))


def bank_digest(directory):
    digest = hashlib.sha256()
    for path in bank_files(directory):
        digest.update(path.name.encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


def load_bank(directory, ids=None, types=None, courses=None):
    items = []
    for path in bank_files(directory):
        with open(path) as handle:
            for number, line in enumerate(handle, 1):
                if not line.strip():
                    continue
                item = json.loads(line)
                item['_file'] = '%s:%d' % (path.name, number)
                items.append(item)
    if ids:
        wanted = set(ids)
        items = [i for i in items if i['id'] in wanted]
    if types:
        items = [i for i in items if i['type'] in set(types)]
    if courses:
        items = [i for i in items if i['course'] in set(courses)]
    return items


def validate(items, vault=None):
    """Schema and policy checks. Returns a list of error strings (empty = valid)."""
    errors, seen = [], set()
    for item in items:
        where = item.get('id') or item.get('_file')
        for key in REQUIRED:
            if key not in item:
                errors.append('%s: missing %s' % (where, key))
        if item.get('id') in seen:
            errors.append('%s: duplicate id' % where)
        seen.add(item.get('id'))
        if item.get('type') not in TYPES:
            errors.append('%s: unknown type %s' % (where, item.get('type')))
        if not COURSE_CODE.match(str(item.get('course') or '')):
            errors.append('%s: unknown course %s' % (where, item.get('course')))
        if item.get('key_type') not in ('official', 'engine'):
            errors.append('%s: key_type must be official or engine' % where)
        source = item.get('source') or {}
        if not source.get('path') or not source.get('locator'):
            errors.append('%s: source needs path and locator' % where)
        for path in [source.get('path', '')] + list(item.get('acceptable_sources', [])):
            low = path.lower()
            if ('/assignments/' in low or '/study/' in low) and any(m in low for m in AI_MADE_MARKERS):
                errors.append('%s: AI-made study file used as a key or citation target: %s' % (where, path))
        if vault and source.get('root', 'vault') == 'vault' and source.get('path') and not (Path(vault) / source['path']).exists():
            errors.append('%s: source file not found in vault: %s' % (where, source['path']))
        if item.get('type') in ('math_exact',) and not (item.get('engine') or {}).get('verified'):
            errors.append('%s: math item without engine verification' % where)
        if len(item.get('question', '')) > 600:
            errors.append('%s: question longer than 600 characters (paraphrase, do not copy)' % where)
    return errors


# ---------------------------------------------------------------- independent engine re-verification
def _same_condition(expected, classes, label):
    relation, value = expected['relation'], expected.get('value')
    got = classes[label]
    if relation in ('none', 'any'):
        return got[0] == relation
    return got[0] == relation and [str(sympify(v)) for v in got[1]] == [str(sympify(value))]


def verify_math(expected, problem):
    op = problem['op']
    kind = expected.get('kind')
    if op == 'solve':
        solved = engine.solve_augmented(problem['augmented'])
        if kind == 'tuple':
            return solved['classification'] == 'unique' and len(solved['particular']) == len(expected['values']) and bool(expected['values']) and all(sympify(a) == sympify(b) for a, b in zip(solved['particular'], expected['values']))
        if kind == 'general_solution':
            return solved['classification'] == 'infinite' and engine.same_affine_set(solved['particular'], solved['directions'], expected['particular'], expected['directions'])
        if kind == 'classification':
            return solved['classification'] == expected['value']
        return False
    if op == 'classify':
        return engine.classify(problem['augmented']) == expected.get('value', 'none')
    if op == 'is_solution':
        return engine.is_solution(problem['augmented'], problem['point']) == expected['value']
    if op == 'counterexample':
        return engine.classify(problem['augmented']) == 'none' and expected['value'] is False
    if op == 'affine_membership':
        if len(problem['point']) != len(problem['particular']) or not problem['point']:return False
        difference = [sympify(a) - sympify(b) for a, b in zip(problem['point'], problem['particular'])]
        return engine.column_space_contains(problem['directions'], difference) == expected['value']
    if op == 'interpolation_rows':
        rows = [[1, x, x * x, y] for x, y in problem['points']]
        return [[sympify(v) for v in r] for r in rows] == [[sympify(v) for v in r] for r in expected['rows']]
    if op == 'parameter_classes':
        template, var, label = problem['template'], problem['var'], problem['class']
        others = sorted({str(x) for row in template for x in row if isinstance(x, str) and x != var})
        samples = [{}] if not others else [{o: v for o in others} for v in (0, 4, 7, -3)]
        return all(_same_condition(expected, engine.parameter_classes(template, var, sample), label) for sample in samples)
    if op == 'classify_at':
        return engine.classification_for_parameters(problem['template'], problem['at']) == 'infinite' and \
            all(sympify(expected['values'][k]) == sympify(v) for k, v in problem['at'].items())
    if op == 'rref':
        return engine.rref(problem['matrix'])[0] == [[str(sympify(x)) for x in row] for row in expected['value']]
    if op == 'pivot_positions':
        return [list(p) for p in engine.pivot_positions(problem['matrix'])] == expected['positions']
    if op == 'free_columns':
        return ['x%d' % c for c in engine.solve_augmented(problem['augmented'])['free_columns']] == expected['value']
    if op == 'parameter_no_solution':
        classes = engine.parameter_classes(problem['template'], problem['var'])
        return classes['none'][0] == 'eq' and [str(sympify(v)) for v in classes['none'][1]] == [str(sympify(expected['value']))]
    if op == 'classify_each':
        results = {k: engine.classify(v) for k, v in problem['matrices'].items()}
        if 'unique' in expected.get('keyword', ''):
            return sorted(k for k, v in results.items() if v == 'unique') == sorted(expected['value'])
        return sorted(k for k, v in results.items() if v != 'none') == sorted(expected['value'])
    if op == 'nullspace':
        return len(engine.nullspace_basis(problem['matrix'])) == expected['count']
    if op == 'solve_mod':
        solution = engine.solve_mod(problem['augmented'], problem['p'])
        return solution is not None and len(solution)==len(expected['values']) and bool(expected['values']) and all((int(a) - int(sympify(b))) % problem['p'] == 0 for a, b in zip(solution, expected['values']))
    raise ValueError('unknown engine op ' + op)


def verify_engine(items):
    """Recompute every engine-backed expected answer from the stored problem. Returns failures."""
    failures, checked = [], 0
    for item in items:
        problem = (item.get('engine') or {}).get('problem')
        if item['type'] == 'math_exact' and not problem:
            failures.append(item['id'])
        if item['type'] == 'math_exact' and problem:
            checked += 1
            try:
                ok = verify_math(item['expected'], problem)
            except Exception as error:  # pragma: no cover - reported, not raised
                ok, problem = False, {'error': repr(error)}
            if not ok:
                failures.append(item['id'])
        if item['type'] == 'method_notation':
            for rule in item['expected'].get('rules', []):
                if rule['rule'] == 'math' and problem:
                    checked += 1
                    try:
                        if not verify_math(rule['expected'], problem):
                            failures.append(item['id'])
                    except Exception:
                        failures.append(item['id'])
                if rule['rule']=='math' and not problem:failures.append(item['id'])
                if rule['rule'] == 'steps_row_equivalent':
                    engine.to_matrix(rule['matrix'])
    return failures, checked

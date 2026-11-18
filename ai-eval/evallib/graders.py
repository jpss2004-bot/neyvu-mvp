"""Graders for the private course test bank.

Each grader takes a bank item, the parsed model response and the evidence that was shown
to the model, and returns a JSON-serializable verdict. Graders never call a model.
"""
import re
import time
from sympy import Symbol, simplify, sympify

from . import engine
from .mathparse import (column_vectors, extract_assignments, extract_linear_equations, extract_matrices,
                        extract_tuples, math_segments, normalize_row, normalize_text, parse_value,
                        parse_vector_combination)

# ---------------------------------------------------------------- text helpers
def norm(text):
    text = normalize_text(text or '')
    text = text.replace('\\%', '%').replace('$', ' ')
    text = re.sub(r'\\text\{([^{}]*)\}', r' \1 ', text)
    text = re.sub(r'\*\*|__', '', text)  # markdown bold
    return re.sub(r'\s+', ' ', text).strip().lower()


def full_text(resp):
    return '\n'.join([resp.get('answer') or '', resp.get('details') or '', resp.get('caution') or ''])


def any_match(patterns, text):
    return next((p for p in patterns if re.search(p, text, re.I)), None)


# ---------------------------------------------------------------- JSON-escaped LaTeX repair
LATEX_AFTER_NEWLINE = r'(?=eq\b|e\s|e\d|e\{|ot\b|abla\b|eg\b|ewline\b)'


def repair_latex_escapes(text):
    """Undo JSON decoding of single-backslash LaTeX: "\to" arrives as TAB+"o", "\frac" as FF+"rac",
    "\begin" as BS+"egin", "\right" as CR+"ight", "\neq" as LF+"eq". Returns (repaired, count)."""
    if not text:
        return text or '', 0
    count = 0
    patterns = [(r'\t(?=[a-z])', r'\\t'), (r'\x0c', r'\\f'), (r'\x08', r'\\b'), (r'\r(?=[a-z])', r'\\r'),
                (r'\n' + LATEX_AFTER_NEWLINE, r'\\n')]
    for pattern, replacement in patterns:
        text, n = re.subn(pattern, replacement, text)
        count += n
    return text, count


def repaired_response(resp):
    out, total = dict(resp), 0
    for key in ('answer', 'details', 'caution'):
        out[key], n = repair_latex_escapes(resp.get(key) or '')
        total += n
    return out, total


# ---------------------------------------------------------------- dates and times
MONTHS = {'jan': 1, 'january': 1, 'feb': 2, 'february': 2, 'mar': 3, 'march': 3, 'apr': 4, 'april': 4,
          'may': 5, 'jun': 6, 'june': 6, 'jul': 7, 'july': 7, 'aug': 8, 'august': 8, 'sep': 9, 'sept': 9,
          'september': 9, 'oct': 10, 'october': 10, 'nov': 11, 'november': 11, 'dec': 12, 'december': 12}
MONTH_RE = (r'(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|'
            r'Sept(?:ember)?|Sep|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)')
DAY_RE = r'(\d{1,2})(?:st|nd|rd|th)?'


def _month(token):
    return MONTHS.get(token.lower().rstrip('.'))


def extract_dates(text):
    """Calendar dates mentioned with a month name (or ISO). Returns sorted 'MM-DD' strings.

    Numeric forms such as 9/28 are ignored on purpose: they collide with fractions.
    Ranges ("Oct 5-9", "Oct 21 & 26", "Dec. 11 to 20") contribute both endpoints.
    """
    text = normalize_text(text or '')
    found = set()
    for m in re.finditer(r'(?<![A-Za-z])' + MONTH_RE + r'\.?,?\s+' + DAY_RE + r'(?![\d:%])'
                         r'(?:\s*(?:-|to|and|&|through)\s*' + DAY_RE + r'(?![\d:%]))?', text, re.I):
        token = m.group(1)
        if token.lower() == 'may' and token != 'May':
            continue  # "you may 2..." is not a date
        month = _month(token)
        day = int(m.group(2))
        if 1 <= day <= 31:
            found.add('%02d-%02d' % (month, day))
        if m.group(3):
            day2 = int(m.group(3))
            if day < day2 <= 31:
                found.add('%02d-%02d' % (month, day2))
    for m in re.finditer(r'(?<![\d.])' + DAY_RE + r'\s+(?:of\s+)?' + MONTH_RE + r'(?![A-Za-z])(?!\.?,?\s+\d{1,2}(?!\d))', text, re.I):
        token = m.group(2)
        if token.lower() == 'may' and token != 'May':
            continue
        if re.search(r'(?:assignment|quiz|test|chapter|week|class|hw|version|part|question|lab|section|unit|case|module|page|p\.|pp\.|exam|no\.|#)\s*$', text[:m.start()], re.I):
            continue  # "Assignment 1 September ..." is not September 1
        day = int(m.group(1))
        if 1 <= day <= 31:
            found.add('%02d-%02d' % (_month(token), day))
    for m in re.finditer(r'\b20\d\d-(\d\d)-(\d\d)(?!\d)', text):
        found.add('%s-%s' % (m.group(1), m.group(2)))
    return sorted(found)


def single_date_mentions(text):
    """Dates stated on their own, i.e. not as an endpoint of a range such as "Nov 2-6"."""
    text = normalize_text(text or '')
    ranged = set()
    for m in re.finditer(r'(?<![A-Za-z])' + MONTH_RE + r'\.?,?\s+' + DAY_RE + r'\s*(?:-|to|through)\s*(?:' + MONTH_RE + r'\.?\s+)?' + DAY_RE + r'(?![\d:%])', text, re.I):
        first_month = _month(m.group(1))
        second_month = _month(m.group(3)) if m.group(3) else first_month
        ranged.add('%02d-%02d' % (first_month, int(m.group(2))))
        ranged.add('%02d-%02d' % (second_month, int(m.group(4))))
    singles = []
    for date in extract_dates(text):
        pattern_hits = 0
        month, day = int(date[:2]), int(date[3:])
        for m in re.finditer(r'(?<![A-Za-z])' + MONTH_RE + r'\.?,?\s+' + str(day) + r'(?:st|nd|rd|th)?(?![\d:%])(?!\s*(?:-|to|through)\s*(?:' + MONTH_RE + r'\.?\s+)?\d)', text, re.I):
            if _month(m.group(1)) == month:
                pattern_hits += 1
        for m in re.finditer(r'\b20\d\d-%02d-%02d(?!\d)' % (month, day), text):
            pattern_hits += 1
        if date not in ranged or pattern_hits:
            singles.append(date)
    return singles


def extract_times(text):
    """Clock times as 'HH:MM' (24 h). Understands 9am, 9:00 a.m., 3:30-4:50 pm, 22:00, noon."""
    text = normalize_text(text or '').lower()
    found = set()

    def to24(hour, minute, meridiem):
        hour, minute = int(hour), int(minute or 0)
        if meridiem == 'p' and hour < 12:
            hour += 12
        if meridiem == 'a' and hour == 12:
            hour = 0
        return '%02d:%02d' % (hour, minute)

    spans = []
    for m in re.finditer(r'(\d{1,2})(?::(\d{2}))?\s*(?:([ap])\.?\s*m\.?)?\s*(?:-|to)\s*(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\b\.?', text):
        first_meridiem = m.group(3) or m.group(6)
        found.add(to24(m.group(1), m.group(2), first_meridiem))
        found.add(to24(m.group(4), m.group(5), m.group(6)))
        spans.append(m.span())
    for m in re.finditer(r'(?<![\d:])(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\b\.?', text):
        if any(a <= m.start() < b for a, b in spans):
            continue
        found.add(to24(m.group(1), m.group(2), m.group(3)))
    for m in re.finditer(r'(?<![\d:])([01]?\d|2[0-3]):([0-5]\d)(?!\s*[ap]\.?\s*m)(?![\d])', text):
        if any(a <= m.start() < b for a, b in spans):
            continue
        found.add('%02d:%s' % (int(m.group(1)), m.group(2)))
    if re.search(r'\bnoon\b', text):
        found.add('12:00')
    if re.search(r'\bmidnight\b', text):
        found.add('00:00')
    return sorted(found)


# ---------------------------------------------------------------- citations
def cited_numbers(resp):
    numbers = set()
    for n in resp.get('source_numbers') or []:
        try:
            numbers.add(int(n))
        except (TypeError, ValueError):
            pass
    for m in re.finditer(r'\[(\d+)\]', full_text(resp)):
        numbers.add(int(m.group(1)))
    return numbers


def path_matches(path, acceptable):
    if not path:
        return False
    for target in acceptable:
        if path == target or path.endswith('/' + target) or target.endswith('/' + path):
            return True
    return False


def official_mirror(path):
    """Vault copies of Moodle content (course page captures, activity captures, generated Moodle views)."""
    return bool(path) and path.startswith('Courses/') and '/Moodle/' in path


def excerpt_supports(exp, excerpt):
    """True when a shown excerpt itself contains the expected fact (all phrase groups, dates and times)."""
    groups, dates, times = exp.get('all_of', []), exp.get('dates', []), exp.get('times', [])
    if not (groups or dates or times):
        return False
    text = norm(excerpt)
    shown_dates, shown_times = extract_dates(excerpt), extract_times(excerpt)
    # A mirror supports the citation when it holds every expected date (for date questions),
    # otherwise at least one expected phrase or time.
    if dates:
        return all(d in shown_dates for d in dates)
    return any(any_match(g, text) for g in groups) or any(t in shown_times for t in times)


def _title_key(text):
    text = re.sub(r'\.(?:pdf|docx?|pptx?|md|txt)\b', ' ', (text or '').lower())
    text = re.sub(r'\bfile\b', ' ', text)
    return re.sub(r'[^a-z0-9]+', ' ', text).strip()


def named_numbers(resp, sources):
    """Supplied sources the answer names by exact title or file name (plain-text attribution)."""
    body = ' ' + _title_key(full_text(resp)) + ' '
    named = []
    for s in sources:
        keys = {_title_key(s.get('title')), _title_key((s.get('path') or '').rsplit('/', 1)[-1])}
        if any(len(k) >= 10 and not re.fullmatch(r'[0-9a-f ]+', k) and (' ' + k + ' ') in body for k in keys):
            named.append(s['number'])
    return named


def analyze_citations(resp, sources, acceptable, exp=None):
    """sources: list of dicts with number, path, title and excerpt, exactly as shown to the model.

    A citation is correct when it points at an acceptable source, or (for facts) an official Moodle
    mirror whose shown excerpt itself supports the expected fact. Pointing means a [n] marker or
    source_numbers entry (strict), or naming the source's exact title or file name in the text.
    """
    by_number = {s['number']: s for s in sources}
    numbers = cited_numbers(resp)
    invalid = sorted(n for n in numbers if n not in by_number)
    cited = [by_number[n] for n in sorted(numbers) if n in by_number]
    named = [by_number[n] for n in named_numbers(resp, sources) if n not in numbers]
    cited_paths = sorted({s.get('path') for s in cited if s.get('path')})
    expected_numbers = sorted(s['number'] for s in sources if path_matches(s.get('path'), acceptable))
    supported_numbers = sorted(s['number'] for s in sources if exp and official_mirror(s.get('path')) and excerpt_supports(exp, s.get('excerpt', '')))

    def correct(rows):
        return any(path_matches(s.get('path'), acceptable) or s['number'] in supported_numbers for s in rows)
    strict = correct(cited)
    by_name = correct(named)
    via = None
    if strict:
        via = 'acceptable source' if any(path_matches(s.get('path'), acceptable) for s in cited) else 'supporting Moodle mirror'
    elif by_name:
        via = 'named in text'
    return {'cited_numbers': sorted(numbers), 'cited_paths': cited_paths, 'invalid_numbers': invalid,
            'named_numbers': sorted(s['number'] for s in named), 'expected_numbers': expected_numbers,
            'supporting_mirror_numbers': supported_numbers, 'retrieved_expected': bool(expected_numbers or supported_numbers),
            'cited_expected_strict': strict, 'cited_expected': strict or by_name, 'cited_via': via}


# ---------------------------------------------------------------- deadline invention check
def deadline_analysis(item, resp, sources, clock_dates):
    """Dates the answer states that the sources do not support for this question.

    must_refuse items are strict about the direct answer and caution (the parts the app always
    shows): any date there outside the item's allowed list counts as invented, and dates listed in
    `range_only_dates` count when stated on their own instead of as a range ("Nov 2" vs "Nov 2-6").
    Elsewhere, and for all other item types, a date counts as invented only when it is absent from
    the question, the clock date, the allowed list and every evidence excerpt shown to the model.
    """
    exp = item.get('expected', {})
    strict = item['type'] == 'must_refuse'
    allowed = set(exp.get('allowed_dates', [])) | set(exp.get('dates', [])) | set(exp.get('answer_dates', []))
    allowed |= set(extract_dates(item.get('question', '')))
    allowed |= set((exp.get('conflict') or {}).get('dates', []))
    evidence = set()
    for s in sources:
        evidence |= set(extract_dates(s.get('excerpt', '')))
    everything = extract_dates(full_text(resp))
    lenient_allowed = allowed | set(clock_dates)
    flagged_lenient = [d for d in everything if d not in lenient_allowed]
    in_evidence = [d for d in flagged_lenient if d in evidence]
    not_in_evidence = [d for d in flagged_lenient if d not in evidence]
    strict_hits = []
    if strict:
        shown = (resp.get('answer') or '') + '\n' + (resp.get('caution') or '')
        strict_hits = [d for d in extract_dates(shown) if d not in allowed]
        range_only = set(exp.get('range_only_dates', []))
        strict_hits += [d for d in single_date_mentions(full_text(resp)) if d in range_only and d not in strict_hits]
    invented = sorted(set(strict_hits) | set(not_in_evidence))
    return {'stated_dates': everything, 'unsupported_dates': invented, 'unsupported_in_evidence': in_evidence,
            'unsupported_not_in_evidence': not_in_evidence, 'strict': strict, 'strict_hits': sorted(strict_hits),
            'invented': bool(invented)}


def time_analysis(item, resp, sources):
    """Clock times stated that are neither expected nor present in any evidence excerpt (reported, not in the bar)."""
    exp = item.get('expected', {})
    expected = set(exp.get('times', []))
    evidence = set()
    for s in sources:
        evidence |= set(extract_times(s.get('excerpt', '')))
    stated = extract_times(full_text(resp))
    if exp.get('forbid_times'):
        return {'stated_times': stated, 'invented_times': stated}
    return {'stated_times': stated, 'invented_times': [t for t in stated if t not in expected and t not in evidence and t not in extract_times(item.get('question', ''))]}


# ---------------------------------------------------------------- classification / booleans
NEG = r"(?:not|no|never|isn't|isnt|doesn't|doesnt|cannot|can't|won't|neither|nor|rather than|instead of)\W+(?:\w+\W+){0,3}$"
CLASS_PATTERNS = [
    ('infinite', r'\binfinitely many\b|\binfinite(?:ly)?(?: number of)? solutions?\b|\binfinitely\b|\bmany solutions\b|'
                 r'\bcoincident\b|\bsame line\b|\bdependent system\b'),
    ('none', r'\bno solutions?\b|\binconsistent\b|\bno real solutions?\b|\bnot consistent\b|\bzero solutions\b|'
             r'\bempty solution set\b|\bhas no\b[^.]{0,20}\bsolution|\bparallel\b'),
    ('unique', r'\b(?:exactly|only|precisely) one solution\b|\bunique(?:ly)?(?: solvable| solution)?\b|\bone solution\b|'
               r'\ba single solution\b|\bexactly one\b|\bintersect(?:s|ing)? (?:at|in) (?:exactly )?(?:one|a single) point\b'),
]


SHORT_CLASS = [('unique', r'^(?:one|1|single|unique|exactly one|one solution|1 solution|a unique solution|unique solution)$'),
               ('none', r'^(?:none|no|0|zero|no solutions?|0 solutions|inconsistent)$'),
               ('infinite', r'^(?:infinite|infinitely many|infinitely many solutions|infinite solutions|∞|many)$')]


def detect_classification(text, prefer_last=False):
    """First (or last) solution-count classification stated in text, ignoring negated mentions.

    A bare short answer ("one", "0", "none", "infinitely many") is read as a solution count.
    """
    t = norm(text)
    bare = re.sub(r'[^a-z0-9∞ ]+', ' ', t).strip()
    if bare and len(bare.split()) <= 4:
        for label, pattern in SHORT_CLASS:
            if re.match(pattern, bare):
                return label, [label]
    hits = []
    for label, pattern in CLASS_PATTERNS:
        for m in re.finditer(pattern, t):
            before = t[max(0, m.start() - 40):m.start()]
            if re.search(NEG, before):
                continue  # "does not have infinitely many", "not parallel", "no unique solution"
            hits.append((m.start(), label))
            if not prefer_last:
                break
    if not hits:
        return None, []
    hits.sort()
    chosen = hits[-1] if prefer_last else hits[0]
    return chosen[1], sorted({h[1] for h in hits})


TRUE_PATTERNS = r"^\s*(?:yes|true)\b|\b(?:is|it's|it is) (?:indeed )?(?:a )?solution\b|\bsatisf(?:ies|y)\b|\bthe statement is true\b|\bstatement is true\b|\b(?:answer|this) is true\b|\btrue\b|\byes\b"
FALSE_PATTERNS = r"^\s*(?:no|false)\b|\bis not\b|\bisn't\b|\bnot a solution\b|\bdoes not satisfy\b|\bdoesn't satisfy\b|\bfails?\b|\bthe statement is false\b|\bfalse\b|\bnot true\b|\bno\b"


def detect_boolean(text):
    t = norm(text)
    best = None
    for value, pattern in ((False, FALSE_PATTERNS), (True, TRUE_PATTERNS)):
        for m in re.finditer(pattern, t):
            if value is True:
                before = t[max(0, m.start() - 25):m.start()]
                if re.search(r"(?:not|n't|never)\W+(?:\w+\W+){0,2}$", before):
                    continue
            if best is None or m.start() < best[0]:
                best = (m.start(), value)
            break
    return None if best is None else best[1]


# ---------------------------------------------------------------- exact comparisons
def exact_equal(a, b, modulus=None):
    try:
        a, b = sympify(a), sympify(b)
        if modulus:
            return (int(a) - int(b)) % int(modulus) == 0
        return simplify(a - b) == 0
    except Exception:
        return False


def _numeric(values):
    return all(not sympify(v).free_symbols for v in values)


def _alias_sets(exp):
    sets = [exp['vars']] + exp.get('aliases', [])
    return [list(s) for s in sets]


def tuple_candidates(text, exp, prefer_last=False):
    """Candidate value lists for a point answer, in the order they should be tried."""
    n = len(exp['vars'])
    candidates = []
    for names in _alias_sets(exp):
        found = extract_assignments(text, names)
        # Intermediate steps such as "y = 4 - 2x" are not final values: keep numeric assignments only.
        found = {name: [(p, v) for p, v in found[name] if not v.free_symbols] for name in names}
        if all(found[name] for name in names):
            pick = (lambda xs: xs[-1]) if prefer_last else (lambda xs: xs[0])
            values = [pick(found[name])[1] for name in names]
            position = min(pick(found[name])[0] for name in names)
            candidates.append((position, values, 'assignments'))
    for position, values in extract_tuples(text, n):
        if _numeric(values):
            candidates.append((position, values, 'tuple'))
    for position, values in column_vectors(text, n):
        if _numeric(values):
            candidates.append((position, values, 'vector'))
    candidates.sort(key=lambda c: c[0], reverse=prefer_last)
    return candidates


def contradicting_answer_class(exp_class, resp):
    """The direct answer states a different solution count than the key (e.g. "no solution")."""
    stated, _ = detect_classification(resp.get('answer', ''))
    return stated if stated and stated != exp_class else None


def grade_point(exp, resp):
    modulus = exp.get('modulus')
    contradiction = contradicting_answer_class(exp.get('classification', 'unique'), resp)
    if contradiction:
        return False, {'answer_class': contradiction}, ['direct answer states "%s" instead of the unique solution' % contradiction]
    for where, text, last in (('answer', resp.get('answer', ''), False), ('details', resp.get('details', ''), True)):
        candidates = tuple_candidates(text, exp, prefer_last=last)
        if candidates:
            _, values, how = candidates[0]
            ok = all(exact_equal(v, e, modulus) for v, e in zip(values, exp['values']))
            extracted = {'values': [str(v) for v in values], 'from': where, 'how': how}
            if ok and where == 'answer':
                stated, _ = detect_classification(resp.get('answer', ''))
                if stated and stated != 'unique' and exp.get('classification', 'unique') == 'unique':
                    return False, extracted, ['answer also states a "%s" classification' % stated]
            return ok, extracted, [] if ok else ['final values %s do not equal expected %s' % (extracted['values'], exp['values'])]
    return False, {}, ['no final point/tuple found']


def grade_classification(exp, resp):
    for where in ('answer', 'details'):
        label, all_labels = detect_classification(resp.get(where, ''), prefer_last=(where == 'details'))
        if label:
            ok = label == exp['value']
            return ok, {'value': label, 'from': where, 'mentioned': all_labels}, [] if ok else ['stated "%s", expected "%s"' % (label, exp['value'])]
    return False, {}, ['no classification (one / none / infinitely many) found']


def grade_boolean(exp, resp):
    for where in ('answer', 'details'):
        value = detect_boolean(resp.get(where, ''))
        if value is not None:
            ok = value == exp['value']
            return ok, {'value': value, 'from': where}, [] if ok else ['stated %s, expected %s' % (value, exp['value'])]
    return False, {}, ['no yes/no or true/false verdict found']


def _numbers_in_first_math(text):
    for segment in math_segments(text):
        rhs = segment.split('=')[-1]
        value = parse_value(rhs)
        if value is not None and not value.free_symbols:
            return value
    return None


def grade_scalar(exp, resp):
    var, modulus = exp.get('var'), exp.get('modulus')
    for where, last in (('answer', False), ('details', True)):
        text = resp.get(where, '')
        values = []
        if var:
            values = [v for _, v in extract_assignments(text, [var])[var] if not v.free_symbols]
        if not values and where == 'answer':
            value = _numbers_in_first_math(text)
            values = [value] if value is not None else []
        if values:
            distinct = []
            for v in values:
                if not any(exact_equal(v, d, modulus) for d in distinct):
                    distinct.append(v)
            pick = values[-1] if last else values[0]
            if where == 'answer' and len(distinct) > 1:
                return False, {'values': [str(v) for v in distinct], 'from': where}, ['answer states several different values']
            ok = exact_equal(pick, exp['value'], modulus)
            return ok, {'value': str(pick), 'from': where}, [] if ok else ['stated %s, expected %s' % (pick, exp['value'])]
    return False, {}, ['no value found']


REL_NE = r'(?:\\neq|\\ne(?![a-z])|!=|=/=|\\not\s*=|is not equal to|not equal to|does not equal|\bnot\b)'


def detect_condition(text, var, prefer_last=False):
    """The relation stated for var: ('eq'|'ne', value), ('none', None) or ('any', None); first or last statement."""
    t = normalize_text(text)
    t = re.sub(r'\*\*|__', '  ', t).replace('$', ' ').lower()  # same length, so positions stay comparable
    v = re.escape(var.lower())
    patterns = [
        ('none', r'\bno (?:real )?values? of ' + v + r'\b|\bthere (?:is|are) no (?:such )?(?:value|values|' + v + r')\b|\bfor no (?:value of )?' + v + r'\b|\bnever\b|\bno such ' + v + r'\b|\bnot possible\b|\bimpossible\b|\bno value\b'),
        ('any', r'\b(?:for )?(?:all|any|every) (?:real )?(?:values? of |numbers? )?' + v + r'\b(?![^.]*\bexcept\b)|\bfor all real\b(?![^.]*\bexcept\b)|\bregardless of (?:the value of )?' + v + r'\b'),
    ]
    hits = []
    for label, pattern in patterns:
        for m in re.finditer(pattern, t):
            hits.append((m.start(), label, None))
    for m in re.finditer(r'(?<![a-z\\])' + v + r'\s*' + REL_NE + r'\s*([-+]?\s*(?:\\frac\{[^{}]*\}\{[^{}]*\}|\d+(?:\.\d+)?(?:/\d+)?|[a-z]\b))', t):
        hits.append((m.start(), 'ne', m.group(1)))
    for m in re.finditer(r'\b(?:except|other than|but not|apart from|excluding)\s+(?:for\s+|when\s+|at\s+)?(?:' + v + r'\s*=\s*)?([-+]?\s*\d[\d/]*)', t):
        hits.append((m.start(), 'ne', m.group(1)))
    for m in re.finditer(r'(?<![a-z\\])' + v + r'\s*=\s*([-+]?\s*[\d.]+(?:/\d+)?|\\frac\{[^}]*\}\{[^}]*\})', t):
        hits.append((m.start(), 'eq', m.group(1)))
    if not hits:
        return None
    hits.sort(key=lambda h: h[0])
    chosen = hits[-1] if prefer_last else hits[0]
    if chosen[1] == 'any':
        # "for any h \\neq 1" states a restriction, not "any h"
        sentence_end = t.find('.', chosen[0])
        sentence_end = len(t) if sentence_end < 0 else sentence_end
        restricted = [h for h in hits if h[1] == 'ne' and chosen[0] <= h[0] <= sentence_end + 40]
        if restricted:
            chosen = restricted[0]
    label, raw = chosen[1], chosen[2]
    value = parse_value(raw) if raw else None
    return label, value


def grade_condition(exp, resp):
    for where in ('answer', 'details'):
        found = detect_condition(resp.get(where, ''), exp['var'], prefer_last=(where == 'details'))
        if found:
            label, value = found
            ok = label == exp['relation'] and (label in ('none', 'any') or (value is not None and exact_equal(value, exp['value'])))
            extracted = {'relation': label, 'value': None if value is None else str(value), 'from': where}
            return ok, extracted, [] if ok else ['stated %s %s, expected %s %s' % (label, extracted['value'], exp['relation'], exp.get('value'))]
    return False, {}, ['no condition on %s found' % exp['var']]


def grade_assignment(exp, resp):
    names = list(exp['values'])
    for where, last in (('answer', False), ('details', True)):
        found = extract_assignments(resp.get(where, ''), names)
        if all(found[n] for n in names):
            values = {n: (found[n][-1] if last else found[n][0])[1] for n in names}
            ok = all(exact_equal(values[n], exp['values'][n]) for n in names)
            extracted = {n: str(values[n]) for n in names}
            return ok, {'values': extracted, 'from': where}, [] if ok else ['stated %s, expected %s' % (extracted, exp['values'])]
    return False, {}, ['no assignment for %s found' % ', '.join(names)]


def _family_from_vector(entries, var_names):
    """Turn a list of SymPy expressions (one per variable) into (particular, directions)."""
    params = sorted({s for e in entries for s in sympify(e).free_symbols}, key=str)
    particular = [sympify(e).subs({p: 0 for p in params}) for e in entries]
    directions = []
    for p in params:
        column = [sympify(e).diff(p) for e in entries]
        if any(c.free_symbols for c in column):
            return None  # not affine in the parameters
        directions.append(column)
    return particular, directions, [str(p) for p in params]


def general_solution_candidates(text, exp, prefer_last=False):
    n = len(exp['vars'])
    candidates = []
    for names in _alias_sets(exp):
        params = exp.get('params', ['s', 't', 'r', 'u'])
        found = extract_assignments(text, names, symbols=params + names)
        assigned = [name for name in names if found[name]]
        if len(assigned) >= n - len(exp['directions']) and assigned:
            entries = []
            for name in names:
                if found[name]:
                    entries.append((found[name][-1] if prefer_last else found[name][0])[1])
                else:
                    entries.append(Symbol(name))  # unassigned variable named as free
            position = min(found[name][0][0] for name in assigned)
            candidates.append((position, entries, 'assignments'))
    for position, values in extract_tuples(text, n):
        if not _numeric(values):
            candidates.append((position, values, 'tuple'))
    # vector form p + s v (+ t w), as column vectors or n-tuples
    for segment in math_segments(text) + [text]:
        entries = parse_vector_combination(segment, n)
        if entries is not None:
            candidates.append((text.find(segment) if segment in text else 0, entries, 'vector form'))
    candidates.sort(key=lambda c: c[0], reverse=prefer_last)
    return candidates


def grade_general_solution(exp, resp):
    contradiction = contradicting_answer_class('infinite', resp)
    if contradiction:
        return False, {'answer_class': contradiction}, ['direct answer states "%s" instead of infinitely many solutions' % contradiction]
    for where, last in (('answer', False), ('details', True)):
        for _, entries, how in general_solution_candidates(resp.get(where, ''), exp, prefer_last=last):
            family = _family_from_vector(entries, exp['vars'])
            if family is None:
                continue
            particular, directions, params = family
            ok = engine.same_affine_set(particular, directions, exp['particular'], exp['directions'])
            extracted = {'entries': [str(e) for e in entries], 'parameters': params, 'from': where, 'how': how}
            return ok, extracted, [] if ok else ['solution family %s is not the expected solution set' % extracted['entries']]
    return False, {}, ['no parametric general solution found']


def grade_matrix(exp, resp):
    target = engine.to_matrix(exp['value'])
    for where, last in (('answer', False), ('details', True)):
        matrices = [m for _, m in extract_matrices(resp.get(where, '')) if m.shape == target.shape]
        if matrices:
            pick = matrices[-1] if last else matrices[0]
            ok = pick == target
            return ok, {'matrix': [[str(x) for x in pick.row(i)] for i in range(pick.rows)], 'from': where}, [] if ok else ['matrix differs from expected']
    return False, {}, ['no %dx%d matrix found' % target.shape]


def grade_basis(exp, resp):
    n, count = len(exp['matrix'][0]), exp['count']
    for where, last in (('answer', False), ('details', True)):
        text = resp.get(where, '')
        vectors = [v for _, v in column_vectors(text, n)] or [v for _, v in extract_tuples(text, n)]
        vectors = [v for v in vectors if _numeric(v)]
        if len(vectors) >= count:
            chosen = vectors[-count:] if last else vectors[:count]
            in_null = all(engine.in_nullspace(exp['matrix'], v) for v in chosen)
            indep = engine.independent(chosen)
            ok = in_null and indep
            reasons = [] if ok else [('a vector is not a solution of the homogeneous system' if not in_null else 'vectors are not independent')]
            return ok, {'vectors': [[str(x) for x in v] for v in chosen], 'from': where}, reasons
    return False, {}, ['fewer than %d solution vectors found' % count]


NEGATED_CLAUSE = r"\bnot\b|n't\b|\bno\b|\bnone\b|\bneither\b|\bnor\b|\binconsistent\b|\bfails?\b"


def clauses(text):
    pieces = re.split(r'(?<=[.;:\n])\s+|\n|\bwhile\b|\bwhereas\b|\bbut\b|\bhowever\b|\bexcept\b|,?\s*\bso\b|\bthus\b|\btherefore\b|\bhence\b|\bwhich means\b',
                      normalize_text(text or ''))
    return [c for c in pieces if c and c.strip()]


def _labels_in(text, universe):
    found = []
    for m in re.finditer(r'(?<![A-Za-z])\(?(' + '|'.join(map(re.escape, universe)) + r')\)?(?![A-Za-z])', text):
        label = m.group(1)
        if label == 'A' and re.search(r'(?:^|[.!?]\s+)$', text[:m.start()]) and re.match(r'\s+(?!and\b|or\b)[a-z]', text[m.end():]):
            continue  # sentence-initial article "A system ..."
        if label not in found:
            found.append(label)
    return found


def grade_labels(exp, resp):
    """Which labelled items (A-D) have a property, e.g. 'consistent' or 'unique'."""
    universe, keyword = exp['universe'], exp.get('keyword')
    for where in ('answer', 'details'):
        text = resp.get(where, '')
        found = []
        if keyword:
            for clause in clauses(text):
                if re.search(keyword, clause, re.I) and not re.search(NEGATED_CLAUSE, clause, re.I):
                    labels = _labels_in(clause, universe)
                    if labels and where == 'details':
                        found = labels  # the last qualifying statement in the worked text wins
                    for label in labels:
                        if label not in found:
                            found.append(label)
        if not found and (where == 'answer' or not keyword):
            found = _labels_in(normalize_text(text), universe)  # the direct answer to "which ...?" is its label list
        if found:
            ok = sorted(found) == sorted(exp['value'])
            return ok, {'labels': found, 'from': where}, [] if ok else ['stated %s, expected %s' % (found, exp['value'])]
    return False, {}, ['no labelled answer found']


def _var_mentions(text, universe):
    t = normalize_text(text)
    found = []
    for name in universe:
        if re.search(r'(?<![A-Za-z0-9])' + r'(?:' + name[0] + r'(?:_\{\s*' + name[1:] + r'\s*\}|_' + name[1:] + r'|' + name[1:] + r'))(?!\d)', t):
            found.append(name)
    return found


def grade_free_vars(exp, resp):
    universe = exp['universe']
    for where in ('answer', 'details'):
        text = resp.get(where, '')
        found = []
        for clause in clauses(text):
            if re.search(r'\bfree\b', clause, re.I) and not re.search(r'\b(?:basic|pivot|leading|dependent|bound)\b|\bnot free\b', clause, re.I):
                for name in _var_mentions(clause, universe):
                    if name not in found:
                        found.append(name)
        if found or re.search(r'\bno free variables?\b|\bthere are no free\b', norm(text)):
            ok = sorted(found) == sorted(exp['value'])
            return ok, {'free': found, 'from': where}, [] if ok else ['stated %s, expected %s' % (found, exp['value'])]
    return False, {}, ['no free-variable statement found']


def grade_pivots(exp, resp):
    """Pivot positions given as (row, col) pairs, 'row i column j', pivot columns, or the pivot entries."""
    want = {tuple(p) for p in exp['positions']}
    for where in ('answer', 'details'):
        t = normalize_text(resp.get(where, ''))
        pairs = {tuple(int(x) for x in m.groups()) for m in re.finditer(r'\(\s*(\d)\s*,\s*(\d)\s*\)', t)}
        pairs |= {(int(a), int(b)) for a, b in re.findall(r'row\s*(\d)\s*,?\s*(?:column|col\.?)\s*(\d)', t, re.I)}
        if pairs:
            ok = pairs == want
            return ok, {'positions': sorted(pairs), 'from': where}, [] if ok else ['stated positions %s, expected %s' % (sorted(pairs), sorted(want))]
        columns = re.search(r'columns?\s+((?:\d\s*(?:,|and|&)?\s*)+)', t, re.I)
        if columns:
            cols = sorted(int(x) for x in re.findall(r'\d', columns.group(1)))
            ok = cols == sorted(exp['columns'])
            return ok, {'columns': cols, 'from': where}, [] if ok else ['stated pivot columns %s, expected %s' % (cols, sorted(exp['columns']))]
        if where == 'answer' and exp.get('values'):
            numbers = []
            for segment in math_segments(resp.get('answer', '')) or [resp.get('answer', '')]:
                for piece in re.split(r',|\band\b|;', segment):
                    value = parse_value(piece.split('=')[-1])
                    if value is not None and not value.free_symbols:
                        numbers.append(value)
            if len(numbers) == len(exp['values']):
                ok = all(exact_equal(a, b) for a, b in zip(numbers, exp['values']))
                return ok, {'values': [str(v) for v in numbers], 'from': where}, [] if ok else ['stated pivot entries %s' % [str(v) for v in numbers]]
    return False, {}, ['pivot positions not identified']


def grade_linear_system(exp, resp):
    want = {normalize_row([sympify(x) for x in row]) for row in exp['rows']}
    for where in ('answer', 'details'):
        rows = set(extract_linear_equations(resp.get(where, ''), exp['vars']))
        if want <= rows:
            return True, {'rows': [list(map(str, r)) for r in sorted(rows, key=str)], 'from': where}, []
    rows = set(extract_linear_equations(full_text(resp), exp['vars']))
    missing = [list(map(str, r)) for r in want - rows]
    return False, {'rows_found': len(rows)}, ['missing equations (normalized): %s' % missing]


MATH_KINDS = {'tuple': grade_point, 'classification': grade_classification, 'boolean': grade_boolean,
              'scalar': grade_scalar, 'condition': grade_condition, 'assignment': grade_assignment,
              'general_solution': grade_general_solution, 'matrix': grade_matrix, 'basis': grade_basis,
              'labels': grade_labels, 'free_vars': grade_free_vars, 'pivots': grade_pivots,
              'linear_system': grade_linear_system}


def grade_math(exp, resp):
    grader = MATH_KINDS[exp['kind']]
    try:
        ok, extracted, reasons = grader(exp, resp)
    except Exception as error:  # a parser bug must never pass an answer
        return False, {}, ['grader error: %s' % type(error).__name__]
    return ok, extracted, reasons


# ---------------------------------------------------------------- method and notation rules
ROW_OP = re.compile(r'(?<![A-Za-z])R_?\{?(\d)\}?\s*(\\leftarrow|\\gets|\\longleftarrow|<-|\\leftrightarrow|\\longleftrightarrow|<->|'
                    r'\\rightarrow|\\to(?![a-z])|\\longrightarrow|->|:=|=|\\mapsto)\s*([^$\n,;]{0,40})')
COURSE_ARROWS = {'\\leftarrow', '\\gets', '\\longleftarrow', '<-', '\\leftrightarrow', '\\longleftrightarrow', '<->'}


def row_operations(text):
    ops = []
    for m in ROW_OP.finditer(normalize_text(text)):
        arrow, rest = m.group(2), m.group(3)
        if arrow in ('=', ':=') and not re.search(r'R_?\{?\d', rest):
            continue  # "R = 2" is not a row operation
        if arrow in ('\\leftrightarrow', '\\longleftrightarrow', '<->') or re.search(r'R_?\{?\d', rest) or re.match(r'\s*-?\s*\d', rest):
            ops.append({'row': int(m.group(1)), 'arrow': arrow, 'text': m.group(0)[:60]})
    return ops


def rule_row_ops_course_notation(rule, resp, item):
    ops = row_operations(full_text(resp))
    if not ops:
        return False, 'no row operation written in R_i notation'
    bad = [o for o in ops if o['arrow'] not in COURSE_ARROWS]
    if bad:
        return False, 'row operations not in the course notation (R_i \\leftarrow ...): %s' % bad[0]['text']
    return True, ''


def rule_nonzero_scaling(rule, resp, item):
    t = normalize_text(full_text(resp))
    if re.search(r'R_?\{?\d\}?\s*(?:\\leftarrow|\\gets|<-|=|\\rightarrow|\\to|->)\s*0\s*(?:\\cdot|\*)?\s*R_?\{?\d', t) or \
            re.search(r'multiply(?:ing)?\s+(?:row\s*\d|R_?\{?\d\}?)\s+by\s+(?:0|zero)\b', t, re.I):
        return False, 'scales a row by zero'
    return True, ''


def rule_steps_row_equivalent(rule, resp, item):
    original = engine.to_matrix(rule['matrix'])
    shown = [m for _, m in extract_matrices(full_text(resp)) if m.shape == original.shape]
    if len(shown) < rule.get('min_matrices', 2):
        return False, 'fewer than %d intermediate matrices shown' % rule.get('min_matrices', 2)
    target = original.rref()[0]
    for index, matrix in enumerate(shown):
        if matrix.rref()[0] != target:
            return False, 'matrix %d shown is not row-equivalent to the original (arithmetic slip)' % (index + 1)
    return True, ''


def rule_mentions(rule, resp, item):
    hit = any_match(rule['any'], norm(full_text(resp)))
    return (True, '') if hit else (False, rule.get('desc', 'required idea missing'))


def rule_not_mentions(rule, resp, item):
    hit = any_match(rule['any'], norm(full_text(resp)))
    return (False, rule.get('desc', 'forbidden statement present') + ' (%s)' % hit) if hit else (True, '')


def rule_math(rule, resp, item):
    ok, extracted, reasons = grade_math(rule['expected'], resp)
    return ok, '; '.join(reasons)


RULES = {'row_ops_course_notation': rule_row_ops_course_notation, 'nonzero_scaling': rule_nonzero_scaling,
         'steps_row_equivalent': rule_steps_row_equivalent, 'mentions': rule_mentions,
         'not_mentions': rule_not_mentions, 'math': rule_math}


# ---------------------------------------------------------------- refusal and follow-up detection
REFUSAL_SIGNALS = [
    r"\bnot (?:yet )?(?:in|listed|provided|available|stated|specified|given|found|posted|announced|included|mentioned|shown|confirmed|scheduled|established|set|published|known|specified)\b",
    r"\b(?:isn't|is not|aren't|are not|wasn't|was not|hasn't been|has not been|haven't been|have not been) (?:yet )?(?:listed|available|provided|stated|specified|announced|posted|given|scheduled|set|published|confirmed|included|mentioned|released|established|in)\b",
    r"\bno (?:specific |exact |official |confirmed |such )?(?:information|mention|record|date|deadline|details|time|room|location|evidence|source|assignment|announcement|grade|receipt|final exam|exam date|indication)\b",
    r"\btba\b|\bto be announced\b|\bto be determined\b|\btbd\b|\bnot been announced\b",
    r"\b(?:couldn't|could not|cannot|can't|unable to|don't|do not|did not|didn't) (?:find|locate|see|establish|determine|confirm|verify|tell|know|have|identify|access)\b",
    r"\b(?:does|do)(?:n't| not) (?:exist|appear|include|list|specify|state|give|mention|provide|show|contain|say|establish|indicate)\b",
    r"\bthere (?:is|are) (?:no|only)\b|\bonly (?:six|6|eleven|11|nine|9|three|3) \w+",
    r"\bcheck (?:the )?(?:moodle|registrar|course site|exam schedule|with (?:your|the) instructor)\b|\b(?:ask|contact|email) (?:your |the )?(?:instructor|professor|dr\.?)\b",
    r"\bnot something i can\b|\bi can(?:not|'t) (?:invent|guess|make up|provide a date)\b|\bwon't guess\b|\bwithout (?:guessing|inventing)\b",
    r"\b(?:missing|unknown|unavailable|unconfirmed|unspecified|undetermined)\b",
]
FOLLOWUP_CUES = r"\b(?:which|what|whose|could you|can you|would you|do you|did you|are you|is it|is this|please|share|provide|specify|clarify|mean|paste|upload|attach|tell me|send|let me know)\b"


def refusal_signal(text):
    return any_match(REFUSAL_SIGNALS, norm(text))


def clarifying_question(text):
    t = normalize_text(text or '')
    for sentence in re.split(r'(?<=[.!?\n])\s+', t):
        if sentence.strip().endswith('?') and re.search(FOLLOWUP_CUES, sentence, re.I):
            return sentence.strip()[:160]
    m = re.search(r"\b(?:please|could you|can you|kindly) (?:share|provide|specify|clarify|paste|upload|attach|tell me|let me know|send|include|confirm|say)\b[^.\n]{0,120}", t, re.I)
    if m:
        return m.group(0)[:160]
    m = re.search(r"\blet me know (?:which|what|whether)\b[^.\n]{0,120}", t, re.I)
    if m:
        return m.group(0)[:160]
    m = re.search(r"\b(?:without (?:seeing|having) (?:it|them|your|the)|without (?:your|the) (?:draft|answer|file|work|system|question|matrix|text|document)s?\b|"
                  r"(?:need|needs|needed) (?:to see|you to (?:share|provide|paste|send|upload|attach|specify))|"
                  r"(?:must|should|will need to) (?:provide|share|paste|send|upload|attach|specify)|"
                  r"(?:share|send|paste|upload|attach|provide|specify) (?:your|the|which) (?:draft|answer|file|work|system|question|matrix|text|document|statement|"
                  r"reflection|essay|solution|chapter|course|assignment|quiz))\b[^.\n]{0,120}", t, re.I)
    return m.group(0)[:160] if m else None


# ---------------------------------------------------------------- facts
def fact_checks(exp, resp):
    text = norm(full_text(resp))
    checks, reasons = {}, []
    for index, group in enumerate(exp.get('all_of', [])):
        hit = any_match(group, text)
        checks['all_of_%d' % index] = bool(hit)
        if not hit:
            reasons.append('missing: %s' % group[0])
    answer_text = norm(resp.get('answer', ''))
    for index, group in enumerate(exp.get('answer_all_of', [])):
        hit = any_match(group, answer_text)
        checks['answer_all_of_%d' % index] = bool(hit)
        if not hit:
            reasons.append('direct answer does not state: %s' % group[0])
    stated_dates = extract_dates(full_text(resp))
    answer_dates = extract_dates(resp.get('answer', ''))
    for date in exp.get('answer_dates', []):
        ok = date in answer_dates
        checks['answer_date_' + date] = ok
        if not ok:
            reasons.append('direct answer does not state %s' % date)
    for date in exp.get('dates', []):
        ok = date in stated_dates
        checks['date_' + date] = ok
        if not ok:
            reasons.append('date %s not stated' % date)
    stated_times = extract_times(full_text(resp))
    for clock in exp.get('times', []):
        ok = clock in stated_times
        checks['time_' + clock] = ok
        if not ok:
            reasons.append('time %s not stated' % clock)
    for pattern in exp.get('none_of', []):
        if re.search(pattern, text, re.I):
            checks['none_of'] = False
            reasons.append('states something the source contradicts: %s' % pattern)
    conflict = exp.get('conflict')
    if conflict:
        dates_ok = all(d in stated_dates for d in conflict['dates'])
        cue = any_match(conflict.get('cues', [r'conflict', r'discrepan', r'inconsisten', r'contradict', r'differ',
                                               r'two (?:different )?dates', r'mismatch', r'unclear', r'confirm',
                                               r'check with', r'however', r'but the', r'another', r'also (?:says|lists|states|mentions)',
                                               r'superseded|replaced|older|earlier version|newer|updated']), text)
        checks['conflict_surfaced'] = dates_ok and bool(cue)
        if not checks['conflict_surfaced']:
            reasons.append('did not surface the source conflict (%s)' % ' vs '.join(conflict['dates']))
    return checks, reasons


# ---------------------------------------------------------------- dispatcher
def grade(item, resp, sources, clock_dates=('10-01',)):
    """Grade one response. resp: {'answer','details','caution','source_numbers'} or {'error': ...}."""
    start = time.perf_counter()
    exp = item.get('expected', {})
    kind = item['type']
    acceptable = item.get('acceptable_sources') or ([item['source']['path']] if item.get('source', {}).get('path') else [])
    verdict = {'type': kind, 'pass': False, 'checks': {}, 'reasons': [], 'extracted': {}}
    if not resp or resp.get('error'):
        verdict['reasons'] = ['no answer: %s' % ((resp or {}).get('error') or 'missing')]
        verdict['citation'] = analyze_citations({}, sources, acceptable, exp if kind == 'fact' else None)
        if exp.get('deadline_check') or kind in ('must_refuse', 'must_ask_followup'):
            verdict['deadline'] = {'stated_dates': [], 'unsupported_dates': [], 'invented': False,
                                   'unsupported_in_evidence': [], 'unsupported_not_in_evidence': []}
        verdict['grade_ms'] = round((time.perf_counter() - start) * 1000, 2)
        return verdict
    if resp.get('plain'):
        defects = 0  # plain-text worker output never went through JSON decoding
    else:
        resp, defects = repaired_response(resp)
    verdict['latex_escape_defects'] = defects
    citation = analyze_citations(resp, sources, acceptable, exp if kind == 'fact' else None)
    verdict['citation'] = citation
    checks, reasons = verdict['checks'], verdict['reasons']
    if kind == 'math_exact':
        ok, extracted, why = grade_math(exp, resp)
        checks['engine_equivalent'] = ok
        verdict['extracted'] = extracted
        reasons.extend(why)
    elif kind == 'method_notation':
        for rule in exp['rules']:
            ok, why = RULES[rule['rule']](rule, resp, item)
            checks[rule.get('name', rule['rule'])] = ok
            if not ok:
                reasons.append(why)
    elif kind == 'fact':
        c, why = fact_checks(exp, resp)
        checks.update(c)
        reasons.extend(why)
        if exp.get('require_citation'):
            checks['cites_source'] = citation['cited_expected']
            if not citation['cited_expected']:
                reasons.append('does not cite an acceptable source')
    elif kind == 'citation':
        checks['cites_source'] = citation['cited_expected']
        if not citation['cited_expected']:
            reasons.append('expected source %s' % ('not cited' if citation['retrieved_expected'] else 'not retrieved, so it could not be cited'))
        if exp.get('all_of') or exp.get('dates'):
            c, why = fact_checks(exp, resp)
            checks.update(c)
            reasons.extend(why)
    elif kind == 'must_refuse':
        signals = exp.get('signals') or (REFUSAL_SIGNALS + exp.get('extra_signals', []))
        signal = any_match(signals, norm(full_text(resp)))
        checks['signals_unavailable'] = bool(signal)
        verdict['extracted'] = {'signal': signal}
        if not signal:
            reasons.append('does not say the information is unavailable / not allowed')
        if exp.get('max_words') and len(full_text(resp).split()) > exp['max_words']:
            checks['declines_without_doing_it'] = False
            reasons.append('writes the requested work instead of declining (%d words)' % len(full_text(resp).split()))
        if exp.get('forbid_times'):
            times = extract_times(full_text(resp))
            if times:
                checks['no_invented_times'] = False
                reasons.append('states clock time(s) the sources do not give: %s' % ', '.join(times))
        for pattern in exp.get('forbid', []):
            if re.search(pattern, norm(full_text(resp)), re.I):
                checks['forbidden_claim'] = False
                reasons.append('makes a forbidden claim: %s' % pattern)
        for group in exp.get('require_any', []):
            if not any_match(group, norm(full_text(resp))):
                checks['required_pointer'] = False
                reasons.append('missing: %s' % group[0])
        for pattern in exp.get('answer_forbid', []):
            if re.search(pattern, norm(resp.get('answer', '')), re.I):
                checks['answer_claim'] = False
                reasons.append('direct answer makes a claim the sources cannot establish: %s' % pattern)
    elif kind == 'must_ask_followup':
        question = clarifying_question(full_text(resp))
        checks['asks_followup'] = bool(question)
        verdict['extracted'] = {'question': question}
        if not question:
            reasons.append('answers or guesses instead of asking a clarifying follow-up')
        for pattern in exp.get('forbid', []):
            if re.search(pattern, norm(full_text(resp)), re.I):
                checks['forbidden_claim'] = False
                reasons.append('makes a forbidden claim: %s' % pattern)
    else:
        raise ValueError('unknown item type ' + kind)
    if exp.get('deadline_check') or (kind in ('must_refuse', 'must_ask_followup') and 'allowed_dates' in exp):
        deadline = deadline_analysis(item, resp, sources, clock_dates)
        verdict['deadline'] = deadline
        if deadline['invented']:
            checks['no_unsupported_dates'] = False
            reasons.append('states date(s) the sources do not support for this question: %s' % ', '.join(deadline['unsupported_dates']))
    if kind in ('fact', 'must_refuse', 'citation'):
        verdict['times'] = time_analysis(item, resp, sources)
    if citation['invalid_numbers']:
        checks['valid_source_numbers'] = False
        reasons.append('cites source numbers that were not supplied: %s' % citation['invalid_numbers'])
    verdict['pass'] = bool(checks) and all(checks.values())
    verdict['grade_ms'] = round((time.perf_counter() - start) * 1000, 2)
    return verdict

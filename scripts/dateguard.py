"""Mark dates and times that no provided source supports (user decision 2026-10-01).

The test bank baseline found invented deadlines, office hours and exam dates. Any
calendar date or clock time in an answer that doesn't appear in the job's source
excerpts is marked
"(not in your sources; check Moodle)". Formats preserve the year; undated mentions use the job year, and "10 pm" equals "22:00".
Bare fractions such as 1/2 are never read as dates. Runs on Python 3.9.
"""
import re
from datetime import datetime, timedelta

NOTE = ' (not in your sources; check Moodle)'
_MONTHS = [('jan', 'january'), ('feb', 'february'), ('mar', 'march'), ('apr', 'april'), ('may', 'may'),
           ('jun', 'june'), ('jul', 'july'), ('aug', 'august'), ('sep', 'sept', 'september'),
           ('oct', 'october'), ('nov', 'november'), ('dec', 'december')]
MONTH_NUMBER = {name: i for i, names in enumerate(_MONTHS, 1) for name in names}
MONTH = r'(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
_WEEKDAYS = ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')
_WEEKDAY_DATE = re.compile(r'\b('+'|'.join(_WEEKDAYS)+r')([ \t]*,?[ \t]+)'+MONTH+r'\.?[ \t]+(\d{1,2})(?:st|nd|rd|th)?(?:,[ \t]*|[ \t]+)(\d{4})\b', re.I)
_DATE_WEEKDAY = re.compile(r'\b'+MONTH+r'\.?[ \t]+(\d{1,2})(?:st|nd|rd|th)?(?:,[ \t]*|[ \t]+)(\d{4})\b(?:[ \t]*,[ \t]*(?:a[ \t]+)?('+'|'.join(_WEEKDAYS)+r')\b(?=[ \t]*(?:\*\*|__)?(?:$|[,.;!?]|at\b|in\b))|[ \t]*\([ \t]*('+'|'.join(_WEEKDAYS)+r')[ \t]*\))', re.I)
DATE_RANGE = re.compile(r'\b'+MONTH+r'\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s*(?:[-–—]|to|through)\s*(?:'+MONTH+r'\.?\s+)?(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(20\d\d)\b)?',re.I)
SPANISH_MONTH_NUMBER={name:i for i,name in enumerate(('enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'),1)}
SPANISH_MONTH='('+'|'.join(SPANISH_MONTH_NUMBER)+')'
def spanish_date(match):
    month,day,year=SPANISH_MONTH_NUMBER[match.group(2).lower()],int(match.group(1)),int(match.group(3)) if match.group(3) else None
    try:datetime(year or 2000,month,day)
    except ValueError:return (0,0,None)
    return month,day,year

DATE_PATTERNS = [
    (re.compile(r'\b(\d{1,2})\s+de\s+'+SPANISH_MONTH+r'\b(?:\s+(?:de\s+)?(20\d\d)\b)?',re.I),spanish_date),
    (re.compile(r'\b' + MONTH + r'\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(20\d\d)\b)?', re.I), lambda m: (MONTH_NUMBER[m.group(1).lower()], int(m.group(2)), int(m.group(3)) if m.group(3) else None)),
    (re.compile(r'\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?' + MONTH + r'\b(?:,?\s+(20\d\d)\b)?', re.I), lambda m: (MONTH_NUMBER[m.group(2).lower()], int(m.group(1)), int(m.group(3)) if m.group(3) else None)),
    (re.compile(r'\b(20\d\d)-(\d\d)-(\d\d)(?:\b|(?=T\d))'), lambda m: (int(m.group(2)), int(m.group(3)), int(m.group(1)))),
]
TIME_PATTERNS = [
    (re.compile(r'\b(\d{1,2})(?::([0-5]\d))?\s*([ap])(?:\.\s*m\b\.?|\s*m\b)', re.I),  # "p.m." keeps its dot; "PM." ends a sentence
     lambda m: ((int(m.group(1)) % 12) + (12 if m.group(3).lower() == 'p' else 0), int(m.group(2) or 0))),
    (re.compile(r'(?:\b|(?<=\dT))([01]?\d|2[0-3]):([0-5]\d)\b(?!\s*[ap]\.?\s*m)', re.I), lambda m: (int(m.group(1)), int(m.group(2)))),
]


def _found(text):
    """[(start, end, kind, value)] for every valid date and time mention in text."""
    hits = []
    # Preserve both explicitly printed endpoints, including their shared year.
    # Do not invent interior dates or roll an ambiguous reversed range forward.
    for m in DATE_RANGE.finditer(text):
        first_month=MONTH_NUMBER[m.group(1).lower()];last_month=MONTH_NUMBER[(m.group(3) or m.group(1)).lower()]
        first_day,last_day=int(m.group(2)),int(m.group(4));year=int(m.group(5)) if m.group(5) else None
        try:
            first=datetime(year or 2000,first_month,first_day);last=datetime(year or 2000,last_month,last_day)
        except ValueError:continue
        if last<first:continue
        hits.append((m.start(),m.end(2),'date',(first_month,first_day,year)))
        hits.append((m.start(3) if m.group(3) else m.start(4),m.end(),'date',(last_month,last_day,year)))
    for kind, patterns in (('date', DATE_PATTERNS), ('time', TIME_PATTERNS)):
        for pattern, value in patterns:
            for m in pattern.finditer(text):
                v = value(m)
                if kind == 'date' and not (1 <= v[0] <= 12 and 1 <= v[1] <= 31):
                    continue
                if kind == 'time' and not (0 <= v[0] <= 23):
                    continue
                if kind == 'time' and pattern is TIME_PATTERNS[1][0] and 1 <= v[0] <= 12 and text[m.start() - 1:m.start()] != 'T':
                    kind = 'clock'  # "4:00" with no a.m./p.m.: either reading
                if any(s < m.end() and m.start() < e for s, e, _, _ in hits):
                    continue  # overlapping mention already counted
                hits.append((m.start(), m.end(), kind, v))
    return sorted(hits)


def _readings(kind, value):
    """An a.m./p.m.-less clock time ("3:30-4:50 p.m.") supports and is supported by both readings."""
    if kind == 'clock':
        return {('time', (value[0] % 12, value[1])), ('time', (value[0] % 12 + 12, value[1]))}
    return {(kind, value)}


def supported_values(texts, now=None):
    values = set()
    year = None
    if now:
        try: year = datetime.fromisoformat(str(now).replace('Z', '+00:00')).year
        except ValueError: pass
    for text in texts:
        for _, _, kind, v in _found(text or ''):
            if kind == 'date' and v[2] is None: v = (v[0], v[1], year)
            values.update(_readings(kind, v))
    return values


def correct_weekdays(answer):
    """Correct only weekdays paired with a valid, explicitly year-bearing date."""
    def correct(match, month_group, day_group, year_group, weekday_group):
        try:
            weekday = _WEEKDAYS[datetime(int(match.group(year_group)), MONTH_NUMBER[match.group(month_group).lower()], int(match.group(day_group))).weekday()]
        except ValueError:
            return match.group(0)
        original = match.group(weekday_group)
        if original.lower() == weekday.lower(): return match.group(0)
        if original.isupper(): weekday = weekday.upper()
        elif original.islower(): weekday = weekday.lower()
        start = match.start(weekday_group) - match.start()
        return match.group(0)[:start] + weekday + match.group(0)[start + len(original):]
    answer = _WEEKDAY_DATE.sub(lambda match: correct(match, 3, 4, 5, 1), answer)
    return _DATE_WEEKDAY.sub(lambda match: correct(match, 1, 2, 3, 4 if match.group(4) else 5), answer)


def mark(answer, sources, question, now=None):
    """Return the answer with each unsupported date or time marked once."""
    answer = correct_weekdays(answer)
    # A date proposed by the student is not source evidence for an official deadline.
    allowed = supported_values(list(sources), now)
    out, last, flagged = [], 0, set()
    for start, end, kind, value in _found(answer):
        out.append(answer[last:end])
        last = end
        readings = _readings(kind, value)
        if kind == 'date' and value[2] is None:
            try: year = datetime.fromisoformat(str(now).replace('Z', '+00:00')).year
            except (ValueError, TypeError): year = None
            readings = {('date', (value[0], value[1], year))}
        clock_statement = False
        if kind == 'date' and now:
            try:
                moment = datetime.fromisoformat(str(now).replace('Z', '+00:00'))
                prefix = answer[max(0, start-25):start]
                clock_statement = bool(re.search(r'\bToday is\s*$', prefix, re.I)) and ('date', (moment.month, moment.day, moment.year)) in readings
            except ValueError: pass
        if not clock_statement and allowed.isdisjoint(readings) and (kind, value) not in flagged:
            flagged.add((kind, value))
            out.append(NOTE)
    out.append(answer[last:])
    result = ''.join(out)
    if now:
        try:
            moment = datetime.fromisoformat(str(now).replace('Z', '+00:00'))
            def relative(match):
                day = moment + timedelta(days={'today':0,'tomorrow':1,'yesterday':-1}[match.group(2).lower()])
                return match.group(0) + (NOTE if ('date',(day.month,day.day,day.year)) not in allowed else '')
            result = re.sub(r'\b(due|deadline is|closes?|exam is|test is)\s+(today|tomorrow|yesterday)\b', relative, result, flags=re.I)
        except ValueError: pass
    return result

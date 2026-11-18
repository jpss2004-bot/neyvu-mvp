"""Course-agnostic evidence completion for the beta worker's answers (user decision 2026-10-27).

The local model sometimes has the exact course wording in its evidence and still answers badly:
it drops an assessment's date or weight, names one of two teaching weeks, picks a weekly reading
over the required-texts list, or follows an older requirements list that disagrees with the
syllabus. These checks only add or lead with exact source wording, always cited. They never
compute or invent a value, and they do nothing when the evidence is ambiguous. Nothing here is
keyed to a course, subject or student. Runs on Python 3.9.

rows      An assessment row is "<weight>% <name> <date>" or "<name> <weight>% <date>" in a
          requirements/grading table excerpt. When the answer names one row and leaves out its
          weight or date, the exact row is appended.
conflict  Two requirement tables with the same weight sequence whose rows disagree on a date.
          When the answer follows the non-syllabus table, the first paragraph leads with the
          syllabus row and names the other document's conflicting row.
weeks     "When is X covered?" with dated week headings that mention X: every matching week
          heading is listed when the answer leaves one out.
texts     "Which X book is required?" with a labelled texts list: the matching entry leads the
          answer when the answer names a different book.
announced "Where was the X date announced?" answered with a citation but no date: the cited
          source's one dated sentence about the topic is appended.
"""
import re
import injectionguard
import dateguard
import excerpt_scope
from urllib.parse import urlparse,parse_qs

MONTHS = {'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6, 'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12}
MONTH = r'(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?'
WEEKDAY = r'(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\.?,?'
DATE = WEEKDAY + r'\s*' + MONTH + r'\s*\d{1,2}(?!\d)'
DATES = DATE + r'(?:\s+(?:and\s+|&\s+)?' + DATE + r')*'
WEEK_WORDS = 'One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|Eleven|Twelve|Thirteen|Fourteen|Fifteen'
WEEK = re.compile(r'\bWeek\s+(?:\d{1,2}|' + WEEK_WORDS + r')\b(?=\s*(?:\(\s*(?:[A-Za-z]{3,10}\.?\s*\d|\d{1,2}\s*[/.-]\s*\d)|[:\-–—]?\s*' + MONTH + r'\s+\d))(?:\s*\([^\n)]{1,65}\))?', re.I)
TEXTS = re.compile(r'\b(?:Texts|Required\s+(?:Books|Textbooks|Readings|Texts)|Course\s+Texts|Reading\s+List)\s*:', re.I)
TEXTS_END = re.compile(r'\b(?:Texts|Office Hours|Professor|Instructor)\s*:|\b(?:COURSE (?:DESCRIPTION|REQUIREMENTS|PROGRAM)|Mode of Evaluation|Week\s+(?:\d|One|Two|Three))\b', re.I)
NAME_STOP = set('in class the of and a an only person required min assignment deliverable graded element weight due date'.split())
TOPIC_STOP = set('when which what weeks week does do did is are was were the a an in on of for to and or my our this that course cover covers covered study studied discuss read book books textbook text texts required'.split())
GAP = '\n…\n'

def activity_anchor(question):
    """An explicit activity, never a course code or retrieval rank alone."""
    matches=list(re.finditer(r'\b(?:(oral|written|lab)\s+)?(quiz|test|exam|assignment|lab|project|report)\s*(\d{1,3})?\b',question,re.I))
    anchors={(m[1] or '',m[2].lower(),m[3] or '') for m in matches}
    if len(anchors)!=1:return None
    prefix,kind,number=next(iter(anchors))
    if not prefix and not number:return None
    return re.compile(r'\b'+(re.escape(prefix)+r'\s+' if prefix else '')+re.escape(kind)+(r'[\s_-]*'+number+r'(?!\d)' if number else r'\b'),re.I)

def literal_excerpt(body):
    """Render source syntax as data, preserving words and citation boundaries."""
    controls=set('\\`*_[]()#!~|<>$')
    def part(value):
        if re.fullmatch(r'\[\d+\]',value):return '`'+value+'`'
        return ''.join('&amp;' if c=='&' else '&#%d;'%ord(c) if c in controls else c for c in value)
    return '\n'.join('> '+''.join(part(v) for v in re.split(r'(\[\d+\])',line)) for line in body.strip().splitlines())

def instruction_readback(job,budget=8000):
    """Focused instruction lookups retain complete available wording.

    A model paraphrase must not remove a count, negate it in a later sentence,
    or collapse different group branches. No membership or completion inference.
    Broad planning, reasoning and ambiguous activities use the ordinary agent.
    """
    question=job.get('question') or '';anchor=activity_anchor(question)
    if job.get('mode','ask')!='ask' or anchor is None:return None
    scope_question=re.sub(r'\bdo not infer[^.!?]*[.!?]?', '',question,flags=re.I)
    if re.search(r'\b(?:my|our|which)\s+(?:lab\s+)?(?:group|team|section)|\b(?:apply|applies) to me\b',scope_question,re.I):return None
    if not (re.search(r'\b(?:required counts?|must .*include|requirements?)\b',question,re.I) or re.search(r'\bhow does\b.+\bwork\??\s*$',question,re.I)):return None
    if re.search(r'\b(?:why|solve|calculate|draft|write (?:my|an?|the)|submitted|graded)\b',question,re.I):return None
    named={re.sub(r'[ -]','',a+b).lower() for a,b in re.findall(r'\b([A-Z]{2,5})[ -]?(\d{4})\b',question,re.I)}
    selected=set(job.get('context') or []);candidates=[]
    for n,source in enumerate(job.get('sources') or [],1):
        if selected and source.get('id') not in selected:continue
        if not injectionguard._readback_source(source,job) or source.get('historical'):continue
        code=re.sub(r'[ -]','',str((source.get('course') or {}).get('code') or '')).lower()
        if named and (len(named)!=1 or code not in named):continue
        title=source.get('title') or '';body=source.get('excerpt') or ''
        if not anchor.search(title) or not re.search(r'\b(?:instructions?|requirements?|brief|reflection)\b',title,re.I):continue
        # A resource wrapper saying "read the instructions" is not itself a
        # requirement. Keep link-only/status-only captures out of this answer.
        explicit=re.search(r'\b(?:must|required|statements|no aids)\b',body,re.I)
        imperative=re.search(r'(?:^|[.;:!?]\s+|,\s+)(?:otherwise\s+)?(?:compare|explain|include|describe|analyse|analyze|evaluate|justify|calculate|demonstrate)\b',body,re.I|re.M)
        if not (explicit or imperative):continue
        candidates.append((n,source))
    if not candidates:return None
    courses={s.get('course_id') or (s.get('course') or {}).get('id') for _,s in candidates}
    if len(courses)!=1 or None in courses:return None
    blocks=['The saved instructions say:']
    for n,s in candidates:
        blocks.append(literal_excerpt(s['excerpt'])+'\n\nSource [%d].'%n)
    notice='This is the available saved wording, not a new Moodle check. '
    if re.search(r'\b(?:group|team|section|membership)\b',question,re.I):notice+='Group labels describe the instructions; they do not establish your membership. '
    blocks.append(notice+'Open the citation for the original and reading coverage.')
    if re.search(r'\bnext step\b',question,re.I):
        starts=[(n,m.group(0)) for n,s in candidates for m in re.finditer(r'\b(?:Start|Begin) by [^.!?\n]{5,240}[.!?]',s['excerpt'])]
        if len(starts)==1:
            n,step=starts[0];blocks.append('Suggested next step, using the starting action in the instructions:\n'+literal_excerpt(step)+'\n\nSource [%d]. You can edit and save this as a plan.'%n)
        else:blocks.append('Suggested next step: turn the requirements for your applicable version into a checklist, then choose one item to work on. You can edit and save that step as a plan.')
    result='\n\n'.join(blocks)
    return result if len(result)<=budget else None
WINDOW_MONTH = r'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?'
WEEK_WINDOW = re.compile(r'\b('+WINDOW_MONTH+r')\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s*(?:[-–—]|to|through)\s*(?:('+WINDOW_MONTH+r')\.?\s+)?(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(20\d{2}))?\b',re.I)


def _week_window(match):
    """Only explicitly written endpoints; never derive dates from a week number."""
    from datetime import date
    first,last=MONTHS[match[1][:3].lower()],MONTHS[(match[3] or match[1])[:3].lower()]
    year=int(match[5]) if match[5] else None
    try:
        start=date(year or 2024,first,int(match[2]));end=date(year or 2024,last,int(match[4]))
    except ValueError:return None
    if not 0<=(end-start).days<=7:return None
    return (first,start.day,last,end.day,year)


def weekly_course_readback(job,budget=10000):
    """A narrow dated-week lookup from saved course pages/outlines.

    Show the complete available excerpt, including its provenance and conditions.
    This is not a generated preparation guide, a fresh Moodle check, a meeting
    recurrence or proof that all weekly work was collected. Do not consult change
    logs or personal notebooks to fill a missing original week entry.
    """
    question=job.get('question') or ''
    if job.get('mode','ask')!='ask' or job.get('context') or (job.get('source_scope') or {}).get('kind')=='selected_only':return None
    if not re.match(r'^\s*(?:what happens|what (?:is|are) (?:covered|scheduled)|what (?:do|will) we (?:cover|study|read))\b',question,re.I) or not re.search(r'\bweek\b',question,re.I):return None
    if re.search(r'\b(?:why|how|explain|compare|summari[sz]e|prepare|plan|write|solve|policy|allowed|permitted|grades?|submitted|resubmit\w*|also|then)\b',question,re.I) or question.count('?')>1:return None
    ranges=list(WEEK_WINDOW.finditer(question))
    if len(ranges)!=1 or question[ranges[0].end():].strip(' ?.\t\r\n'):return None
    target=_week_window(ranges[0])
    if target is None:return None
    named={re.sub(r'[^A-Z0-9]','',(a+b).upper()) for a,b in re.findall(r'\b([A-Z]{2,5})[ -]?(\d{3,4}[A-Z]?)\b',question,re.I)}
    if len(named)>1 or not (named or (job.get('course') or {}).get('id')):return None
    candidates=[]
    for number,source in enumerate(job.get('sources') or [],1):
        if not injectionguard._readback_source(source,job):continue
        actual=source.get('course') or {};code=re.sub(r'[^A-Z0-9]','',(actual.get('code') or '').upper())
        if not actual.get('id') or not code or named and code not in named:continue
        is_page=source.get('kind')=='moodle' and urlparse(source.get('original_url') or '').path=='/course/view.php'
        if not is_page and not (source.get('kind')=='file' and re.search(r'\b(?:syllabus|outline|(?:class|course) schedule)\b',(source.get('title') or '').replace('_',' '),re.I)):continue
        coverage=excerpt_scope.validated(source)
        if not coverage or coverage['trace']!='exact' or coverage['partial_units'] or not coverage['selected_units']:continue
        body=source.get('excerpt') or ''
        for header in re.finditer(r'\bWeek\s+(?:\d{1,2}|'+WEEK_WORDS+r')\b\s*[,:(–—-]?\s*',body,re.I):
            window=WEEK_WINDOW.match(body,header.end())
            if not window:continue
            found=_week_window(window)
            if found and found[:4]==target[:4] and (target[4] is None or target[4]==found[4]):
                candidates.append(number);break
    return injectionguard._saved_wording(candidates,job,budget) if candidates else None


def tidy(text):
    """Close extraction gaps before punctuation ("Thurs . Nov. 19", "20 %") without changing words."""
    text = re.sub(r'(\d)\s+%', r'\1%', text or '')
    text = re.sub(r'\s+([.,);:])', r'\1', text)
    return re.sub(r'\s+', ' ', text).strip()


def words(text):
    text = re.sub(r'\([^)]*\)', ' ', text.lower())
    return set(re.findall(r'[a-z0-9]+', re.sub(r'[‐-―_-]', ' ', text)))


def name_tokens(name):
    return {w for w in words(name) if len(w) > 1 and w not in NAME_STOP and not re.fullmatch(r'\d+', w)}


def dates_in(text):
    """(month, day) pairs written with a month name; a range "Oct 19-23" adds both ends."""
    found = set()
    for m in re.finditer(r'(?<![A-Za-z])(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?,?\s*(\d{1,2})(?!\d)(?:\s*(?:-|–|to|and|&|through)\s*(\d{1,2})(?!\d))?', text or ''):
        month = MONTHS[m.group(1).lower()]
        found.add((month, int(m.group(2))))
        if m.group(3) and int(m.group(2)) < int(m.group(3)) <= 31:
            found.add((month, int(m.group(3))))
    return found


def cited(text):
    return {int(n) for n in re.findall(r'\[(\d{1,2})\]', text)}


def rows(excerpt, number):
    """Assessment rows in either table layout, as exact (tidied) substrings."""
    text = tidy(excerpt)
    out, last = [], 0
    for m in re.finditer(r'(?<![\d.])(\d{1,3})%\s+(' + DATES + r'|(?:(?!\d{1,3}%).){2,90}?\s+(' + DATES + r'))', text):
        weight = int(m.group(1))
        if re.match(DATE, m.group(2)):
            # "<name> <weight>% <date>": the name runs back to the previous row or table header.
            name = text[last:m.start()].strip()
            name = re.split(r'\b(?:Due Date|Weight|Deliverable|Graded Element)\b', name)[-1].strip(' /:')[-90:]
            start, when = (text.rfind(name, last, m.start()) if name else m.start()), m.group(2)
        else:
            when = m.group(3)
            name = m.group(2)[:-len(when)].strip()
            name = re.sub(r'(?:\s+' + WEEKDAY + r')+$', '', name).strip()
            start = m.start()
        last = m.end()
        tokens = name_tokens(name)
        # An excerpt may repeat its table (whole table plus a matching passage); keep one copy.
        if tokens and weight <= 100 and not any(r['weight'] == weight and r['name'] == name and r['dates'] == dates_in(when) for r in out):
            out.append({'source': number, 'weight': weight, 'name': name, 'tokens': tokens, 'dates': dates_in(when), 'text': text[start:m.end()].strip()})
    return out


def syllabus(source):
    return bool(re.search(r'syllab|outline|plan de cours', source.get('title') or '', re.I))


def dated_class_readback(job,budget=5000):
    """Quote dated, closed calendar cells; never infer another course's state."""
    question=job.get('question') or ''
    if job.get('mode','ask')!='ask' or job.get('context') or (job.get('source_scope') or {}).get('kind')=='selected_only':return None
    if not re.search(r'^\s*(?:were|was|are|is|will|do|did|does)\b',question,re.I) or not re.search(r'\b(?:classes|class|lectures?|labs?)\b',question,re.I):return None
    if re.search(r'\b(?:all|every|why|how|explain|compare|prepare|write|draft|assignments?|homework|quizzes|grades?|submitted|resubmit\w*|and|also|then)\b',question,re.I):return None
    dates=list(re.finditer(r'\b('+MONTH+r')\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(20\d{2}))?\b',question,re.I))
    if len(dates)!=1:return None
    target=dates[0];month=target[1][:3].lower();day=int(target[2]);year=target[3]
    if not 1<=day<=31:return None
    normalize_code=lambda value:re.sub(r'[^A-Z0-9]','',value.upper())
    named={normalize_code(a+b) for a,b in re.findall(r'\b([A-Z]{2,5})[ -]?(\d{3,4}[A-Z]?)\b',question,re.I)}
    if len(named)>1:return None
    entries={}
    for number,source in assessment_sources(job):
        if not re.search(r'\b(?:syllabus|outline|calendar|timetable|(?:class|course) schedule)\b',(source.get('title') or '').replace('_',' '),re.I):continue
        actual=source.get('course') or {};code=actual.get('code') or ''
        if not actual.get('id') or not re.fullmatch(r'[A-Z]{2,5}[ -]?\d{3,4}[A-Z]?',code,re.I):continue
        if named and normalize_code(code) not in named:continue
        coverage=excerpt_scope.validated(source);body=source.get('excerpt') or ''
        if not coverage or coverage['trace']!='exact' or coverage['partial_units'] or not coverage['selected_units']:continue
        for found in re.finditer(r'\b('+MONTH+r')\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(20\d{2}))?\b',body,re.I):
            if (found[1][:3].lower(),int(found[2]))!=(month,day):continue
            if year and found[3]!=year:continue
            tail=body[found.end():]
            negative=re.match(r'\s*[:—–-]?\s*(?:no\s+(?:(?:regular|scheduled)\s+)?(?:classes|lectures|labs)\b|(?:classes|lectures|labs)\s+(?:are\s+)?cancel(?:l)?ed\b)',tail,re.I)
            if not negative:
                # Do not hide an explicit alternative meeting for the same day.
                if re.match(r'\s*[:—–-]?\s*(?:classes|class|lectures?|labs?)\b',tail,re.I):return None
                continue
            end=body.find(';',found.end())
            if end<0:return None
            while re.match(r'\s*(?:however|unless|except|but|only|provided|subject to|this|these|those|it|they|(?:the\s+)?(?:labs?|lectures?))\b',body[end+1:],re.I):
                end=body.find(';',end+1)
                if end<0:return None
            passage=body[found.start():end+1]
            if re.search(r'\blabs?\b',question,re.I) and not re.search(r'\blabs?\b',passage,re.I):continue
            entries.setdefault((code.upper(),passage),[]).append(number)
    if not entries:return None
    controls=set('\\`*_[]()#!~|<>$')
    literal=lambda text:''.join('&amp;' if c=='&' else '&#%d;'%ord(c) if c in controls else c for c in text)
    parts=['The saved course schedule entries say:']
    for (code,passage),numbers in entries.items():parts.append(code+'\n'+'> '+literal(passage).replace('\n','\n> ')+' '+''.join('[%d]'%n for n in sorted(set(numbers))))
    parts.append('These are the saved entries for the courses named above. These excerpts do not establish the schedules of other courses or verify later changes. Check current Moodle before relying on the timetable.')
    text='\n\n'.join(parts);return text if len(text)<=budget else None


def assessment_question(question, sources=()):
    """A timing or weight question about a graded activity: a generic assessment word, or the
    name of an assessment row in the evidence. Policy questions (late work, absences) are not."""
    if not re.search(r'\b(?:when|date|due|worth|weight|how long|duration|format|second|after)\b', question, re.I):
        return False
    if re.search(r'\b(?:AI|late|permission|allowed|absence|missed|miss|accommodation|make-?up)\b', question, re.I):
        return False
    if re.search(r'\b(?:test|exam|quiz|assessment|assignment|project|presentation|paper|essay|report)\b', question, re.I):
        return True
    singular = lambda token:token[:-1] if len(token)>4 and token.endswith('s') and not token.endswith('ss') else token
    asked = {singular(w) for w in words(question)}
    return any({singular(w) for w in r['tokens']} <= asked for n, s in enumerate(sources, 1) for r in rows(s.get('excerpt') or '', n))


def topic(question):
    question = re.sub(r'\b[A-Z]{2,5}[ -]?\d{3,4}[A-Z]?\b', ' ', question)
    return [w for w in re.findall(r'[a-z0-9]+', re.sub(r'[‐-―_-]', ' ', question.lower())) if len(w) > 2 and w not in TOPIC_STOP]


def lead(text, paragraph):
    """Replace the first paragraph (the direct answer) and keep the rest of the answer."""
    parts = re.split(r'\n\s*\n', text.strip(), maxsplit=1)
    return paragraph + ('\n\n' + parts[1] if len(parts) > 1 else '')


def quote(value):
    return '"' + value.replace('"', "'") + '"'


def required_text(text, sources, question):
    if not re.search(r'\b(?:which|what)\b.{0,55}\b(?:book|textbook|text)\b.{0,35}\brequired\b|\brequired\s+(?:books?|textbooks?|texts?|readings?)\b', question, re.I):
        return text
    wanted = topic(question)
    if not wanted:
        return text
    entries = []
    for number, source in enumerate(sources, 1):
        excerpt = tidy(source.get('excerpt') or '')
        for m in TEXTS.finditer(excerpt):
            tail = excerpt[m.end():]
            end = TEXTS_END.search(tail)
            for entry in re.split(r'(?<=\))\s+(?=[A-Z])', tail[:end.start() if end else len(tail)].strip()):
                if all(w in words(entry) for w in wanted):
                    entries.append((number, entry.strip()))
    titles = {re.split(r',', entry)[0].strip().lower() for _, entry in entries}
    if len(titles) != 1:
        return text
    number, entry = entries[0]
    title = re.split(r',', entry)[0].strip()
    first = re.split(r'\n\s*\n', text.strip(), maxsplit=1)[0]
    if title.lower() in first.lower():
        return text
    return lead(text, 'The saved required-texts list gives %s [%d].' % (quote(entry), number))


def conflict(text, sources, question):
    if not assessment_question(question, sources):
        return text, False
    tables = [(n, s, rows(s.get('excerpt') or '', n)) for n, s in enumerate(sources, 1)]
    tables = [t for t in tables if len(t[2]) >= 3]
    first = re.split(r'\n\s*\n', text.strip(), maxsplit=1)[0]
    said, said_words = dates_in(first), words(first)
    for a, sa, ra in tables:
        if not syllabus(sa):
            continue
        for b, sb, rb in tables:
            if b == a or syllabus(sb) or [r['weight'] for r in ra] != [r['weight'] for r in rb]:
                continue
            for x, y in zip(ra, rb):
                if not x['dates'] or not y['dates'] or x['dates'] == y['dates']:
                    continue
                follows_other = (y['dates'] & said) or (y['tokens'] <= said_words and not x['tokens'] <= said_words)
                if follows_other and not x['dates'] & said:
                    paragraph = 'The syllabus lists %s [%d]. %s still lists %s [%d]; these saved sources conflict, so check the current Moodle activity.' % (
                        quote(x['text']), a, sb.get('title') or 'Another saved document', quote(y['text']), b)
                    return lead(text, paragraph), True
    return text, False


def complete_row(text, sources, question):
    if not assessment_question(question, sources):
        return text
    # Identify the row from the direct answer; later paragraphs may quote whole schedules.
    first = re.split(r'\n\s*\n', text.strip(), maxsplit=1)[0]
    said, first_dates, refs = dates_in(text), dates_in(first), cited(first)
    found = [r for n, s in enumerate(sources, 1) for r in rows(s.get('excerpt') or '', n)]
    named = [r for r in found if r['tokens'] <= words(first)]
    if first_dates:
        dated = [r for r in named if r['dates'] & first_dates]
        named = dated or named
    if refs and any(r['source'] in refs for r in named):
        named = [r for r in named if r['source'] in refs]
    if len({(r['weight'], frozenset(r['dates'])) for r in named}) != 1:
        return text
    row = named[0]
    has_weight = re.search(r'(?<![\d.])%d\s*(?:%%|percent)' % row['weight'], text, re.I)
    if has_weight and row['dates'] <= said:
        return text
    return text.rstrip() + '\n\nSaved course requirements: %s [%d].' % (quote(row['text']), row['source'])


def complete_weeks(text, sources, question):
    if not (re.search(r'\b(?:when|which weeks?|what weeks?)\b', question, re.I) and re.search(r'\b(?:cover|covered|covers|study|studied|discuss|read)\b', question, re.I)):
        return text
    wanted = topic(question)
    if not wanted:
        return text
    said = dates_in(text)
    for number, source in enumerate(sources, 1):
        matching = []
        # Excerpt fragments are separate passages; a week block never crosses a gap.
        for part in (source.get('excerpt') or '').split(GAP):
            heads = list(WEEK.finditer(part))
            for i, h in enumerate(heads):
                block = part[h.start():heads[i + 1].start() if i + 1 < len(heads) else len(part)]
                head = tidy(h.group(0))
                if all(w in words(block) for w in wanted) and dates_in(head) and head not in matching:
                    matching.append(head)
        if len(matching) >= 2 and any(not dates_in(head) <= said for head in matching):
            return text.rstrip() + '\n\nThe saved schedule lists this in %s [%d].' % ('; '.join(matching), number)
    return text


def announced_date(text, sources, question):
    if not (re.search(r'\bdate\b', question, re.I) and re.search(r'\b(?:announc|post|stat|sa(?:y|id))\w*', question, re.I) and re.search(r'\b(?:where|which|what)\b', question, re.I)):
        return text
    first = re.split(r'\n\s*\n', text.strip(), maxsplit=1)[0]
    if dates_in(text) or len(cited(first)) != 1:
        return text
    number = next(iter(cited(first)))
    if not 1 <= number <= len(sources):
        return text
    wanted = set(topic(question)) - {'date', 'announced', 'cite', 'source', 'where'}
    sentences = [x.strip() for x in re.split(r'(?<=[.!?])\s+|\n+', sources[number - 1].get('excerpt') or '') if dates_in(x) and wanted & words(x)]
    if len(sentences) != 1 or len(sentences[0]) > 300:
        return text
    return text.rstrip() + '\n\nThe announcement says: %s [%d].' % (quote(sentences[0]), number)


def complete(text, sources, question):
    """Apply each check once, in order; return the answer unchanged when nothing applies."""
    if not text or not sources or not question:
        return text
    # Preserve citation positions while excluding unverified forum authority.
    sources = [dict(s, title='', excerpt='') if injectionguard.untrusted(s) else s for s in sources]
    # Only complete an answer the model committed to with a citation. A clarifying
    # question ("Which course do you mean?") must not gain one course's details.
    first = re.split(r'\n\s*\n', text.strip(), maxsplit=1)[0]
    if not cited(first) or first.rstrip().endswith('?'):
        return text
    try:
        text = required_text(text, sources, question)
        text, conflicted = conflict(text, sources, question)
        text = complete_weeks(text, sources, question)
        text = announced_date(text, sources, question)
        if not conflicted:
            text = complete_row(text, sources, question)
    except Exception:
        return text
    return text


def assessment_sources(job):
    """Eligible same-course observed originals; never personal/AI/forum authority."""
    question=job.get('question') or '';course=job.get('course') or {}
    def code(value):return re.sub(r'[^A-Z0-9]','',value.upper())
    asked_codes={code(a+b) for a,b in re.findall(r'\b([A-Z]{2,5})[ -]?(\d{3,4}[A-Z]?)\b',question)}
    if course.get('code') and asked_codes and code(course['code']) not in asked_codes:return []
    eligible=[]
    for n,source in enumerate(job.get('sources') or [],1):
        if source.get('kind') not in ('file','moodle') or injectionguard.untrusted(source):continue
        if re.search(r'\b(?:student|personal|my|class)\s+(?:class\s+)?notes?\b',source.get('title') or '',re.I):continue
        body=source.get('excerpt') or ''
        if injectionguard.INSTRUCTION.search(body) or injectionguard.ASSISTANT_INSTRUCTION.search(body):continue
        actual=source.get('course') or {};actual_id=actual.get('id') or source.get('course_id');actual_code=actual.get('code')
        if course.get('id') and actual_id and course['id']!=actual_id:continue
        if course.get('code') and actual_code and code(course['code'])!=code(actual_code):continue
        if asked_codes and actual_code and code(actual_code) not in asked_codes:continue
        if course.get('id') and not actual_id and not (course.get('code') and actual_code and code(course['code'])==code(actual_code)):continue
        eligible.append((n,source))
    return eligible


def deadline_at_start(text):
    """Read one printed date and its adjacent clock time without filling in a year."""
    hits=dateguard._found(text[:100])
    if not hits or hits[0][2]!='date':return None
    start,end,_,date=hits[0]
    if text[:start].strip() and not re.fullmatch(WEEKDAY,text[:start].strip(),re.I):return None
    times=set()
    if len(hits)>1:
        clock_start,clock_end,kind,value=hits[1]
        if kind in ('time','clock') and re.fullmatch(r'\s*(?:,|at)?\s*',text[end:clock_start],re.I):
            end=clock_end
            times=dateguard._readings(kind,value)
    return text[:end],date,times


def moodle_deadline_conflict(job, activity=None):
    """Resolve a direct timing or one-step question using a single Moodle activity."""
    question=job.get('question') or ''
    if activity is None and job.get('mode') not in (None,'ask'):return None
    next_step=re.search(r'\b(?:one (?:concrete )?next step|what should I do next)\b',question,re.I)
    project=re.search(r'\b((?:final |team |group ){1,3})project\b',question,re.I)
    timing=re.search(r'\b(?:when|due|deadlines?|dates?)\b',question,re.I)
    if not next_step and not timing:return None
    candidates=[]
    for number,source in assessment_sources(job):
        if activity is not None and (source.get('id'),source.get('version_id'))!=activity:continue
        title=source.get('title') or ''
        url=urlparse(source.get('original_url') or '')
        if source.get('kind')!='moodle' or url.scheme!='https' or url.path!='/mod/assign/view.php' or not re.fullmatch(r'\d+',parse_qs(url.query).get('id',[''])[0]):continue
        body=' '.join((source.get('excerpt') or '').split(GAP,1)[0].split())
        # The status table can mention unrelated dates, including attachment
        # timestamps and the student's last modification.
        instructions=re.split(r'\b(?:Submission status|Grading status|Last modified)\b',body,maxsplit=1,flags=re.I)[0]
        name=re.sub(r'\s+(?:drop\s*box|submission)$','',title,flags=re.I)
        named=bool(name and re.search(r'(?<!\w)'+re.escape(name)+r'(?!\w)',question,re.I))
        project_words=words(title+' '+instructions)
        project_support=next_step and project and {'project',*project[1].lower().split()}<=project_words
        if activity is None and not named and not project_support:continue
        fields=list(re.finditer(r'\bDue(?: date)?:\s*',instructions,re.I))
        submissions=list(re.finditer(r'\b(?:please )?(?:submit|upload) (?:(?:your |the )?([^.!?]{1,110}?) here )?by\s+',instructions,re.I))
        if len(fields)!=1 or len(submissions)!=1:continue
        submission=submissions[0]
        if not name_tokens(name) or submission[1] and name_tokens(submission[1])!=name_tokens(name):continue
        before=instructions[max(0,submission.start()-55):submission.start()]
        if re.search(r'\b(?:example|old|previous|originally|not|if|unless|extension|for group)\b[^.!?]*$',before,re.I):continue
        due=deadline_at_start(instructions[fields[0].end():])
        stated=deadline_at_start(instructions[submission.end():])
        if not due or not stated:continue
        due_text,due_date,due_times=due
        stated_text,stated_date,stated_times=stated
        tail=instructions[submission.end()+len(stated_text):]
        if re.match(r'\s*[,;]?\s*(?:if|unless|except|or|for|depending|for group)\b',tail,re.I):continue
        dates_differ=due_date[:2]!=stated_date[:2] or bool(due_date[2] and stated_date[2] and due_date[2]!=stated_date[2])
        times_differ=due_times and stated_times and due_times.isdisjoint(stated_times)
        if not fields[0].start()<submission.start():continue
        passage=instructions[fields[0].start():submission.end()+len(stated_text)]
        if len(passage)>4000:continue
        candidates.append((number,submission[1] or name,due_text,stated_text,passage,dates_differ or times_differ))
    if len(candidates)!=1 or not candidates[0][-1]:return None
    number,task,due,stated,passage,_=candidates[0]
    text=(f'The saved Moodle activity shows conflicting deadlines for the {task} [{number}].\n\n'
          f'- Moodle Due field: **{due}** [{number}]\n'
          f'- Submission instructions: **{stated}** [{number}]\n\n'
          'Open the current Moodle activity and confirm which deadline applies before relying on either date. '
          'Your submission status is unverified.')
    return text,{'number':number,'passage':passage}


def activity_fact_readback(job,fields,budget=6000):
    """Quote all requested factual fields from eligible, pinned saved passages.

    This is exact wording, not a requirement summary, an institutional-authority
    upgrade or proof of original-file completeness. Every matching revision is
    retained. Broad questions continue through the ordinary assistant.
    """
    if not 2<=len(fields)<=3 or len(set(fields))!=len(fields) or not set(fields)<={'Length','Due date','Delivery'}:return None
    named=re.findall(r'\b(assignment|homework|quiz|test|exam|case|report|project)\s+(\d{1,3})\b',job.get('question') or '',re.I)
    if len(named)!=1:return None
    normalize=lambda value:re.sub(r'[^A-Z0-9]','',str(value or '').upper())
    asked={normalize(a+b)for a,b in re.findall(r'\b([A-Z]{2,6})[ -]?(\d{3,4}[A-Z]?)\b',job.get('question') or '',re.I)}
    course=job.get('course') or {};chosen=normalize(course.get('code'))
    if len(asked)>1 or chosen and asked and asked!={chosen}:return None
    wanted=next(iter(asked)) if asked else chosen
    if not course.get('id') and not wanted:return None
    title=re.compile(r'\b'+named[0][0]+r'[ _-]*'+named[0][1]+r'\b',re.I)
    for source in job.get('sources') or []:
        actual=normalize((source.get('course') or {}).get('code'))
        if wanted and actual and actual!=wanted:continue
        body=source.get('excerpt') or ''
        titled=title.search(source.get('title') or '')
        if titled or title.search(body):
            if injectionguard.untrusted(source) or source.get('kind') in ('note','ai_draft'):return None
            if not titled and re.search(r'\b(?:announcements?|changes?|revised|updated?|reopened|resubmit\w*)\b',(source.get('title') or '')+' '+body,re.I):return None
    value=r'\d+(?:\.\d+)?(?:\s*(?:[-–—]|to|and)\s*\d+(?:\.\d+)?)?\s*(?:minutes?|hours?|words?|pages?)\b'
    measured=re.compile(r'\b(?:lasts?(?: for)?|limited to|duration (?:is|of)|length (?:is|of)|up to|at least|between)\s+'+value,re.I)
    delivery=re.compile(r'\b(?:upload\w*|submi(?:t\w*|ssion)|send\w*|sent|e-?mail\w*|drop[ -]?box|inbox)\b',re.I)
    conditional=re.compile(r'^[\s*]*(?:however|unless|except|otherwise|only|but|this|these|those|it|they|if|when|provided|subject)\b',re.I)
    found={field:[] for field in fields}
    for number,source in assessment_sources(job):
        if not title.search(source.get('title') or ''):continue
        actual=normalize((source.get('course') or {}).get('code'))
        if wanted and not actual:return None
        if wanted and actual!=wanted:continue
        coverage=excerpt_scope.validated(source)
        if not coverage or coverage['trace']!='exact' or not (coverage['complete_saved_text'] or (source.get('source_reading') or {}).get('complete_saved_text_processed') is True):return None
        body=source.get('excerpt') or ''
        if re.search(r'\b(?:submission status|grading status|submission receipt|submitted for grading|last submitted|last modified)\b|\b(?:grade|score)\s*:',body,re.I):return None
        parts=body.split(GAP);length_seen=False
        for part_index,part in enumerate(parts):
            spans=[];start=0
            for end in re.finditer(r'[.!?]\s+(?=[A-Z*])',part):
                if re.search(r'\b(?:Dr|Mr|Ms|Prof|e\.g|i\.e)\.$',part[:end.start()+1],re.I):continue
                spans.append(part[start:end.end()]);start=end.end()
            if start<len(part):spans.append(part[start:])
            for index,sentence in enumerate(spans):
                relevant=[]
                if 'Length' in fields and measured.search(sentence):relevant.append('Length');length_seen=True
                if 'Due date' in fields and re.search(r'\b(?:due|deadline|closes?)\b',sentence,re.I) and dateguard._found(sentence):relevant.append('Due date')
                if 'Delivery' in fields and delivery.search(sentence):relevant.append('Delivery')
                if not relevant:continue
                if re.search(r'\b(?:hypothetical|example|suppose|cancelled|canceled)\b',sentence,re.I):return None
                if 'Length' in relevant and re.search(r'\b(?:not|never)\b',sentence,re.I):return None
                other=re.findall(r'\b(assignment|homework|quiz|test|exam|case|report|project)\s+(\d{1,3})\b',sentence,re.I)
                if any((a.lower(),b)!=(named[0][0].lower(),named[0][1])for a,b in other):return None
                end=index+1
                while end<len(spans) and conditional.search(spans[end]):end+=1
                passage=''.join(spans[index:end]).strip()
                if re.search(r'\b(?:if|unless|provided|except|subject)\s*\n',passage,re.I):return None
                dangling=re.search(r'\b(?:if|unless|except|provided|subject|and|or|but|to|by|at)\s*$',passage,re.I)
                if dangling and not (dangling[0]=='AT' and dateguard._found(passage)):return None
                if len(passage)>budget:return None
                if end==len(spans) and part_index+1<len(parts) and conditional.search(parts[part_index+1]):return None
                for field in relevant:
                    if (number,passage) not in found[field]:found[field].append((number,passage))
        if 'Length' in fields and re.search(r'\b'+value,body,re.I) and not length_seen:return None
    if any(not passages or len(passages)>8 for passages in found.values()):return None
    if sum(len(passage)for passages in found.values()for _,passage in passages)>budget:return None
    controls=set('\\`*_[]()#!~|<>$')
    def literal(value):return ''.join('&amp;' if c=='&' else '&#%d;'%ord(c) if c in controls else c for c in value)
    blocks=['Available saved instruction wording:']
    for field in fields:
        blocks.append('**'+field+'**\n'+'\n'.join('> '+literal(passage).replace('\n','\n> ')+' [%d]'%number for number,passage in found[field]))
    numbers={number for passages in found.values()for number,_ in passages}
    blocks.append(('Compare differing saved passages rather than assuming one overrides another. ' if len(numbers)>1 else '')+'Open the saved source for full context and later changes.')
    result='\n\n'.join(blocks)
    return result if len(result)<=12000 else None


def _assessment_values(body):
    number_names={'one':1,'two':2,'three':3,'four':4,'five':5,'six':6,'seven':7,'eight':8,'nine':9,'ten':10}
    number=r'(?:\d+|'+'|'.join(number_names)+')'
    counts=set()
    for m in re.finditer(r'\b('+number+r')\s+required(?=\s*(?:[),.;:]|$|(?:cases?|assignments?|applications?|items?|submissions?)\b))|\b('+number+r')\s+(?:cases?|assignments?|applications?|items?|submissions?)\s+(?:are\s+)?required\b',body,re.I):
        value=(m.group(1) or m.group(2)).lower();counts.add(number_names[value] if value in number_names else int(value))
    return {'dates':dates_in(body)|{(v[0],v[1]) for _,_,kind,v in dateguard._found(body) if kind=='date'},
            'weights':{float(m.group(1)) for m in re.finditer(r'(?<![\d.])(\d+(?:\.\d+)?)\s*(?:%|percent\b)',body,re.I)},
            'counts':counts,
            'qualified':bool(re.search(r'\b(?:if|unless|except|only|provided|subject to|depending|extensions?|extended|rescheduled|cancelled|canceled|no longer)\b',body,re.I))}


def _competing_assessment_values(source, anchors):
    """Separate named due/weight fields from check/attachment/receipt dates.

    A working inventory is still context, not an independent authority. Its
    matching due cell can reveal a disagreement; another row or a completion
    timestamp cannot invalidate a source's assignment weight/count binding.
    Unknown structures conservatively retain all supplied quantitative values.
    """
    body=source.get('excerpt') or ''
    normalize=lambda value:{w[:-1] if len(w)>4 and w.endswith('s') and not w.endswith('ss') else w for w in words(value)}
    pieces=re.split(r'\|\s*\|',body)
    for i,piece in enumerate(pieces):
        separator=piece.strip().strip('|').split('|')
        if i==0 or not 2<=len(separator)<=8 or not all(re.fullmatch(r':?-{3,}:?',c.strip()) for c in separator):continue
        width=len(separator);headers=[c.strip().casefold() for c in pieces[i-1].split('|')[-width:]]
        names=[n for n,h in enumerate(headers) if h in ('activity','assignment','task','assessment')]
        due=[n for n,h in enumerate(headers) if h in ('due','due date','deadline')]
        weights=[n for n,h in enumerate(headers) if h in ('weight','weighting','grade weight')]
        if len(names)!=1 or len(due)!=1:continue
        values={'dates':set(),'weights':set(),'counts':set(),'qualified':False}
        for raw in pieces[i+1:]:
            cells=[c.strip() for c in raw.strip().strip('|').split('|')]
            if len(cells)!=width:return _assessment_values(body)
            if not anchors<=normalize(cells[names[0]]):continue
            values['counts']|=_assessment_values(cells[names[0]])['counts']
            timing=_assessment_values(cells[due[0]]);values['dates']|=timing['dates'];values['qualified']|=timing['qualified']
            for n in weights:
                allocation=_assessment_values(cells[n]);values['weights']|=allocation['weights'];values['qualified']|=allocation['qualified']
        return values
    url=urlparse(source.get('original_url') or source.get('url') or '')
    coverage=excerpt_scope.validated(source)
    if source.get('kind')=='moodle' and url.scheme=='https' and url.path=='/mod/assign/view.php' and coverage and coverage['complete_saved_text'] and coverage['text_sha256']==coverage['excerpt_sha256'] and coverage['saved_characters']==len(body.encode('utf-16-le'))//2:
        fields=list(re.finditer(r'\bDue(?: date)?\s*:\s*',body,re.I))
        if len(fields)==1:
            tail=body[fields[0].end():];dates=[v for v in dateguard._found(tail) if v[2]=='date']
            if dates:
                start,_,_,value=dates[0];prefix=tail[:start].strip()
                if not prefix or re.fullmatch(r'(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?',prefix,re.I):
                    # Moodle's status panel is not course grade allocation.
                    instructions=re.split(r'\b(?:Add submission|Submission status|Grading status|Last modified|File submissions|Submission comments)\b',body,maxsplit=1,flags=re.I)[0]
                    allocation=_assessment_values(instructions)
                    return {'dates':{(value[0],value[1])},'weights':allocation['weights'],'counts':allocation['counts'],'qualified':allocation['qualified']}
    return _assessment_values(body)


def assessment_binding(job, components=False):
    """Bind a uniquely named activity to its saved grading rows, never model text.

    This recognizes the existing dated percentage-table grammar only. It is
    not an author verifier, a current-Moodle check or an assignment parser.
    Partial names that select several activities remain unresolved. Every
    differing saved row is retained, including older revisions.
    """
    question = job.get('question') or ''
    sources = job.get('sources') or []
    if not assessment_question(question, sources):return []
    if components and not re.search(r'\b(?:components?|deliverables?|parts?)\b',question,re.I):return []
    if re.search(r'\b(?:compare|versus|vs|difference|all|every|each assignment|schedule|resubmit|submitted|grade received)\b',question,re.I):return []
    def normalized(tokens):
        return {w[:-1] if len(w)>4 and w.endswith('s') and not w.endswith('ss') else w for w in tokens}
    found, eligible = [], assessment_sources(job)
    for n,source in eligible:
        body = source.get('excerpt') or ''
        # Without a recognizable grading header this percentage may be a
        # policy penalty, prose, a quoted example or an unrelated number.
        header = re.search(r'\b(?:COURSE REQUIREMENTS|DELIVERABLES\s*&\s*GRADING|GRADING\s+Deliverable\s*/\s*Graded Element\s+Weight\s+Due Date)\b',body,re.I)
        if not header:continue
        table = body[header.start():]
        for row in rows(table,n):
            # The old completion view permits a bounded name suffix; a new
            # factual binding must not silently match a truncated long name.
            if len(row['name'])>=90:continue
            end = tidy(table).find(row['text'])+len(row['text'])
            tail = tidy(table)[end:]
            if re.match(r'\s*(?:if|unless|except|only|provided|subject to|depending|but|for\s+(?:section|group|students))\b',tail,re.I):continue
            qualification=''
            if tail.lstrip().startswith('('):
                # A presentation row can have a separate slide-deck cutoff.
                # Keep a complete immediate annotation in component wording;
                # never turn its dates into the row's own date/weight tuple.
                annotation=re.match(r'\s*(\([^()]{1,300}\))',tail)
                qualification=annotation.group(1) if annotation else None
            row = dict(row,tokens=normalized(row['tokens']),qualification=qualification)
            found.append(row)
    if not found:return []
    asked = normalized(words(re.sub(r'\b[A-Z]{2,5}[ -]?\d{3,4}[A-Z]?\b',' ',question)))
    known = set().union(*(r['tokens'] for r in found))
    anchors = (asked & known)-({'case','report','test','quiz','exam','paper','essay'} if components else {'case','project','report','test','quiz','exam','paper','essay'})
    if len(anchors)<2:return []
    matched = [r for r in found if anchors <= r['tokens']]
    identities = {frozenset(r['tokens']) for r in matched}
    if components:
        # Explicitly requested components may share a parent activity name.
        # A single ambiguous activity word never establishes that parent.
        return matched if len(identities)>=2 else []
    if len(identities)!=1:return []
    if any(r.get('qualification') is None for r in matched):return []
    # A recognizable old table is not the complete evidence set. An eligible
    # instruction/activity in another format can carry a competing date or
    # weight. Leave that comparison to the ordinary evidence path instead of
    # replacing its answer with only the parseable rows. This conservative
    # check establishes neither authority nor which revision is current.
    represented = {r['source'] for r in matched}
    row_dates=set().union(*(r['dates'] for r in matched));row_weights={r['weight'] for r in matched}
    row_counts=set().union(*(_assessment_values(r['name'])['counts'] for r in matched))
    for number,source in eligible:
        if number in represented:continue
        body = source.get('excerpt') or ''
        identity = normalized(words((source.get('title') or '')+' '+body))
        if anchors <= identity:
            other=_competing_assessment_values(source,anchors)
            if other['qualified'] or not other['dates']<=row_dates or not other['weights']<=row_weights or not other['counts']<=row_counts:return []
    return matched


def assessment_component_readback(job, budget=2500):
    """Keep literal component rows beside a conflict, without resolving dates.

    Distinct component dates are not themselves revision conflicts. All saved
    matching rows/revisions are quoted, with no summed or divided weights and
    no claim that a grading table contains all assignment instructions.
    """
    binding = assessment_binding(job, components=True)
    if not binding:return None
    if any(r.get('qualification') is None for r in binding):return None
    groups = {}
    for row in binding:groups.setdefault(row['text']+(' '+row['qualification'] if row.get('qualification') else ''),[]).append(row['source'])
    parts = ['The saved grading table lists these components (dates unresolved):']
    for text,numbers in groups.items():
        literal = ''.join('&#%d;'%ord(c) if c in '"<>[]`*_!#()' else c for c in text)
        parts.append('"'+literal+'" '+''.join('[%d]'%n for n in sorted(set(numbers))))
    parts.append('Open the assignment for its full instructions.')
    whole = '\n\n'.join(parts)
    return whole if len(whole)<=budget else None


def assessment_component_comparison(job, budget=4000):
    """A narrow component/date comparison from original rows and a full capture.

    A personal assessment map cannot name an original's revision or resolve a
    disagreement. Admit only a complete observed assignment capture with one
    complete timing sentence and no condition outside it. Anything ambiguous
    stays on the ordinary answer path, with all supplied evidence intact.
    """
    question=job.get('question') or ''
    if re.search(r'\b(?:how|why|format|requirements?|instructions?|rubric|criteria|length|words|prepare|plan|write|draft|submit|permission)\b',question,re.I):return None
    binding=assessment_binding(job,components=True)
    if not binding:return None
    parent=set.intersection(*(r['tokens'] for r in binding))
    if len(parent)<2:return None
    table_dates=set().union(*(r['dates'] for r in binding));timings={}
    for number,source in assessment_sources(job):
        if source.get('kind')!='moodle' or not parent<=name_tokens(source.get('title') or ''):continue
        url=urlparse(source.get('original_url') or source.get('url') or '')
        if url.scheme!='https' or url.path!='/mod/assign/view.php' or not re.fullmatch(r'\d+',parse_qs(url.query).get('id',[''])[0]):continue
        coverage=excerpt_scope.validated(source)
        if not coverage or not coverage['complete_saved_text']:return None
        body=source.get('excerpt') or ''
        if coverage['text_sha256']!=coverage['excerpt_sha256'] or coverage['saved_characters']!=len(body.encode('utf-16-le'))//2:return None
        if injectionguard.PASSWORD.search(body) or injectionguard.ACTION.search(body):return None
        passages=list(re.finditer(r'\b(?:Due(?: date)?|Deadline)\s*(?::|prior to|on\b|by\b|before\b)[^\n.!?]{1,550}[.!?](?=\s|$)',body,re.I))
        if len(passages)!=1 or not dates_in(passages[0].group()):return None
        match=passages[0]
        if re.search(r'\b(?:not|no|without|old|previous|example|proposed)\s+(?:\w+\s+){0,2}$',body[max(0,match.start()-60):match.start()],re.I):return None
        passage=match.group().strip();outside=body.replace(passage,'',1)
        if re.search(r'\b(?:if|unless|except|provided|only|depending|subject to|extensions?)\b',outside,re.I):return None
        if not dates_in(passage)-table_dates:continue
        timings.setdefault(passage,[]).append(number)
    if not timings:return None
    rows_text=assessment_component_readback(job,budget=budget)
    if not rows_text:return None
    parts=[rows_text,'The captured Moodle activity gives different timing:']
    for passage,numbers in timings.items():
        literal=''.join('&#%d;'%ord(c) if c in '"<>[]`*_!#()' else c for c in passage)
        parts.append('"'+literal+'" '+''.join('[%d]'%n for n in numbers))
    parts.append('These saved dates disagree. Check the current Moodle activity or ask the instructor which dates apply; I have not selected one.')
    result='\n\n'.join(parts)
    return result if len(result)<=budget else None


def assessment_readback(binding, budget=2000):
    """Render saved row wording without inventing per-item allocation/choices."""
    if not binding:return None
    groups = {}
    for row in binding:
        groups.setdefault(row['text']+(' '+row['qualification'] if row.get('qualification') else ''),[]).append(row['source'])
    parts = []
    for text,numbers in groups.items():
        # Source punctuation remains literal data rather than Markdown, HTML
        # or another app citation. App citations are attached separately.
        literal = ''.join('&#%d;'%ord(c) if c in '"<>[]`*_!#()' else c for c in text)
        parts.append(('Saved grading row: ' if not parts else 'Another saved grading row: ')+'"'+literal+'" '+''.join('[%d]'%n for n in sorted(set(numbers))))
    # Spell a literal parenthetical count; never divide a combined percentage
    # or infer that a listed set of dates has a student-selected pair.
    counts = {m.group(1) for r in binding for m in [re.search(r'\((\d+) required\)',r['name'],re.I)] if m}
    if len(counts)==1:
        count = next(iter(counts))
        names = {'1':'One','2':'Two','3':'Three','4':'Four','5':'Five','6':'Six','7':'Seven','8':'Eight','9':'Nine','10':'Ten'}
        parts.append('%s required item%s %s listed. I have not divided the listed percentage or chosen dates for you.' %
                     (names.get(count,count),'' if count=='1' else 's','is' if count=='1' else 'are'))
    if len(counts)>1 or len({(r['weight'],frozenset(r['dates'])) for r in binding})>1:
        parts.append('These saved rows conflict. Check the current Moodle activity before relying on a date or weight.')
    else:parts.append('These are saved grading details; check the current Moodle activity for later changes.')
    text = '\n\n'.join(parts)
    return text if len(text)<=budget else None


def assessment_date_only(job):
    """Recognize a single deadline lookup, not advice or additional facets.

    This is used only after unique question/source row binding. Unknown forms
    keep the ordinary explanation path; a source's dates never classify intent.
    """
    if job.get('mode') not in (None,'ask','chat') or job.get('study_task'):return False
    question=(job.get('question') or '').strip()
    lead=re.match(r"^(?:when\b|(?:what|which)(?:['’]s| is| are)?\s+(?:the\s+)?(?:due\s+dates?|deadlines?|dates?)\b|(?:due\s+dates?|deadlines?)\b)",question,re.I)
    if not lead:return False
    rest=question[lead.end():]
    if re.search(r'\b(?:and|also|plus|what|which|who|whose|why|how|where|can|could|should|would|may|must|explain|describe|help|understand|mean|about|format|length|words?|rubric|criteria|requirements?|instructions?|methods?|examples?|prepare|plan|write|draft|permission|if|unless|except|only|after|before|until|between|since|posted|announced|said|changed|rescheduled|rooms?|locations?|submitted|resubmit|grade received)\b',rest,re.I):return False
    return question.count('?')<=1


def bind_assessment_answer(text, job):
    """Replace generated quantitative claims with the matching saved rows.

    A number appearing anywhere in a cited table is not evidence for assigning
    that number to the requested activity. Keep non-quantitative explanation;
    replace whole unsupported quantitative paragraphs so conditions are never
    cut away. Supported paragraphs retain requested format and method details.
    """
    binding = assessment_binding(job)
    if not binding:return text
    readback = assessment_readback(binding, budget=12000)
    if readback is None:
        return 'The matching saved grading rows do not fit in one answer. Select a saved source version or ask about one part; I have not chosen a date or divided a weight.'
    # A deadline-only lookup is fully answered by the question-bound rows.
    # Adding a model paraphrase can settle a disputed date or reprint unrelated
    # table rows even when each individual number is source-supported.
    if assessment_date_only(job):return readback
    kept = []
    number_names = {'one':1,'two':2,'three':3,'four':4,'five':5,'six':6,'seven':7,'eight':8,'nine':9,'ten':10}
    quantity = r'(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)'
    def unsupported(body, refs):
        mentioned = {(v[0],v[1]) for _,_,kind,v in dateguard._found(body) if kind=='date'}
        percentages = {float(m.group(1)) for m in re.finditer(r'(?<![\d.])(\d+(?:\.\d+)?)\s*(?:%|percent\b)',body,re.I)}
        stated_counts = set()
        for m in re.finditer(r'\b('+quantity+r')\s+(?:required\s+)?(?:cases?|assignments?|applications?|submissions?|items?)\b',body,re.I):
            count = number_names.get(m.group(1).lower())
            if count is None:count=int(m.group(1))
            stated_counts.add(count)
        if re.search(r'\b(?:choose|chosen|selected|first|last|earliest|latest)\b[^.!?\n]{0,75}\bdates?\b',body,re.I):return True
        if not (mentioned or percentages or stated_counts):return False
        # Fields must coexist in one row. Independent unions would accept a
        # date from an older revision with a different revision's weight/count.
        # If a bound-row citation is supplied, that cited row must support the
        # combination; another source cannot silently repair its attribution.
        candidates = [r for r in binding if r['source'] in refs]
        if not candidates:candidates=binding
        for row in candidates:
            count_match = re.search(r'\((\d+) required\)',row['name'],re.I)
            count = int(count_match.group(1)) if count_match else None
            if not mentioned <= row['dates'] or not percentages <= {row['weight']}:continue
            if stated_counts and (count is None or stated_counts!={count}):continue
            if count and count>1 and percentages and re.search(r'\b(?:each|per[- ](?:case|item|assignment|application)|equally)\b',body,re.I):continue
            # Several listed dates do not establish the student's chosen pair.
            if count and len(row['dates'])>count and mentioned and mentioned!=row['dates']:continue
            return False
        # A multi-row conflict paragraph is replaced by the complete cited
        # rows and explicit conflict notice above, rather than merging facts.
        return True
    for paragraph in re.split(r'\n\s*\n',text.strip()):
        # Citation indices are provenance, not quantities in the explanation.
        body = re.sub(r'\[\d+\]','',paragraph)
        if body.strip() and not unsupported(body,cited(paragraph)) and not re.search(r'\bsaved (?:grading|course requirements)\b',body,re.I):kept.append(paragraph)
    output = readback
    note = '\n\nSome additional explanation did not fit. Ask me to continue that explanation.'
    for paragraph in kept:
        if len(output)+len(paragraph)+2+len(note)>12000:return output+note
        output+='\n\n'+paragraph
    return output

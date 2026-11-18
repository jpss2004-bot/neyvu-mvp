"""Source citations for the beta worker's plain-text answers (test bank v1, 2026-10-02).

On the mini the worker cited the right source in 5 of 41 grounded answers: it stated the
facts from the excerpts but rarely wrote [n] markers. Two steps run after generation:

repair(): a line with no marker gets [n] when its dates, times, numbers or names appear in
  supplied source n (the source holding most of them; ties go to the higher-ranked source).
  A line needs at least one such specific detail, so general explanations stay uncited.
  Details that also appear in the question don't count.
  In a partly cited line, each uncited sentence is checked separately: all new details must
  occur in an eligible excerpt, and a named role needs its explicit role/name relation.
  Existing markers are preserved. This is citation repair, not semantic verification.
sanitize(): the beta app rejects a whole answer containing [n] outside 1..len(sources)
  (lib/beta/worker.ts finishAnswer), so out-of-range markers are removed. Inside $...$ math a
  bracketed number is written [\\,n\\,]: it renders the same and is not read as a citation.
Code (fenced blocks and `inline` spans) is never touched: the web renderer does not turn [n]
  inside code into a citation, and finishAnswer skips code, so arr[0] stays arr[0].

Runs on Python 3.9; no model calls.
"""
import re

try:
    import dateguard
except Exception:
    dateguard = None  # dates and times then match as plain numbers only

MARK = re.compile(r'\[(\d+)\]')
MARK_WITH_SPACE = re.compile(r'[ \t]*\[(\d+)\]')
MATH = re.compile(r'(\$\$[\s\S]*?\$\$|\$[^$\n]*?\$)')
# Fenced blocks (closed, or running to the end like Markdown) and inline code spans.
CODE = re.compile(r'^[ \t]*(```|~~~)[^\n]*\n[\s\S]*?(?:^[ \t]*\1[ \t]*$|\Z)|`[^`\n]+`', re.M)
# Engine results, the study label, headings, math and code are never given citations.
SKIP_LINE = re.compile(r'^\s*(?:✓|\*\*Verified solution\*\*|\*AI-written study material|Row operations:|#)|\$|\\\(|\\\[')
NUMBER = re.compile(r'(?<![\w.:/])(\d+(?:\.\d+)?)\s*(%|percent\b|per cent\b)?(?![\w:/]|\.\d)', re.I)
PHRASE = re.compile(r"\b[A-Z][\w'’-]*[A-Za-z](?:\s+(?:(?:of|the|and|for|in|on|to|a|&)\s+){0,2}[A-Z][\w'’-]*[A-Za-z])+")
LEADING_WORDS = {'the', 'this', 'that', 'these', 'your', 'you', 'if', 'it', 'its', 'not', 'no', 'yes', 'so', 'and',
                 'but', 'a', 'an', 'in', 'on', 'for', 'to', 'of', 'at', 'by', 'as', 'or', 'i', 'my', 'we', 'our'}
TRAILING = re.compile(r'([.;:!?]*)(\**)\s*$')
SENTENCE_END = re.compile(r'''[.!?][)"”’']*(?:\*{1,2})?(?:[ \t]*\[\d+\])*[ \t]+(?=[A-Z])''')
ABBREVIATION = re.compile(r'(?:\b(?:dr|mr|mrs|ms|prof|st|etc|vs|mon|tue|wed|thu|fri|sat|sun|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)|\b[A-Z]|[ap]\.m|e\.g|i\.e)\.$', re.I)


def _anchors(text):
    """Specific details in text: ('date'|'time', value), ('num', '45'), ('pct', '10'), ('phrase', 'getting to the bottom')."""
    found = set()
    if dateguard:
        found.update((kind, value) for _, _, kind, value in dateguard._found(text))
        text = _blank_dates(text)
    for m in NUMBER.finditer(text):
        value = m.group(1)
        if m.group(2):
            found.add(('pct', value))
        elif len(value.split('.')[0]) >= 2 and not re.fullmatch(r'(?:19|20)\d\d', value):
            found.add(('num', value))  # single digits and years are too common to identify a source
    for m in PHRASE.finditer(text):
        words = m.group(0).split()
        while words and words[0].lower() in LEADING_WORDS:
            words.pop(0)  # "The Shared Value Ladder" -> "shared value ladder"; "The DEMO" -> nothing
        if len(words) >= 2:
            found.add(('phrase', ' '.join(words).lower()))
    return found


def _blank_dates(text):
    spans = sorted(((s, e) for s, e, _, _ in dateguard._found(text)), reverse=True)
    for start, end in spans:
        text = text[:start] + ' ' * (end - start) + text[end:]
    return text


def _source_profile(source):
    text = '%s\n%s' % (source.get('title') or '', source.get('excerpt') or '')
    anchors = _anchors(text)
    times = set()
    for kind, value in anchors:
        if kind in ('time', 'clock'):
            times.update(dateguard._readings(kind, value))
    return {'anchors': anchors, 'times': times, 'lower': re.sub(r'\s+', ' ', text.lower())}


def _matches(anchor, profile):
    kind, value = anchor
    if kind == 'phrase':
        return value in profile['lower']
    if kind == 'num' and ('pct', value) in profile['anchors']:
        return True
    if kind in ('time', 'clock'):  # "4:00" and "4:00 PM" match; dateguard is present whenever times are found
        return not dateguard._readings(kind, value).isdisjoint(profile['times'])
    return anchor in profile['anchors']


def _best_source(line, profiles, question_anchors):
    anchors = _anchors(line) - question_anchors
    if not anchors:
        return None
    weight = {'date': 3, 'time': 3, 'clock': 3, 'pct': 3, 'num': 2, 'phrase': 2}
    scores = [sum(weight[a[0]] for a in anchors if _matches(a, p)) for p in profiles]
    best = max(scores) if scores else 0
    return scores.index(best) + 1 if best >= 2 else None


def _strict_sentence_source(sentence, sources, question_anchors, question):
    """Fill a missing marker, not certify the semantics of an existing one.

    Every new identifying detail must occur in the excerpt, not only its title.
    An asserted named role additionally needs that explicit role/name relation;
    a person's incidental mention is insufficient. Existing markers stay put.
    """
    anchors = _anchors(sentence) - question_anchors
    if not anchors or re.search(r'\b(?:not|never|neither|hypothetical|example|suppose|unless)\b',sentence,re.I):return None
    named_courses={re.sub(r'[ -]','',v).upper() for v in re.findall(r'\b[A-Z]{2,5}[ -]?\d{3,4}[A-Z]?\b',question,re.I)}
    role=re.search(r'\b(?:guest speaker|instructor|professor|lecturer|author)\b',sentence,re.I)
    names=sorted((value for kind,value in anchors if kind=='phrase'),key=len)
    import injectionguard  # Runtime import: injectionguard itself uses citecheck.
    for number,source in enumerate(sources,1):
        if source.get('kind') not in ('file','moodle') or injectionguard.untrusted(source):continue
        if injectionguard.INSTRUCTION.search(source.get('excerpt') or '') or injectionguard.ASSISTANT_INSTRUCTION.search(source.get('excerpt') or ''):continue
        code=re.sub(r'[ -]','',str((source.get('course') or {}).get('code') or '')).upper()
        if named_courses and code and code not in named_courses:continue
        profile=_source_profile(dict(source,title=''))
        if not all(_matches(anchor,profile) for anchor in anchors):continue
        # A generic recipient ("email the instructor") is not a named-role
        # assertion. Only bind a role to a person when the sentence names one.
        if role and names:
            name=re.escape(names[0]);label=re.escape(role[0])
            relation=re.search(label+r'\s*[:,–—-]?\s*(?:(?:is|was|will be|Dr\.?|Prof\.?)\s+)*'+name,source.get('excerpt') or '',re.I)
            if not relation:continue
            before=(source.get('excerpt') or '')[max(0,relation.start()-35):relation.start()]
            after=(source.get('excerpt') or '')[relation.end():relation.end()+80]
            if re.search(r'\b(?:not|no|former|cancelled|canceled)\s*$',before,re.I) or re.search(r'\b(?:cancelled|canceled|replaced|(?:will|did|could) not attend)\b',after,re.I):continue
        return number
    return None


def _repair_partly_cited_line(line,sources,question_anchors,question):
    if not MARK.search(line) or SKIP_LINE.search(line) or line.lstrip().startswith(('>','|')) or any(c in line for c in ('"','“','”')):return line
    ends=[]
    for match in SENTENCE_END.finditer(line):
        prefix=line[:match.start()+1]
        if not ABBREVIATION.search(prefix):ends.append(match.end())
    if not ends:return line
    out=[];start=0
    for end in ends+[len(line)]:
        part=line[start:end];start=end
        if part.strip() and not MARK.search(part):
            number=_strict_sentence_source(part,sources,question_anchors,question)
            if number:
                trailing=re.search(r'\s*$',part)[0];core=part[:-len(trailing)] if trailing else part
                m=TRAILING.search(core);part=core[:m.start()]+m.group(2)+' [%d]'%number+m.group(1)+trailing
        out.append(part)
    return ''.join(out)


def repair(answer, sources, question=''):
    """Append [n] to each uncited line whose specific details come from one supplied source."""
    if not sources or not answer:
        return answer
    # A syllabus bibliography can name a reading but is weaker evidence of
    # its argument. Redirect only when the answer names the supplied original
    # and that original contains several terms from the requested claim.
    if re.search(r'\b(?:which|what)\b.*\b(?:reading|article|paper|document)\b',question,re.I):
        words=lambda value:set(re.findall(r'[a-z]{4,}',value.lower()))-{'which','what','reading','article','paper','document','cite','source','course','pdf','docx','pptx','syllabus'}
        topic=words(question)
        def redirect(match):
            n=int(match.group(1))
            if not 1<=n<=len(sources) or not re.search(r'syllab|course outline|course overview',sources[n-1].get('title') or '',re.I):return match.group(0)
            candidates=[]
            for i,s in enumerate(sources,1):
                title=s.get('title') or ''
                if s.get('kind')!='file' or re.search(r'syllab|course outline|course overview',title,re.I):continue
                named=words(title)&words(answer)
                supported=topic&words(s.get('excerpt') or '')
                if named and len(supported)>=3:candidates.append((len(named)+len(supported),-i,i))
            return '[%d]'%max(candidates)[2] if candidates else match.group(0)
        answer=outside_code(answer,lambda part:MARK.sub(redirect,part))
    profiles = [_source_profile(s) for s in sources]
    question_anchors = _anchors(question or '')
    answer=outside_code(answer,lambda prose:'\n'.join(_repair_partly_cited_line(line,sources,question_anchors,question) for line in prose.split('\n')))
    out, fenced = [], False
    for line in answer.split('\n'):
        if line.strip().startswith('```'):
            fenced = not fenced
        if fenced or not line.strip() or MARK.search(line) or SKIP_LINE.search(line):
            out.append(line)
            continue
        number = _best_source(line, profiles, question_anchors)
        if number and line.rstrip().endswith('|'):  # table row: inside the last cell
            cut = line.rstrip().rfind('|')
            line = line[:cut].rstrip() + ' [%d] |' % number
        elif number and re.search(r'\b[ap]\.m\.\**\s*$', line, re.I):
            line = line.rstrip() + ' [%d]' % number  # "10 p.m." keeps its period
        elif number:
            m = TRAILING.search(line)
            line = line[:m.start()] + m.group(2) + ' [%d]' % number + m.group(1)
        out.append(line)
    return '\n'.join(out)


def outside_code(text, change):
    """Apply change() to the prose between code spans; code passes through exactly as written."""
    text, out, last = text or '', [], 0
    for m in CODE.finditer(text):
        out += [change(text[last:m.start()]), m.group(0)]
        last = m.end()
    return ''.join(out + [change(text[last:])])


def sanitize(answer, count):
    """Keep only citation markers the beta app will accept; respace bracketed numbers in math."""
    def prose(text):
        parts = MATH.split(text)
        for i, part in enumerate(parts):
            if i % 2:
                parts[i] = MARK.sub(lambda m: '[\\,%s\\,]' % m.group(1), part)
            else:
                parts[i] = MARK_WITH_SPACE.sub(lambda m: m.group(0) if 1 <= int(m.group(1)) <= count else '', part)
        return ''.join(parts)
    return outside_code(answer, prose)

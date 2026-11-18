"""Course-agnostic claim guards for the beta worker's answers (user decisions 2026-10-01).

Some claims are shown as fact only when a supplied source backs them; nothing here is keyed
to a particular course. Runs on Python 3.9.

policy  A yes/no answer about what's allowed or required (AI tools, devices, collaboration,
        late work, extensions, missed tests, aids, attendance) needs an explicit eligible
        course rule. A topic mention is not permission. Conditional, conflicting or
        unsupported polarity is replaced by complete available saved wording; it is never
        repaired by leaving a guessed yes beside a shortened contradictory quotation.
status  "You submitted / didn't submit / passed / your grade is ..." needs a Moodle submission
        or grade capture among the sources, or it's marked "(not confirmed: check Moodle for
        your submission receipt or grade)". With such a capture, its date is added, because a
        capture can be out of date.
course  When the job or the question names one course and the answer cites a source from a
        different course, a caution names both.
"""
import re
from datetime import datetime
import workguard
import injectionguard

CITE = re.compile(r'\[(\d+)\]')
COURSE_CODE = re.compile(r'\b([A-Z]{2,5})[ -]?(\d{3,4}[A-Z]?)\b')

TOPICS = {
    'ai': r'chat\s?gpt|\bgpt\b|generative|\bgen-?ai\b|\bai\b|artificial intelligence|copilot|gemini|\bclaude\b|grammarly|language models?|\bllms?\b',
    'devices': r'laptops?|(?:cell ?|smart ?)?phones?|devices?|tablets?|electronics?|calculators?',
    'collaboration': r'collaborat\w*|work(?:ing)? together|group work|partners?|shar(?:e|ing) (?:answers|code|work|solutions)',
    'late work': r'\blate\b|after the deadline|grace period|penalt(?:y|ies)',
    'extensions': r'extensions?|extend(?:ed)? (?:the )?deadline|more time',
    'missed work': r'miss(?:ed|ing)? (?:a |an |the )?(?:test|quiz|exam|lab|class|midterm)|make-?up|deferr?al|deferred',
    'aids': r'open[- ]book|cheat ?sheet|formula sheet|crib sheet|\baids?\b|notes? (?:are )?(?:allowed|permitted)',
    'attendance': r'attendance|\battend\b|absen(?:t|ce)',
}
TOPIC_RE = {name: re.compile(pattern, re.I) for name, pattern in TOPICS.items()}
POLICY_ASK = re.compile(r"\b(?:can|may|could) (?:i|we|students?)\b|\b(?:am i|are we|are students|is it|is that) (?:allowed|permitted|ok|okay|fine)\b|"
                        r"\b(?:allowed|permitted|prohibited|forbidden|banned|mandatory|required|policy|rules?|lets?|allows?|permits?)\b|\bdo (?:i|we) (?:need|have) to\b", re.I)
ALLOW = re.compile(r"^\s*(?:\**yes\b)|\b(?:is|are) (?:allowed|permitted|fine|acceptable|accepted)\b|\byou (?:can|may) (?:use|bring|work|submit|collaborate)\b|"
                   r"\b(?:may|can) be used\b|\bpermits?\b|\ballows?\b", re.I)
FORBID = re.compile(r"^\s*(?:\**no\b)|\bnot (?:allowed|permitted|acceptable|accepted)\b|\b(?:isn.t|aren.t) (?:allowed|permitted)\b|\bprohibit\w*|\bforbid\w*|"
                    r"\bbanned\b|\bmay not\b|\bcannot\b|\bcan.t\b|\bmust not\b|\bno (?:use of|laptops|phones|devices|ai|late)\b", re.I)
NO_CLAIM = re.compile(r"\bnot (?:in|mentioned|stated|specified|covered|found|confirmed)\b|\bdo(?:es)?n.t (?:say|mention|specify|cover|state)\b|"
                      r"\bdo(?:es)? not (?:say|mention|specify|cover|state)\b|\bcould(?:n.t| not) find\b|\bno information\b|\bcan(?:no|.)t (?:confirm|tell|see|verify)\b", re.I)

STATUS_CLAIM = re.compile(r"\byou(?:.ve| have)? (?:already )?(?:submitted|turned in|handed in|uploaded|completed)\b|"
                          r"\byou(?:.ve| have)? (?:already )?finished\b|"
                          r"\b(?:assignments?|homework|quiz(?:zes)?|labs?|worksheets?|tasks?|reports?)\b[^.!?\n]{0,60}\b(?:is|are|was|were|has been|have been)\s+(?:complete|completed|finished|done|submitted)\b|"
                          r"\byou (?:did not|didn.t|have not|haven.t|never) (?:yet )?(?:submit|turn|hand|upload|complete)\w*|"
                          r"\byou (?:passed|failed|scored|got (?:a|an|\d)|received (?:a|an|\d)|earned)\b|"
                          r"\byour (?:grade|mark|score|result)s? (?:is|was|are|were|on|for)\b|\b(?:has|have) (?:already )?been (?:submitted|graded)\b", re.I)
STATUS_SOURCE = re.compile(r"submission status|grading status|submitted for grading|no attempt|no submissions? (?:have|has) been made|"
                           r"attempts? (?:summary|history)|user report|grader report|\bgrade\s*:|\bgraded\b|feedback\s*:", re.I)

POLICY_NOTE = ' (not confirmed in your sources; check the syllabus)'
STATUS_NOTE = ' (not confirmed: check Moodle for your submission receipt or grade)'


def _paragraphs(text):
    return text.split('\n\n')


def _cited(text, count):
    return sorted({int(n) for n in CITE.findall(text) if 1 <= int(n) <= count})


def _source_text(source):
    return '%s\n%s' % (source.get('title') or '', source.get('excerpt') or '')


def _code(text):
    m = COURSE_CODE.search(text or '')
    return (m.group(1) + ' ' + m.group(2)).upper() if m else None


def _source_course(source):
    course = source.get('course') or {}
    return _code(course.get('code') or '') or _code(source.get('title') or '')


# Leading Yes/No can identify an answer, but not a source restriction. In
# particular, "No other AI was used" inside an acknowledgement template is not
# a prohibition on AI. Never infer a role or authority from copied source text.
SOURCE_ALLOW = re.compile(ALLOW.pattern.replace(r"^\s*(?:\**yes\b)|", "", 1), re.I)
SOURCE_FORBID = re.compile(FORBID.pattern.replace(r"^\s*(?:\**no\b)|", "", 1), re.I)
EXPLICIT_USE = re.compile(r'\b(?:may|can) (?:only )?be used\b|\b(?:you|students?|learners?|we) (?:may|can) (?:only )?(?:use|bring|work|submit|collaborate)\b',re.I)
REQUIREMENT = re.compile(r'\b(?:must|required|mandatory|compulsory|need to|have to)\b',re.I)
CONDITION = re.compile(r'\b(?:if|unless|except|only|provided|outside|during|within|when|under|for|in)\b', re.I)
PERSONAL_POLICY = re.compile(r'\b(?:my|personal|student) (?:class )?notes?\b|\bclass notes?\b', re.I)
POLICY_HEADINGS = {
    'ai':r'artificial intelligence(?:\s*\(AI\))?(?:\s+(?:aids|tools|policy|use))?|(?:generative\s+)?AI(?:\s+(?:aids|tools|policy|use))?',
    'devices':r'technology in the classroom|classroom technology|(?:electronic\s+)?devices?(?:\s+policy)?',
    'collaboration':r'collaboration(?:\s+policy)?|group work',
    'late work':r'late (?:work|assignments?|submissions?)(?:\s+policy)?',
    'extensions':r'extensions?(?:\s+policy)?',
    'missed work':r'missed (?:work|tests?|exams?|quizzes?)(?:\s+policy)?|make-?up (?:tests?|exams?|work)',
    'aids':r'permitted aids|examination aids|open[- ]book policy',
    'attendance':r'attendance(?:\s+policy)?|absences?(?:\s+policy)?',
    'other':r'(?:academic|research) integrity|plagiarism|intellectual property|copyright|student assistance|'
            r'accommodations?|accessibility|course requirements|course policies|assessment(?:s|\s+policy)?|'
            r'grading(?:\s+policy)?|valuing education/grading|schedule of classes(?:\s*&\s*assignments)?',
}
POLICY_HEADING = re.compile(r'\b(?:'+ '|'.join('(?P<h%d>%s)'%(i,p) for i,p in enumerate(POLICY_HEADINGS.values()))+r')\s*:',re.I)


def _policy_passages(body,topics):
    """Select complete available sections only at explicit labelled headings.

    No heading means no safe structural cut. References to another recognized
    section retain that section too; repeated headings never pick one winner.
    This is not a claim that the original capture or policy is exhaustive.
    """
    headers=list(POLICY_HEADING.finditer(body));names=list(POLICY_HEADINGS)
    selected={i for i,h in enumerate(headers) if names[int(h.lastgroup[1:])] in topics}
    if not selected:return body
    spans=[body[h.start():headers[i+1].start() if i+1<len(headers) else len(body)].strip() for i,h in enumerate(headers)]
    # A restriction may live under another heading. Keep every available
    # section containing an explicit rule on the asked topic as well.
    for i,span in enumerate(spans):
        if any(SOURCE_ALLOW.search(s) or SOURCE_FORBID.search(s) or EXPLICIT_USE.search(s) or REQUIREMENT.search(s) for t in topics for s in _sentences_about(span,TOPIC_RE[t])):selected.add(i)
    normal=lambda s:' '.join(re.findall(r'\w+',s.casefold()))
    groups={}
    for i,h in enumerate(headers):groups.setdefault(normal(h.group(0).rstrip(':').strip()),set()).add(i)
    while True:
        texts=[normal(spans[i][len(headers[i].group(0)):]) for i in selected]
        extra=set()
        for label,indexes in groups.items():
            if any(re.search(r'(?<!\w)'+re.escape(label)+r'(?!\w)',text) for text in texts):extra|=indexes
        if extra<=selected:break
        selected|=extra
    return '\n…\n'.join(spans[i] for i in sorted(selected))


def _sentences_about(text, topic_re):
    # Used only to identify an explicit rule, never to manufacture an output
    # quotation. Output retains the complete available excerpt across wraps.
    return [s.strip() for s in re.split(r'(?<=[.!?])\s+|\n', text) if topic_re.search(s)]


def _append_to_paragraph(paragraph, note):
    """Put a note at the end of a paragraph's text, before trailing punctuation and markers."""
    m = re.search(r'((?:\s*\[\d+\])*)([.;:!?]*)(\**)\s*$', paragraph)
    return paragraph[:m.start()] + m.group(3) + note + m.group(1) + m.group(2)


def _insert_caution(paragraphs, caution):
    return paragraphs[:1] + [caution] + paragraphs[1:]


def _eligible_policy(source, question, job_course):
    if source.get('kind') not in ('file', 'moodle') or injectionguard.untrusted(source):return False
    if PERSONAL_POLICY.search(source.get('title') or ''):return False
    body=source.get('excerpt') or ''
    if not isinstance(body,str) or not body.strip() or '[removed:' in body or injectionguard.INSTRUCTION.search(body) or injectionguard.ASSISTANT_INSTRUCTION.search(body):return False
    material=source.get('source_material')
    if material is not None:
        # This server-derived label follows the full pinned body even when its
        # notebook header is absent from a quotation. A label is not authority.
        coverage=source.get('excerpt_coverage') or {}
        if not isinstance(coverage,dict):return False
        if not isinstance(material,dict) or material.get('format')!='saved-material/1' or material.get('kind')!='observed_source':return False
        digest=material.get('text_sha256')
        if not isinstance(digest,str) or not re.fullmatch('[0-9a-f]{64}',digest) or digest!=coverage.get('text_sha256'):return False
    # Older sources may still contain the identifying header themselves.
    prefix=body.lstrip('\ufeff \t\r\n')[:2000]
    if re.match(r'^(?:#{1,4}\s*)?Class\s+Notes\b',prefix,re.I) and (re.search(r'\bSource:\s*https://(?:app\.|www\.)?notion\.(?:com|so)/',prefix,re.I) or re.search(r'\bOne running notebook\b',prefix,re.I)):return False
    selected=job_course or {};actual=source.get('course') or {}
    if selected.get('id') and actual.get('id') and selected['id']!=actual['id']:return False
    target=_code(selected.get('code') or '')
    codes={(a+' '+b).upper() for a,b in COURSE_CODE.findall(question or '')}
    if not target and len(codes)==1:target=next(iter(codes))
    source_code=_source_course(source)
    if target and source_code and target.replace(' ','')!=source_code.replace(' ',''):return False
    if selected.get('id') and not actual.get('id') and not(target and source_code and target==source_code):return False
    return True


def _policy_rules(sources, topics, question, job_course):
    rules=[]
    for n,source in enumerate(sources,1):
        if not _eligible_policy(source,question,job_course):continue
        for topic in topics:
            for sentence in _sentences_about(source.get('excerpt') or '',TOPIC_RE[topic]):
                requirement=bool(REQUIREMENT.search(sentence))
                positive=bool(SOURCE_ALLOW.search(sentence) or EXPLICIT_USE.search(sentence) or requirement);negative=bool(SOURCE_FORBID.search(sentence))
                if not(positive or negative):continue
                # A broad course rule can support a direct answer. A scoped
                # permission is instead reported with its full available text.
                blanket=re.sub(r'\bin (?:this|the) course\b','',sentence,flags=re.I)
                rules.append({'citation':n,'topic':topic,'positive':positive,'negative':negative,
                              'conditional':requirement or bool(CONDITION.search(blanket))})
    return rules


def _disclosure_comparison(question):
    return bool(re.search(r'^\s*(?:which|what)\b.*\bcourses?\b',question,re.I)
        and re.search(r'\b(?:lets?|allows?|permits?)\b',question,re.I) and re.search(r'\backnowledg\w*|\bdisclos\w*',question,re.I)
        and TOPIC_RE['ai'].search(question)
        and not re.search(r'\b(?:not|never|forbid\w*|prohibit\w*|and|also|then|how|explain|why|compare|summari[sz]e|prepare|draft|writ\w*|review|check|solve|calculate|change\w*|latest|announc\w*|submit\w*|resubmit\w*|grad\w*|feedback)\b',question,re.I))


def _disclosure_permissions(sources,rules,question):
    if not _disclosure_comparison(question):return []
    result=[]
    requirement=re.compile(r'\b(?:must|required to|have to|need to|shall)\s+(?:\w+\s+){0,3}(?:acknowledg\w*|disclos\w*)\b|\b(?:acknowledg\w*|disclos\w*)\s+(?:\w+\s+){0,3}(?:must|required|mandatory)\b',re.I)
    for n in sorted({r['citation'] for r in rules if r['topic']=='ai'}):
        source=sources[n-1];code=_code((source.get('course') or {}).get('code') or '')
        if not code:continue
        sentences=_sentences_about(source.get('excerpt') or '',TOPIC_RE['ai'])
        permission=any((SOURCE_ALLOW.search(s) or EXPLICIT_USE.search(s)) and not SOURCE_FORBID.search(s) for s in sentences)
        disclosure=any(requirement.search(s) for s in sentences)
        # Both must occur in the same eligible saved version. A disclosure
        # requirement alone never establishes permission to use AI.
        if permission and disclosure:result.append((code,n))
    return result


def _policy_readback(sources, rules,question=''):
    citations=sorted({rule['citation'] for rule in rules})
    blocks=[]
    for n in citations:
        topics={r['topic'] for r in rules if r['citation']==n}
        body=_policy_passages((sources[n-1].get('excerpt') or '').strip(),topics)
        # Literal backticks stay source data. Numeric bracket references in an
        # original must not become app citation markers to another source.
        parts=re.split(r'(\[\d+\])',body)
        def literal_part(part):
            if re.fullmatch(r'\[\d+\]',part):return '`'+part+'`'
            # Character references display the original punctuation without
            # letting copied Markdown create code/citation spans or HTML.
            controls=set('\\`*_[]()#!~|<>$')
            return ''.join('&amp;' if c=='&' else '&#%d;'%ord(c) if c in controls else c for c in part)
        literal=''.join(literal_part(part) for part in parts)
        code=_source_course(sources[n-1])
        blocks.append((code+' — saved passage:\n\n' if code else '')+'\n'.join('> '+line for line in literal.split('\n'))+' [%d]'%n)
    text='\n\n'.join(blocks)
    if len(text)>10000:
        return ('The relevant saved policy passages are too long to quote together without cutting their conditions. '
                'Open '+', '.join('[%d]'%n for n in citations)+', or ask about one source and one rule. '
                'These excerpts do not establish permission for your particular case.')
    matching=_disclosure_permissions(sources,rules,question)
    intro=('Retrieved AI-use policies with permission and disclosure conditions: '+', '.join(code+' [%d]'%n for code,n in matching)+'. Available wording and conditions follow:' if matching else 'The saved course source states (wording and conditions retained):')
    return (intro+'\n\n'+text+
            '\n\nThis reports the available saved wording, not approval of your particular case. '
            'Open the citation and check Moodle for later changes; omitted original context may matter.')


def disclosure_lookup(job):
    if job.get('mode','ask')!='ask' or job.get('context') or (job.get('source_scope') or {}).get('kind')=='selected_only':return None
    question=job.get('question') or '';sources=job.get('sources') or []
    rules=_policy_rules(sources,['ai'],question,job.get('course'))
    if not _disclosure_permissions(sources,rules,question):return None
    return _policy_readback(sources,rules,question)


def policy(answer, sources, question, job_course=None):
    topics=[name for name,rx in TOPIC_RE.items() if rx.search(question or '')]
    if not topics or not POLICY_ASK.search(question or ''):return answer
    direct=_paragraphs(answer)[0]
    allows,forbids=bool(ALLOW.search(direct)),bool(FORBID.search(direct))
    rules=_policy_rules(sources,topics,question,job_course)
    universal_denial=bool(re.search(r'\b(?:none of|no (?:saved |current |your )?courses?)\b',direct,re.I))
    if universal_denial:
        return _policy_readback(sources,rules,question) if rules else ('The retrieved excerpts do not establish a complete cross-course permission comparison. Open the relevant course policies; a missing passage does not establish that no course permits this use.')
    if NO_CLAIM.search(direct):return _policy_readback(sources,rules,question) if rules else answer
    if not(allows or forbids):return answer
    cited=set(_cited(direct,len(sources)) or _cited(answer,len(sources)))
    same='positive' if allows else 'negative';other='negative' if allows else 'positive'
    # Topic presence, peer notes, a different course and an unverified post do
    # not substantiate Yes/No. Mixed/scoped rules need their original wording;
    # neither the model nor this guard may erase an exception or choose a winner.
    supported=allows!=forbids and all(any(r['topic']==t and r['citation'] in cited and r[same] and not r[other] and not r['conditional'] for r in rules) for t in topics)
    contrary=any(r[other] or r['conditional'] for r in rules)
    if supported and not contrary:return answer
    if rules:return _policy_readback(sources,rules,question)
    return ('I cannot establish that permission or requirement from the retrieved course excerpts'+POLICY_NOTE+
            '. Open the relevant current syllabus or activity instructions, or add its policy passage.')


def _capture_date(value):
    try:
        moment = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return None
    return moment.strftime('%b %d').replace(' 0', ' ')


def status(answer, sources, question=''):
    paragraphs = _paragraphs(answer)
    hits = [i for i, p in enumerate(paragraphs) if STATUS_CLAIM.search(p) and not NO_CLAIM.search(p)]
    if not hits:
        return answer
    for i in hits:
        cited = _cited(paragraphs[i], len(sources))
        # Only typed, activity-bound observed evidence can support a status claim.
        receipts = []
        for n in cited:
            source = sources[n - 1]
            evidence = source.get('evidence') or {}
            activity = evidence.get('activity_url') or ''
            if (source.get('kind') == 'moodle' and evidence.get('provider') == 'moodle'
                    and re.fullmatch(r'https://moodle\.acadiau\.ca/mod/(?:assign|quiz)/view\.php\?id=\d{1,12}', activity)
                    and evidence.get('observed_at') and evidence.get('version_id') == source.get('version_id')
                    and evidence.get('type') in ('submission_receipt', 'released_grade')):
                claim = paragraphs[i]
                negative = bool(re.search(r'did not|didn.t|have not|haven.t|never', claim, re.I))
                grade_claim = bool(re.search(r'grade|mark|score|result|passed|failed|earned|received|got (?:a|an|\d)', claim, re.I))
                if grade_claim:
                    # A receipt is not a released grade; every stated numeric value and outcome
                    # must match explicit fields on the same pinned grade record.
                    values = re.findall(r'\b\d+(?:\.\d+)?(?:\s*/\s*\d+(?:\.\d+)?|%)?', claim)
                    actual = str(evidence.get('grade') or '')
                    values = [v for v in values if not re.search(r'\[' + re.escape(v) + r'\]', claim)]
                    if evidence.get('type') != 'released_grade' or not actual or not values: continue
                    actual_values = {v.replace(' ', '') for v in re.findall(r'\b\d+(?:\.\d+)?(?:\s*/\s*\d+(?:\.\d+)?|%)?', actual)}
                    if any(v.replace(' ', '') not in actual_values for v in values): continue
                    if re.search(r'\bpassed\b', claim, re.I) and evidence.get('outcome') != 'passed': continue
                    if re.search(r'\bfailed\b', claim, re.I) and evidence.get('outcome') != 'failed': continue
                else:
                    state = evidence.get('submission_status')
                    if evidence.get('type') != 'submission_receipt': continue
                    if (negative and state != 'no-submission') or (not negative and state != 'submitted-for-grading'): continue
                receipts.append(source)
        if not receipts:
            paragraphs[i] = _append_to_paragraph(paragraphs[i], STATUS_NOTE)
        elif not re.search(r'\bas of\b|\bcaptured\b|\bcapture\b', paragraphs[i], re.I):
            dates = [d for d in (_capture_date(s['evidence']['observed_at']) for s in receipts) if d]
            when = ' on %s' % dates[0] if dates else ''
            paragraphs[i] = _append_to_paragraph(paragraphs[i], ' (from an observed Moodle page%s; check Moodle for the current status)' % when)
    return '\n\n'.join(paragraphs)


def course(answer, sources, question, job_course=None):
    # A citation from one course cannot establish a categorical exclusion of
    # another. Keep an explicitly quoted denial; otherwise name the uncertainty.
    pieces=re.split(r'((?<=[.!?])\s+(?!\[\d+\])|\n\n)',answer)
    changed=False
    for i in range(0,len(pieces),2):
        piece=pieces[i]
        exclusion=re.search(r"\b(?:does? not|doesn.t|is not|isn.t) (?:apply|applicable) to\s+(?:the\s+)?([A-Z]{2,5}[ -]?\d{3,4}[A-Z]?)\b",piece,re.I)
        if not exclusion:continue
        normalized=lambda text:' '.join(re.findall(r'\w+',text.casefold()))
        literal=normalized(re.sub(r'\[\d+\]','',piece))
        supported=any(source.get('kind') in ('file','moodle') and not injectionguard.untrusted(source)
            and literal in normalized(source.get('excerpt') or '') for source in sources)
        if supported:continue
        target=_code(exclusion[1].upper());pieces[i]='These excerpts do not establish whether that information also applies to '+target+'.';changed=True
    if changed:answer=''.join(pieces)
    asked = _code((job_course or {}).get('code') or '')
    if not asked:
        codes = {(a + ' ' + b).upper() for a, b in COURSE_CODE.findall(question or '')}
        asked = codes.pop() if len(codes) == 1 else None
    if not asked:
        return answer
    others = []
    for n in _cited(answer, len(sources)):
        code = _source_course(sources[n - 1])
        if code and code.replace(' ', '') != asked.replace(' ', '') and (code, n) not in others:
            others.append((code, n))
    if not others:
        return answer
    names = ', '.join('%s [%d]' % (code, n) for code, n in others)
    caution = '⚠️ Part of this answer uses material from %s, not %s. Check that it applies to your course.' % (names, asked)
    return '\n\n'.join(_insert_caution(_paragraphs(answer), caution))


EXAMPLE_PROVENANCE_NOTE = ('I could not verify the example attributed to your saved material, so I have not included that answer. '
                           'Add the relevant reading passage, or ask for a clearly labelled hypothetical example and general explanation.')


def example_provenance(answer, sources):
    """Refuse fabricated quoted examples falsely attributed to saved material.

    This is a narrow publication check, not semantic proof of every paraphrase.
    A clearly hypothetical example is allowed; claiming that its unsupported
    quoted speech comes from an original passage is not.
    """
    paragraphs = _paragraphs(answer)
    claims = [p for p in paragraphs if re.search(r'\b(?:example|illustration)\b', p, re.I)
              and re.search(r'\b(?:source|reading|material|dialogue|text|passage)\b', p, re.I)
              and re.search(r'\b(?:supported|taken|cited|directly|comes? from|based on)\b', p, re.I)]
    if not claims:
        return answer
    normalize = lambda text: ' '.join(re.findall(r'\w+', text.casefold()))
    evidence = [normalize(s.get('excerpt') or '') for s in sources]
    for paragraph in paragraphs:
        if not re.search(r'\b(?:example|illustration)\b', paragraph, re.I):
            continue
        quotes = re.findall(r'["“]([^"“”\n]+)["”]', paragraph)
        for quoted in quotes:
            words = normalize(quoted)
            if len(words.split()) >= 3 and not any(words in text for text in evidence):
                return EXAMPLE_PROVENANCE_NOTE
    return answer


def check(answer, sources, question, job_course=None, work=None, context=None):
    """Apply the source and saved-work guards."""
    answer = example_provenance(answer, sources)
    answer = workguard.guard(answer, dict(context or {}, question=question, sources=sources, course=job_course, work=work))
    answer = policy(answer, sources, question, job_course)
    answer = status(answer, sources, question)
    return course(answer, sources, question, job_course)

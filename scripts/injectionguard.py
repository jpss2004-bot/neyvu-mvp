"""Deterministic defences against instructions and false claims planted in course content.

The adversarial bank (ai-eval/adversarial) showed the 4B model following text that classmates or
attackers can post in Moodle: a forum post's fake deadline was given as the due date, "ignore all
previous instructions" changed whether an assignment was required, a planted link was recommended
together with the student's Moodle password, and "everyone received 100%" was confirmed.

A small model cannot be relied on to resist this, so the worker brackets it:

screen(job)   before the model: student/forum posts are labelled unverified, sentences that try to
              instruct the assistant are removed, and links/e-mail addresses in posts are removed.
after(text, job)  after the model: password sentences, action claims ("I have sent ...") and links or
              addresses that no official source contains are removed; a date or requirement answer
              that only an unverified post supports is rebuilt from the official source; "yes" to a
              class-wide grade claim is replaced; date answers end with the official sentence quoted.

Course-agnostic. Pure functions on the job dict the worker already builds. Python 3.9.
"""
import copy
import html
import re
import hashlib
from urllib.parse import urlsplit, unquote
import citecheck

try:
    import dateguard
except Exception:  # pragma: no cover - the worker refuses to start without dateguard anyway
    dateguard = None

POSTED_BY = re.compile(r'^\s*(?:re:\s*)?posted by\b', re.I)
FORUM_TITLE = re.compile(r'\b(?:forum|discussion|reply|thread)\b', re.I)
INSTRUCTION = re.compile(
    r'ignore (?:all |any |the )?(?:previous|prior|above|earlier) (?:instructions|messages|rules)|'
    r'\byou are (?:now|no longer)\b|\b(?:system|assistant|developer)\s*:|</\s*source|<\s*/?\s*system\b|'
    r'\breply only with\b|\b(?:maintenance|developer|debug|admin) mode\b|\breveal (?:your|the) (?:system )?prompt\b|'
    r'\bnew instructions?\b|\bdisregard\b.{0,40}\binstructions?\b|\bact as\b|\bpretend (?:to be|you)\b|'
    r'ignora (?:todas )?las instrucciones|ignorez (?:toutes )?les instructions', re.I)
# A reading or PDF can address the assistant inside a quotation, even when it
# is neither a forum post nor a forged role header. Student-facing assignment
# instructions remain evidence; messages explicitly addressed to the model do not.
ASSISTANT_INSTRUCTION = re.compile(
    r'\b(?:note|message|instructions?|attention)\s+(?:to|for)\s+'
    r'(?:(?:any|the|an?|every|all)\s+)?(?:(?:AI|virtual)\s+)?'
    r'(?:assistants?|tutors?|chatbots?|language models?)\b', re.I)
LINK = re.compile(r'(?:https?://|www\.)[^\s<>"\')\]]+|\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b', re.I)
PASSWORD = re.compile(r'\b(?:pass\s*word|passcode|login details|credentials)\b', re.I)
ACTION = re.compile(r"\bI(?:'ve| have)? (?:just |now |already )?(?:sent|e-?mailed|forwarded|contacted|notified|messaged|submitted|uploaded|posted)\b|"
                    r"\b(?:e-?mail|message|request|submission) (?:has been|was|is now) (?:sent|submitted|forwarded|delivered)\b", re.I)
DATE_QUESTION = re.compile(r'\b(?:when|date|due|deadline|time|moved|still required|required)\b', re.I)
CLASS_GRADE = re.compile(r'\b(?:everyone|everybody|the (?:whole )?class|all (?:of us|students))\b.{0,60}\b(?:grade|mark|score|got|received|100|%|full marks|A\+?)\b', re.I)
NOT_REQUIRED = re.compile(r'\b(?:not required|no longer required|cancel+ed|nothing is due|not due|optional now)\b', re.I)
DUE_SENTENCE = re.compile(r'[^.\n]*\b(?:due|closes?|deadline|test|exam|midterm|quiz|required)\b[^.\n]*\d[^.\n]*', re.I)
AUTHORITY_CLAIM = re.compile(r'\b(?:must|required|mandatory|compulsory|allowed|permitted|prohibited|forbidden|optional|cancel+ed|due|deadline|(?:you|we|students?|learners?) (?:need|have|are expected) to|you (?:can|cannot|may|may not) (?:use|submit|skip|hand in)|obligatori[oa]|debes|hay que|se permite|puedes usar|fecha l[ií]mite)\b|^\s*(?:submit|upload|complete|bring|post|reply|prepare|entrega|presenta)\b', re.I)
REMOVED = '[removed: text in this post that tried to instruct the assistant]'
SOURCE_REMOVED = '[removed: source text addressed instructions to the assistant]'
LINK_NOTE = ('A link or e-mail address that appears only in an unverified post was removed. '
             'Use the official Moodle page or the instructor address from the course outline.')


ANNOUNCEMENTS = re.compile(r'\bannouncements?\b|\bnews forum\b', re.I)


def untrusted(source):
    """Forum content has unverified authorship, regardless of its title or body.

    The capture contract does not verify forum permissions or an author's role.
    Retain the content as data; copied role headers cannot elevate its authority.
    """
    excerpt = source.get('excerpt') or ''
    title = source.get('title') or ''
    if source.get('untrusted') is True or re.fullmatch(r'forum|forum[_-]post|post|discussion|reply|thread',source.get('kind') or source.get('source_kind') or '',re.I):
        return True
    if POSTED_BY.search(excerpt):return True
    url = source.get('original_url') or source.get('url') or ''
    if url:
        try:
            path = unquote(urlsplit(url).path).lower()
            return bool(re.match(r'/mod/forum/',path) or re.match(r'/pluginfile\.php/.*/mod_forum(?:/|$)',path))
        except (ValueError, TypeError):
            return True
    return bool(FORUM_TITLE.search(title) or ANNOUNCEMENTS.search(title))


def _sentences(text):
    return re.split(r'(?<=[.!?])\s+|\n+', text or '')


def screen(job):
    """Copy of job with unverified posts labelled and instruction-like text and links removed."""
    job = copy.deepcopy(job)
    for source in job.get('sources') or []:
        if not untrusted(source):
            excerpt = source.get('excerpt') or ''
            if ASSISTANT_INSTRUCTION.search(excerpt):
                source['excerpt'] = ' '.join(
                    SOURCE_REMOVED if ASSISTANT_INSTRUCTION.search(sentence) else sentence
                    for sentence in _sentences(excerpt) if sentence)
            continue
        source['untrusted'] = True
        title = source.get('title') or 'post'
        if not title.lower().startswith('unverified'):
            source['title'] = 'Unverified forum source (author role not verified): ' + title
        kept = []
        for sentence in _sentences(source.get('excerpt') or ''):
            if INSTRUCTION.search(sentence) or ASSISTANT_INSTRUCTION.search(sentence):
                if REMOVED not in kept:
                    kept.append(REMOVED)
                continue
            kept.append(LINK.sub('[link removed]', sentence))
        source['excerpt'] = ' '.join(s for s in kept if s)
    return job


def _official(job):
    return [(n, s) for n, s in enumerate(job.get('sources') or [], 1) if not s.get('untrusted') and not untrusted(s)]


def attributed_message(job, budget=6000):
    """Read a pinned message as a claim, without granting its author authority.

    Only a complete, hash-bound saved message about the explicitly named
    activity is eligible. Competing dated activity evidence stays with the
    ordinary conflict handler. Source signatures and titles prove no role.
    """
    import evidenceguard
    question=job.get('question') or '';anchor=evidenceguard.activity_anchor(question)
    if job.get('mode','ask')!='ask' or anchor is None:return None
    if not re.search(r'\b(?:when|where|format|announced)\b',question,re.I):return None
    if re.search(r'\b(?:submit|submitted|graded|everyone|password|permission|allowed)\b',question,re.I):return None
    sources=job.get('sources') or [];selected=set(job.get('context') or [])
    candidates=[]
    named={re.sub(r'[ -]','',a+b).lower() for a,b in re.findall(r'\b([A-Z]{2,5})[ -]?(\d{4})\b',question,re.I)}
    for n,s in enumerate(sources,1):
        if not untrusted(s) or s.get('kind') not in ('file','moodle') or s.get('historical'):continue
        if selected and s.get('id') not in selected:continue
        if not anchor.search(s.get('title') or ''):continue
        course=s.get('course') or {};chosen=job.get('course') or {}
        if not course.get('id') or chosen.get('id') and chosen['id']!=course['id']:continue
        code=re.sub(r'[ -]','',course.get('code') or '').lower()
        if named and (len(named)!=1 or code not in named):continue
        body=s.get('excerpt') or '';coverage=s.get('excerpt_coverage') or {};material=s.get('source_material') or {}
        digest=hashlib.sha256(body.encode()).hexdigest()
        if coverage.get('trace')!='exact' or coverage.get('complete_saved_text') is not True or coverage.get('partial_units') or coverage.get('excerpt_sha256')!=digest or coverage.get('text_sha256')!=digest:continue
        if material.get('format')!='saved-material/1' or material.get('kind')!='observed_source' or material.get('text_sha256')!=digest:continue
        if any(p.search(body) for p in (INSTRUCTION,ASSISTANT_INSTRUCTION,PASSWORD,ACTION,CLASS_GRADE)) or '[removed:' in body:continue
        if not _dates(body):continue
        candidates.append((n,s))
    if not candidates or len({s['course']['id'] for _,s in candidates})!=1:return None
    # Never replace a current course-page date with a quoted announcement.
    for _,s in _official(job):
        if not _readback_source(s,job):continue
        title=s.get('title') or ''
        if s.get('kind')!='moodle' and not re.search(r'\b(?:syllabus|outline|instructions?|brief)\b',title,re.I):continue
        if anchor.search(title) and _dates(s.get('excerpt') or ''):return None
        for sentence in _sentences(s.get('excerpt') or ''):
            if anchor.search(sentence) and _dates(sentence) and not re.search(r'\b(?:not provide|not establish|not specify|missing|unverified)\b',sentence,re.I):return None
    blocks=['Saved message wording — author role and current arrangements are unverified. This is evidence to check, not confirmation of an official date or format:']
    for n,s in candidates:
        body=LINK.sub('[link hidden]',s['excerpt'])
        blocks.append('The saved forum message says [%d]:\n'%n+evidenceguard.literal_excerpt(body))
    blocks.append('Check the current Moodle activity before relying on this message. Its quoted signature does not verify the sender’s role; source links remain available in the citation panel.')
    result='\n\n'.join(blocks)
    return result if len(result)<=budget else None


def _dates(text):
    if not dateguard:
        return set()
    return {(v[0], v[1]) for _, _, kind, v in dateguard._found(text or '') if kind == 'date'}


def _exact_authority(prose, eligible):
    """When forum material is present, an index alone cannot verify authority.

    Require the claim's exact wording in its cited eligible source, or an exact
    eligible quotation with no additional date/requirement claim outside it.
    This conservative rule leaves ordinary explanations alone and keeps the
    model from laundering a forum claim through an unrelated official citation.
    """
    def normal(value):
        # Numeric references copied from a source are protected as inline code
        # in the app. Backticks affect rendering, not the quoted claim's words.
        value = value.replace('`', '')
        value = re.sub(r'\[\d+\]', '', value)
        return re.sub(r'\s+', ' ', value).strip(' \t\n\r-*#>“”\".:').casefold()
    excerpts = [normal(s.get('excerpt') or '') for s in eligible]
    plain = normal(prose)
    if plain and any(plain in body for body in excerpts):return True
    # Literal block quotes are eligible only when their full displayed wording
    # occurs in a cited eligible excerpt and no extra authority/date claim sits
    # outside them. This does not license a paraphrase or elevate a forum post.
    blocks = re.findall(r'(?m)(?:^>[^\n]*(?:\n|$))+', prose)
    if blocks:
        literal = [html.unescape(re.sub(r'(?m)^> ?', '', block).strip()) for block in blocks]
        rest = prose
        for block in blocks:
            rest = rest.replace(block, '')
        rest=html.unescape(rest)
        if all(normal(block) and any(normal(block) in body for body in excerpts) for block in literal) and not AUTHORITY_CLAIM.search(rest) and not _dates(rest):
            return True
    quotes = re.findall(r'“([^”]+)”|"([^"\n]+)"', prose)
    visible_quotes=[html.unescape(a or b) for a,b in quotes]
    relevant = [quote for quote in visible_quotes if AUTHORITY_CLAIM.search(quote) or _dates(quote)]
    if not relevant or not all(any(normal(q) in body for body in excerpts) for q in relevant):return False
    rest = html.unescape(re.sub(r'“[^”]+”|"[^"\n]+"', '', prose))
    return not AUTHORITY_CLAIM.search(rest) and not _dates(rest)


def _readback_source(source, job):
    """Eligibility for literal saved wording, never independent author proof.

    The server's full-body material label can exclude a notebook even when
    retrieval omits its header. Bind that label to the pinned excerpt coverage;
    legacy sources still have their visible origin and notebook checks.
    """
    if source.get('kind') not in ('file', 'moodle') or untrusted(source):return False
    body=source.get('excerpt') or ''
    if not isinstance(body,str) or not body.strip():return False
    if any(pattern.search(body) for pattern in (INSTRUCTION,ASSISTANT_INSTRUCTION,PASSWORD,ACTION,CLASS_GRADE)) or '[removed:' in body:return False
    if re.search(r'\b(?:my|personal|student) (?:class )?notes?\b|\bclass notes?\b',source.get('title') or '',re.I):return False
    prefix=body.lstrip('\ufeff \t\r\n')[:2000]
    if re.match(r'^(?:#{1,4}\s*)?Class\s+Notes\b',prefix,re.I) and (re.search(r'\bSource:\s*https://(?:app\.|www\.)?notion\.(?:com|so)/',prefix,re.I) or re.search(r'\bOne running notebook\b',prefix,re.I)):return False
    material=source.get('source_material')
    if material is not None:
        coverage=source.get('excerpt_coverage') or {}
        if not isinstance(material,dict) or not isinstance(coverage,dict):return False
        digest=material.get('text_sha256')
        if material.get('format')!='saved-material/1' or material.get('kind')!='observed_source' or not isinstance(digest,str) or not re.fullmatch('[0-9a-f]{64}',digest) or digest!=coverage.get('text_sha256'):return False
    selected=job.get('course') or {};actual=source.get('course') or {}
    if selected.get('id') and actual.get('id')!=selected['id']:return False
    code=lambda value: re.sub(r'[\s-]','',value or '').casefold()
    if selected.get('code') and actual.get('code') and code(selected['code'])!=code(actual['code']):return False
    return True


def _saved_wording(cited, job, limit):
    """Replace a rejected paraphrase with every cited excerpt, without cropping.

    Refuse mixed/unknown/personal citations and over-budget sets. Keep exact
    provenance already in each excerpt, all competing cited versions and stable
    app markers. Escaped source Markdown/HTML/references remain source data.
    """
    sources=job.get('sources') or []
    if not cited or any(not 1<=n<=len(sources) or not _readback_source(sources[n-1],job) for n in cited):return None
    blocks=[]
    for n in sorted(cited):
        body=sources[n-1]['excerpt'].strip()
        controls=set('\\`*_[]()#!~|<>$')
        def literal_part(part):
            # Markdown decodes entities before the app's citation plugin runs.
            # Only a code node reliably keeps a copied [n] as source text.
            if re.fullmatch(r'\[\d+\]',part):return '`'+part+'`'
            return ''.join('&amp;' if c=='&' else '&#%d;'%ord(c) if c in controls else c for c in part)
        literal=''.join(literal_part(part) for part in re.split(r'(\[\d+\])',body))
        blocks.append('Saved excerpt [%d] — complete available wording:\n'%n+'\n'.join('> '+line for line in literal.split('\n')))
    notice='Forum authorship remains unverified. ' if any(untrusted(s) for s in sources) else ''
    result=('\n\n'.join(blocks)+'\n\n'+notice+'These are saved excerpts; '
            'omitted original context and later Moodle changes may matter.')
    return result if len(result)<=limit else None


def _personal_or_confirmed_schedule(prose,job):
    if re.search(r'\b(?:your personal study day|you personally planned|you chose .{0,30} as a personal study day)\b',prose,re.I):return True
    # Meetings were explicitly confirmed by the student on the server. Keeping
    # that separate schedule is not verification of the forum author's role.
    dates=_dates(prose)
    meetings=list(job.get('agenda') or [])+list((job.get('work') or {}).get('meetings') or [])
    matched=set()
    for meeting in meetings:
        if meeting.get('kind') not in ('class','lab','office_hours'):continue
        title=meeting.get('title') or ''
        if title and title.casefold() in prose.casefold():matched |= _dates(meeting.get('date') or '')
    return bool(dates) and dates <= matched and not AUTHORITY_CLAIM.search(prose)


def _official_sentence(job, question):
    """(cite, sentence) of the official source's due/date sentence most relevant to the question."""
    words = {w for w in re.findall(r'[a-z0-9]{3,}', (question or '').lower()) if w not in {'when', 'what', 'the', 'due', 'is', 'and'}}
    best = None
    for n, s in _official(job):
        for sentence in DUE_SENTENCE.findall(s.get('excerpt') or ''):
            sentence = ' '.join(sentence.split())
            score = len(words & set(re.findall(r'[a-z0-9]{3,}', ((s.get('title') or '') + ' ' + sentence).lower())))
            if _dates(sentence):
                score += 2
            if best is None or score > best[0]:
                best = (score, n, sentence)
    return (best[1], best[2]) if best else (None, None)


def after(text, job, *, compiled_work=False):
    """Apply the post-model guards; returns the text to publish."""
    sources = job.get('sources') or []
    question = job.get('question') or ''
    official = _official(job)
    posts = [(n, s) for n, s in enumerate(sources, 1) if s.get('untrusted') or untrusted(s)]
    official_text = ' '.join((s.get('excerpt') or '') + ' ' + (s.get('title') or '') for _, s in official)

    # 1. Never publish password requests, action claims, or links no official source contains.
    removed_link = False
    paragraphs = []
    for paragraph in (text or '').split('\n\n'):
        # Split keeping the separators so an untouched paragraph is published byte-for-byte.
        parts = re.split(r'((?<=[.!?])\s+|\n)', paragraph)
        kept, changed = [], False
        for i in range(0, len(parts), 2):
            sentence, sep = parts[i], parts[i + 1] if i + 1 < len(parts) else ''
            visible = html.unescape(sentence)
            bad_link = any(link.lower().rstrip('.,') not in official_text.lower() for link in LINK.findall(visible))
            if PASSWORD.search(visible) or ACTION.search(visible) or bad_link:
                removed_link = removed_link or bad_link
                changed = True
                continue
            kept.append(sentence + sep)
        paragraph = ''.join(kept).strip() if changed else paragraph
        if paragraph.strip():
            paragraphs.append(paragraph)
    text = '\n\n'.join(paragraphs).strip()
    if removed_link:
        text = (text + '\n\n' + LINK_NOTE).strip()

    cite, sentence = _official_sentence(job, question)
    post_cites = ' '.join('[%d]' % n for n, _ in posts)

    def rebuilt(reason):
        lead = ('According to the official course page [%d]: “%s”.' % (cite, sentence)) if cite else \
            'The official course pages saved here do not establish this.'
        return (lead + '\n\n' + reason + ' The forum author and authority have not been verified. '
                'Rely on the official page, and ask the instructor if you are unsure.')

    # 2. A date or requirement that only an unverified post supports is not repeated as fact.
    if posts and not compiled_work:
        official_dates = _dates(official_text)
        post_dates = set().union(*[_dates(s.get('excerpt')) for _, s in posts]) if posts else set()
        stated = _dates('\n\n'.join(p for p in text.split('\n\n') if not _personal_or_confirmed_schedule(citecheck.CODE.sub('',p),job)))
        planted = (stated & post_dates) - official_dates
        if planted or (NOT_REQUIRED.search(text) and re.search(r'\brequired\b', official_text, re.I)
                       and not NOT_REQUIRED.search(official_text)):
            return rebuilt('An unverified forum source %s claims something different.' % post_cites)

    # Requirements and permissions need eligible evidence even when the student
    # asked for preparation rather than a date/policy question. Keep source
    # indices stable and leave code spans out of prose-citation checks.
    if posts and not compiled_work:
        post_numbers={n for n,_ in posts}
        kept=[];output_length=len(text);readback_used=False
        for paragraph in text.split('\n\n'):
            prose=citecheck.CODE.sub('',paragraph)
            cited={int(n) for n in re.findall(r'\[(\d+)\]',prose)}
            forum_cited=bool(cited & post_numbers)
            eligible=[sources[n-1] for n in cited if n not in post_numbers and 1<=n<=len(sources)]
            personal=_personal_or_confirmed_schedule(prose,job)
            claim=AUTHORITY_CLAIM.search(prose) or _dates(prose)
            if claim and not personal and (forum_cited or not _exact_authority(prose,eligible)):
                markers=' '.join('[%d]'%n for n in sorted(cited & post_numbers))
                fallback=('The saved forum material does not verify an official requirement or permission. '+markers+' Its author and authority are unverified; check the official Moodle activity or syllabus.').strip()
                # An unrelated post must not erase available course-page facts.
                # Do not trust the paraphrase: show its complete cited wording,
                # within the same final response budget, or keep the refusal.
                replacement=None if forum_cited else _saved_wording(cited,job,12000-output_length+len(paragraph))
                readback_used=readback_used or replacement is not None
                replacement=replacement or fallback
                output_length+=len(replacement)-len(paragraph)
                paragraph=replacement
            # Replacing several unsupported claims must not bury the useful
            # part of an answer under repeated identical warnings.
            if not paragraph.startswith('The saved forum material does not verify an official requirement or permission.') or paragraph not in kept:kept.append(paragraph)
        text='\n\n'.join(kept)
        # Later refusals can also expand very short paragraphs. Never let the
        # worker's final slice cut a literal excerpt or detach its conditions.
        if readback_used and (len(text)>12000 or output_length>12000):
            return ('The complete cited excerpts do not fit in this reply. Open Sources or ask about one passage. '
                    'Forum authorship remains unverified.')

    # 3. Class-wide grade claims are never confirmed from posts.
    if CLASS_GRADE.search(question) or CLASS_GRADE.search(text):
        first = text.split('\n\n', 1)[0]
        if re.match(r'\s*(?:yes|yeah|correct|that\'s right|it is true)\b', first, re.I) or re.search(r'\beveryone (?:got|received)\b', first, re.I):
            return ('The saved course sources do not confirm grades for the class; only a forum post %s claims it. '
                    'Check your own grade in Moodle Grades, and ask the instructor if something looks wrong.' % post_cites).strip()

    # 4. Date answers end with the official sentence they rely on, quoted (owner decision 2026-10-07):
    # only when the first sentence cites an official source and states the date that source gives.
    if DATE_QUESTION.search(question):
        first = re.split(r'(?<=[.!?])\s+|\n', text.strip(), maxsplit=1)[0] if text.strip() else ''
        stated = _dates(first)
        for n in [int(x) for x in re.findall(r'\[(\d+)\]', first)]:
            match = next((s for m, s in official if m == n), None)
            # An exact dated quotation already supplies the owner's requested
            # source wording. A flattened table's larger regex "sentence"
            # must not be appended after a complete question-bound row quote.
            # This does not exempt paraphrases, wrong citations or additional
            # claims outside the quotation from the existing protections.
            if match and _exact_authority(first,[match]):break
            quote = next((' '.join(q.split()) for q in DUE_SENTENCE.findall((match or {}).get('excerpt') or '')
                          if stated & _dates(q)), None)
            if quote and quote not in text:
                text = (text + '\n\nOfficial source [%d]: “%s”' % (n, quote)).strip()
                break
    return text

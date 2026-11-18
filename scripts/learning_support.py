"""Focused learning follow-ups and honest saved-material availability.

These bounded workflows give study advice, never assess mastery, infer a course
rule from a resource link, or claim to have read a linked paper/video.
"""
import re
import injectionguard
import source_teaching


def originals(job):
    selected=set(job.get('context') or [])
    for n,s in enumerate(job.get('sources') or [],1):
        if selected and s.get('id') not in selected:continue
        if s.get('kind') not in ('file','moodle') or injectionguard.untrusted(s):continue
        if (s.get('source_material') or {}).get('kind') in ('student_notes','ai_draft'):continue
        yield n,s


def note_sources(job):
    yield from originals(job)
    # A whole, short original retained by the server remains usable when the
    # generic reader selects only its last paragraph. Validate its version and
    # hashes before using it; a link or personal summary cannot supply it.
    for n,s,anchors in source_teaching.evidence(job,'note-goals'):
        yield n,dict(s,excerpt=' '.join(anchors))


def routine(job):
    q=job.get('question') or ''
    if not re.search(r'\b(?:review routine|routine.{0,60}(?:review|understood)|review.{0,35}routine)\b',q,re.I):return None
    duration=re.search(r'\b(\d{1,2})[ -]minute\b',q,re.I)
    if not duration or not 4<=int(duration[1])<=60:return None
    topic=job.get('retrieval_question') or q
    for n,s in note_sources(job):
        body=s.get('excerpt') or ''
        if not (re.search(r'note[ -]?taking|notes?',topic,re.I) and re.search(r'organiz\w*\s*(?:&|and)\s*structur',body,re.I) and re.search(r'key ideas',body,re.I) and re.search(r'memory retention',body,re.I)):continue
        total=int(duration[1]);one=max(1,total//5);two=max(1,total*3//10);three=two;four=total-one-two-three
        map_phrase='; it calls notes a map of the presentation' if re.search(r'notes should be a map',body,re.I) else ''
        return ("Use one small section of today's notes. The reading emphasizes organizing information, selecting key ideas and supporting memory"+map_phrase+". [%d]"%n
          +"\n\nHere is a suggested %d-minute routine, not an additional course requirement:"%total
          +"\n\n1. **%d minutes, organize:** choose one important idea and turn that section into a short heading plus the key relationship it explains."%one
          +"\n2. **%d minutes, recall:** close the notes and explain the idea aloud in your own words. Say how or why it works; do not just repeat a definition."%two
          +"\n3. **%d minutes, apply:** invent a small example and predict what would change if one condition changed. Write down your prediction before reopening the material."%three
          +"\n4. **%d minutes, check:** compare your explanation and prediction with the original reading or class notes. Correct the specific gap, then try that part again with the notes closed."%four
          +"\n\nYour understanding check: **Can you explain why your new example fits the idea and how the changed condition affects it?** Count it as supported only if the original material backs both explanations. If you can repeat the words but cannot justify the example, mark that connection for review. A confident or fluent answer alone does not establish understanding."
          +"\n\nStart by choosing the one idea you found hardest today. No calendar block or progress status has been added.")
    return None


def note_learning(job):
    q=job.get('question') or ''
    if not (re.search(r'\bnotes?\b|note[ -]?taking',q,re.I) and re.search(r'\blearn|copy|before.and.after',q,re.I)):return None
    if re.search(r'routine|minutes?|feedback|my draft|my paragraph',q,re.I):return None
    for n,s in note_sources(job):
        body=s.get('excerpt') or ''
        if not (re.search(r'organiz\w*\s*(?:&|and)\s*structur',body,re.I) and re.search('key ideas',body,re.I) and re.search('memory retention',body,re.I)):continue
        return ('Your notes should make the key ideas easier to understand and retrieve. The reading emphasizes organizing information, selecting essentials and supporting memory. It also recommends following the presentation actively and filling in details later. [%d]'%n
          +'\n\nMy suggested way to apply that is to record a claim, explain the connection that makes it useful, and leave a question where your understanding is incomplete. Copying every sentence can leave you with the wording but no explanation of how the ideas fit together.'
          +'\n\nIllustrative before-and-after note (AI-written, separate from the reading):\n\n**Before:** “Audience matters. Avoid jargon.”\n\n**After:** “When a reader may not know a technical term, define it so they can understand the message and act on it. In my next draft, which term would an outside reader need explained?”'
          +'\n\nThe second note connects a writing choice with its purpose and gives you something to check in a draft. To try this today, take one copied sentence from your actual notes, add why it matters, and test whether you can explain it with the notes closed. Do not treat being able to repeat it as proof of understanding.')
    return None


def verification_advice(job):
    q=job.get('question') or ''
    if not (re.search(r'\b(?:AI|chatbot|model)\b',q,re.I) and re.search(r'trustworth|check.{0,30}(?:answer|claim)|verify.{0,30}(?:answer|claim)',q,re.I) and re.search(r'general advice|course.{0,30}(?:requires|requirements)|explicitly requires',q,re.I)):return None
    text=("Check the claim that matters against the source that can actually settle it. Looking at a citation's title or asking the same chatbot again is not enough."
      "\n\nIllustrative school example (AI-written): an AI says an essay is due Friday. Open the exact assignment in Moodle, check its date and time, and compare them with any later instructor revision. If they disagree, keep the conflict visible rather than picking the convenient date. For a claim about a reading, open the passage and check the surrounding conditions as well as the quoted words."
      "\n\nThat is my general advice. To distinguish it from course instructions, here is what the supplied saved material actually says:")
    quotes=[]
    for n,s in originals(job):
        body=s.get('excerpt') or ''
        match=re.search(r'If you use AI for course work, you should cite AI\.',body,re.I)
        if match:
            label='The saved optional-resources page' if re.search('optional',s.get('title') or '',re.I) else 'The saved page'
            quotes.append('- '+label+' says: “'+match[0]+'” Its APA/MLA links explain citation; those links do not themselves establish an independent fact-checking requirement. [%d]'%n)
        goal=re.search(r'Recognize common strengths and limitations[^.]*\.',body,re.I)
        if goal:quotes.append('- The saved course overview lists this learning goal: “'+goal[0]+'” [%d]'%n)
    if quotes:text+='\n\n'+'\n'.join(quotes[:3])
    else:text+='\n\nI do not have a matching explicit course instruction in these excerpts. That does not establish that none exists elsewhere.'
    text+='\n\nThe checking process above is a recommendation, not a newly established course rule. Your next step is to choose one claim in the answer you are using, open its original source, and record whether it is supported, contradicted, or still uncertain.'
    return text


def practice_without_hints(job):
    q=job.get('question') or ''
    if not (re.search(r'(?:one|a) practice question',q,re.I) and re.search(r'consistent.*inconsistent|inconsistent.*consistent',q,re.I) and re.search('systems?',q,re.I) and re.search(r'do not.{0,40}(?:answer|hints?)',q,re.I)):return None
    return ('AI-written practice question:\n\nCould a system of linear equations be inconsistent even though each individual equation has solutions on its own? Explain your answer.')


def brief_readback(job):
    q=job.get('question') or ''
    if not (re.search('panel questions',q,re.I) and re.search(r'require|submit|appropriate question',q,re.I)):return None
    for n,s in originals(job):
        body=s.get('excerpt') or ''
        if not (s.get('kind')=='file' and re.search(r'panel questions assignment (?:instructions)?',s.get('title') or '',re.I) and 'PANEL QUESTIONS ASSIGNMENT Deadline:' in body and re.search(r'TWO questions',body) and 'one sentence each' in body):continue
        body=body[body.index('PANEL QUESTIONS ASSIGNMENT Deadline:'):].strip()
        if len(body)>7000:continue
        return ('The saved assignment brief gives this wording. It contains the submission format and question length, so those details should not be treated as missing. [%d]\n\n> '%n+body.replace('\n','\n> ')
          +'\n\nMy practical check: a philosophical question asks for reasons, principles or justification about law or legal practice. A question about the speaker’s salary or career history asks for facts instead. Use a course issue to frame your own question; I have not written your assessed questions.'
          +'\n\nNext, draft your two questions and check each against the brief’s one-sentence format and philosophical focus. The event arrangements remain TBA in this saved brief. Verify later Moodle instructions before relying on its arrangements; the brief alone does not prove your submission or grade.')
    return None


def availability_question(q):
    return bool(re.search(r'what can (?:you|the assistant) (?:actually )?read|which.{0,40}(?:readable|actually read)',q,re.I) and re.search(r'vault|saved|course|material',q,re.I))


def availability(job):
    if not availability_question(job.get('question') or ''):return None
    refs=list(originals(job))
    text='I can read the captured text supplied here. That gives us a starting point for study, but it does not establish that the whole course has been read or prepared.'
    lines=[]
    for n,s in refs[:8]:
        title=re.sub(r'[\[\]\n]',' ',s.get('title') or 'Saved material')[:180]
        body=s.get('excerpt') or ''
        if not body.strip():lines.append('- **'+title+':** no readable passage was supplied for this answer. [%d]'%n);continue
        if re.search('optional',title,re.I):
            lines.append('- **'+title+':** the saved page contains resource descriptions and citation guidance. I can read that page text; it does not give me the full linked papers, articles or videos. Its optional label remains separate from the certificate instructions. [%d]'%n)
        elif s.get('kind')=='file':
            complete=(s.get('excerpt_coverage') or {}).get('complete_saved_text') is True
            lines.append('- **'+title+':** '+('the complete saved text is supplied' if complete else 'a readable saved excerpt is supplied')+'. That is not a visual review of every page or a check for later revisions. [%d]'%n)
        else:
            lines.append('- **'+title+':** I can read the captured course-page text, including the headings and instructions shown in it. A title or link on that page is evidence that a resource is listed, not that its contents have been read. [%d]'%n)
        podcast=re.search(r'In Learning Materials, listen to[^\n]*Trapped in a ChatGPT Spiral[^\n]*',body,re.I)
        if podcast:lines.append('  The course page names *Trapped in a ChatGPT Spiral* and the Podcast Comprehension Questions. This is a podcast task; it is separate from the optional AI-energy article. I need the actual audio or transcript and question text before preparing that activity substantively. [%d]'%n)
    if lines:text+='\n\n'+'\n'.join(lines)
    else:text+='\n\nNo readable original passage was supplied for this answer. Open Sources and select the course material you want to begin with.'
    coverage=job.get('collection_coverage') or {}
    if coverage.get('scope_confirmed') is True:
        for c in (coverage.get('courses') or [])[:8]:
            r=c.get('readiness') or {};a=r.get('attachments') or {}
            if r.get('state')!='readable' or any(a.get(k) for k in ['pending','failed','not_indexed','partial','truncated']):text+='\n\nThe saved collection report also records coverage gaps. Its counts describe saved material, not comprehension or course completion.';break
    text+='\n\nNext, compare the current Moodle learning-materials list with the saved vault, collect the missing original text or transcripts and question prompts, and work through each required activity. Until then I can help with the readable portions, but cannot certify whole-course preparation, module completion, or a certificate. This answer is not a fresh Moodle check.'
    return text

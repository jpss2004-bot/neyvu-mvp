"""Bounded saved-work answers. Missing capture is never proof of no work or completion."""
import re,json
from planning_steps import next_step,action_table
from datetime import datetime, date, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
import injectionguard
from evidenceguard import deadline_at_start, moodle_deadline_conflict

LIST_NOUN = r'(?:to[ \-\u2011]?dos?|to[ \-\u2011]?do list|tasks?|work|homework|assessments?|assignments?|quizzes|quiz|labs?|worksheets?|readings?|deadlines?)'
LIST_REQUEST = re.compile(r'\b(?:what(?:\x27s| is| are)|which|show(?: me)?|list|give me|summarize)\s+(?:on\s+)?(?:(?:my|our|the|upcoming|weekly|remaining|current)\s+){0,3}'+LIST_NOUN+r'\b(?:.{0,70}\b(?:today|tomorrow|this week|next week|week ahead|have|need|due|upcoming)\b|\s*[?.!]*\s*$)|\b(?:help me\s+)?plan\s+(?:(?:my|our|the|this|next)\s+)?week(?:\s+ahead)?\b', re.I)

WORK = r'(?:work|homework|assessments?|assignments?|tasks?|quizzes|quiz|labs?|in[- ]class (?:work|assignments?|exercises?)|worksheets?|reports?|exercises?|discussions?|readings?|preparation|prep|deadlines?)'
INVENTORY = re.compile(
    r'\b(?:what|which)\s+(?:(?:my|our|the)\s+)?'+WORK+r'\b.{0,45}\b(?:have|need|due|upcoming|this week|today|tomorrow|turn in|hand in|submit|prepare|complete|bring|are there|is there)\b|'
    r'^\s*(?:what|which)\s+(?:(?:my|our)\s+)?'+WORK+r'\s*\??\s*$|'
    r'\bwhat\s+(?:do|should|must)\s+(?:i|we)\s+(?:need to\s+)?(?:do|have|complete|prepare|work on|turn in|hand in|submit|bring)\b|'
    r'\bwhat\s+(?:do|should|must)\s+(?:i|we)\s+need\s+(?:to\s+(?:do|prepare|complete|bring)|for\s+(?:class|lab))\b|'
    r'\b(?:do|will)\s+(?:i|we)\s+have\b.{0,40}(?:'+WORK+r'|anything|something)\b|'
    r'\b(?:is|are)\s+there\b.{0,25}(?:'+WORK+r'|anything|something)\b|'
    r'\b(?:anything|something|nothing)\b.{0,45}\b(?:due|turn in|hand in|submit|do|prepare|complete)\b|'
    r'^\s*any\b.{0,20}\b'+WORK+r'\b|'
    r'\b(?:anything|work)\s+(?:for|before)\s+(?:class|lab)\b|'
    r'\bwhat(?:\x27s| is)\s+(?:due|left|next|coming up)\b|\bam i\s+(?:done|caught up|all done)\b', re.I)
FACT = re.compile(r'\b(?:how much|how many|how long|worth|weights?|percentage|definition|solve|solution|calculate|prove|derive|write|explain|determinant|matri(?:x|ces)|proof|eigenvalue|eigenvector|exam(?:ination)?s?|allowed|permission|policy|rules?|grade|graded|score|mark)\b|^\s*(?:when (?:is|are)|what time|which room|where (?:is|are))\b|\b(?:can|may|could)\s+(?:i|we)\b.*\b(?:use|collaborate)\b', re.I)
NAMED_ACTIVITY = re.compile(r'\b(?:assignment|homework|quiz|test|exam|lab|worksheet|report|exercise|chapter|question|part)\s+(?:\d+|[IVX]+|one|two|three|four|five)\b', re.I)
COMPLETION_ASK = re.compile(r'\b(?:did|have)\s+(?:i|we)\s+(?:already\s+)?(?:submitted|submit|turned in|handed in|completed|complete|finished|finish|done)\b|\b(?:work|assignments?|tasks?|quizzes|quiz|labs?|worksheets?)\b.{0,35}\b(?:have|did)\s+(?:i|we)\s+(?:complete|completed|finished|finish|submit|submitted|done)\b|\b(?:is|are)\b.{0,35}\b(?:work|assignment|task|quiz|lab|worksheet)\b.{0,25}\b(?:completed|finished|done|submitted)\b', re.I)
FOLLOWUP = re.compile(r'^\s*(?:and\b|what about\b|how about\b|for\b|then\b)|^\s*(?:tomorrow|today|this week|next week)\??\s*$', re.I)
NEXT_DEADLINE = re.compile(r"\s*(?:what(?:['’]s| is)|which is)\s+(?:(?:my|our|the)\s+)?next\s+(?:deadline|due date)(?:\s+(?:in|for)\s+[a-z]{2,5}[ -]?\d{3,4}[a-z]?)?\s*[?.!]*\s*", re.I)
MOODLE_DUE_FIELD = re.compile(r'^\s*(Extension due date|Due(?: date)?|Closes?|Close the quiz):\s*([^\n]+)', re.I|re.M)
NO_WORK = re.compile(
    r'\bnothing\b.{0,35}\b(?:turn in|hand in|submit|do|complete|prepare|due)\b|'
    r'\b(?:no|not any)\s+(?:(?:more|other|remaining|upcoming|pending|outstanding|current|dated|required)\s+){0,3}'+WORK+r'\b|'
    r'\b(?:you|we|i)\s+(?:do not|don\x27t|don’t|does not|have no|haven\x27t got)\s+(?:have\s+)?(?:any\s+)?'+WORK+r'\b|'
    r'\b(?:you|we|i)\s+(?:do not|don\x27t|don’t)\s+have\s+anything\b.{0,30}\b(?:turn in|hand in|submit|do|complete|prepare|due)\b|'
    r'\b(?:you|we|i)\s+(?:do not|don\x27t|don’t)\s+need\b.{0,25}\b(?:turn in|hand in|submit|do|complete|prepare)\b|'
    r'\b(?:you|we|i)\s+(?:do not|don\x27t|don’t)\s+have to\s+(?:turn in|hand in|submit|do|complete|prepare)\b|'
    r'\bthere\s+(?:isn\x27t|isn’t|aren\x27t|aren’t|is not|are not)\s+any\s+'+WORK+r'\b|'
    r'\bnone of\s+(?:(?:your|the)\s+)?'+WORK+r'\b.{0,35}\b(?:due|required|remaining|left)\b|'
    r'\b(?:you(?:\x27re|’re| are)|we(?:\x27re|’re| are)|i(?:\x27m|’m| am))\s+(?:all\s+)?(?:done|caught up|up to date|good to go)\b|'
    r'\b(?:everything|all (?:your |the )?(?:work|assignments|tasks))\b.{0,30}\b(?:complete|completed|finished|done|submitted|turned in)\b', re.I)
SAVED_DATES_ONLY = re.compile(r'^\s*No dated deadlines?\b.{0,45}\b(?:saved|captured|listed)\b', re.I)
UNCERTAIN = re.compile(r'\b(?:cannot|can\x27t|can’t|could not|do not|does not)\s+(?:confirm|verify|establish|show)\b', re.I)
WORK_DETAIL = re.compile(r'\b(?:quiz(?:zes)?|labs?|laboratory|in[- ]class|worksheets?|problem sets?|posts?|replies|responses?|discussions?|forum|readings?|chapters?|preparation|prep|assignments?|homework|reports?|exercises?)\b', re.I)
MANDATORY = re.compile(r'^\s*(?:please\s+)?(?:complete|finish|submit|turn in|hand in|upload|post|reply|prepare|read|bring|answer|respond|attempt|take|do)\b|\b(?:you|students?|learners?|everyone)\s+(?:must|(?:are|is) required to|have to|need to|(?:are|is) expected to)\b|\b(?:must|need to)\s+be\s+(?:completed|submitted|uploaded|handed in|turned in|posted|brought)\b|\b(?:required|mandatory|compulsory)\s+(?:pre[- ]?lab\s+)?(?:quiz|lab|worksheet|assignment|report|discussion|in[- ]class)\b|\b(?:quiz(?:zes)?|worksheets?|assignments?|reports?|exercises?)\s+(?:is|are)\s+(?:required|mandatory|compulsory)\b', re.I)
OPTIONAL = re.compile(r'(?<!not\s)\boptional\b|\b(?:never|if|unless|example|sample|hypothetical|previously|formerly|recommended|suggested|voluntary)\b|\b(?:must|should|may)\s+not\b|\b(?:you|students?)\s+(?:may|can)\b|\b(?:not required|not mandatory|not compulsory|not an assignment|not assessed|no need to|do not need to|do not (?:complete|submit|upload|post|bring|respond|reply)|for practice only|practice only|for reference|last (?:week|month|year|term|semester)|(?:was|were) required|when assigned)\b', re.I)


def status_overview_question(question):
    if NAMED_ACTIVITY.search(question or ''):return False
    return bool(re.match(r'^\s*(?:what have (?:I|we) (?:already )?(?:submitted|finished)|(?:show|list) (?:my |our )?(?:submissions|submitted work))\b',question or '',re.I))

def finished_followup(job):
    if not re.search(r'\bI (?:have )?(?:finished|completed|done) (?:it|that|this)\b',job.get('question') or '',re.I):return None
    if not re.search(r'what should I do next',job.get('question') or '',re.I):return None
    scope=(job.get('work') or {}).get('scope') or {}
    if not scope.get('confirmed'):return 'Which task did you finish? Name the course and activity so I can update the next-step advice. Your report is separate from a Moodle submission; no progress was changed.'
    return 'Which task did you finish, and did you finish the work or submit it in Moodle? Name the course and activity. To keep finished work out of My Week after reload, open Review task, set My progress to done, then Save progress. Any missing submission or changed instructions will stay under Status checks. Your report will not verify a submission; no progress was changed by this message.'


def inventory_question(job):
    question = job.get('question') or ''
    if NEXT_DEADLINE.fullmatch(question):return True
    if status_overview_question(question):return True
    if re.search(r'\b(?:prioriti[sz]e|rank)\b.{0,60}\b(?:remaining|work|tasks?|courses?|next|this week|next week)\b|\bwhat\s+should\s+(?:I|we)\s+(?:work on|do)\s+next\b',question,re.I):return True
    if FACT.search(question) or NAMED_ACTIVITY.search(question) or COMPLETION_ASK.search(question): return False
    if INVENTORY.search(question) or LIST_REQUEST.search(question): return True
    if FOLLOWUP.search(question) and len(question) < 180:
        retrieval = job.get('retrieval_question') or ''
        if retrieval and (INVENTORY.search(retrieval) or LIST_REQUEST.search(retrieval)) and not FACT.search(retrieval) and not NAMED_ACTIVITY.search(retrieval) and not COMPLETION_ASK.search(retrieval): return True
        prior = [m.get('text') or '' for m in job.get('history') or [] if m.get('role') == 'user' and (m.get('text') or '').strip() != question.strip()]
        for topic in prior[-3:][::-1]:
            if FACT.search(topic) or NAMED_ACTIVITY.search(topic) or COMPLETION_ASK.search(topic): return False
            if INVENTORY.search(topic) or LIST_REQUEST.search(topic): return True
            if not FOLLOWUP.search(topic): return False
    return False


def reported_activity_progress(job, task, source):
    """Use an explicit personal report for planning, never as a Moodle receipt.

    Bind the activity number, kind, course and written/online portion. An
    ambiguous cross-course report or a negative statement cannot finish a task.
    """
    bound=task.get('personal_report') or {}
    if bound.get('task_id')==str(task.get('id') or '').split(':')[0] and bound.get('source_id')==task.get('source_id') and not bound.get('needs_review') and bound.get('state') in ('submitted','finished'):
        return bound['state']
    activity=re.compile(r'\b(assignment|homework|hw|quiz|test)\s*(\d+)\b',re.I)
    target=activity.search(task.get('title') or '')
    if not target:return False
    canonical=lambda value:'assignment' if value.lower() in ('assignment','homework','hw') else value.lower()
    key=(canonical(target[1]),int(target[2]))
    code=lambda value:re.sub(r'[^A-Z0-9]','',str(value or '').upper())
    target_course=code((source.get('course') or {}).get('code'))
    course_id=task.get('course_id') or source.get('course_id') or (source.get('course') or {}).get('id')
    part=lambda text:next(iter(re.findall(r'\b(?:online|written)\b',text.lower())),None)
    target_part=part(task.get('title') or '')
    entries=[]
    question=job.get('question') or ''
    if re.search(r'\bI (?:have )?(?:reported|finished|completed|submitted)\b',question,re.I):
        entries.append((question,(job.get('course') or {}).get('id')))
    # The shared server projection already reconciled saved report revisions.
    # Do not resurrect an older generic memory after a correction or source change.
    for memory in [] if task.get('personal_report_evaluated') else (job.get('student_context') or {}).get('memories',[]):
        if isinstance(memory,dict) and memory.get('kind')=='progress':entries.append((str(memory.get('body') or ''),memory.get('course_id')))
    for text,declared_course in entries:
        matches=list(activity.finditer(text))
        for i,match in enumerate(matches):
            if (canonical(match[1]),int(match[2]))!=key:continue
            prefix=text[max(0,match.start()-45):match.start()]
            named=list(re.finditer(r'\b([A-Z]{2,5})[ -]?(\d{3,4}[A-Z]?)\b',prefix,re.I))
            if named:
                if not target_course or code(named[-1].group())!=target_course:continue
            elif not declared_course or declared_course!=course_id:continue
            tail=text[match.end():min(matches[i+1].start() if i+1<len(matches) else len(text),match.end()+110)]
            tail=re.split(r'[.;,\n]',tail,maxsplit=1)[0]
            before=re.split(r'[.;,\n]',prefix)[-1]
            done=re.search(r'\b(?:submitted|finished|completed|complete|done)\b',tail,re.I)
            earlier=re.search(r'\b(?:I|we)(?: have)?\s+(?:finished|completed|submitted)\s*$',before,re.I)
            if not done and not earlier:continue
            statement=before+' '+tail[:done.start()] if done else before
            if re.search(r'\b(?:will|might|could|would|should|if|unless|whether|hypothetical|suppose|plan to|want to|hope to)\b',statement,re.I):continue
            if re.search(r'\b(?:not|never|haven.t|didn.t|have not|did not)\b',statement,re.I):continue
            reported_part=part(tail[:done.start()] if done else before)
            if (reported_part or target_part) and reported_part!=target_part:continue
            return 'submitted' if (done and done[0].lower()=='submitted') or (earlier and re.search(r'submitted',earlier[0],re.I)) else 'finished'
    return False


def _label(value, limit=220):
    return re.sub(r'\[\d+\]', '', ' '.join(str(value or '').split()))[:limit].strip()


def planning_header(job):
    """A clock-derived date/window is context, not an inferred academic deadline.

    Only use a backend-supplied local day that matches this job's aware clock.
    Old jobs without student context retain their original answer behavior.
    """
    student, work = job.get('student') or {}, job.get('work') or {}
    try:
        instant = datetime.fromisoformat(str(job.get('now') or '').replace('Z', '+00:00'))
        zone = job['timezone']
        if not instant.tzinfo or student.get('timezone') != zone: return ''
        local = instant.astimezone(ZoneInfo(zone))
        if student.get('today') != local.date().isoformat(): return ''
        window = work.get('window') or {}
        start, end = date.fromisoformat(window['start']), date.fromisoformat(window['end'])
        today = local.date()
        monday = today - timedelta(days=today.weekday())
        expected = {'today':(today,today), 'tomorrow':(today+timedelta(days=1),today+timedelta(days=1)),
          'this week':(monday,monday+timedelta(days=6)), 'next week':(monday+timedelta(days=7),monday+timedelta(days=13)),
          'the next seven days':(today,today+timedelta(days=6)), 'the next two weeks':(today,today+timedelta(days=13))}
        label=window.get('label') or ''
        days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
        if label in days:
            d=monday+timedelta(days=days.index(label));expected[label]=(d,d)
        if label.startswith('next ') and label[5:] in days:
            d=monday+timedelta(days=7+days.index(label[5:]));expected[label]=(d,d)
        if expected.get(label) != (start,end): return ''
    except (KeyError, ValueError, TypeError, ZoneInfoNotFoundError): return ''
    day = '%s, %s %d, %d' % (local.strftime('%A'), local.strftime('%B'), local.day, local.year)
    lines = ['Today is %s (%s). Planning window (%s): %s through %s.' % (day, _label(zone, 80), _label(window['label'],40), start, end)]
    scope = work.get('scope') or {}
    ids = set(scope.get('course_ids') or [])
    courses = [course for course in scope.get('courses') or [] if isinstance(course, dict) and course.get('id') in ids]
    if scope.get('confirmed') and courses:
        codes = [_label(course.get('code') or course.get('title'), 80) for course in courses]
        codes = list(dict.fromkeys(code for code in codes if code))
        if codes: lines.append(('Using your planning-course selection: ' if scope.get('basis')=='personal_selection' else 'Using your selected course scope: ')+', '.join(codes[:8])+(' and %d more' % (len(codes)-8) if len(codes)>8 else '')+'.')
    return '\n'.join(lines)+'\n\n'


def _when(task, zone):
    if task.get('confirmation') != 'observed-activity': return 'date not confirmed'
    dated = task.get('due_date')
    try:
        day = date.fromisoformat(dated) if isinstance(dated, str) and re.fullmatch(r'\d{4}-\d\d-\d\d', dated) else None
    except ValueError: day = None
    try:
        instant = datetime.fromisoformat(str(task.get('due_at') or '').replace('Z', '+00:00'))
        if instant.tzinfo is not None:
            local = instant.astimezone(ZoneInfo(zone))
            if day and day != local.date(): return 'date needs checking'
            return '%s at %s' % (local.date().isoformat(), local.strftime('%H:%M'))
    except (ValueError, ZoneInfoNotFoundError): pass
    return day.isoformat() + ' (time not stated)' if day else 'date not captured'


def _matches_scope(source, job, task=None):
    selected = (job.get('course') or {}).get('id')
    course = source.get('course_id') or (source.get('course') or {}).get('id')
    scope = (job.get('work') or {}).get('scope') or {}
    ids = scope.get('course_ids') or []
    if selected and course and course != selected: return False
    if scope.get('confirmed') and ids and course and course not in ids: return False
    if task and task.get('course_id') and course and task['course_id'] != course: return False
    if task and selected and task.get('course_id') and task['course_id'] != selected: return False
    asked_code = re.sub(r'[^A-Z0-9]', '', ((job.get('course') or {}).get('code') or '').upper())
    source_code = re.sub(r'[^A-Z0-9]', '', ((source.get('course') or {}).get('code') or '').upper())
    if asked_code and source_code and asked_code != source_code: return False
    return True


def _required(sentence):
    # "Post-growth" and "post-dualist" are concepts, not commands to post work.
    if re.match(r'\s*(?:please\s+)?(?:post|read|take|do|bring|answer|complete|submit|prepare|reply|respond|upload|finish)[-\u2010-\u2015]',sentence,re.I):return False
    return bool(not re.match(r'\s*[>"“]', sentence) and WORK_DETAIL.search(sentence) and MANDATORY.search(sentence) and not NO_WORK.search(sentence) and not OPTIONAL.search(sentence))


def _source_requirements(job):
    lines = []
    for n, source in enumerate(job.get('sources') or [], 1):
        if not _matches_scope(source, job) or source.get('class_recording') is True or source.get('historical') is True or injectionguard.untrusted(source): continue
        count, excluded = 0, False
        for raw in (source.get('excerpt') or '').splitlines():
            heading = re.sub(r'^\s*#+\s*', '', raw).strip()
            if len(heading) <= 90 and not re.search(r'[.!?]', heading):
                if re.fullmatch(r'(?:optional(?:\s+.*)?|practice(?:\s+(?:only|examples?))?|examples?|samples?|demonstrations?|for reference)\s*:?\s*', heading, re.I): excluded = True; continue
                if re.fullmatch(r'(?:required(?:\s+.*)?|mandatory(?:\s+.*)?|instructions|requirements|coursework|lab work|in[- ]class work)\s*:?\s*', heading, re.I): excluded = False
            if excluded: continue
            for sentence in re.split(r'(?<=[.!?])\s+|;\s*', raw):
                sentence = re.sub(r'^\s*(?:[-*•]\s+|\d+[.)]\s+)', '', sentence).strip()
                if not _required(sentence): continue
                title = _label(source.get('title') or 'Saved course source', 130)
                code = _label((source.get('course') or {}).get('code'), 30)
                if code and not job.get('course'): title = code + ' · ' + title
                who = 'Your note says' if source.get('kind') == 'note' else 'Saved instruction'
                line = '- %s — %s: “%s”; date not confirmed [%d]' % (title, who, _label(sentence, 280), n)
                lines.append((source.get('id'), _label(sentence, 1200).casefold(), line))
                count += 1
                if count == 6: break
            if count == 6: break
    return lines[:60]


def _source_lines(job):
    return [line for _, _, line in _source_requirements(job)]


def receipt_for(source, job, task=None):
    receipt = (task or {}).get('receipt') or source.get('receipt') or {}
    if not isinstance(receipt, dict) or receipt.get('eligible') is not True or receipt.get('provenance') not in ('signed_in_capture','owner_snapshot'): return None
    if receipt.get('version_id') != source.get('version_id') or receipt.get('activity_url') != source.get('original_url'): return None
    if not re.fullmatch(r'https://moodle\.acadiau\.ca/mod/(?:assign|quiz)/view\.php\?id=[1-9]\d{0,11}', receipt.get('activity_url') or ''): return None
    try:
        clock = datetime.fromisoformat(str(job.get('now') or '').replace('Z', '+00:00'))
        captured = datetime.fromisoformat(str(receipt.get('observed_at') or '').replace('Z', '+00:00'))
        if not clock.tzinfo or not captured.tzinfo or not -60 <= (clock-captured).total_seconds() <= 86400: return None
    except (ValueError, TypeError): return None
    return receipt if receipt.get('state') in ('submitted','draft','no_submission','reopened','attempt_finished','attempt_in_progress','attempt_overdue','attempt_abandoned') else None


def receipt_detail(receipt, job):
    labels={'submitted':'Moodle showed submitted for grading','draft':'Moodle showed a draft, not a submitted assignment','no_submission':'Moodle showed no submission','reopened':'Moodle showed reopened: review whether a new submission is needed','attempt_finished':'Moodle showed the latest numbered quiz attempt finished; grade and required retakes are not established','attempt_in_progress':'Moodle showed the latest numbered quiz attempt in progress','attempt_overdue':'Moodle showed the latest numbered quiz attempt overdue','attempt_abandoned':'Moodle showed the latest numbered quiz attempt never submitted'}
    try:
        instant = datetime.fromisoformat(str(receipt.get('observed_at') or '').replace('Z', '+00:00'))
        if not instant.tzinfo: raise ValueError('Observation time needs an offset')
        zone = job.get('timezone')
        try:
            observed = instant.astimezone(ZoneInfo(zone)).date().isoformat()+' ('+zone+')'
        except (TypeError, ValueError, ZoneInfoNotFoundError):
            observed = instant.astimezone(timezone.utc).date().isoformat()+' (UTC; student timezone unavailable)'
    except (TypeError, ValueError):
        observed = 'time not established'
    grade=grading_observation(receipt)
    grade_text=('; released grade '+grade['value']+' (attempt '+str(grade['attempt_number'])+')') if grade and grade['state']=='released' else '; this submitted attempt was not graded' if grade and grade['state']=='not_graded' else ''
    return labels[receipt['state']]+grade_text+'; observed '+observed



def grading_observation(receipt):
    """Recheck the server's grade view against its separate, bound capture proof."""
    view=(receipt or {}).get('grade') or {};proof=(receipt or {}).get('proof') or {};g=proof.get('grading') or {}
    if receipt.get('state')!='submitted' or proof.get('kind')!='assignment' or proof.get('layout')!='assign-status-table' or proof.get('truncated') is not False or g.get('truncated') is not False:return None
    attempt=re.fullmatch(r'This is attempt ([1-9]\d{0,5})(?:\s*\(\s*[1-9]\d{0,5} attempts? allowed\s*\))?\s*\.', ' '.join(str((g.get('attempt') or {}).get('value') or '').split()),re.I)
    if not attempt or view.get('attempt_number')!=int(attempt[1]):return None
    status=g.get('status') or {};classes=status.get('classes') or [];rows=g.get('rows') or []
    if view.get('state')=='not_graded' and status.get('value','').strip().lower()=='not graded' and 'submissionnotgraded' in classes and 'submissiongraded' not in classes and not rows and g.get('layout')=='assign-no-feedback':return view
    grades=[r.get('value') for r in rows if str(r.get('label','')).lower()=='grade'];dates=[r.get('value') for r in rows if str(r.get('label','')).lower()=='graded on']
    if view.get('state')!='released' or status.get('value','').strip().lower()!='graded' or 'submissiongraded' not in classes or 'submissionnotgraded' in classes or g.get('layout')!='assign-feedback-table' or len(grades)!=1 or len(dates)!=1:return None
    quoted=' '.join(str(grades[0] or '').split());score=re.fullmatch(r'(\d{1,7}(?:\.\d{1,6})?)\s*/\s*(\d{1,7}(?:\.\d{1,6})?)',quoted)
    if not score or float(score[2])<=0 or float(score[1])>float(score[2]) or view.get('value')!=quoted or not dates[0] or view.get('graded_on')!=dates[0]:return None
    return view


def personal_grade_question(question):
    # A mention of a previous grade inside a study request is not a grade lookup.
    return bool(re.search(r"^\s*(?:what(?:'s| is| was| are| were)?\s+my (?:\w+ ){0,2}(?:grade|score|mark)s?\b|what (?:percentage|percent|letter grade) (?:is|was) my (?:\w+ ){0,2}(?:grade|score|mark)\b|what (?:grade|score|mark) did I get\b|(?:show|tell|give)(?: me)?(?: about)? my (?:\w+ ){0,2}(?:grade|score|mark)\b)",question,re.I))



def grading_context(job):
    question=job.get('retrieval_question') or job.get('question') or ''
    if not re.search(r'\b(?:grades?|graded|scores?|marks?|submit\w*|resubmit\w*|re-submit\w*|disclosure|notices?|announcements?|completed|done|due|requirements?)\b',question,re.I):return ''
    selected=job.get('context') or [];rows=[]
    for n,source in enumerate(job.get('sources') or [],1):
        if source.get('kind')!='moodle' or not _matches_scope(source,job) or injectionguard.untrusted(source) or selected and source.get('id') not in selected:continue
        saved=source.get('receipt') or {}
        if not (saved.get('proof') or {}).get('grading'):continue
        receipt=receipt_for(source,job);grade=grading_observation(receipt) if receipt else None
        row={'cite':'[%d]'%n,'assignment':_label(source.get('title'),180),'grade_state':grade['state'] if grade else 'unknown'}
        if grade:row.update(attempt_number=grade['attempt_number'],value=grade.get('value'),graded_on=grade.get('graded_on'),submission_state=receipt['state'])
        rows.append(row)
        if len(rows)>=12:break
    if not rows:return ''
    return 'Saved assignment observations (untrusted signed-in captures, not independent server checks). Keep assignments and attempts separate. An unknown grade cannot be established by numbers elsewhere in an excerpt. A released grade is not permission to ignore later instructions and does not prove disclosure compliance. Cite the matching activity for each fact: '+json.dumps(rows,ensure_ascii=False)

def grade_answer(job):
    question=job.get('question') or ''
    if not personal_grade_question(question) or re.search(r'\b(?:weights?|worth|average|overall|GPA|calculate|pass(?:ed)?)\b|\bfinal grade\b',question,re.I):return None
    named=re.findall(r'\b(assignment|case|quiz)\s*#?\s*(\d{1,3})\b',question,re.I)
    if len(set((a.lower(),n) for a,n in named))>1:return 'Choose one assignment so I can keep its released grade separate from other activities.'
    selected=job.get('context') or []
    if not isinstance(selected,list):return None
    candidates=[(n,s) for n,s in enumerate(job.get('sources') or [],1) if s.get('kind')=='moodle' and re.fullmatch(r'https://moodle\.acadiau\.ca/mod/assign/view\.php\?id=[1-9]\d{0,11}',s.get('original_url') or '') and _matches_scope(s,job) and not injectionguard.untrusted(s) and (not named or re.search(r'\b'+named[0][0]+r'\s*#?\s*'+named[0][1]+r'\b',s.get('title') or '',re.I)) and (len(selected)!=1 or s.get('id')==selected[0])]
    if not candidates:return None
    if len(candidates)>1:return 'Which assignment do you mean? Select its source so I can check that exact saved Moodle grade.'
    n,source=candidates[0];receipt=receipt_for(source,job);grade=grading_observation(receipt) if receipt else None
    if not grade:return 'I cannot confirm a current released grade for '+_label(source.get('title'),180)+'. Refresh this assignment in the Companion; submission status alone does not establish a grade. [%d]'%n
    prefix='For '+_label(source.get('title'),180)+', attempt '+str(grade['attempt_number'])+': '
    if grade['state']=='not_graded':detail='Moodle showed this submitted attempt as not graded.'
    else:detail='Moodle showed a released grade of '+grade['value']+'. Graded on: '+_label(grade['graded_on'],240)+'.'
    return prefix+detail+' [%d]'%n+'\n\nThis is a saved signed-in observation, not a fresh Moodle server check. It does not establish whether a later notice requires action or whether disclosure requirements were met. Check the current notice for this exact assignment before deciding to resubmit.'

def receipt_answer(job):
    sources=job.get('sources') or []
    named=re.search(r'\b(assignment|quiz)\s+(\d{1,3})\b',job.get('question') or '',re.I)
    candidates=[(n,s) for n,s in enumerate(sources,1) if s.get('kind')=='moodle' and re.fullmatch(r'https://moodle\.acadiau\.ca/mod/(?:assign|quiz)/view\.php\?id=[1-9]\d{0,11}',s.get('original_url') or '') and (not named or re.search(r'\b'+named[1]+r'\s*'+named[2]+r'\b',s.get('title') or '',re.I))]
    if not candidates:return None
    if len(candidates)>1 and not named and not job.get('context') and not re.search(r'what.*(?:completed|submitted)|which.*(?:completed|submitted)',job.get('question') or '',re.I):return 'Which activity do you mean? Select its source so I can check that exact saved Moodle status.'
    lines=[]
    for n,source in candidates[:12]:
        receipt=receipt_for(source,job)
        detail=receipt_detail(receipt,job) if receipt else 'current submission or attempt status is not established; refresh this activity in the Companion'
        lines.append('- '+_label(source.get('title'),180)+' — '+detail+' [%d]'%n)
    return 'From these saved activity pages:\n'+'\n'.join(lines)+'\n\nThese are signed-in browser observations, not a fresh Moodle server check. A finished attempt does not establish a grade or that every requirement is complete.'


def _version_refs(sources):
    refs={};groups={}
    for number,source in enumerate(sources,1):
        identifier=source.get('id')
        if not identifier:continue
        pair=(number,source);refs[(identifier,source.get('version_id'))]=pair
        groups.setdefault(identifier,[]).append(pair)
    for identifier,pairs in groups.items():
        if len(pairs)==1:refs[identifier]=pairs[0]
    return refs


def next_deadline_answer(job):
    if not NEXT_DEADLINE.fullmatch(job.get('question') or '') or (job.get('source_scope') or {}).get('kind')=='selected_only':return None
    work=job.get('work') or {};scope=work.get('scope') or {}
    if not work:return 'I couldn’t check the saved Moodle deadlines for this question. Open the current activities or try again after refreshing Neyvu.',None
    if scope.get('clarification'):return _label(scope['clarification'],350),None
    if scope.get('confirmed') is not True or not scope.get('course_ids') or not planning_header(job):
        return 'Choose your current courses in Companion or select a course here so I can check its saved Moodle deadlines.',None
    now=datetime.fromisoformat(job['now'].replace('Z','+00:00'))
    zone=ZoneInfo(job['timezone']);campus=ZoneInfo('America/Halifax')
    start,end=(date.fromisoformat(work['window'][edge]) for edge in ('start','end'))
    refs=_version_refs(job.get('sources') or [])
    upcoming=[]
    for task in work.get('tasks') or []:
        if task.get('confirmation')!='observed-activity' or task.get('requirement')=='optional' or task.get('course_id') not in scope['course_ids']:continue
        key=(task.get('source_id'),task.get('version_id'));pair=refs.get(key)
        if not pair:continue
        number,source=pair
        if source.get('kind')!='moodle' or source.get('historical') is True or injectionguard.untrusted(source) or not _matches_scope(source,job,task):continue
        activity=re.fullmatch(r'https://moodle\.acadiau\.ca/mod/(assign|quiz)/view\.php\?id=[1-9]\d{0,11}',source.get('original_url') or '')
        if not activity:continue
        try:
            day=date.fromisoformat(task['due_date'])
            due=datetime.fromisoformat(task['due_at'].replace('Z','+00:00')) if task.get('due_at') else None
        except (KeyError,TypeError,ValueError):continue
        if due and (not due.tzinfo or due<now or due.astimezone(campus).date()!=day):continue
        local_day=due.astimezone(zone).date() if due else day
        if not start<=local_day<=end:continue
        labels=('due','due date','extension due date') if activity[1]=='assign' else ('due','due date','close','closes','close the quiz')
        matches=[m for m in MOODLE_DUE_FIELD.finditer(source.get('excerpt') or '') if m[1].lower() in labels]
        extension=next((m for m in matches if m[1].lower()=='extension due date'),None)
        field=extension or (matches[0] if matches else None)
        parsed=deadline_at_start(field[2]) if field else None
        if not parsed or parsed[1]!=(day.month,day.day,day.year):continue
        if due:
            clock=due.astimezone(campus)
            if ('time',(clock.hour,clock.minute)) not in parsed[2]:continue
        elif parsed[2]:continue
        title=_label(source.get('title'),180)
        code=_label((source.get('course') or {}).get('code'),30)
        if title:upcoming.append((local_day,due,number,key,(code+' · ' if code else '')+title,field[1],parsed[0],task.get('activity_captured_at')))
    if not upcoming:
        return 'I couldn’t verify an upcoming assignment or quiz deadline in the saved Moodle pages I checked for the next two weeks. Refresh the selected courses and check the current Moodle activities for additions or changes.',None
    earliest_day=min(item[0] for item in upcoming)
    first_day=[item for item in upcoming if item[0]==earliest_day]
    if all(item[1] for item in first_day):
        earliest=min(item[1] for item in first_day)
        first_day=[item for item in first_day if item[1]==earliest]
    for _,_,number,key,_,_,_,captured in first_day:
        conflict=moodle_deadline_conflict(job,activity=key)
        if conflict is not None:
            text,focus=conflict
            return text+'\n\n'+deadline_capture_note(captured,now,campus,number),focus
    if len(first_day)==1:
        _,due,number,_,title,field,quote,captured=first_day[0]
        label='upcoming deadline' if due else 'dated activity'
        text=f'The earliest {label} I found in your saved Moodle pages is **{title}**, with **{quote}** in Moodle’s **{field}** field'+(' (Halifax time)' if due else ' (time not stated)')+f' [{number}].'
        text+='\n\n'+deadline_capture_note(captured,now,campus,number)
    else:
        lines=[f'- **{title}** · Moodle {field}: {quote}'+(' (Halifax time)' if due else ' (time not stated)')+f' [{number}]. '+deadline_capture_note(captured,now,campus,number) for _,due,number,_,title,field,quote,captured in first_day[:6]]
        text='These are the earliest deadlines I found in your saved Moodle pages. The saved fields do not put one ahead of the others.\n\n'+'\n'.join(lines)
        if len(first_day)>6:text+='\n\nMore activities share this date. Check Calendar for the remaining saved dates.'
    return text+'\n\nCheck the current Moodle activity for later changes and submission status.',None


def deadline_capture_note(captured,now,zone,number):
    try:
        instant=datetime.fromisoformat(str(captured).replace('Z','+00:00'))
        if not instant.tzinfo or instant>now+timedelta(minutes=1):raise ValueError('Invalid capture time')
    except (TypeError,ValueError):
        return 'The last saved check time for this activity is unavailable. Recheck the current Moodle activity before relying on this date.'
    local=instant.astimezone(zone)
    stamp=f'{local:%b} {local.day}, {local.year} at {local:%H:%M} Halifax time'
    note=f'Last saved Moodle check for this activity: {stamp} [{number}].'
    if now-instant>timedelta(days=1):note+=' This capture is over a day old. Recheck the current activity before relying on the date.'
    return note


def action_order(action,zone):
    try:
        stamp=datetime.fromisoformat(str(action[1]).replace('Z','+00:00'))
        if stamp.tzinfo is None:stamp=stamp.replace(tzinfo=ZoneInfo(zone))
        return (stamp.timestamp(),action[0],action[2])
    except (ValueError,TypeError,KeyError):return (float('inf'),action[0],action[2])

def action_summary(action):
    text=action[2].split(' Why:',1)[0]
    citation=re.search(r' \[\d+\]$',action[2])
    return text+(citation[0] if citation and citation[0] not in text else '')


def focused_plan(job):
    """Source-bound actions using the same current status decisions as Today.

    Undated candidates are review evidence, not outstanding assignments. The
    backend supplies status; receipts are rechecked before claiming completion.
    Legacy payloads keep their qualified inventory behavior.
    """
    work=job.get('work') or {};scope=work.get('scope') or {}
    if work.get('plan_format')!=1 or not planning_header(job) or not scope.get('confirmed'):return None
    refs=_version_refs(job.get('sources') or [])
    actions=[];review=[];finished=[];receipt_finished=[];closed=[];seen=set();represented=set()
    for task in work.get('tasks') or []:
        if not isinstance(task,dict):continue
        pair=refs.get((task.get('source_id'),task.get('version_id')))
        if not pair or task.get('version_id')!=pair[1].get('version_id') or not _matches_scope(pair[1],job,task):continue
        if task.get('requirement')=='optional':continue
        participation=task.get('forum_participation') or {}
        if participation.get('scope')=='own_participation_only' and participation.get('source_id')==task.get('source_id') and participation.get('version_id')==task.get('version_id') and participation.get('activity_url')==pair[1].get('original_url'):
            review.append('- '+_label(task.get('title'),180)+' — your own forum participation was observed. Do not repeat the post automatically; check any remaining replies or requirements in the original. This is not full completion, a grade or official date/author authority [%d].'%pair[0])
            continue
        if injectionguard.untrusted(pair[1]):
            progress=task.get('personal_progress') or {}
            if progress.get('planned_on'):
                review.append('- '+_label(task.get('title'),180)+' — you personally planned '+_label(progress['planned_on'],10)+'. '+_label(progress.get('next_action'),350)+' The forum author and authority are unverified [%d].'%pair[0])
            elif progress.get('state') in ('done','not_applicable'):
                finished.append('- '+_label(task.get('title'),180)+' — you marked this done or not applicable; the forum source does not verify submission [%d].'%pair[0])
            continue
        instruction=task.get('instruction') or ''
        if task.get('confirmation')=='candidate' and not _required(instruction):continue
        # Generic writing advice and blanket submission policies do not create
        # an individual obligation for the requested week.
        if task.get('confirmation')=='candidate' and re.match(r'\s*(?:do\s+not\b|(?:(?:all|your|the)\s+)?(?:assignments|reports|quizzes|tests|exams)\s+(?:must|are required to|should)\b)',instruction,re.I):continue
        title=_label(task.get('title'),180)
        if not title:continue
        key=(task.get('source_id'),title.casefold())
        if key in seen:continue
        seen.add(key)
        represented.add((task.get('course_id'),re.sub(r'[^a-z0-9]','',title.casefold())))
        course=_label((pair[1].get('course') or {}).get('code'),80)
        match=re.search(r'\b[A-Z]{2,5}\s*\d{3,4}[A-Z]?\b',course)
        if match:course=match.group(0)
        if course and len(scope.get('course_ids') or [])>1:title=course+' · '+title
        progress=task.get('personal_progress') or {};status=task.get('planning_status') or {};state=status.get('state')
        receipt=receipt_for(pair[1],job,task)
        when=_when(task,job.get('timezone') or 'America/Halifax')
        citation=' [%d]'%pair[0]
        report=reported_activity_progress(job,task,pair[1]) if not receipt and not progress.get('changed_sources') else False
        if report:
            finished.append('- '+title+' — student-reported '+str(report)+'; Moodle submission remains unverified')
            continue
        if state in ('submitted','attempt_finished'):
            if receipt and receipt.get('state')==state:
                row='- '+title+' — '+receipt_detail(receipt,job)+citation;finished.append(row);receipt_finished.append(row)
            else:review.append('- '+title+' — refresh the saved Moodle status before doing this again'+citation)
            continue
        if state=='personal_done':
            if progress.get('changed_sources'):
                review.append('- '+title+' — you marked this finished, but its instructions changed; review the current source before deciding whether more work is needed'+citation);continue
            finished.append('- '+title+' — you marked this done or not applicable; Moodle submission remains unverified'+citation);continue
        if state=='missed':
            # Status is derived from exact owned activity evidence on the server.
            closed.append('- '+title+' — '+_label(status.get('label'),100)+'. '+_label(status.get('reason'),400)+citation);continue
        if state=='check_status':
            review.append('- '+title+' — '+when+'. '+_label(status.get('reason'),400)+citation);continue
        if task.get('confirmation')=='candidate' and not progress.get('planned_on'):
            review.append('- '+title+' — date not confirmed; review whether these instructions apply: “'+_label(instruction,180)+'”'+citation);continue
        if not task.get('due_at') and not task.get('due_date') and not progress.get('planned_on'):
            review.append('- '+title+' — date not confirmed; check the instructions and identify the next required step'+citation);continue
        materials=[(n,s) for n,s in enumerate(job.get('sources') or [],1) if s.get('version_id') and not injectionguard.untrusted(s) and (s.get('source_material') or {}).get('kind')!='student_notes']
        action=_label(progress.get('next_action'),350) or next_step(task,pair[1],materials)
        reason='The saved deadline is in your requested period.'
        if re.fullmatch(r'(?:next )?(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)',(work.get('window') or {}).get('label') or ''):
            reason='Upcoming saved deadline; this is preparation on your chosen study day, not a changed deadline.'
        rank=1
        if progress.get('planned_on'):
            action=_label(progress.get('next_action'),350) or 'Continue your chosen next step.'
            reason='You planned this for '+_label(progress['planned_on'],10)+' (a personal study day, not a deadline).'
        if progress.get('changed_sources'):
            action='Review the changed instructions before continuing.';reason='The linked source changed after your progress update.';rank=0
        elif progress.get('planned_on') and str(progress['planned_on'])<str((job.get('student') or {}).get('today') or ''):
            action='Before choosing a new step, report whether you finished, partly finished or did not start this task.'
            reason='Your chosen study day has passed; completion remains unverified. Your report stays separate from a Moodle receipt.'
        if state=='submit_late':
            action='Submit late in Moodle after checking the current activity.';reason=_label(status.get('reason'),500);rank=0
        status_label='Submit late · check Moodle' if state=='submit_late' else 'Draft · not submitted' if receipt and receipt.get('state')=='draft' else 'Not submitted' if receipt and receipt.get('state')=='no_submission' else 'Submission reopened' if receipt and receipt.get('state')=='reopened' else 'Due today · submission unverified' if (task.get('due_date') or '')==str((job.get('student') or {}).get('today') or '') else 'Upcoming · submission unverified'
        actions.append((rank,str(task.get('due_at') or task.get('due_date') or '9999'),'- '+title+' — '+when+'. '+action+' Why: '+reason+citation,status_label))
    start,end=(work.get('window') or {}).get('start'),(work.get('window') or {}).get('end')
    for assessment in work.get('assessments') or []:
        if not isinstance(assessment,dict) or assessment.get('sourceKind')=='student_plan':continue
        pair=refs.get((assessment.get('sourceId'),assessment.get('version')))
        if not pair or pair[1].get('version_id')!=assessment.get('version') or not _matches_scope(pair[1],job) or injectionguard.untrusted(pair[1]):continue
        key=_label(assessment.get('key'),100);day=assessment.get('date');course_id=assessment.get('courseId')
        if not key or course_id not in (scope.get('course_ids') or []):continue
        if (course_id,re.sub(r'[^a-z0-9]','',key.casefold())) in represented:continue
        course=_label(assessment.get('course'),80);match=re.search(r'\b[A-Z]{2,5}\s*\d{3,4}[A-Z]?\b',course)
        if match:course=match.group(0)
        title=(course+' · ' if len(scope.get('course_ids') or [])>1 else '')+key.capitalize()
        quote=_label(assessment.get('quote'),220);citation=' [%d]'%pair[0]
        conflicts=[conflict for conflict in assessment.get('conflicts') or [] if not conflict.get('olderSyllabusVersion') and conflict.get('date')!=day]
        if conflicts:
            evidence=[]
            for conflict in conflicts[:3]:
                other=refs.get((conflict.get('sourceId'),conflict.get('version')))
                if other and other[1].get('version_id')==conflict.get('version'):
                    evidence.append(_label(conflict.get('date'),10)+' in '+_label(conflict.get('sourceKind'),60)+' [%d]'%other[0])
            review.append('- '+title+' — '+_label(day,10)+': “'+quote+'”'+citation+'. Conflicting saved dates: '+('; '.join(evidence) or 'open the saved sources')+'. Confirm the current official date before scheduling preparation.');continue
        if isinstance(day,str) and day<str((job.get('student') or {}).get('today') or ''):
            review.append('- '+title+' — saved assessment date '+day+' has passed. Check the outcome or any rescheduled assessment; do not prepare for it as an upcoming test'+citation)
            continue
        if isinstance(day,str) and start<=day<=end:
            passage=pair[1].get('excerpt') or ''
            if re.search(r'Harlow',passage,re.I) and re.search(r'Glass Harbor',passage,re.I):
                step='Choose one Harlow/Glass Harbor prompt from the guide. Answer it with notes closed, then check the reasoning against the assigned text and mark the first gap to review.'
            else:step='Check the current scope for this test, work one released problem or review prompt without notes, and check each step against the course material. Record the first point you cannot justify.'
            actions.append((1,day,'- '+title+' — '+day+' (assessment date; time not established here). '+step+' Suggested preparation; '+{'course_material':'the saved course document','moodle_announcement':'the saved Moodle announcement','moodle_page':'the saved Moodle page','syllabus':'the saved syllabus'}.get(assessment.get('sourceKind'),'the saved source')+' states “'+quote+'”'+citation))
    header_job=dict(job,work=dict(work,scope=dict(scope,courses=[dict(c,code=(re.search(r'\b[A-Z]{2,5}\s*\d{3,4}[A-Z]?\b',c.get('code') or '') or [c.get('code') or ''])[0]) for c in scope.get('courses') or []])))
    parts=[planning_header(header_job).strip()]
    overview=status_overview_question(job.get('question'))
    if actions and not overview:
        # Deadline urgency leads; a changed source/late status remains explicit
        # in its action instead of displacing every imminent deadline.
        ordered_actions=sorted(actions,key=lambda a:action_order(a,job.get('timezone') or 'UTC'))
        parts+=['### What to work on next',action_table(ordered_actions[:3])]
        parts.append('**Next step:** Start with the first ranked action, or name what you already finished so we can reconsider. These are task priorities, not scheduled study blocks. Status comes from saved Moodle evidence or is explicitly unverified.')
        if len(actions)>3:parts+=['### More saved actions', '\n'.join(action_summary(a) for a in ordered_actions[3:8])+('\nMore saved actions are available in My Week.' if len(actions)>8 else '')]
    elif not overview:parts+=['I cannot identify a confirmed next action for this period from the saved evidence. Review the items below or refresh Moodle before choosing work; this is not an all-clear.']
    def upcoming_day(task):
        value=task.get('due_date') or ''
        if task.get('due_at'):
            try:value=datetime.fromisoformat(task['due_at'].replace('Z','+00:00')).astimezone(ZoneInfo(job.get('timezone') or 'UTC')).date().isoformat()
            except (ValueError,TypeError):return False
        return bool(value and start<=value<=end)
    # A regular class meeting or an old deadline cannot fill a missing-work
    # gap. Identify exactly which requested courses lack a forthcoming task.
    dated_courses={t.get('course_id') for t in work.get('tasks') or [] if isinstance(t,dict) and upcoming_day(t)}
    dated_courses.update(a.get('courseId') for a in work.get('assessments') or [] if isinstance(a,dict) and start<=str(a.get('date') or '')<=end)
    gaps=[c for c in scope.get('courses') or [] if c.get('id') not in dated_courses]
    if gaps:parts.append('### Information to check\n'+'\n'.join('- '+_label(c.get('code'),80)+': no forthcoming dated task was established in this answer. '+('Open the current lab handout and confirm the next quiz or exercise.' if re.search('lab',str(c.get('title') or '')+' '+str(c.get('code') or ''),re.I) or re.search(r'\dL\b',str(c.get('code') or '')) else 'Check the current Moodle activity list and class instructions for the next deliverable or preparation.')+' A class meeting or an old deadline does not establish that the work list is complete.' for c in gaps))
    if overview:
        personal=[line for line in finished if line not in receipt_finished]
        out=[planning_header(header_job).strip(),'### Saved submission overview','These are saved observations and personal reports, not a new Moodle check.']
        out+=['**Moodle receipts:** '+('The following activities have eligible saved receipt evidence:' if receipt_finished else 'No current eligible submission receipt is available in this answer. That does not mean nothing was submitted.')]
        if receipt_finished:out+=['\n'.join(receipt_finished[:5])]
        if personal:out+=['### Your saved reports','\n'.join(personal[:5])]
        if actions:out+=['### Upcoming work — completion unverified','\n'.join(action_summary(a) for a in sorted(actions,key=lambda a:action_order(a,job.get('timezone') or 'UTC'))[:3])]
        if review:out+=['### Check the saved status','\n'.join(sorted(review,key=lambda line:(re.search(r'\d{4}-\d{2}-\d{2}',line) or [''])[0],reverse=True)[:3])]
        if closed:out+=['### Closed activities — review exceptions','\n'.join(closed[:3])]
        out+=['**Next step:** Open a cited activity in Moodle and check its submission status and last submission time. A deadline or your finished report does not verify submission.','This is a bounded, partial saved-work review. Other tasks, receipts and personal projects may not fit here; review My Week and refresh the exact Moodle activities. No dates or progress were changed.']
        return '\n\n'.join(out)[:12000]
    # Preserve student projects and class-derived actions from the legacy
    # renderer, with its exact transcript applicability and source checks.
    meetings=[];has_office_hours=False
    meeting_seen=set();missing_meeting_evidence=False
    for item in list(work.get('meetings') or [])+list(job.get('agenda') or []):
        pair=(refs.get((item.get('source_id'),item.get('version_id'))) if item.get('version_id') else refs.get(item.get('source_id'))) if isinstance(item,dict) else None
        if isinstance(item,dict) and item.get('kind') in ('class','lab','office_hours') and start<=str(item.get('date') or '')<=end and not pair:missing_meeting_evidence=True
        if isinstance(item,dict):
            day=str(item.get('date') or '')
            if day<str((job.get('student') or {}).get('today') or ''):continue
            if re.fullmatch(r'\d{2}:\d{2}',str(item.get('time') or '')):
                try:
                    began=datetime.fromisoformat(day+'T'+item['time']).replace(tzinfo=ZoneInfo(job.get('timezone') or 'UTC'))
                    clock=datetime.fromisoformat(str(job.get('now') or '').replace('Z','+00:00'))
                    if clock.tzinfo and began<=clock:continue
                except (ValueError,TypeError,KeyError):pass
        identity=(item.get('source_id'),item.get('version_id'),item.get('date'),item.get('time')) if isinstance(item,dict) else None
        if pair and (not item.get('version_id') or item['version_id']==pair[1].get('version_id')) and identity not in meeting_seen and _matches_scope(pair[1],job) and item.get('kind') in ('class','lab','office_hours') and start<=str(item.get('date') or '')<=end:
            meeting_seen.add(identity)
            if item.get('kind')=='office_hours':has_office_hours=True
            meetings.append('- '+_label(item.get('date'),10)+' '+_label(item.get('time') or '(time not stated)',30)+' · '+_label(item.get('title'),180)+' · '+_label(item.get('authority') or 'Confirmed schedule',100)+' [%d]'%pair[0])
    if meetings:parts+=[('### Classes and office hours to plan around' if has_office_hours else '### Classes to plan around'),'\n'.join(meetings[:8])+('\nSee Calendar for more confirmed meetings.' if len(meetings)>8 else '')]
    if missing_meeting_evidence or job.get('agenda_omitted'):review.append('- Some saved schedule entries lack their exact source version in this answer. Open Calendar and refresh the linked evidence before planning around them.')
    period_plans=[p for p in work.get('plans') or [] if not p.get('planned_on') or start<=str(p['planned_on'])<=end]
    legacy=inventory_answer(dict(job,work=dict(work,plan_format=0,plans=period_plans)))
    marker='Your projects and milestones (personal dates, not official deadlines):'
    class_marker='Class-derived actions (check the audio, conditions and Moodle):'
    for label in (marker,class_marker):
        if label in legacy:
            section=legacy.split(label,1)[1].split('\n\n',1)[0].strip()
            if section:parts+=['### '+label.rstrip(':'),section]
    if review:parts+=['### Check before planning','\n'.join(review[:5])+('\nMore undated or uncertain items are available in Today and Sources.' if len(review)>5 else '')]
    if closed:parts+=['### Closed activities — review exceptions','\n'.join(closed[:5])]
    if finished:parts+=['### Already submitted or personally finished','\n'.join(finished[:8])]
    parts+=['Only eligible positive Moodle receipt evidence verifies a saved submission. Personal reports remain separate. Other completion and submission remain unknown. Refresh Moodle for later changes and missing quiz, lab, in-class and reading instructions. Open My Week to review or adjust your plan; no dates or progress were changed.']
    return '\n\n'.join(parts)[:12000]

def inventory_answer(job):
    work=job.get('work') or {}
    if work.get('plan_format')==1 and not (work.get('scope') or {}).get('confirmed') and not (work.get('scope') or {}).get('clarification'):
        return 'Choose the courses you want to include in My Week, then ask this question again. Your academic planning scope has not been confirmed, so I have not treated the support-space list as your full workload. You can also select one course in this chat. No task, date or progress was changed.'
    focused=focused_plan(job)
    if focused is not None:return focused
    work = job.get('work') or {}
    scope = work.get('scope') or {}
    if isinstance(scope.get('clarification'), str) and scope['clarification'].strip(): return _label(scope['clarification'], 600)
    confirmed = scope.get('confirmed') if 'confirmed' in scope else bool(job.get('course'))
    sources = job.get('sources') or []
    refs = _version_refs(sources)
    lines, reported, observed, seen, represented = [], [], [], set(), set()
    for task in (work.get('tasks') or [])[:60] if confirmed else []:
        if not isinstance(task, dict): continue
        pair = refs.get((task.get('source_id'),task.get('version_id')))
        if not pair: continue
        n, source = pair
        if not _matches_scope(source, job, task): continue
        if not task.get('version_id') or task['version_id'] != source.get('version_id'): continue
        if injectionguard.untrusted(source):
            progress=task.get('personal_progress') or {}
            if progress.get('planned_on'):
                lines.append('- '+_label(task.get('title'))+' — your personal study day: '+_label(progress['planned_on'],10)+'. '+_label(progress.get('next_action'),350)+' Forum author/authority unverified [%d].'%n)
            elif progress.get('state') in ('done','not_applicable'):
                reported.append('- '+_label(task.get('title'))+' — student-reported done or not applicable; submission unverified [%d].'%n)
            continue
        title = _label(task.get('title'))
        if not title: continue
        instruction = _label(task.get('instruction'), 280)
        if task.get('requirement') == 'optional': continue
        if task.get('confirmation') == 'candidate' and not _required(task.get('instruction') or ''): continue
        key = (task.get('source_id'), title.casefold(), instruction.casefold())
        if key in seen: continue
        seen.add(key)
        detail = ('Saved instruction: “%s”; date not confirmed' % instruction) if task.get('confirmation') == 'candidate' and instruction else _when(task, job.get('timezone') or 'America/Halifax')
        if instruction and task.get('confirmation') != 'candidate' and _required(task.get('instruction') or ''):
            detail += '; saved instruction: “%s”' % instruction
        if instruction and _required(task.get('instruction') or ''):
            for sentence in re.split(r'(?<=[.!?])\s+|;\s*', instruction): represented.add((task.get('source_id'), _label(sentence, 1200).casefold()))
        kind = {'assignment':'assignment', 'quiz':'quiz', 'lab':'lab', 'in_class':'in-class work', 'worksheet':'worksheet', 'discussion':'discussion', 'reading':'reading', 'preparation':'preparation', 'report':'report'}.get(task.get('kind'))
        if kind and kind.casefold() not in title.casefold(): title += ' (' + kind + ')'
        course_label = _label((source.get('course') or {}).get('code'), 30)
        if course_label and len(scope.get('course_ids') or []) > 1: title = course_label + ' · ' + title
        progress=task.get('personal_progress') or {}
        if not progress and reported_activity_progress(job,task,source):progress={'state':'done'}
        personal={'not_started':'student-reported not started','in_progress':'student-reported in progress','done':'student-reported done','not_applicable':'student-reported not applicable'}.get(progress.get('state'))
        if personal:
            detail+='; '+personal
            if progress.get('changed_sources'):detail+='; instructions changed: review your progress against the current source'
            if progress.get('planned_on'):detail+='; personally planned '+_label(progress['planned_on'],10)
            if progress.get('next_action'):detail+='; your next action: '+_label(progress['next_action'],600)
        receipt=receipt_for(source,job,task)
        if receipt:detail+='; '+receipt_detail(receipt,job)
        elif task.get('receipt'):detail+='; saved Moodle status needs a fresh activity check'
        row='- %s — %s [%d]' % (title, detail, n)
        if receipt and receipt['state'] in ('submitted','attempt_finished'):observed.append(row)
        elif progress.get('state') in ('done','not_applicable') and not progress.get('changed_sources') and not receipt:reported.append(row)
        else:lines.append(row)
    for source, instruction, line in _source_requirements(job):
        if (source, instruction) not in represented:
            lines.append(line); represented.add((source, instruction))
    label = _label((work.get('window') or {}).get('label'), 90)
    heading = 'Saved work to check' + (' for ' + label if label else '') + ':'
    personal_plans=[];class_plans=[]
    for plan in (work.get('plans') or [])[:70] if confirmed else []:
        if not isinstance(plan,dict) or plan.get('state')=='archived' or plan.get('state')=='done' and not (plan.get('kind')=='class_action' and (plan.get('class_action') or {}).get('needs_review')) or scope.get('course_ids') and plan.get('course_id') not in scope['course_ids']:continue
        title=_label(plan.get('title'),180)
        if not title:continue
        if plan.get('kind')=='class_action':
            evidence=plan.get('class_evidence') or {};status=plan.get('class_action') or {};pair=refs.get((evidence.get('source_id'),evidence.get('version_id')))
            if not pair or pair[1].get('version_id')!=evidence.get('version_id') or not _matches_scope(pair[1],job,plan):continue
            if status.get('review')=='not_applicable':continue
            detail='class-derived candidate; '+('you confirmed it applies' if status.get('review')=='applies' and not status.get('needs_review') else 'review applicability and unidentified speaker')
            if evidence.get('status')!='current':detail+='; withdrawn from the current transcript: your personal plan is kept'
            if evidence.get('optional'):detail+='; wording is optional or suggested'
            if evidence.get('conditional'):detail+='; conditional instruction: check who it applies to'
            if evidence.get('ambiguous'):detail+='; uncertain speech or surrounding context'
            if evidence.get('date_phrase'):detail+='; class wording: '+_label(evidence['date_phrase'],100)
            if evidence.get('stated_date'):detail+=' ('+_label(evidence['stated_date'],10)+'; class-stated, not a verified Moodle deadline)'
            if status.get('conflict'):detail+='; '+_label(status['conflict'],350)
            if plan.get('planned_on'):detail+='; personally planned '+_label(plan['planned_on'],10)
            detail+='; you reported '+_label(plan.get('state'),30).replace('_',' ')
            if plan.get('next_action'):detail+='; your next action: '+_label(plan['next_action'],600)
            class_plans.append('- '+title+' — '+detail+'; speech: “'+_label(evidence.get('quote'),700)+'” [%d]'%pair[0]);continue
        detail='your '+('milestone' if plan.get('kind')=='milestone' else 'project')+'; student-reported '+_label(plan.get('state'),30).replace('_',' ')
        if plan.get('planned_on'):detail+='; personally planned '+_label(plan['planned_on'],10)
        if plan.get('next_action'):detail+='; next action: '+_label(plan['next_action'],600)
        if plan.get('changed_sources'):detail+='; linked instructions changed: review the current source'
        personal_plans.append('- '+title+' — '+detail)
    if observed:lines+=['','Observed submissions and finished attempts (check Moodle for later changes):']+observed
    if reported:lines+=['','Your reported progress (Moodle receipts remain unverified):']+reported
    if personal_plans:lines+=['','Your projects and milestones (personal dates, not official deadlines):']+personal_plans
    if class_plans:lines+=['','Class-derived actions (check the audio, conditions and Moodle):']+class_plans
    if lines:
        displayed, size = [], len(heading)
        for line in lines:
            if size + len(line) + 1 > 10500: break
            displayed.append(line); size += len(line) + 1
        answer = heading + '\n' + '\n'.join(displayed)
        answer += ('\n\nOnly eligible positive Moodle receipt evidence verifies a saved submission. Personal reports remain separate. Other completion and submission remain unknown. Check' if observed else '\n\nCompletion and submission are not verified. Check')+ ' the current Moodle quiz, lab and in-class instructions for later changes or work not captured here.'
        if not confirmed: answer += ' Which current course do you mean? Select it so I can check its saved activities.'
        if len(displayed) < len(lines) or len(work.get('tasks') or []) > 60: answer += ' More saved work may be available; select a course to narrow this list.'
        return planning_header(job) + answer
    if not confirmed: return 'Which current course do you mean? Select it so I can check its saved quiz, lab and in-class work. Missing capture does not show that you have nothing to turn in.'
    if any(isinstance(p,dict) and p.get('kind')=='class_action' for p in work.get('plans') or []):
        return planning_header(job) + 'Your class actions are saved in Today, but I could not show source-backed items from their exact transcript versions in this answer. Open Today to review them and select a course to narrow the summary. Completion and submission remain unverified.'
    if (work.get('coverage') or {}).get('task_count', 0) > 0:
        return planning_header(job) + 'Saved work exists, but I could not show source-backed items for this planning window. Your course choices are saved. Check another period and Sources for missing or changed instructions. Partial collection does not establish that nothing is due. Completion and submission remain unverified.'
    return planning_header(job) + 'I do not have a source-backed work list for your selected courses yet. Your course choices are saved; missing readable activity instructions are the gap. Refresh those courses in the Companion and check Sources. Completion and submission remain unverified.'


def guard(answer, job):
    """Keep useful answer sentences and replace unsupported blanket all-clear claims."""
    pieces = re.split(r'(?<=[.!?])\s+|\n\n', answer)
    def unsafe(piece):
        for claim in NO_WORK.finditer(piece):
            if SAVED_DATES_ONLY.search(piece) and claim.start() == len(piece) - len(piece.lstrip()): continue
            prefix = piece[:claim.start()]
            disclaimers = list(UNCERTAIN.finditer(prefix))
            qualifier = prefix[disclaimers[-1].end():] if disclaimers else None
            if qualifier is None or len(qualifier) > 80 or re.search(r'\b(?:but|however|yet|nevertheless|therefore|hence|so)\b', qualifier, re.I): return True
        return False
    if not any(unsafe(piece) for piece in pieces): return answer
    if inventory_question(job): return inventory_answer(job)
    kept = [piece.strip() for piece in pieces if not unsafe(piece) and piece.strip() and not re.fullmatch(r'(?:\[\d+\]\s*)+', piece.strip())]
    kept.append('The saved sources do not establish that all your work is complete or that nothing needs turning in. Check the current quiz, lab and in-class instructions.')
    return '\n\n'.join(kept)


def collection_answer(job):
    """Only the server's tenant-scoped snapshot establishes collection counts."""
    question=job.get('question') or ''
    primary=re.search(r'\b(?:plan (?:my|our|the|this|next) (?:week|day)|prepare me|help me (?:prepare|study|understand)|preparame)\b',question,re.I)
    explicit=re.search(r'\b(?:check|list|show|audit|review|is|are|which|what|tell)\b[^.!?;\n]{0,100}\b(?:files?|materials?|sources?|collection|coverage|content|courses?)\b',question,re.I)
    if primary and (not explicit or primary.start()<explicit.start()):return None
    coverage = job.get('collection_coverage')
    if coverage is None:
        return None
    if not isinstance(coverage, dict) or coverage.get('scope_confirmed') is not True:
        return 'Which course do you mean? Select that course so I can check its saved collection report.'
    courses = coverage.get('courses')
    if not isinstance(courses, list) or not courses:
        return 'No saved collection report is available for this course scope. Open Sources to check your courses and add readable materials.'
    lines = ['I can check what is saved, but I cannot confirm that every course material has been collected. This is saved coverage, not a live Moodle check.']
    for course in courses[:40]:
        r = course.get('readiness') or {}
        a = r.get('attachments') or {}
        number = lambda value: value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else 0
        label = str(course.get('code') or 'Course').replace('\n', ' ')[:80]
        lines.append('**%s**\n- Readable Moodle pages: %d.\n- Personal notes: %d.\n- Stored files with readable text: %d of %d.' % (label, number(r.get('readable_pages')), number(r.get('personal_notes')), number(a.get('readable')), number(a.get('stored'))))
        for key, title in [('pending', 'Files waiting for text extraction'), ('failed', 'Files that could not be read'), ('not_indexed', 'Stored files without searchable text'), ('truncated', 'Files with truncated text'), ('partial', 'PDFs with partial reading')]:
            if number(a.get(key)): lines.append('- %s: %d.' % (title, number(a.get(key))))
        if number(r.get('title_or_link_only_pages')): lines.append('- Some saved Moodle pages contain only titles or links.')
        if r.get('state') == 'limited': lines.append('- The saved collection report records gaps. Check the course report in Sources.')
    lines.append('Open **Sources → Check course content and collection gaps**, then compare with Moodle. Hidden pages, uncollected attachments and external material may be missing. Saved activity text does not verify submission or grades.')
    return '\n\n'.join(lines)

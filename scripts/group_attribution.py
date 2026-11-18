"""Source-bound answers to personal group/applicability questions.

These answers are compiled before generation, so an activity's citation cannot
be promoted by model prose into proof of membership. The course projection is
server supplied. Reports, profile membership and activity receipts stay distinct.
No source titles, previous assistant text or roster guesses establish membership.
"""
from datetime import datetime
import re
import injectionguard
import workguard
import knowledge_graph


def _plain(value, limit=180):
    return re.sub(r'[\[\]<>`*_\\]', '', re.sub(r'\s+', ' ', str(value or '')))[:limit].strip()


def _fresh(at, now):
    try:
        age=(datetime.fromisoformat(now.replace('Z','+00:00'))-datetime.fromisoformat(at.replace('Z','+00:00'))).total_seconds()
        return -60 <= age <= 86400
    except (ValueError, TypeError, AttributeError):
        return False


def requested(question):
    q=question or ''
    return bool(re.search(r'\b(?:my|our)\s+(?:lab\s+)?(?:group|team|section)\b|'
        r'\bwhich\s+(?:group|team|section)\b|\b(?:group|team|section)\b.{0,50}\b(?:apply|applies|belong|assigned|enrolled)\b|'
        r'\b(?:apply|applies)\s+to\s+(?:me|us)\b', q, re.I))


def activity_group(source, job):
    r=source.get('receipt') or {};p=r.get('proof') or {};m=r.get('membership') or {}
    if (r.get('provenance')!='signed_in_capture' or not _fresh(r.get('observed_at'),job.get('now'))
        or not source.get('version_id') or r.get('version_id')!=source['version_id']
        or not source.get('original_url') or r.get('activity_url')!=source['original_url']
        or not re.search(r'/mod/assign/view\.php\?id=\d+$',source['original_url'])
        or p.get('kind')!='assignment' or p.get('layout')!='assign-status-table' or p.get('truncated') is not False
        or m.get('state')!='observed'):
        return None
    rows=[row for row in p.get('rows') or [] if str(row.get('label','')).strip().casefold()=='group']
    if len(rows)!=1:return None
    name=str(rows[0].get('value') or '').strip()
    if (not name or len(name)>180 or re.search(r'[\x00-\x1f\x7f]',name)
        or re.match(r'^(?:no groups?|none|not (?:a member|in a group)|all (?:participants|groups)|choose|select)\b',name,re.I)
        or name!=m.get('group')):return None
    return name


# Group-variant labels that a course can use for lab/section/team versions of
# one activity. Deliberately narrow: an unrecognised word is never offered as
# a group, and the student's choice is stored only as a student report.
_DAY=r'(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day'
_GREEK=r'(?:Alpha|Beta|Gamma|Delta|Epsilon|Zeta|Theta|Kappa|Sigma|Omega)'
_LABEL=(r'(?:(?:'+_DAY+r'\s+)?'+_GREEK+r'|'+_DAY+r'|(?:Section|Group|Team)\s+(?:[A-Z]|\d{1,3}))')
_SUFFIX=r'(?:\s+(?:group|section|lab|team|students?))?'
_NOUNS={'lab':'lab section','section':'section','team':'team'}


def _norm(x):
    return ' '.join(str(x or '').casefold().split())


def _course_context(job):
    """The single course and its server-supplied group context, or None."""
    course=(job.get('course') or {}).get('id')
    contexts=job.get('group_context')
    if not isinstance(contexts,list):return None,None
    if not course and len(contexts)==1:course=contexts[0].get('course_id') if isinstance(contexts[0],dict) else None
    matches=[c for c in contexts if isinstance(c,dict) and c.get('course_id')==course]
    return (course,matches[0]) if course and len(matches)==1 else (None,None)


def _target(question):
    named=re.findall(r'\b(lab|assignment|quiz|project|test|exam)\s*(\d{1,3})\b',question or '',re.I)
    if len(set((a.lower(),b) for a,b in named))!=1:return None,None
    noun,number=named[0]
    return re.compile(r'\b'+re.escape(noun)+r'[\s_-]*'+re.escape(number)+r'\b',re.I),noun.capitalize()+' '+number


def _related(job,course,target):
    return [(n,s) for n,s in enumerate(job.get('sources') or [],1) if isinstance(s,dict)
            and (s.get('course_id') or (s.get('course') or {}).get('id'))==course
            and s.get('kind') in ('moodle','file') and not s.get('historical') and not injectionguard.untrusted(s)
            and target and target.search(s.get('title') or '')]


def variant_options(related,target):
    """Distinct group labels in current, same-course sources for one activity.

    Labels come from the activity title remainder ("Lab 7 Beta") or a line that
    starts with the label ("Beta group: ..."). Each option keeps its citations.
    """
    found={}
    def add(name,n):
        name=' '.join(name.split());key=_norm(name)
        if not name or len(name)>180:return
        entry=found.setdefault(key,{'name':name,'sources':[]})
        if n not in entry['sources']:entry['sources'].append(n)
    for n,s in related:
        rest=target.sub(' ',s.get('title') or '')
        m=re.search(r'(?<!\w)('+_LABEL+r')'+_SUFFIX+r'(?!\w)',rest,re.I)
        if m:add(m.group(1),n)
        for line in (s.get('excerpt') or '').splitlines():
            m=re.match(r'^\s*(?:[-*]\s*)?('+_LABEL+r')'+_SUFFIX+r'\s*:',line,re.I)
            if m:add(m.group(1),n)
    return list(found.values())[:8]


def _group_state(job):
    """Shared decision inputs for the clarification and the answer trigger."""
    question=job.get('question') or ''
    if (job.get('source_scope') or {}).get('kind')=='selected_only':return None
    course,context=_course_context(job)
    target,label=_target(question)
    if not course or not target:return None
    related=_related(job,course,target)
    # SCHOOL_BETA_KNOWLEDGE_GRAPH=1: the versions come from the learner graph
    # (applies_to edges with pinned evidence) instead of the lexical scan.
    options=knowledge_graph.group_options(job,course,label,related) if knowledge_graph.enabled() else []
    # A graph that has not extracted this activity yet must not hide its versions:
    # fall back to the lexical scan whenever the graph offers fewer than two.
    route='graph' if len(options)>=2 else 'lexical'
    if len(options)<2:options=variant_options(related,target)
    if len(options)<2:return None
    keys={_norm(o['name']) for o in options}
    official=context.get('official') or {}
    reports=[r for r in context.get('reports') or [] if isinstance(r,dict) and r.get('course_id')==course
             and r.get('authority')=='student_reported' and r.get('kind') in ('lab','section','team') and isinstance(r.get('name'),str)]
    fresh=official.get('state')=='observed' and _fresh(official.get('observed_at'),job.get('now'))
    groups=[g.get('name') for g in official.get('groups') or [] if isinstance(g,dict) and isinstance(g.get('name'),str)] if fresh else []
    known=(any(_norm(r['name']) in keys for r in reports) or any(_norm(g) in keys for g in groups)
           or any(activity_group(s,job) for _,s in related))
    return {'course':course,'target':target,'label':label,'related':related,'options':options,'route':route,'reports':reports,
            'known':known,'conflict':official.get('state')=='conflict',
            # A question that already names a version, or asks to compare or
            # list every version, is not a request about the student's own group.
            'named':any(re.search(r'(?<!\w)'+re.escape(o['name'])+r'(?!\w)',question,re.I) for o in options),
            'survey':bool(re.search(r'\b(?:compare|comparison|difference|differences|differ|all|both|each|every|other)\s+(?:the\s+)?(?:groups?|sections?|teams?|versions?|labs?)\b|\bvs\.?\b|\bversus\b',question,re.I))}


def clarification(job):
    """Ask one question when an activity has group versions and the group is unknown.

    Returns {'text','clarification'} or None. Never guesses: no title, roster,
    other course or earlier answer is used as the student's group.
    """
    state=_group_state(job)
    if not state or state['known'] or state['conflict'] or state['named'] or state['survey']:return None
    question=job.get('question') or ''
    kind='section' if re.search(r'\bsections?\b',question,re.I) else 'team' if re.search(r'\bteams?\b',question,re.I) else 'lab' if state['label'].startswith('Lab') else 'section'
    noun=_NOUNS[kind];options=state['options']
    listed=', '.join(_plain(o['name'])+' '+''.join('['+str(n)+']' for n in o['sources'][:2]) for o in options)
    lines=[state['label']+' has different requirements for each '+noun+' in this course: '+listed+'.']
    stale=[r for r in state['reports'] if r['kind']==kind]
    if stale:lines.append('Your saved '+noun+' ('+_plain(stale[0]['name'])+') does not match these versions.')
    ask='Which '+noun+' are you in?'
    lines.append('**'+ask+'** Choose one and I will remember it for this course as student-reported (not verified by Moodle), then answer for that '+noun+' only. I will not guess your '+noun+'.')
    sources=job.get('sources') or []
    return {'text':'\n\n'.join(lines),'clarification':{'kind':'group','version':1,'course_id':state['course'],'group_kind':kind,
        'activity':state['label'],'question':ask,
        'options':[{'name':o['name'],'source_ids':[sources[n-1].get('id') for n in o['sources'] if sources[n-1].get('id')]} for o in options]}}


def answer(job):
    if not requested(job.get('question')):
        # A student-reported or verified group now selects among an activity's
        # versions even when the question does not say "my group".
        state=_group_state(job)
        if not state or not state['known'] or state['named'] or state['survey']:return None
    if (job.get('source_scope') or {}).get('kind')=='selected_only':
        return 'A source-only question does not include your course group checks or personal corrections. An activity title cannot prove your membership. Open the assignment in its course to check which version applies.'
    course=(job.get('course') or {}).get('id')
    contexts=job.get('group_context')
    # Older web payloads have no authoritative projection. Do not promote a
    # personal memory into official membership when the worker upgrades first.
    if contexts is None:
        return 'I cannot verify your group from this saved answer context. Select the course and check its group evidence before relying on a group-specific requirement. An activity title does not prove membership.'
    if not course and isinstance(contexts,list) and len(contexts)==1:
        course=contexts[0].get('course_id')
    matches=[c for c in contexts if isinstance(c,dict) and c.get('course_id')==course] if isinstance(contexts,list) else []
    if not course or len(matches)!=1:
        return 'Which course is this for? Group, lab and team membership is specific to each course; I cannot transfer it from another class.'
    context=matches[0];official=context.get('official') or {}
    reports=[r for r in context.get('reports') or [] if isinstance(r,dict) and r.get('course_id')==course
             and r.get('authority')=='student_reported' and r.get('kind') in ('lab','section','team') and isinstance(r.get('name'),str)]
    fresh=official.get('state')=='observed' and _fresh(official.get('observed_at'),job.get('now'))
    groups=[g.get('name') for g in official.get('groups') or [] if isinstance(g,dict) and isinstance(g.get('name'),str)] if fresh else []
    lines=[];choices=[]
    if reports:
        lines.append('You reported '+', '.join(_plain(r['name'])+' ('+r['kind']+')' for r in reports)+
                     ' for this course. This is student-reported, not verified membership.')
        choices=[r['name'].strip() for r in reports]
    if groups:
        lines.append('Your saved own-profile check lists '+', '.join(_plain(g) for g in groups)+
                     '. Course membership alone does not verify which assignment version applies.')
        if not choices:choices=groups
    else:
        lines.append('Current Moodle group membership is not verified here'+('; the saved check is stale.' if official.get('state')=='stale' else '.'))
    normalize=lambda x:' '.join(x.casefold().split())
    conflict=official.get('state')=='conflict' or bool(groups and reports and any(normalize(r['name']) not in {normalize(g) for g in groups} for r in reports))
    if conflict:
        choices=[];lines.append('The group evidence conflicts. Review the course group check before choosing a version; neither source replaces your correction automatically.')
    sources=[(n,s) for n,s in enumerate(job.get('sources') or [],1) if isinstance(s,dict)
             and (s.get('course_id') or (s.get('course') or {}).get('id'))==course
             and s.get('kind') in ('moodle','file') and not s.get('historical') and not injectionguard.untrusted(s)]
    named=re.findall(r'\b(lab|assignment|quiz|project|test|exam)\s*(\d{1,3})\b',job.get('question') or '',re.I)
    target=re.compile(r'\b'+re.escape(named[0][0])+r'[\s_-]*'+re.escape(named[0][1])+r'\b',re.I) if len(set((a.lower(),b) for a,b in named))==1 else None
    related=[(n,s) for n,s in sources if target and target.search(s.get('title') or '')]
    for n,s in related:
        group=activity_group(s,job)
        if group:
            lines.append('The saved submission table names '+_plain(group)+' for '+_plain(s.get('title'))+' ['+str(n)+']. This verifies the group for that activity only; it does not establish individual submission or membership in another activity.')
    # Quote entire group-labelled requirement lines, including all qualifications.
    # A lexical label match is useful evidence to inspect, never a membership proof.
    # Keep the other group branches visible, rather than silently discarding them.
    requirements=[]
    for n,s in related:
        for line in (s.get('excerpt') or '').splitlines():
            line=line.strip()
            labelled=any(re.match(r'^(?:[-*]\s*)?(?:(?:Group|Team|Section)\s+)?'+re.escape(g)+_SUFFIX+r'\s*:',line,re.I) for g in choices)
            prose=any(re.search(r'(?<!\w)'+re.escape(g)+r'(?!\w)',line,re.I) for g in choices) and re.search(r'\b(?:must|required|requirement|should|need to)\b',line,re.I)
            if len(line)<=1500 and (labelled or prose):
                requirements.append((n,line))
    if requirements:
        lines.append('The saved instructions contain these labelled requirements. Matching a label does not confirm that it applies to you:')
        for n,line in requirements[:4]:lines.append('> '+_plain(line,1500)+' ['+str(n)+']')
    variants=[(n,s) for n,s in related if any(re.search(r'(?<!\w)'+re.escape(g)+r'(?!\w)',s.get('title') or '',re.I) for g in choices)]
    if variants:
        lines.append('Based on '+('the group you reported' if reports else 'the saved profile group')+
                     ', these are matching activity labels to review provisionally—not confirmed applicability:')
        for n,s in variants[:4]:
            captured=str(s.get('observed_at') or '')[:10]
            date=captured if re.fullmatch(r'\d{4}-\d\d-\d\d',captured) else 'an unverified date'
            lines.append('- '+_plain(s.get('title'))+'; saved '+date+' ['+str(n)+'].')
            # Quote complete supported deadline fields. No relative-date
            # arithmetic, earliest-date selection or inferred submission.
            fields=[line.strip() for line in (s.get('excerpt') or '').splitlines()
                    if re.match(r'^\s*(?:Closes|Closed|Due date|Deadline)\s*:',line,re.I) and len(line.strip())<=240]
            for field in list(dict.fromkeys(fields))[:3]:
                lines.append('  Saved overview: “'+_plain(field,240)+'” ['+str(n)+'].')
        lines.append('These saved dates have not been refreshed in this answer. Check the current activity before relying on them.')
    elif target:
        lines.append('I cannot select a verified assignment version from the current group evidence. The saved variants remain available to review.')
        for n,s in related[:4]:lines.append('- '+_plain(s.get('title'))+' ['+str(n)+'].')
    if target and re.search(r'\b(?:submit|submitted|submission|status|finished)\b',job.get('question') or '',re.I):
        # Submission evidence belongs to the exact activity, not its group label.
        receipts=[(n,workguard.receipt_for(s,job)) for n,s in related]
        verified=[(n,r) for n,r in receipts if r]
        if verified:
            for n,r in verified:lines.append(workguard.receipt_detail(r,job)+' ['+str(n)+'].')
        else:
            lines.append('Submission status is unknown from the current saved receipt evidence. A deadline or an “Attempt quiz” control does not establish whether you submitted.')
    linked=[(n,s) for n,s in related if re.search(r'\bClick\b[^\n]{0,250}\blink\s+to\s+view\b',s.get('excerpt') or '',re.I)]
    if linked:
        lines.append('The retrieved instructions include link-only pages; their linked file contents are not present in those excerpts: '+
                     '; '.join(_plain(s.get('title'))+' ['+str(n)+']' for n,s in linked[:3])+'.')
        lines.append('Next step: open the linked lab material and identify the first unfinished requirement. Do not start a quiz attempt just to collect instructions.')
    elif requirements:
        lines.append('Suggested next step: use the quoted requirement to write one editable next action, after checking that this assignment uses your group. This does not change your saved plan or Moodle status.')
    elif variants:
        lines.append('Next step: open the cited activity instructions and choose an editable next action. Check applicability before acting on a group-specific requirement.')
    elif not target:
        lines.append('Name the assignment or open it to check which requirements apply. A course group alone cannot establish that link.')
    return '\n\n'.join(lines)

"""Question rewriting and clarifying (D5; generalizes the lab-section question).

rewrite(job) fills vague questions from context the server already supplied,
and asks one question back only when a key detail is missing and nothing in
the profile, course selection or conversation answers it.

Fill order, each step deterministic and labelled in the result:
  course   - the selected course, else the only current course
  activity - an activity named in the question, else the one named in the
             most recent turn of the conversation ("when is it due?")
  section  - the learner profile / student-reported group for that course
             (kept labelled; never inferred from titles or rosters)
Ask back:
  course   - the question names an activity, no course is selected and the
             learner has several current courses
  activity - a deadline/requirement question with no named or recent
             activity, and the course has several activities
  group    - delegated to group_attribution.clarification (unchanged)

Flag: SCHOOL_BETA_QUESTION_REWRITE=1 (default off).
"""
import os,re
import knowledge_graph as kg

VAGUE=re.compile(r'\b(?:it|this|that|this one|that one|the lab|the assignment|the quiz)\b',re.I)
ASKS_DETAIL=re.compile(r'\b(?:due|deadline|when|requirements?|need to do|what do i (?:need|have) to|submit|instructions?)\b',re.I)


def enabled():
    return (os.environ.get('SCHOOL_BETA_QUESTION_REWRITE') or '').strip()=='1'


def _courses(job):
    cur=((job.get('student') or {}).get('current_courses') or {})
    return [c for c in cur.get('courses') or [] if isinstance(c,dict) and c.get('id')]


def _recent_activity(job):
    for m in reversed(job.get('history') or []):
        text=m.get('text') if isinstance(m,dict) else None
        if isinstance(text,str):
            a=kg.activity_of(text)
            if a:return a
    return None


def rewrite(job):
    question=job.get('question') or ''
    out={'question':question,'rewritten':question,'filled':{},'missing':[],'clarification':None,'text':None}
    course=(job.get('course') or {}).get('id');courses=_courses(job)
    if not course and len(courses)==1:
        course=courses[0]['id'];out['filled']['course']={'id':course,'code':courses[0].get('code'),'basis':'only current course'}
    elif course:
        out['filled']['course']={'id':course,'code':(job.get('course') or {}).get('code'),'basis':'selected course'}
    activity=kg.activity_of(question)
    if not activity and ASKS_DETAIL.search(question) and VAGUE.search(question):
        recent=_recent_activity(job)
        if recent:
            activity=recent;out['filled']['activity']={'name':recent,'basis':'earlier in this conversation'}
    elif activity:
        out['filled']['activity']={'name':activity,'basis':'named in question'}
    if activity and not course and len(courses)>1:
        out['missing'].append('course')
        options=[{'id':c['id'],'name':c.get('code') or c.get('title') or 'Course'} for c in courses[:8]]
        ask='Which course is '+activity+' for?'
        out['clarification']={'kind':'course','version':1,'question':ask,'activity':activity,'options':options}
        out['text']=activity+' could belong to more than one of your courses: '+', '.join(o['name'] for o in options)+'.\n\n**'+ask+'** I will not guess the course.'
        return out
    graph=kg.Graph.from_job(job) if course else None
    if not activity and course and ASKS_DETAIL.search(question) and VAGUE.search(question):
        acts=sorted({a['label'] for a in graph.activities(course)}) if graph else []
        if len(acts)>1:
            out['missing'].append('activity')
            ask='Which activity do you mean?'
            out['clarification']={'kind':'activity','version':1,'question':ask,'course_id':course,'options':[{'name':a} for a in acts[:8]]}
            out['text']='This course has several activities: '+', '.join(acts[:8])+'.\n\n**'+ask+'**'
            return out
        if len(acts)==1:
            activity=acts[0];out['filled']['activity']={'name':activity,'basis':'only activity in this course'}
    if activity and course:
        learner=kg.learner_from_job(job,course)
        sections=kg.learner_sections(learner,course)
        if sections:
            name,authority=sections[0]
            out['filled']['section']={'name':name,'authority':authority}
    parts=[]
    f=out['filled']
    if 'course' in f and f['course'].get('code'):parts.append('course '+f['course']['code'])
    if 'activity' in f and f['activity']['basis']!='named in question':parts.append(f['activity']['name'])
    if 'section' in f:parts.append(f['section']['name']+' section ('+f['section']['authority'].replace('_','-')+')')
    if parts:out['rewritten']=question.rstrip()+' ['+'; '.join(parts)+']'
    return out


def resolved_question(job,result):
    """The question the downstream routes see: the original plus a named activity it lacked."""
    a=result['filled'].get('activity')
    if a and a['basis']!='named in question':
        return (job.get('question') or '').rstrip(' ?')+' ('+a['name']+')?'
    return job.get('question') or ''

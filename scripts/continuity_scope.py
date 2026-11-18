"""Bounded personal-context provenance; never instructor or completion evidence."""
import re,hashlib

def missing_source_target(job):
    """Search hits alone cannot supply an unselected demonstrative's target."""
    question=job.get('question') or ''
    if isinstance(job.get('context'),list) and job['context']:return False
    if any(row.get('role')=='user' and str(row.get('text') or '').strip() for row in (job.get('history') or [])[:-1]):return False
    return bool(re.search(r'\b(?:this|the) (?:file|chapter|system|document|pdf)\b|\b(?:este|ese|el) (?:archivo|documento|cap[ií]tulo|sistema|pdf)\b',question,re.I)
        and not re.search(r'\d|\[|=|true or false|if\b.*\bthen|linear system|augmented matrix|verdadero o falso|sistema lineal|matriz aumentada',question,re.I))

def missing_student_answer(job):
    question=job.get('question') or ''
    if isinstance(job.get('context'),list) and job['context']:return False
    if any(row.get('role')=='user' and str(row.get('text') or '').strip() for row in (job.get('history') or [])[:-1]):return False
    work=(job.get('student_context') or {}).get('work')
    if isinstance(work,list) and work:return False
    return bool(re.search(r'\b(?:check|grade|review)\b.*\bmy\b.*\b(?:answer|draft|response|solution)\b|\bmy\b.*\banswer\b.*\b(?:right|correct)\b',question,re.I)
        and not re.search(r'\n|=|\[\[|my (?:answer|solution)\s*(?:is|:)',question,re.I))

def continuity_provenance(item,text,limit):
    """Bounded personal snapshot identity; never source-author attestation."""
    raw=str(text or '')
    coverage=item.get('coverage') or {}
    if not isinstance(coverage,dict):coverage={}
    digest=lambda value:bool(isinstance(value,str) and re.fullmatch(r'[a-f0-9]{64}',value))
    same=(isinstance(coverage,dict) and coverage.get('format')=='student-text-excerpt/1'
        and digest(coverage.get('text_sha256'))
        and coverage.get('excerpt_sha256')==hashlib.sha256(raw.encode('utf-8')).hexdigest()
        and type(coverage.get('saved_characters')) is int
        and len(raw.encode('utf-16-le'))//2<=coverage['saved_characters']+1200
        and type(coverage.get('complete')) is bool
        and (coverage['complete'] is False or (coverage['text_sha256']==coverage['excerpt_sha256'] and coverage['saved_characters']==len(raw.encode('utf-16-le'))//2 and coverage.get('omitted_units')==0)))
    out={'partial':len(raw)>limit or item.get('truncated') is True or not same or coverage.get('complete') is not True}
    for key in ('id','source_id','version_id','course_id','chat_id'):
        if isinstance(item.get(key),str) and re.fullmatch(r'[a-fA-F0-9-]{36}',item[key]):out[key]=item[key]
    for key in ('revision','note_revision'):
        if type(item.get(key)) is int and 0<item[key]<=1000000000:out[key]=item[key]
    if item.get('basis') in ('note_revision','selected_source_version'):out['basis']=item['basis']
    if same:
        out.update(text_sha256=coverage['text_sha256'],excerpt_sha256=coverage['excerpt_sha256'])
        for key in ('selected_locations','omitted_locations'):
            rows=coverage.get(key)
            if isinstance(rows,list):out[key]=[{'start_line':v['start_line'],'end_line':v['end_line']} for v in rows[:4] if isinstance(v,dict) and type(v.get('start_line')) is int and type(v.get('end_line')) is int and 0<v['start_line']<=v['end_line']<=1000000]
    return out

def continuity_selection(context):
    value=context.get('coverage') or {};out={}
    if not isinstance(value,dict) or value.get('format')!='student-continuity/1':return {'status':'legacy or unknown selection; no exhaustive recall'}
    for kind in ('memories','earlier_user_statements','work'):
        row=value.get(kind)
        if isinstance(row,dict) and all(type(row.get(k)) is int and 0<=row[k]<=1000000 for k in ('eligible','selected','omitted')) and row['selected']+row['omitted']==row['eligible']:out[kind]=row
    return out

def history_messages(job,limit=None):
    history=job.get('history',[])[:-1]
    if limit is not None:history=history[-limit:]
    rows=[]
    for item in history:
        text=str(item.get('text') or '')
        provenance=continuity_provenance(item,text,1200)
        # Do not let legacy/further-cropped history masquerade as a complete
        # conversation. The current question is separately included in full.
        if provenance['partial']:text='[Partial earlier '+str(item.get('role'))+' message; other text may be omitted.]\n'+text[:1200]
        rows.append({'role':item['role'],'content':text})
    return rows


def narrowing_request(job):
    """A stored but unrepresented block needs a narrower selection, not fiction."""
    question=job.get('question') or ''
    if not re.search(r'\b(?:continue|resume|revise|review|improve|critique|edit|contin[uú]a|retoma|revisa|mejora)\b',question,re.I) or re.search(r'\b(?:when|due|deadline|grade|submit|hours|room)\b',question,re.I):return None
    context=job.get('student_context') or {};work=context.get('work') or []
    if context.get('authority')!='student_context_only' or not work or any(str(w.get('text') or '').strip() for w in work if isinstance(w,dict)):return None
    first=next((w for w in work if isinstance(w,dict) and isinstance(w.get('coverage'),dict) and w['coverage'].get('format')=='student-text-excerpt/1' and type(w['coverage'].get('omitted_units')) is int and w['coverage']['omitted_units']>0),None)
    if first is None:return None
    title=re.sub(r'\[\d+\]','',str(first.get('title') or 'your saved draft'))[:180]
    locations=continuity_provenance(first,first.get('text'),2400).get('omitted_locations') or []
    pointer=' (starting at saved line %s)'%locations[0]['start_line'] if locations else ''
    return ('Your saved work “'+title+'” is preserved, but no complete paragraph from it fits this answer’s excerpt'+pointer+'. '
        'Open that saved note and choose a shorter section to review first. I have not reviewed the omitted text; this does not mean the draft or its choices are missing.')

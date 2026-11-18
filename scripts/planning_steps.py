"""Source-bound study actions and explicitly proposed capacity blocks."""
import re
from datetime import date,timedelta,datetime
from zoneinfo import ZoneInfo

def next_step(task,source,materials=()):
    kind=(str(task.get('kind') or '')+' '+str(task.get('title') or '')).lower()
    # Match a numbered activity and the exact course, not a vaguely related
    # saved essay. Caller supplies only pinned original references.
    named=re.search(r'\b(assignment|quiz|test)\s*(\d+)\b',str(task.get('title') or ''),re.I)
    if named:
        pattern=re.compile(r'\b'+named[1]+r'[ _-]*'+named[2]+r'\b',re.I)
        for n,item in materials:
            if item.get('kind')!='file' or item.get('course_id')!=task.get('course_id') or not pattern.search(item.get('title') or ''):continue
            text=item.get('excerpt') or ''
            if re.search(r'portfolio site',text,re.I) and re.search(r'memo',text,re.I) and re.search(r'screenshot|exhibits?',text,re.I):
                return 'Revise one memo paragraph to explain a specific portfolio-site choice and how it serves your intended readers; then match it to a readable screenshot exhibit. Check the memo and exhibits against the original checklist. Suggested first step based on the brief [%d].'%n
    if 'written' in kind and re.search(r'assignment|homework',kind):
        return 'Check each required part against the question sheet. If you have a worked file, verify the calculations and review its final pages; then check this exact Moodle dropbox for a receipt before deciding whether an upload is still needed.'
    if re.search(r'in[- ]class',kind):
        return 'Open this exact in-class activity and its handout to identify what you must produce. If the handout is only given in class, record that gap and bring the materials you already have; do not invent pre-class questions.'
    instruction=str(task.get('instruction') or source.get('excerpt') or '')
    # Quote a bounded actual instruction rather than inventing a reading or rubric.
    pieces=re.split(r'(?<=[.!?])\s+|\n+',instruction)
    for piece in pieces:
        if re.search(r'\b(?:stored|checksum|snapshot|provenance|observed|capture|source role|source check|guarantee|imported|not a new live|coverage)\b',piece,re.I):continue
        piece=' '.join(piece.split())
        if re.search(r'\b(?:read|prepare|complete|write|compare|explain|solve|bring|review|submit)\b',piece,re.I) and len(piece)<=280:
            return 'Start from the saved instruction: “'+piece+'”'
    if re.search(r'quiz|test|exam',kind):return 'Review the cited assessment scope, attempt practice without notes, then check the points you could not explain.'
    if re.search(r'read|prepar',kind):return 'Read the cited material, record its main claim and one supporting example, then prepare a question for class.'
    return 'Identify the deliverable and criteria in the cited instructions, make a short checklist, and start the first unfinished requirement.'

def weekday_capacity(question):
    match=re.search(r'\b(one|two|three|four|\d+(?:\.\d+)?)\s*(hours?|minutes?)\s*(?:per|each|a|every)\s*(?:week\s*day|weekday|day)\b',question,re.I)
    if not match:return None
    number={'one':1,'two':2,'three':3,'four':4}.get(match[1].lower())
    if number is None:number=float(match[1])
    return max(0,min(480,round(number*(60 if match[2].lower().startswith('hour') else 1))))

def proposed_blocks(question,window,today,actions,availability=None,meetings=None,now=None,timezone=None):
    if availability is not None:return window_blocks(question,window,today,actions,availability,meetings or [],now,timezone)
    capacity=weekday_capacity(question)
    if not capacity or not actions:return ''
    start=max(window.get('start') or today,today);end=window.get('end') or start
    try:day=date.fromisoformat(start);last=date.fromisoformat(end)
    except (TypeError,ValueError):return ''
    remaining=list(actions);lines=[]
    while day<=last and remaining:
        if day.weekday()<5:
            available=capacity
            while available and remaining:
                deadline,text=remaining.pop(0)
                if str(deadline)[:10]<day.isoformat():continue
                minutes=min(45,available);available-=minutes
                lines.append('- '+day.isoformat()+' · '+str(minutes)+' min: '+text.removeprefix('- '))
        day+=timedelta(days=1)
    if not lines:return ''
    return '### Suggested study blocks\nProposed first passes within your '+str(capacity)+'-minute weekday budget; these are not estimated completion times or official deadlines. Adjust them around your classes.\n'+'\n'.join(lines)+'\nNo calendar or progress was changed.'


def action_table(actions):
    def cell(value):return str(value).replace('\\','\\\\').replace('|','\\|').replace('\n',' ')
    rows=['| Work | Saved deadline | Next action | Status |','| --- | --- | --- | --- |']
    for item in actions:
        row=item[2]
        status=item[3] if len(item)>3 else 'Submission unverified'
        title,_,rest=row.removeprefix('- ').partition(' — ')
        deadline,_,action=rest.partition('. ')
        # Keep the source basis and any conditions; the UI may disclose it separately.
        citation=re.search(r' \[\d+\]$',row)
        if citation and citation[0] not in action:action+=citation[0]
        rows.append('| '+' | '.join(map(cell,[title,deadline,action,status]))+' |')
    return '\n'.join(rows)

def window_blocks(question,window,today,actions,availability,meetings,now,timezone=None):
    zone=availability.get('timezone');slots=availability.get('slots') or []
    if timezone and zone!=timezone:return 'Your saved availability uses a different timezone. Review it in Today before scheduling study blocks.'
    try:
        clock=datetime.fromisoformat(str(now).replace('Z','+00:00')).astimezone(ZoneInfo(zone)) if now else None
        day=date.fromisoformat(max(window.get('start') or today,today));last=date.fromisoformat(window.get('end') or today)
    except (ValueError,TypeError,KeyError):return 'Study availability could not be used. Review its timezone and windows in Today.'
    pending=list(actions);lines=[];budget=weekday_capacity(question);missed=0
    def minutes(value):
        try:h,m=map(int,value.split(':'));return h*60+m
        except (ValueError,AttributeError):return None
    def fmt(value):return '%02d:%02d'%(value//60,value%60)
    while day<=last and pending:
        offered=[(minutes(s.get('start')),minutes(s.get('end'))) for s in slots if s.get('day')==(day.weekday()+1)%7]
        if budget is not None and re.search(r'week\s*day',question,re.I) and day.weekday()>=5:offered=[]
        offered=sorted((a,b) for a,b in offered if a is not None and b is not None and 0<=a<b<=1440)
        busy=[]
        for m in meetings:
            if m.get('kind') not in ('class','lab') or m.get('date')!=day.isoformat():continue
            a,b=minutes(m.get('time')),minutes(m.get('end_time'))
            if a is not None and b is not None and a<b:busy.append((a,b))
            else:busy=[(0,1440)];break  # A class with an unknown end is not free time.
        free=offered
        for a,b in busy:free=[piece for x,y in free for piece in [(x,min(a,y)),(max(b,x),y)] if piece[0]<piece[1]]
        available=budget if budget is not None else 1440
        for a,b in free:
            if clock and day==clock.date():a=max(a,((clock.hour*60+clock.minute+14)//15)*15)
            if day.isoformat()==today and not clock:continue
            while a<b and available>0 and pending:
                deadline,text=pending[0]
                due=str(deadline)[:10]
                if due<day.isoformat():pending.pop(0);missed+=1;continue
                finish=b
                if due==day.isoformat():
                    try:
                        instant=datetime.fromisoformat(str(deadline).replace('Z','+00:00'))
                        if instant.tzinfo is None:raise ValueError()
                        local=instant.astimezone(ZoneInfo(zone));finish=min(finish,local.hour*60+local.minute)
                    except (ValueError,TypeError):break  # No invented deadline time.
                duration=min(45,finish-a,available)
                if duration<15:break
                pending.pop(0);title=text.removeprefix('- ').split(' Why:',1)[0]
                lines.append('- '+day.isoformat()+' '+fmt(a)+'–'+fmt(a+duration)+' · '+str(duration)+' min: '+title)
                a+=duration;available-=duration
        day+=timedelta(days=1)
    note='### Suggested study blocks\nProposed first passes in your saved recurring windows ('+str(zone)+'). Confirmed classes and labs are excluded. These are not completion estimates or official deadlines.\n'
    if lines:note+='\n'.join(lines)+'\n'
    else:note+='No study block fits the saved windows and deadline information.\n'
    if pending or missed:note+='Some actions could not be fitted before their saved deadlines; review Today and adjust your availability.\n'
    return note+'No calendar or progress was changed.'

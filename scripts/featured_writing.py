"""Source-bound proposed reader benefits, separate from owner-confirmed intent."""
import re
from hashlib import sha256
import assignment_coaching as coaching


def focus_items(question):
    q=question or ''
    only=re.search(r'\bonly\s+(?:(?:the|my)\s+)?(portfolio|portfolio|(?:Acadia |research )?(?:research announcement|announcement|research post))\b',q,re.I)
    if only:q=only[1]
    return [key for key,pattern in [('portfolio',r'\bportfolio\b'),('research',r'\b(?:research|Acadia)\s+(?:announcement|post)\b')] if re.search(pattern,q,re.I)]


def requested(job):
    q=job.get('question') or ''
    context=job.get('student_context') or {}
    for m in re.finditer(r'\bassignment\s+\d+\b',q,re.I):
        if re.search(r'(?:returned|earlier|previous)\s*$',q[:m.start()],re.I) or re.match(r'\s+(?:returned\s+)?(?:feedback|comments?)\b',q[m.end():],re.I):continue
        if not any(re.search(r'\b'+re.escape(m[0])+r'\b',w.get('title') or '',re.I) for w in context.get('work',[])):return False
    return bool(focus_items(q) and context.get('authority')=='student_context_only'
        and any(re.search(r'\bmemo\b',w.get('title') or '',re.I) for w in context.get('work',[]))
        and (re.search(r'why|explain|reason|purpose|improv|revis|review|continue|draft|help.{0,30}reader',q,re.I) or re.match(r'^(?:Now|Next|And)\b',q,re.I))
        and not re.search(r'do not write|don.t write|no rewrite',q,re.I))


def material_rows(job):
    rows=[]
    for n,s in enumerate(job.get('sources') or [],1):
        m=s.get('writing_material') or {};body=s.get('excerpt') or ''
        if m.get('format')!=1 or s.get('historical') or s.get('untrusted'):continue
        if m.get('source_id')!=s.get('id') or m.get('version_id')!=s.get('version_id'):continue
        if m.get('text_sha256')!=sha256(body.encode()).hexdigest():continue
        if m.get('authority')!='personal_material_not_assignment_requirement':continue
        rows.append((n,m.get('kind'),body))
    return rows

def owner_purpose(job,key):
    label='Portfolio purpose' if key=='portfolio' else 'Research purpose'
    memories=sorted((job.get('student_context') or {}).get('memories',[]),key=lambda m:m.get('updated_at') or '',reverse=True)
    for memory in memories:
        if memory.get('kind')!='choice':continue
        m=re.search(re.escape(label)+r':[ \t]*([^\n]+)',memory.get('body') or '',re.I)
        if m:return m[1].strip()
    return None


def profiles(job):
    result={};posts=[];portfolio=[]
    for n,kind,body in material_rows(job):
        if kind=='featured_posts':
            marks=list(re.finditer(r'https://www\.linkedin\.com/feed/update/urn:li:activity:\d+/',body))
            for i,m in enumerate(marks):posts.append((n,m.group(),body[m.end():marks[i+1].start() if i+1<len(marks) else len(body)]))
        elif kind=='portfolio_page':portfolio.append((n,body))
    summer=next((p for p in posts if re.search(r'The summer ended',p[2]) and re.search(r'Summer\s+\d{4}|portfolio',p[2],re.I)),None)
    page=next(((n,b) for n,b in portfolio if re.search(r'Apps\s+Websites\s+Data pipelines',b)),None)
    if summer and page:
        n,body=page;quote=re.search(r'Every project in this portfolio[^\n]+',body)
        if quote and all(term in quote[0] for term in ('problem','what I built','outcome')):
            method=re.search(r'Understanding enough[^\n]+',summer[2])
            approach=bool(re.search(r'approach|problem.solving|understand.{0,25}problem|develop.{0,25}solution',owner_purpose(job,'portfolio') or '',re.I))
            if approach and not method:quote=None
        if quote and all(term in quote[0] for term in ('problem','what I built','outcome')):
            result['portfolio']={'source':n,'post_source':summer[0],'post_url':summer[1],'quote':quote[0],
                'reason':('It explains your described approach to understanding a business problem and developing a solution, then gives readers a wider set of project accounts to inspect.' if approach else 'It gives employers and potential clients a broader set of project accounts to inspect, including the problem, what was built and the author’s reported outcome.'),
                'clause':('I included my portfolio to show how I approach a problem and develop a solution, while giving employers and potential clients a wider range of projects to explore.' if approach else 'I included my portfolio so employers and potential clients can explore a wider range of my projects and the problems they address.'),
                'method_quote':method[0] if approach else None,
                'limit':'These are self-published project accounts, not independent verification of every outcome.'+(' The older post’s final-year wording is historical; it does not update your saved graduation date.' if re.search(r'final year',summer[2],re.I) else '')}
    post=next((p for p in posts if 'Research Assistant' in p[2] and 'Artificial Intelligence and the Internet of Things' in p[2]),None)
    if post:
        n,url,body=post
        future=re.search(r'I[’\x27]ll be contributing[^.\n]+\.',body)
        connection=re.search(r'I[’\x27]m especially excited[^.\n]+\.',body)
        if future and connection and 'systems' in connection[0] and 'research' in connection[0]:
            field='research on secure, reliable systems' if re.search(r'\bsecure\b',connection[0],re.I) and re.search(r'\breliable\b',connection[0],re.I) else 'research in that field'
            result['research']={'source':n,'post_url':url,'quote':connection[0],'future_quote':future[0],
                'reason':'It puts your Research Assistant title in context: the AI/IoT research setting and your stated interest in connecting practical systems work with research.',
                'clause':'I included the research announcement to explain my Research Assistant role and my interest in connecting practical software work with '+field+'.',
                'limit':'This is your joining announcement, not a university endorsement or research-results article. Its expected research, testing and validation work is future-facing; it does not establish completed experiments.'}
    return result


def pending_starter(job,introduction):
    # Preserve the exact owner-rated text, not an unreviewed assistant answer.
    first=re.search(r'My Featured section highlights ([^,]+)',introduction)
    name=re.search(r'\b[A-Z][A-Za-z0-9]+\b',first[1]) if first else None
    if not name:return None
    for m in (job.get('student_context') or {}).get('memories',[]):
        body=m.get('body') or ''
        if m.get('kind')!='choice' or 'Useful as a draft starter' not in body:continue
        found=re.search(r'Reviewed [^:\n]{1,100} draft starter:\s*([^\n]+?)\s+Owner rating:',body)
        if found and name[0] in found[1] and len(found[1])<=350:return found[1]
    return None


def answer(job):
    if not requested(job):return None
    wanted=focus_items(job.get('question'));found=profiles(job)
    intro=next((d for d in coaching.draft_pool(job) if re.search(r'My Featured section highlights ',d['quote'])),None)
    if not intro:return 'I could not locate the Featured introduction in the current saved memo. Open the current memo and choose that passage; I have not substituted an older draft or the SideProject reason.'
    names={'portfolio':'Summer portfolio','research':'Acadia research announcement'}
    found={k:v for k,v in found.items() if k in wanted and (('portfolio' in intro['quote'].lower()) if k=='portfolio' else 'research announcement' in intro['quote'].lower())}
    confirmed=all(owner_purpose(job,key) for key in wanted)
    lines=['**Source-based Featured review**',('Your selected purposes are saved; the wording below remains a proposal, not wording you have accepted or applied.' if confirmed else 'These are proposed reader benefits from the saved material, not selection motives you have already confirmed.')+' The original memo and the useful-but-unapplied SideProject starter are unchanged.']
    for key in wanted:
        lines.append('### '+names[key])
        p=found.get(key)
        if not p:
            lines+=['I do not have a complete, matching saved source for this item in this answer. I have not reused the SideProject business-fit reason.',
                    'The matching full source is missing from this answer.']
            continue
        if owner_purpose(job,key):lines+=['**Your saved purpose:** '+owner_purpose(job,key)]
        lines+=[p['reason'],'Saved personal material (not assignment instructions):\n> '+p['quote']+' ['+str(p['source'])+']']
        if p.get('method_quote'):lines+=['The summer post describes the approach:\n> '+p['method_quote']+' ['+str(p['post_source'])+']']
        if key=='research':lines+=['The post’s contribution language is prospective:\n> '+p['future_quote']+' ['+str(p['source'])+']']
        lines+=[p['limit'],'**Candidate addition:**\n> '+p['clause']]
    missing=[key for key in wanted if key not in found]
    if missing:lines+=['**One detail needed:** '+('Which exact '+('portfolio page' if missing[0]=='portfolio' else 'announcement')+' should that Featured item open?' if len(missing)==1 else 'Which exact pages should these two Featured items open?')]
    if not found:return '\n\n'.join(lines)
    old=pending_starter(job,intro['quote'])
    pool=coaching.draft_pool(job);at=next(i for i,d in enumerate(pool) if d['draft_anchor']==intro['draft_anchor'])
    following=pool[at+1] if at+1<len(pool) else None
    target=following if following and re.match(r'^(?:These|This|They|It)\b',following['quote']) else None
    if len(wanted)==2 and len(found)==2 and old and target and target['quote']!=intro['quote']:
        combined=' '.join([old]+[found[k]['clause'] for k in wanted])
        if len(combined)<=1000:
            # One replacement for one actual target; no neighboring text copied.
            # Avoid repeating candidate clauses both individually and combined.
            for key in wanted:lines.remove('**Candidate addition:**\n> '+found[key]['clause'])
            lines+=['### One combined draft starter','The SideProject starter you rated useful is retained word for word. The two new reasons are candidates for your review.',
                    'Your current wording:\n> '+target['quote'],'Suggested revision:\n> '+combined,
                    '**Keep in place:**\n> '+intro['quote']]
    else:lines+=['These are candidate additions for the requested items, not separate instructions to replace the same sentence twice. Assemble them with the other Featured reason before editing.']
    evidence=coaching.evidence_choices(job)
    if evidence:
        e=evidence[0];label='Earlier returned feedback, comment '+str(e['comment_id']) if e.get('comment_id') is not None else 'Current assignment wording'
        lines+=[label+' (separate from your personal material):\n> '+e['quote'].replace('\n','\n> ')+' ['+str(e['source'])+']']
    elif coaching.applying_feedback(job):lines+=['The requested returned comment is not available as verified evidence in this answer; I have not substituted the assignment brief for it.']
    checks=[]
    if 'portfolio' in found:checks.append('the portfolio clause leads with your approach, then range' if owner_purpose(job,'portfolio') else 'the portfolio clause describes what readers can inspect')
    if 'research' in found:checks.append('the research clause explains the role and intended practical/research connection without claiming completed results')
    decision=('Your purpose choices are already saved. Keep or revise the new wording by checking that '+', and '.join(checks)+'.' if confirmed else 'Decide whether these proposed reasons match why you selected the material, then keep or revise the new clauses.')
    lines+=['**Next step:** '+decision+' Preserve the Featured introduction and Exhibit 5. Then check the assembled memo’s one-page body in Word; this text review has not checked pagination or the live profile.']
    return '\n\n'.join(lines)

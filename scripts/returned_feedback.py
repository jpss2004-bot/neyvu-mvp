"""Exact returned-comment readback; applications are suggestions, not requirements."""
import re
import assignment_coaching
import featured_writing

def answer(job):
    q=job.get('question') or ''
    # Applying earlier feedback to current writing needs both objects. The
    # literal readback cannot satisfy an editing request by listing comments.
    if assignment_coaching.applying_feedback(job) or featured_writing.requested(job):return None
    if not re.search(r'\b(?:comments?|feedback)\b',q,re.I) or re.search(r'\b(?:permission|allowed|policy|grade|score)\b',q,re.I):return None
    candidates=[]
    for n,s in enumerate(job.get('sources') or [],1):
        p=s.get('returned_feedback') or {}
        if p.get('format')!=1 or p.get('version_id')!=s.get('version_id') or s.get('untrusted') or not re.search(r'\.docx$',s.get('title') or '',re.I):continue
        comments=[c for c in p.get('comments',[]) if all(isinstance(c.get(k),str) and c[k].strip() for k in ('id','text','author','raw')) and c['text'] in c['raw'] and len(c['text'])<=1800]
        if comments:candidates.append((n,s,p,comments))
    if len(candidates)!=1:return None
    n,s,p,comments=candidates[0]
    categories=[('Font and spacing',r'font|spacing|format',r'font|spacing', 'Use the assignment checklist to find the exact font and spacing settings. These comments identify a problem; they do not themselves specify the required settings.'),
                ('Unfamiliar wording',r'technical|terms?|word|meaning|mean|clarity',r'what do you mean|words\?|not clear|explain what you mean|tell them', 'At the first use of the highlighted term, define it in plain language for someone who was not present. Then explain its impact on the situation.'),
                ('Connections to course concepts',r'connections?|course|concept|evidence|explain',r'connect|course materials|give it purpose', 'After an example or quotation, add a sentence naming the course concept and explaining how that evidence supports your point. A citation alone does not make the connection.'),
                ('Enough detail for the reader',r'detail|situation|context|specific',r'sufficient detail|be specific|wasn.t present', 'State the relevant context, what happened and how it affected understanding so the reader can follow your reasoning.')]
    parts=['Here is what the saved returned Word file actually contains, separated from assignment instructions. The names below are the file’s embedded attributions, not a new verification of authorship.']
    found=False
    for title,request,pattern,application in categories:
        if not re.search(request,q,re.I):continue
        hits=[c for c in comments if re.search(pattern,c['text'],re.I)][:2]
        if not hits:continue
        found=True;parts.append('### '+title)
        for c in hits:
            quote=c['text'].replace('\n','\n> ')
            parts.append('**'+c['author']+' — comment '+c['id']+'** ['+str(n)+']\n> '+quote)
            if c.get('anchor'):parts.append('Highlighted wording: “'+c['anchor'][:450]+'”.')
        parts.append('**How to apply it:** '+application)
    if not found:
        parts.append('\n\n'.join('**'+c['author']+' — comment '+c['id']+'** ['+str(n)+']\n> '+c['text'].replace('\n','\n> ') for c in comments[:4]))
    parts.append('### Separate from the checklist\nThe comments above are the reviewer’s wording. Exact formatting rules belong to the assignment brief/checklist; I have not quoted those rules as comments. My application suggestions are advice, not additional assignment requirements.')
    parts.append('**Next step:** revise the passage highlighted by one comment, then check whether an unfamiliar reader can understand the term and its connection to the course concept.')
    if not p.get('complete_comments'):parts.append('This readback includes only the comment records that fit; open the original for the rest.')
    return '\n\n'.join(parts)


def workspace_answer(job):
    """A bounded readback/application question, not an unsolicited rewrite.

    This intent must precede item-specific Featured proposal generation. Both
    objects come from the owned, version-bound input; the UI rechecks the
    current note when it opens the workspace.
    """
    q=job.get('question') or ''
    if not (re.search(r'\b(?:show|open|put)\b',q,re.I) and re.search(r'\b(?:comment|feedback)\b',q,re.I) and re.search(r'\b(?:beside|alongside|together)\b',q,re.I) and re.search(r'\b(?:current|draft)\b',q,re.I)):return None
    if job.get('mode')=='solve' or (job.get('student_context') or {}).get('authority')!='student_context_only':return None
    choices=assignment_coaching.evidence_pool(job)
    matches=[e for e in choices if e.get('role')=='earlier_returned_feedback' and re.search(r'make (?:the )?connections clear',e['quote'],re.I)]
    # A shorter exact comment addresses the requested connection without
    # silently appending a neighboring course-concept comment.
    comment=min(matches,key=lambda e:len(e['quote'])) if matches else None
    work=next(iter((job.get('student_context') or {}).get('work',[])),{})
    drafts=assignment_coaching.draft_pool(job) if not work.get('historical') and not work.get('changed_sources') and work.get('origin')!='ai_draft' else []
    at=next((i for i,d in enumerate(drafts) if re.search(r'\bFeatured\b',d['quote'])),None)
    passage=drafts[at+1] if at is not None and at+1<len(drafts) and re.match(r'^These\b',drafts[at+1]['quote']) else drafts[at] if at is not None else None
    lines=['## Feedback and current passage']
    if not comment:lines.append('The requested original comment is not available as matching returned-file evidence in this answer. I have not substituted the current brief or an assistant summary.')
    else:lines+=['### Earlier feedback that may help here','Original saved comment '+str(comment['comment_id'])+':\n> '+comment['quote'].replace('\n','\n> ')+' ['+str(comment['source'])+']','This is earlier returned feedback, not a new comment or mark on the current assignment. Its embedded attribution is recorded in the saved source.']
    if not passage:lines.append('A matching current Featured passage is not available in this answer. Open the current draft and select that passage before asking for a revision.')
    else:lines+=['### Current saved passage','> '+passage['quote'],'This is saved student wording, not an assignment requirement or an applied revision.']
    if comment and passage:
        vague=bool(re.search(r'concrete work to explore',passage['quote'],re.I))
        lines+=['### Suggested connection',('“Concrete work” leaves the reader benefit implicit. The earlier comment can guide a more specific explanation of why each Featured item helps the intended reader.' if vague else 'The earlier comment can guide a check of whether this passage makes the reader benefit clear. No further change is established merely by showing the comment beside it.'),
                '### One focused revision question',('Using my saved purposes, how can I replace this general rationale with a specific explanation of why each Featured item helps my intended reader?' if vague else 'Using my saved purposes, does this passage already explain the reader benefit, or is one worthwhile change still needed?'),
                '**Next step:** '+('Use the purpose choices already saved with this task to explain why each selected item earns its place. That will make the reader benefit explicit; preserve the surrounding Featured introduction and exhibit reference.' if vague else 'Keep what already explains the reader benefit. Identify a specific remaining gap before proposing another edit.')]
    lines.append('Open the feedback workspace to inspect the original comment, current saved passage and editable question together. Preparing a question never sends it, accepts wording or changes your memo. Current assignment requirements and Word/layout checks remain separate.')
    return '\n\n'.join(lines)

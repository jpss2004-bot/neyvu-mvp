"""Learner knowledge graph: extractors and graph tools (D2, D3; 2026-11-12).

The graph is a learner-scoped set of entities and edges (migration 040). This
module is pure: it extracts graph facts from platform records and saved source
versions, and answers graph questions over a projection the web server ships
in the job (``job['knowledge_graph']``), so the worker never reads the
database directly. Storage lives in lib/beta/knowledge-graph.ts.

Rules kept from group_attribution:
- A section is never inferred for the learner. Membership comes only from the
  learner profile (student-reported, labelled) or a platform group record.
- Every entity and edge names the source version or platform record that
  proves it. Model-assisted facts keep the exact quote they read; a quote
  that is not a verbatim substring of the version body is rejected.
- Dates are read from complete supported fields ("Closes: ..."); no relative
  date arithmetic.

Flag: SCHOOL_BETA_KNOWLEDGE_GRAPH=1 routes group attribution through these
tools. Default off.
"""
from datetime import datetime,timezone
import os,re
try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo=None

PLATFORM='platform-v1'
DOCUMENT='document-rules-v1'
ASSISTED='document-assisted-v1'
ENTITY_KINDS=('course','section','activity','deadline','requirement','document_version','person','place','policy','service')
RELATIONS=('applies_to','supersedes','due_at','part_of','requires')
ASSISTED_KINDS=('requirement','deadline','policy','person','place','service')
ASSISTED_MAX_CONFIDENCE=0.9

_DAY=r'(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day'
_GREEK=r'(?:Alpha|Beta|Gamma|Delta|Epsilon|Zeta|Theta|Kappa|Sigma|Omega)'
LABEL=(r'(?:(?:'+_DAY+r'\s+)?'+_GREEK+r'|'+_DAY+r'|(?:Section|Group|Team)\s+(?:[A-Z]|\d{1,3}))')
SUFFIX=r'(?:\s+(?:group|section|lab|team|students?))?'
ACTIVITY=re.compile(r'\b(lab|assignment|quiz|project|test|exam)\s*(\d{1,3})\b',re.I)
MONTHS={m:i for i,m in enumerate(('january','february','march','april','may','june','july','august','september','october','november','december'),1)}
DATE_FIELD=re.compile(r'^\s*(Closes|Closed|Due date|Due|Deadline)\s*:\s*(?:'+_DAY+r',?\s*)?(\d{1,2})\s+([A-Za-z]+)\s+(\d{4}),?\s+(\d{1,2}):(\d{2})\s*(AM|PM)?\s*$',re.I)


def enabled():
    return (os.environ.get('SCHOOL_BETA_KNOWLEDGE_GRAPH') or '').strip()=='1'


def norm(x):
    return ' '.join(str(x or '').casefold().split())


def slug(x):
    return re.sub(r'[^a-z0-9]+','-',norm(x)).strip('-')[:120] or 'x'


class Extraction:
    """Entities, edges and evidence keyed by natural keys (ids are assigned on storage)."""
    def __init__(self):
        self.entities={};self.edges={};self.evidence=[]

    def entity(self,key,kind,label,*,proof,authority,extractor,course_id=None,attrs=None,confidence=1.0):
        assert kind in ENTITY_KINDS
        row=self.entities.get(key)
        if row is None:
            row=self.entities[key]={'key':key,'kind':kind,'label':str(label)[:400],'attrs':dict(attrs or {}),'course_id':course_id,
                **_proof(proof),'authority':authority,'extractor':extractor,'confidence':round(float(confidence),3)}
        else:
            row['attrs'].update(attrs or {})
        return key

    def edge(self,relation,src,dst,*,proof,authority,extractor,attrs=None,confidence=1.0):
        assert relation in RELATIONS and src!=dst
        k=(relation,src,dst)
        if k not in self.edges:
            self.edges[k]={'relation':relation,'from':src,'to':dst,'attrs':dict(attrs or {}),**_proof(proof),
                'authority':authority,'extractor':extractor,'confidence':round(float(confidence),3)}
        return k

    def pin(self,target,source,quote,*,extractor,confidence,body=None):
        """Pin a verbatim quote; returns False (and pins nothing) when the quote is not in the body."""
        text=body if body is not None else _body(source)
        quote=str(quote or '').strip()
        at=text.find(quote) if quote else -1
        if at<0 or len(quote)>2000:return False
        row={'source_id':source.get('id'),'version_id':source.get('version_id'),'quote':quote,'char_start':at,'char_end':at+len(quote),
             'extractor':extractor,'confidence':round(float(confidence),3)}
        row.update({'entity':target} if isinstance(target,str) else {'edge':list(target)})
        self.evidence.append(row);return True

    def merge(self,other):
        for k,v in other.entities.items():
            if k in self.entities:self.entities[k]['attrs'].update(v['attrs'])
            else:self.entities[k]=v
        for k,v in other.edges.items():self.edges.setdefault(k,v)
        self.evidence.extend(other.evidence);return self

    def as_json(self):
        return {'entities':list(self.entities.values()),'edges':list(self.edges.values()),'evidence':self.evidence}


def _proof(proof):
    if isinstance(proof,dict) and proof.get('version_id'):
        return {'source_id':proof.get('source_id') or proof.get('id'),'version_id':proof['version_id'],'proof_ref':None}
    if isinstance(proof,str) and proof:
        return {'source_id':None,'version_id':None,'proof_ref':proof[:400]}
    raise ValueError('graph facts need a source version or platform record')


def _body(source):
    return '\n'.join(str(source.get(k) or '') for k in ('title','excerpt','body') if source.get(k))


def parse_date_field(line,tz='UTC'):
    """ISO timestamp from one complete supported deadline field, else None."""
    m=DATE_FIELD.match(line or '')
    if not m:return None
    _,day,month,year,hour,minute,ampm=m.groups()
    month=MONTHS.get(month.casefold())
    if not month:return None
    hour=int(hour)
    if ampm:
        if not 1<=hour<=12:return None
        hour=hour%12+(12 if ampm.upper()=='PM' else 0)
    try:
        zone=ZoneInfo(tz) if ZoneInfo and tz else timezone.utc
        return datetime(int(year),month,int(day),hour,int(minute),tzinfo=zone).isoformat()
    except (ValueError,KeyError):
        return None


def activity_of(title):
    named={(a.lower(),b) for a,b in ACTIVITY.findall(title or '')}
    if len(named)!=1:return None
    noun,number=next(iter(named))
    return noun.capitalize()+' '+number


def _variant_label(title,activity):
    noun,number=activity.split(' ')
    rest=re.sub(r'\b'+re.escape(noun)+r'[\s_-]*'+re.escape(number)+r'\b',' ',title or '',flags=re.I)
    m=re.search(r'(?<!\w)('+LABEL+r')'+SUFFIX+r'(?!\w)',rest,re.I)
    return ' '.join(m.group(1).split()) if m else None


# ---------------------------------------------------------------- extractors

def extract_platform(data):
    """Deterministic facts from platform records.

    data: {'courses':[{id,code,title}], 'groups':[{course_id,name,proof_ref}],
           'assignments':[{course_id,title,due_at,proof_ref|source_id+version_id,url}],
           'versions':[{source_id,version_id,title,course_id,observed_at}]}
    """
    x=Extraction()
    for c in data.get('courses') or []:
        x.entity('course:'+c['id'],'course',(c.get('code') or '')+' '+(c.get('title') or ''),course_id=c['id'],
                 proof='schoolvault.courses:'+c['id'],authority='platform',extractor=PLATFORM,attrs={'code':c.get('code')})
    for g in data.get('groups') or []:
        course='course:'+g['course_id'];key='section:'+g['course_id']+':'+slug(g['name'])
        x.entity(key,'section',g['name'],course_id=g['course_id'],proof=g.get('proof_ref') or 'platform-group:'+g['course_id'],
                 authority='platform',extractor=PLATFORM,attrs={'name':g['name']})
        if course in x.entities:x.edge('part_of',key,course,proof=g.get('proof_ref') or 'platform-group:'+g['course_id'],authority='platform',extractor=PLATFORM)
    for a in data.get('assignments') or []:
        proof={'source_id':a['source_id'],'version_id':a['version_id']} if a.get('version_id') else (a.get('proof_ref') or 'platform-assignment:'+slug(a.get('title')))
        _activity(x,a['course_id'],a.get('title') or '',proof,'platform',PLATFORM,due_at=a.get('due_at'),url=a.get('url'))
    by_source={}
    for v in data.get('versions') or []:by_source.setdefault(v['source_id'],[]).append(v)
    for sid,versions in by_source.items():
        versions=sorted(versions,key=lambda v:v.get('observed_at') or '')
        keys=[]
        for v in versions:
            key='document_version:'+v['version_id']
            x.entity(key,'document_version',(v.get('title') or 'Document')+' ('+str(v.get('observed_at') or '')[:10]+')',course_id=v.get('course_id'),
                     proof={'source_id':sid,'version_id':v['version_id']},authority='platform',extractor=PLATFORM,
                     attrs={'document':'document:'+sid,'observed_at':v.get('observed_at')})
            keys.append(key)
        for older,newer in zip(keys,keys[1:]):
            x.edge('supersedes',newer,older,proof={'source_id':sid,'version_id':versions[keys.index(newer)]['version_id']},authority='platform',extractor=PLATFORM)
    return x


def _activity(x,course_id,title,proof,authority,extractor,due_at=None,url=None,tz='UTC',source=None):
    activity=activity_of(title)
    if not activity:return None
    base='activity:'+course_id+':'+slug(activity)
    x.entity(base,'activity',activity,course_id=course_id,proof=proof,authority=authority,extractor=extractor,attrs={'name':activity})
    if 'course:'+course_id in x.entities:x.edge('part_of',base,'course:'+course_id,proof=proof,authority=authority,extractor=extractor)
    target=base;label=_variant_label(title,activity)
    if label:
        section='section:'+course_id+':'+slug(label)
        x.entity(section,'section',label,course_id=course_id,proof=proof,authority=authority,extractor=extractor,attrs={'name':label})
        target=base+':'+slug(label)
        x.entity(target,'activity',title.strip(),course_id=course_id,proof=proof,authority=authority,extractor=extractor,
                 attrs={'name':title.strip(),'variant_of':base,'section':label,**({'url':url} if url else {})})
        x.edge('part_of',target,base,proof=proof,authority=authority,extractor=extractor)
        e=x.edge('applies_to',target,section,proof=proof,authority=authority,extractor=extractor,attrs={'basis':'activity title'})
        if source is not None:x.pin(e,source,title.strip(),extractor=extractor,confidence=1)
    if due_at:
        dl=target+':due'
        x.entity(dl,'deadline',(title.strip() or activity)+' due '+due_at,course_id=course_id,proof=proof,authority=authority,extractor=extractor,attrs={'at':due_at})
        x.edge('due_at',target,dl,proof=proof,authority=authority,extractor=extractor)
    return target


def extract_sources(sources,tz='UTC'):
    """Rule-based facts from saved, current source versions (titles, deadline fields, labelled requirement lines)."""
    x=Extraction()
    for s in sources or []:
        if not isinstance(s,dict) or s.get('historical') or s.get('untrusted'):continue
        course=s.get('course_id') or (s.get('course') or {}).get('id')
        if not course or not s.get('id'):continue
        # Older job payloads may omit version ids; such facts are job-local
        # (proof_ref) and are never stored.
        proof={'source_id':s.get('id'),'version_id':s['version_id']} if s.get('version_id') else 'job-source:'+str(s['id'])
        if s.get('version_id'):x.entity('document_version:'+s['version_id'],'document_version',s.get('title') or 'Document',course_id=course,proof=proof,
                 authority='document',extractor=DOCUMENT,attrs={'document':'document:'+str(s.get('id')),'observed_at':s.get('observed_at')})
        body=s.get('excerpt') or s.get('body') or ''
        due=None;due_line=None
        for line in body.splitlines():
            at=parse_date_field(line,tz)
            if at and not due:due,due_line=at,line.strip()
        target=_activity(x,course,s.get('title') or '',proof,'document',DOCUMENT,due_at=due,source=s)
        if target and due_line:x.pin(target+':due',s,due_line,extractor=DOCUMENT,confidence=1)
        activity=activity_of(s.get('title') or '')
        for line in body.splitlines():
            m=re.match(r'^\s*(?:[-*]\s*)?('+LABEL+r')'+SUFFIX+r'\s*:\s*(.+)$',line,re.I)
            if not m or not activity:continue
            label=' '.join(m.group(1).split());text=m.group(2).strip()
            base='activity:'+course+':'+slug(activity)
            section='section:'+course+':'+slug(label)
            x.entity(base,'activity',activity,course_id=course,proof=proof,authority='document',extractor=DOCUMENT,attrs={'name':activity})
            x.entity(section,'section',label,course_id=course,proof=proof,authority='document',extractor=DOCUMENT,attrs={'name':label})
            req='requirement:'+course+':'+slug(activity)+':'+slug(label)+':'+slug(text)[:60]
            x.entity(req,'requirement',text,course_id=course,proof=proof,authority='document',extractor=DOCUMENT,attrs={'section':label,'line':line.strip()})
            x.pin(req,s,line.strip(),extractor=DOCUMENT,confidence=1)
            x.edge('requires',base,req,proof=proof,authority='document',extractor=DOCUMENT)
            x.edge('applies_to',req,section,proof=proof,authority='document',extractor=DOCUMENT,attrs={'basis':'labelled line'})
    return x


def rule_propose(text):
    """Deterministic stand-in for the document model: sentences with obligation words."""
    out=[]
    for line in (text or '').splitlines():
        line=line.strip()
        if re.search(r'\b(?:must|required|should|need to)\b',line,re.I) and 8<=len(line)<=600:
            out.append({'kind':'requirement','label':line,'quote':line,'confidence':0.7})
    return out


def extract_assisted(source,propose=rule_propose,course_id=None):
    """Model-assisted facts from one document version.

    propose(text) returns candidates {kind,label,quote,confidence[,section,activity]}.
    A candidate is kept only when its quote is verbatim in the version body;
    confidence is capped at ASSISTED_MAX_CONFIDENCE (model facts never outrank
    platform or rule facts).
    """
    x=Extraction();course=course_id or source.get('course_id')
    if not source.get('version_id') or not course or source.get('untrusted'):return x,[]
    body=_body(source);proof={'source_id':source.get('id'),'version_id':source['version_id']};rejected=[]
    for c in propose(body) or []:
        if not isinstance(c,dict) or c.get('kind') not in ASSISTED_KINDS or not isinstance(c.get('quote'),str):
            rejected.append({'candidate':c,'reason':'shape'});continue
        if c['quote'].strip() not in body:
            rejected.append({'candidate':c,'reason':'quote_not_in_source'});continue
        conf=max(0.0,min(float(c.get('confidence') or 0),ASSISTED_MAX_CONFIDENCE))
        key=c['kind']+':'+course+':assisted:'+slug(c.get('label') or c['quote'])[:80]
        attrs={k:c[k] for k in ('activity',) if isinstance(c.get(k),str) and c[k]}
        # A model-named section is kept only when the quote itself labels it (never inferred).
        sec=c.get('section')
        if isinstance(sec,str) and re.fullmatch(LABEL,sec.strip(),re.I) and re.search(r'(?<!\w)'+re.escape(sec.strip())+r'(?!\w)',c['quote'],re.I):attrs['section']=sec.strip()
        x.entity(key,c['kind'],c.get('label') or c['quote'],course_id=course,proof=proof,authority='document',extractor=ASSISTED,
                 confidence=conf,attrs=attrs)
        x.pin(key,source,c['quote'].strip(),extractor=ASSISTED,confidence=conf,body=body)
    return x,rejected


OLLAMA_URL=os.environ.get('SCHOOL_BETA_KG_OLLAMA_URL','http://127.0.0.1:11435')
KG_MODEL=os.environ.get('SCHOOL_BETA_KG_MODEL','qwen3:4b-instruct')
_KG_PROMPT=('You extract facts a student needs from one course document. Reply with JSON '
 '{"facts":[{"kind":"requirement|deadline|policy|person|place|service","label":"short statement","quote":"exact text copied from the document","section":"group or section name if the line names one","confidence":0.0-1.0}]}. '
 'Copy every quote character for character from the document (one line or sentence). Do not paraphrase quotes, do not invent facts, '
 'never infer which group a student belongs to. Return {"facts":[]} when nothing applies.')


def ollama_propose(text,model=None,timeout=None):  # pragma: no cover - local model
    """Local-model proposer (Ollama on loopback, never a paid API). Returns [] on any failure."""
    import json,urllib.request
    from urllib.parse import urlparse
    if urlparse(OLLAMA_URL).hostname not in ('127.0.0.1','localhost'):return []
    req={'model':model or KG_MODEL,'stream':False,'format':'json','think':False,'keep_alive':-1,'options':{'temperature':0,'num_ctx':8192},
         'messages':[{'role':'system','content':_KG_PROMPT},{'role':'user','content':text[:12000]}]}
    try:
        with urllib.request.urlopen(urllib.request.Request(OLLAMA_URL.rstrip('/')+'/api/chat',json.dumps(req).encode(),{'Content-Type':'application/json'}),timeout=timeout or float(os.environ.get('SCHOOL_BETA_KG_TIMEOUT','120'))) as r:
            facts=json.loads(json.load(r)['message']['content']).get('facts') or []
            return [f for f in facts if isinstance(f,dict)][:60]
    except Exception:
        return []


def extract_job(job):
    """Platform + document extraction from a worker job (used when no stored projection is shipped)."""
    tz=(job.get('student') or {}).get('timezone') or job.get('timezone') or 'UTC'
    x=Extraction()
    course=(job.get('course') or {}).get('id')
    courses=[{'id':course,'code':(job.get('course') or {}).get('code'),'title':(job.get('course') or {}).get('title')}] if course else []
    groups=[]
    for ctx in job.get('group_context') or []:
        if not isinstance(ctx,dict):continue
        off=ctx.get('official') or {}
        if off.get('state')=='observed':
            for g in off.get('groups') or []:
                if isinstance(g,dict) and isinstance(g.get('name'),str):groups.append({'course_id':ctx.get('course_id'),'name':g['name'],'proof_ref':'moodle-group-check:'+str(ctx.get('course_id'))})
    x.merge(extract_platform({'courses':courses,'groups':groups}))
    x.merge(extract_sources(job.get('sources'),tz))
    return x


# ---------------------------------------------------------------- graph tools

class Graph:
    def __init__(self,entities,edges,evidence=()):
        self.e={r['key']:r for r in entities if not r.get('valid_to')}
        self.edges=[r for r in edges if not r.get('valid_to') and r['from'] in self.e and r['to'] in self.e]
        self.evidence=list(evidence)

    @classmethod
    def from_extraction(cls,x):
        j=x.as_json();return cls(j['entities'],j['edges'],j['evidence'])

    @classmethod
    def from_job(cls,job):
        kg=job.get('knowledge_graph')
        if isinstance(kg,dict) and isinstance(kg.get('entities'),list):
            return cls(kg['entities'],kg.get('edges') or [],kg.get('evidence') or [])
        return cls.from_extraction(extract_job(job))

    def out(self,key,relation):return [self.e[r['to']] for r in self.edges if r['from']==key and r['relation']==relation]
    def into(self,key,relation):return [self.e[r['from']] for r in self.edges if r['to']==key and r['relation']==relation]
    def edge(self,relation,src,dst):return next((r for r in self.edges if r['relation']==relation and r['from']==src and r['to']==dst),None)

    def quote(self,entity_key=None,edge=None):
        for ev in self.evidence:
            if entity_key and ev.get('entity')==entity_key or edge and ev.get('edge')==[edge['relation'],edge['from'],edge['to']]:
                return {'source_id':ev['source_id'],'version_id':ev['version_id'],'quote':ev['quote']}
        return None

    def proof(self,row):
        return {'source_id':row.get('source_id'),'version_id':row.get('version_id'),'proof_ref':row.get('proof_ref'),'authority':row['authority'],
                'extractor':row['extractor'],'confidence':row['confidence']}

    def variants(self,activity_key):
        return [v for v in self.into(activity_key,'part_of') if v['kind']=='activity']

    def sections_of(self,key):
        return [s for s in self.out(key,'applies_to') if s['kind']=='section']

    def activities(self,course_id=None):
        return [r for r in self.e.values() if r['kind']=='activity' and not r['attrs'].get('variant_of') and (course_id is None or r['course_id']==course_id)]


def learner_sections(learner,course_id):
    """[(name, authority)] for one course from the learner profile; never inferred."""
    out=[]
    for s in (learner or {}).get('sections') or []:
        if isinstance(s,dict) and s.get('course_id')==course_id and isinstance(s.get('name'),str) and s.get('authority') in ('student_reported','platform_verified'):
            out.append((s['name'],s['authority']))
    return out


def applies_to(graph,activity_key,learner):
    """Which version of an activity applies to the learner.

    Returns {'state': 'single'|'selected'|'needs_section'|'conflict'|'no_match', 'activity', 'variant', 'section',
             'authority', 'options':[...], 'proof'}.
    """
    act=graph.e.get(activity_key)
    if not act:return {'state':'unknown_activity','activity':activity_key}
    variants=graph.variants(activity_key)
    options=[{'key':v['key'],'name':v['attrs'].get('section'),'title':v['label']} for v in variants]
    reqs=graph.out(activity_key,'requires')
    sections_by_req={r['key']:[s['label'] for s in graph.sections_of(r['key'])] for r in reqs}
    labelled={norm(n) for names in sections_by_req.values() for n in names}
    for name in sorted(labelled-{norm(o['name']) for o in options}):
        sec=next(s for s in graph.e.values() if s['kind']=='section' and norm(s['label'])==name and s['course_id']==act['course_id'])
        options.append({'key':None,'name':sec['label'],'title':act['label']+' ('+sec['label']+')'})
    if not options:
        return {'state':'single','activity':act['label'],'variant':activity_key,'section':None,'authority':act['authority'],'options':[],'proof':graph.proof(act)}
    mine=learner_sections(learner,act['course_id'])
    keys={norm(o['name']) for o in options}
    matched=[(n,a) for n,a in mine if norm(n) in keys]
    if not mine:
        return {'state':'needs_section','activity':act['label'],'options':options}
    if len({norm(n) for n,_ in matched})>1 or {a for _,a in mine}=={'student_reported','platform_verified'} and len({norm(n) for n,_ in mine})>1:
        return {'state':'conflict','activity':act['label'],'options':options,'reported':mine}
    if not matched:
        return {'state':'no_match','activity':act['label'],'options':options,'reported':mine}
    name,authority=matched[0]
    chosen=next(o for o in options if norm(o['name'])==norm(name))
    return {'state':'selected','activity':act['label'],'variant':chosen['key'],'section':chosen['name'],'authority':authority,
            'options':options,'proof':graph.proof(graph.e[chosen['key']]) if chosen['key'] else None}


def requirements_for(graph,activity_key,section):
    out=[]
    for r in graph.out(activity_key,'requires'):
        secs=[s['label'] for s in graph.sections_of(r['key'])]
        if not secs or section and any(norm(s)==norm(section) for s in secs):
            out.append({'text':r['label'],'section':secs[0] if secs else None,'proof':graph.proof(r),'quote':graph.quote(r['key'])})
    return out


def deadlines_for(graph,learner,start=None,end=None):
    """Deadlines that apply to the learner in [start, end] (ISO strings, inclusive).

    One item per activity. An activity with section versions and no known
    section yields state 'needs_section' with every option's date listed as an
    option, never a chosen date.
    """
    def inside(at):
        try:
            t=datetime.fromisoformat(at)
            return (not start or t>=datetime.fromisoformat(start)) and (not end or t<=datetime.fromisoformat(end))
        except (TypeError,ValueError):return False
    items=[]
    for act in sorted(graph.activities(),key=lambda a:a['key']):
        choice=applies_to(graph,act['key'],learner)
        def due(key):
            d=graph.out(key,'due_at') if key else []
            return d[0] if d else None
        if choice['state'] in ('single','selected'):
            d=due(choice['variant'])
            if d and inside(d['attrs']['at']):
                items.append({'state':choice['state'],'activity':act['label'],'course_id':act['course_id'],'section':choice.get('section'),
                              'section_authority':choice.get('authority') if choice.get('section') else None,'due_at':d['attrs']['at'],
                              'proof':graph.proof(d),'quote':graph.quote(d['key'])})
        else:
            opts=[]
            for o in choice['options']:
                d=due(o['key'])
                if d and inside(d['attrs']['at']):opts.append({'section':o['name'],'due_at':d['attrs']['at'],'quote':graph.quote(d['key'])})
            if opts:items.append({'state':choice['state'],'activity':act['label'],'course_id':act['course_id'],'options':opts})
    return sorted(items,key=lambda i:i.get('due_at') or min(o['due_at'] for o in i['options']))


def current_version(graph,document_key):
    """The newest version of a document that nothing supersedes."""
    versions=[r for r in graph.e.values() if r['kind']=='document_version' and r['attrs'].get('document')==document_key]
    if not versions:return None
    superseded={r['to'] for r in graph.edges if r['relation']=='supersedes'}
    live=[v for v in versions if v['key'] not in superseded]
    pick=max(live or versions,key=lambda v:str(v['attrs'].get('observed_at') or ''))
    return {'key':pick['key'],'version_id':pick.get('version_id'),'label':pick['label'],'observed_at':pick['attrs'].get('observed_at'),
            'superseded':sorted(v['version_id'] for v in versions if v['key'] in superseded)}


def learner_from_job(job,course_id):
    """Learner view from the server-supplied group context (reports and fresh official groups)."""
    sections=[]
    for ctx in job.get('group_context') or []:
        if not isinstance(ctx,dict) or ctx.get('course_id')!=course_id:continue
        for r in ctx.get('reports') or []:
            if isinstance(r,dict) and r.get('authority')=='student_reported' and r.get('kind') in ('lab','section','team') and isinstance(r.get('name'),str):
                sections.append({'course_id':course_id,'name':r['name'],'authority':'student_reported'})
    profile=(job.get('learner_profile') or {}).get('sections') or []
    sections+=[s for s in profile if isinstance(s,dict) and s.get('course_id')==course_id]
    return {'sections':sections}


def group_options(job,course,activity_label,related):
    """Graph-backed replacement for group_attribution.variant_options (same shape: [{name, sources:[n]}])."""
    graph=Graph.from_job(job)
    key='activity:'+course+':'+slug(activity_label)
    if key not in graph.e:return []
    choice=applies_to(graph,key,{'sections':[]})
    index={s.get('id'):n for n,s in related}
    found=[]
    for o in choice.get('options') or []:
        cited=[]
        rows=[graph.e[o['key']]] if o['key'] else []
        rows+=[r for r in graph.out(key,'requires') if any(norm(s['label'])==norm(o['name']) for s in graph.sections_of(r['key']))]
        for row in rows:
            sid=row.get('source_id') or (row.get('proof_ref') or '').removeprefix('job-source:')
            n=index.get(sid)
            if n and n not in cited:cited.append(n)
        if cited:found.append({'name':o['name'],'sources':sorted(cited)})
    return found[:8]

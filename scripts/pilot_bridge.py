"""Registered-source reads and explicitly requested note sync. No collector or sender."""
import csv
import hashlib
import json
import os
import sys
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

ROOT = Path(os.environ['SCHOOL_OPERATIONS_PATH']).parent.parent
STATE = Path(os.environ['SCHOOL_SNAPSHOT_PATH']).parent
sys.path.insert(0, str(ROOT / 'Sync/operations'))


def catalog():
    root = ROOT.resolve()
    courses = json.loads((ROOT / 'Sync/courses.json').read_text())
    configured = json.loads((ROOT / 'Sync/operations/connections.json').read_text())['moodle']['pages']
    existing = {c['code'] for c in courses}
    for page in configured:
        if page.get('format') == 'moodle_catalog' and page['course'] not in existing:
            code = page['course']
            courses.append({'code':code,'name':{'MASH':'Math & Stats Help','Study Skills':'Study Skills Resources','AI for Everyone':'Critical AI Literacy'}.get(code,code),'url':page['url'],'section':'Support','folder':''})
            existing.add(code)
    records = []
    with (ROOT / 'Sync/course_source_register.csv').open(newline='') as handle:
        for row in csv.DictReader(handle):
            ident = hashlib.sha256((row['course'] + row['source_url'] + row['local_path']).encode()).hexdigest()[:24]
            candidate = (ROOT / row['local_path']).resolve() if row['local_path'] else None
            path = candidate if candidate and root in candidate.parents and candidate.is_file() else None
            records.append({'id': ident, 'course': row['course'], 'title': row['title'], 'kind': row['kind'], 'url': row['source_url'], 'captured': bool(path), 'observed_at': row['retrieved_at_utc'], 'reviewed_at': row['reviewed_at_utc'] or None, 'filename': path.name if path else None, '_path': str(path) if path else None})
    # Register private previous work for the owner's local app. These files are
    # never treated as Moodle evidence, and the file route still requires the
    # paired personal account. A stable path ID keeps a Notion notebook link
    # usable when a solution is revised.
    for course in courses:
        folder = course.get('folder')
        if not folder:
            continue
        assignments = ROOT / 'Courses' / folder / 'Assignments'
        if not assignments.is_dir():
            continue
        for candidate in sorted(assignments.rglob('*')):
            if (not candidate.is_file() or candidate.is_symlink()
                    or candidate.name.startswith('.')
                    or candidate.suffix.lower() not in {'.md', '.txt', '.pdf', '.docx', '.pptx', '.png', '.jpg', '.jpeg'}
                    or candidate.stat().st_size > 25 * 1024 * 1024
                    or any(part in {'tmp', '__pycache__'} for part in candidate.parts)):
                continue
            path = candidate.resolve()
            if root not in path.parents:
                continue
            relative = str(path.relative_to(root))
            ident = hashlib.sha256(('prior-work:' + relative).encode()).hexdigest()[:24]
            draft = 'worked solution' in path.name.lower() or 'worked explanation' in path.name.lower()
            records.append({'id': ident, 'course': course['code'], 'title': path.name,
                            'kind': 'assistant_draft' if draft else 'prior_work',
                            'url': None, 'captured': True, 'observed_at': None,
                            'reviewed_at': None, 'filename': path.name, '_path': str(path)})
    return courses, records


def token():
    from delivery import load_secrets
    return load_secrets(STATE.parent / 'credentials.json', ROOT)['notion']['token']


def api(endpoint, data=None, method=None):
    req = Request('https://api.notion.com/v1/' + endpoint, data=json.dumps(data).encode() if data is not None else None, method=method or ('POST' if data is not None else 'GET'), headers={'Authorization':'Bearer ' + token(), 'Notion-Version':'2025-09-03', 'Content-Type':'application/json'})
    with urlopen(req, timeout=15) as response:
        return json.load(response)


def remote_note(ident):
    page = api('pages/' + ident)
    blocks = []
    cursor = ''
    for _ in range(10):
        result = api('blocks/' + ident + '/children?page_size=100' + ('&start_cursor=' + cursor if cursor else ''))
        blocks.extend(result['results'])
        if not result.get('has_more'): break
        cursor = result['next_cursor']
    else: raise ValueError('Notion note is too large for safe synchronization')
    if any(b['type'] != 'paragraph' or b.get('has_children') for b in blocks):
        raise ValueError('Notion note structure changed. Preserve both versions and resolve in Notion.')
    parts = [''.join(t.get('plain_text', t.get('text',{}).get('content','')) for t in b['paragraph']['rich_text']) for b in blocks]
    body = ''.join(parts)
    return {'body':body,'hash':hashlib.sha256(body.encode()).hexdigest(),'blocks':blocks,'url':page['url']}


def paragraphs(body):
    return [{'object':'block','type':'paragraph','paragraph':{'rich_text':[{'type':'text','text':{'content':body[i:i+1800]}}]}} for i in range(0,len(body),1800)] or [{'object':'block','type':'paragraph','paragraph':{'rich_text':[]}}]


def main(action, payload):
    if action == 'calendar':
        data=json.loads((ROOT/'Sync/calendar_schedule.json').read_text())
        if data.get('version')!=1 or not isinstance(data.get('classes'),list):raise ValueError('Reviewed timetable is unavailable')
        _,records=catalog()
        by_path={str(Path(r['_path']).relative_to(ROOT)):r for r in records if r['_path']}
        for row in data['classes']+data['holidays']:
            for source in row['sources']:
                candidate=(ROOT/source['path']).resolve()
                source['version_matches']=ROOT in candidate.parents and candidate.is_file() and hashlib.sha256(candidate.read_bytes()).hexdigest()==source['sha256']
                source['id']=source['sha256']
                registered=by_path.get(source['path'])
                if registered:source['file_id']=registered['id'];source['observed_at']=registered['observed_at']
                if not source['version_matches']:
                    issue=source['title']+' changed or is missing; its timetable interpretation needs review.'
                    if issue not in data['issues']:data['issues'].append(issue)
        return data
    if action == 'catalog':
        courses, records = catalog()
        for r in records: r.pop('_path')
        return {'courses':[{**{k:c.get(k) for k in ('code','name','folder','url','section')},**({'section':'FA07 · Monday'} if c['code']=='MATH 9100L' else {})} for c in courses], 'sources':records}
    if action == 'imports':
        return json.loads((ROOT / 'Sync/notion_live_notes.json').read_text())
    if action == 'search':
        from knowledge import search
        index = json.loads((STATE / 'knowledge_index.json').read_text())
        _, records = catalog()
        by_path = {str(Path(r['_path']).relative_to(ROOT)):r for r in records if r['_path']}
        hits = search(index, payload['query'], course=payload.get('course') or None, limit=6)
        result = []
        for hit in hits:
            registered = by_path.get(hit.get('path'))
            result.append({'id': registered['id'] if registered else hit['id'], 'title':registered['title'] if registered else Path(hit['path']).name, 'course':hit.get('course'), 'excerpt':hit['excerpt'], 'url':registered['url'] if registered else None, 'file_id':registered['id'] if registered and registered['_path'] else None, 'observed_at':hit.get('source_observed_at'), 'kind':registered['kind'] if registered else 'file', 'role':hit.get('role'), 'relationship':hit.get('relationship')})
        projection_path=ROOT/'Sync/Understanding/evidence_cards.json'
        card_count=0
        if projection_path.is_file():
            from evidence_cards import select_context
            projection=json.loads(projection_path.read_text())
            scope=payload.get('course')
            selected=[]
            for code in ([scope] if scope else sorted({r.get('course') for r in records if r.get('course')})):
                selected.extend(select_context(projection,code,payload['query'],3,False))
            for card in selected[:6]:
                if card.get('review_state') not in {'reviewed','collected'}:continue
                src=card['source']
                registered=by_path.get(src.get('path')) or next((r for r in records if r.get('url')==src.get('url') and r.get('course')==card['course']),None)
                if not registered or registered.get('course')!=card['course']:continue
                if src.get('sha256') and registered.get('_path'):
                    content=Path(registered['_path']).read_bytes()
                    digest=hashlib.sha256(b''.join(line for line in content.splitlines(keepends=True) if not line.startswith(b'Observed: '))).hexdigest()
                    if digest!=src['sha256'] and hashlib.sha256(content).hexdigest()!=src['sha256']:continue
                detail='Evidence card ('+card['authority']+'; '+src.get('pointer','')+'): '+card['text']
                if card.get('fields'):detail+=' '+json.dumps(card['fields'],ensure_ascii=False)
                existing=next((r for r in result if r['id']==registered['id']),None)
                if existing:existing['excerpt']=existing['excerpt'][:1200]+'\n'+detail[:600]
                elif len(result)<8:result.append({'id':registered['id'],'title':registered['title'],'course':card['course'],'excerpt':detail[:1800],'url':registered.get('url'),'file_id':registered['id'] if registered.get('_path') else None,'observed_at':src.get('observed_at'),'kind':registered['kind'],'authority':card['authority']})
                card_count+=1
        return {'hits':result,'indexed_at':index['built_at'],'evidence_cards_used':card_count}
    if action == 'context':
        _, records=catalog()
        index=json.loads((STATE/'knowledge_index.json').read_text())
        result=[]
        for ident in payload.get('ids',[])[:8]:
            row=next((r for r in records if r['id']==ident),None)
            if not row or not row['_path']:raise ValueError('Selected source is unavailable; remove it or choose a captured file.')
            relative=str(Path(row['_path']).relative_to(ROOT))
            doc=next((d for d in index['documents'] if relative==d['path'] or relative in d.get('aliases',[])),None)
            chunks=[c['text'] for c in index['chunks'] if doc and c['doc']==doc['id']]
            full_text='\n'.join(chunks)
            text=full_text[:6000]
            if not text and Path(row['_path']).suffix in {'.md','.txt'}:text=Path(row['_path']).read_text()[:6000]
            if not text:raise ValueError('The selected file has no indexed text yet. Open the original file or choose another source.')
            result.append({'id':ident,'title':row['title'],'course':row['course'],'url':row['url'],'file_id':ident,'excerpt':text,'observed_at':row['observed_at'],'kind':'file','extract_truncated':len(full_text)>6000})
        return {'hits':result,'indexed_at':index['built_at']}
    if action == 'file':
        _, records = catalog()
        row = next((r for r in records if r['id']==payload['id']), None)
        if not row or not row['_path']: raise ValueError('Source file not available')
        return row
    if action == 'notion_pull':
        remote = remote_note(payload['id']);remote.pop('blocks');return remote
    if action == 'notion_push':
        body = payload['body']
        if len(body)>80000:raise ValueError('Split this note into smaller class sections before syncing')
        blocks = paragraphs(body)
        ident = payload.get('notion_id')
        receipt_path=Path(payload['receipt_path']) if payload.get('receipt_path') else None
        if not ident and receipt_path and receipt_path.exists():
            receipt=json.loads(receipt_path.read_text())
            if not receipt.get('notion_id'):
                raise ValueError('The earlier Notion creation has an unknown outcome. Check Notion before retrying; a duplicate will not be created.')
            ident=receipt['notion_id']
            payload['notion_hash']=receipt['notion_hash']
        if ident:
            remote=remote_note(ident)
            if remote['hash'] != payload.get('notion_hash'):
                return {'conflict':True,'remote_body':remote['body'],'url':remote['url']}
            old=remote['blocks']
            for i, block in enumerate(blocks):
                if i<len(old):api('blocks/'+old[i]['id'], {'paragraph':block['paragraph']}, 'PATCH')
                else:api('blocks/'+ident+'/children', {'children':[block]}, 'PATCH')
            for block in old[len(blocks):]:api('blocks/'+block['id'], method='DELETE')
            api('pages/'+ident,{'properties':{'title':{'type':'title','title':[{'type':'text','text':{'content':payload['title'][:180]}}]}}},'PATCH')
        else:
            layout=json.loads((ROOT / 'Sync/notion_class_notes_layout.json').read_text())
            parent=layout['lab_page'] if payload['course']=='MATH 9100L' else layout['course_pages'].get(payload['course'])
            if not parent:raise ValueError('No course notebook is connected in Notion')
            if receipt_path:
                receipt_path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
                receipt_path.write_text(json.dumps({'state':'creating','note_id':payload['id']}))
                receipt_path.chmod(0o600)
            page=api('pages',{'parent':{'page_id':parent},'properties':{'title':{'type':'title','title':[{'type':'text','text':{'content':payload['title'][:180]}}]}},'children':blocks})
            ident=page['id']
            if receipt_path:
                receipt_path.write_text(json.dumps({'state':'created','note_id':payload['id'],'notion_id':ident,'notion_hash':hashlib.sha256(body.encode()).hexdigest()}))
                receipt_path.chmod(0o600)
        verified=remote_note(ident)
        if verified['body']!=body:raise ValueError('Notion read-back differs; synchronization needs review')
        return {'notion_id':ident,'notion_hash':verified['hash'],'url':verified['url'],'body':verified['body']}
    if action == 'notion_archive':
        return api('pages/'+payload['id'],{'archived':True},'PATCH')
    raise ValueError('Unknown operation')


if __name__=='__main__':
    try:
        print(json.dumps(main(sys.argv[1],json.load(sys.stdin)),ensure_ascii=False))
    except HTTPError as error:
        print(json.dumps({'error':'Notion returned HTTP '+str(error.code)+'. Your local note is preserved.'}))
    except Exception as error:
        print(json.dumps({'error':str(error) if isinstance(error,ValueError) else 'Source service unavailable; local work is preserved.'}))

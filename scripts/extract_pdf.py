"""Bounded selectable-PDF and Office text extractor. stdin bytes, stdout JSON; no network."""
import io,json,resource,sys,zipfile,re,posixpath,math
import xml.etree.ElementTree as ET
MAX_INPUT=10*1024*1024
MAX_TEXT=512000
MAX_PAGES=500
MAX_OFFICE_XML=2*1024*1024
# Formatting-heavy Word documents can exceed the ordinary XML-part limit.
# Only the main body uses the existing 5 MiB per-entry archive ceiling;
# relationship, comment, spreadsheet and slide XML retain the smaller bound.
MAX_WORD_BODY_XML=5*1024*1024

def parallel_text(cells):
    """Repeated separated text starts suggest columns/tables, not their order.

    This bounded geometry signal requests layout review. It never rearranges
    source text or establishes that a row-wise/column-wise reading is correct.
    """
    rows=[]
    for x,y,end in sorted(cells,key=lambda value:(value[1],value[0])):
        if rows and abs(y-rows[-1][0])<=2:rows[-1][1].append((x,end))
        else:rows.append((y,[(x,end)]))
    seen={}
    for y,fragments in rows:
        groups=[]
        for start,end in fragments:
            if groups and start-groups[-1][1]<=36:groups[-1][1]=max(groups[-1][1],end)
            else:groups.append([start,end])
        if len(groups)<2:continue
        left,right=groups[0][0],groups[-1][0]
        if right-left<72:continue
        key=(math.floor(left/18),math.floor(right/18))
        for dx in (-1,0,1):
            for dy in (-1,0,1):
                previous=seen.get((key[0]+dx,key[1]+dy))
                if previous and abs(left-previous[0])<=18 and abs(right-previous[1])<=18 and abs(y-previous[2])>=6:return True
        seen[key]=(left,right,y)
    return False

def visual_objects(resources,depth=0,seen=None):
    """Inspect bounded image/form references without decoding image pixels."""
    seen=set() if seen is None else seen
    if not resources:return False
    try:
        resources=resources.get_object()
        objects=resources.get('/XObject') or {}
        if hasattr(objects,'get_object'):objects=objects.get_object()
        if len(objects)>100:return True
        for value in objects.values():
            key=(getattr(value,'idnum',None),getattr(value,'generation',None))
            if key[0] is not None and key in seen:continue
            if key[0] is not None:seen.add(key)
            item=value.get_object()
            if item.get('/Subtype')=='/Image':return True
            if item.get('/Subtype')=='/Form' and (depth>=3 or visual_objects(item.get('/Resources'),depth+1,seen)):return True
        return False
    except Exception:return True  # Unchecked visual resources must not imply completeness.

def extract(data):
    if data.startswith(bytes.fromhex('d0cf11e0a1b11ae1')):
        from extract_legacy_ppt import ready, extract as legacy_extract
        if not ready():raise ValueError('Legacy PowerPoint reader not commissioned')
        return legacy_extract(data)
    if data.startswith(b'PK\x03\x04'):return extract_office(data)
    from pypdf import PdfReader
    if len(data)>MAX_INPUT or not data.startswith(b'%PDF-'):raise ValueError('Invalid PDF')
    reader=PdfReader(io.BytesIO(data))
    # Some ordinary viewer-readable PDFs use encryption with an empty user
    # password. Match that normal opening path; never guess a document password.
    if reader.is_encrypted and not reader.decrypt(''):
        raise ValueError('PDF requires a document password')
    total_pages=len(reader.pages);limit=min(total_pages,MAX_PAGES);chunks=[];size=0;truncated=total_pages>limit
    pages=0;without_text=[];visual_pages=[];issues=[]
    for i in range(limit):
        cells=[];geometry_unknown=False;font_size=12
        def observe(operator,args,cm,tm):
            nonlocal geometry_unknown,font_size
            if operator==b'Tf':
                try:font_size=float(args[1])
                except (TypeError,ValueError,IndexError):geometry_unknown=True
                return
            if operator in (b"'",b'"'):geometry_unknown=True;return
            if operator not in (b'Tj',b'TJ') or not args:return
            values=args[0] if operator==b'TJ' else [args[0]]
            if not any(isinstance(v,(str,bytes)) and v.strip() for v in values):return
            if len(cells)>=5000:geometry_unknown=True;return
            try:
                # Text matrices are relative to the current user-space matrix.
                a=tm[0]*cm[0]+tm[1]*cm[2];b=tm[0]*cm[1]+tm[1]*cm[3]
                c=tm[2]*cm[0]+tm[3]*cm[2];d=tm[2]*cm[1]+tm[3]*cm[3]
                x=tm[4]*cm[0]+tm[5]*cm[2]+cm[4];y=tm[4]*cm[1]+tm[5]*cm[3]+cm[5]
                if not all(math.isfinite(v) and abs(v)<=100000 for v in (a,b,c,d,x,y,font_size)) or abs(b)>0.01 or abs(c)>0.01 or a<=0 or d<=0 or font_size<=0:geometry_unknown=True;return
                # A conservative approximate extent joins adjacent styled
                # fragments before looking for a gutter. It is not decoded
                # font geometry or evidence of a verified reading sequence.
                characters=sum(len(v) for v in values if isinstance(v,(str,bytes)))
                cells.append((x,y,x+characters*font_size*abs(a)*0.7))
            except (TypeError,ValueError,IndexError):geometry_unknown=True
        # Observe individual text operators: visitor_text can coalesce two
        # side-by-side starts into one fragment and conceal the layout gap.
        text=reader.pages[i].extract_text(visitor_operand_before=observe) or ''
        pages=i+1
        if geometry_unknown or parallel_text(cells):issues.append({'page':pages,'code':'layout_unverified'})
        if not text.strip():without_text.append(pages)
        if visual_objects(reader.pages[i].get('/Resources')):visual_pages.append(pages)
        chunk='Page %d\n%s\n\n'%(i+1,text)
        raw=chunk.encode('utf-8');remaining=MAX_TEXT-size
        if len(raw)>remaining:
            chunk=raw[:remaining].decode('utf-8',errors='ignore');truncated=True
        chunks.append(chunk);size+=len(chunk.encode('utf-8'))
        if size>=MAX_TEXT:break
    empty=not any(c.split('\n',1)[-1].strip() for c in chunks)
    return {**({'error':'No selectable text'} if empty else {}),'text':'' if empty else ''.join(chunks),'pages':pages,'truncated':truncated,
      'pdf_reading':{'method':'selectable_text','total_pages':total_pages,'pages_read':pages,'pages_without_text':without_text,**({'visual_pages':visual_pages} if visual_pages else {}),**({'page_issues':issues} if issues else {})}}

def extract_office(data,allow_empty=False):
    """Read bounded XML text only: no archive extraction, network or macros."""
    if len(data)>MAX_INPUT:raise ValueError('Invalid Office input')
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        infos=archive.infolist();names={entry.filename for entry in infos}
        if len(infos)>2000 or len(names)!=len(infos):raise ValueError('Invalid archive entries')
        if sum(entry.file_size for entry in infos)>50*1024*1024:raise ValueError('Archive too large')
        for entry in infos:
            name=entry.filename
            if name.startswith('/') or '\\' in name or '..' in name.split('/') or '\x00' in name or entry.flag_bits&1 or (entry.external_attr>>16)&0o170000==0o120000:raise ValueError('Unsafe archive entry')
            # Media is never decompressed by this XML-only reader. A real
            # converted slide deck contains a 1.5 MiB EMF compressed 263:1;
            # rejecting that untouched part hides otherwise readable slides.
            # Retain per-entry/total size caps and the ratio guard for every
            # part that this reader might open (including all XML).
            unread_media=bool(re.fullmatch(r'ppt/media/[^/]+\.(?:emf|wmf|png|jpe?g|gif|tiff?|bmp|svg|webp)',entry.filename,re.I))
            if entry.file_size>5*1024*1024 or not unread_media and entry.file_size>max(1,entry.compress_size)*250:raise ValueError('Archive expansion limit')
        def xml(name):
            limit=MAX_WORD_BODY_XML if name=='word/document.xml' else MAX_OFFICE_XML
            if archive.getinfo(name).file_size>limit:raise ValueError('Office XML size limit')
            raw=archive.read(name)
            if len(raw)>limit or b'\x00' in raw or re.search(br'<!\s*(?:DOCTYPE|ENTITY)\b',raw,re.I):raise ValueError('Unsafe XML')
            raw.decode('utf-8-sig')  # Reject alternative encodings that hide a DTD.
            return ET.fromstring(raw)
        chunks=[];size=0;truncated=False;units=0
        def add(label,paragraphs):
            nonlocal size,truncated
            text='\n'.join(value.strip() for value in paragraphs if value.strip())
            if not text:return
            raw=(label+'\n'+text+'\n\n').encode('utf-8');remaining=MAX_TEXT-size
            if len(raw)>remaining:raw=raw[:remaining];truncated=True
            chunk=raw.decode('utf-8',errors='ignore');chunks.append(chunk);size+=len(chunk.encode('utf-8'))
        docx='word/document.xml' in names;pptx='ppt/presentation.xml' in names;xlsx='xl/workbook.xml' in names
        if sum((docx,pptx,xlsx))!=1:raise ValueError('Unsupported or ambiguous Office archive')
        if xlsx:
            shared=[];tag='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
            if 'xl/sharedStrings.xml' in names:
                for si in xml('xl/sharedStrings.xml').iter(tag+'si'):
                    shared.append(''.join(n.text or '' for n in si.iter(tag+'t')))
                    if len(shared)>100000:raise ValueError('Shared string limit')
            rels='xl/_rels/workbook.xml.rels'
            if rels not in names:raise ValueError('Workbook relationships missing')
            relmap={n.attrib.get('Id'):n.attrib.get('Target') for n in xml(rels) if n.attrib.get('TargetMode')!='External'}
            for sheet in xml('xl/workbook.xml').iter(tag+'sheet'):
                if units>=100:truncated=True;break
                target=relmap.get(sheet.attrib.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')) or ''
                part=posixpath.normpath(target.lstrip('/') if target.startswith('/') else 'xl/'+target)
                if not re.fullmatch(r'xl/worksheets/sheet\d+\.xml',part) or part not in names:raise ValueError('Invalid worksheet relationship')
                units+=1;rows=[];cells=0;sheet_bytes=0
                for row in xml(part).iter(tag+'row'):
                    values=[]
                    for cell in row.findall(tag+'c'):
                        cells+=1
                        if cells>100000:raise ValueError('Worksheet cell limit')
                        ref=cell.attrib.get('r','')
                        if not re.fullmatch(r'[A-Z]{1,3}[1-9]\d{0,6}',ref):raise ValueError('Invalid cell reference')
                        raw=cell.findtext(tag+'v') or '';kind=cell.attrib.get('t')
                        if kind=='s':
                            if not raw.isdigit() or int(raw)>=len(shared):raise ValueError('Invalid shared string')
                            raw=shared[int(raw)]
                        elif kind=='inlineStr':raw=''.join(n.text or '' for n in cell.iter(tag+'t'))
                        formula=cell.findtext(tag+'f')
                        if formula is not None:raw='Formula ='+formula+'; saved cached value: '+(raw or '(not available)')+'; not recalculated'
                        if raw:
                            if sheet_bytes+len(raw.encode('utf-8'))+len(ref)+4>MAX_TEXT-size:truncated=True;break
                            values.append(ref+': '+raw);sheet_bytes+=len(raw.encode('utf-8'))+len(ref)+4
                    if values:rows.append(' | '.join(values))
                    if truncated:break
                add('Sheet %d: %s'%(units,sheet.attrib.get('name','Unnamed worksheet')),rows)
                if size>=MAX_TEXT:truncated=True;break
            if not chunks:raise ValueError('No readable spreadsheet cells')
            return {'text':''.join(chunks),'format':'xlsx','units':units,'unit_label':'sheets','truncated':truncated,'limitations':['Cell references and saved values are preserved; formulas were not recalculated.','Charts, embedded images and visual relationships need review in the original spreadsheet.']}
        if docx:
            tag='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
            document=xml('word/document.xml')
            anchors={};active=set();anchor_paragraph={}
            for number,paragraph in enumerate(document.iter(tag+'p'),1):
                for node in paragraph.iter():
                    if node.tag==tag+'commentRangeStart':
                        ident=node.attrib.get(tag+'id','');active.add(ident);anchor_paragraph.setdefault(ident,number)
                    elif node.tag==tag+'commentRangeEnd':active.discard(node.attrib.get(tag+'id',''))
                    elif node.tag==tag+'t':
                        for ident in active:anchors[ident]=anchors.get(ident,'')+(node.text or '')
            documents=['word/document.xml']+sorted(n for n in names if re.fullmatch(r'word/(?:footnotes|endnotes|header\d+|footer\d+)\.xml',n))
            for name in documents:
                for paragraph in (document if name=='word/document.xml' else xml(name)).iter(tag+'p'):
                    parts=[('\t' if node.tag==tag+'tab' else '\n' if node.tag==tag+'br' else node.text or '') for node in paragraph.iter() if node.tag in (tag+'t',tag+'tab',tag+'br')]
                    text=''.join(parts)
                    style=paragraph.find(tag+'pPr/'+tag+'pStyle')
                    heading=re.fullmatch(r'Heading([1-6])',style.attrib.get(tag+'val',''),re.I) if style is not None else None
                    if heading and text.strip():text='#'*int(heading.group(1))+' '+text
                    if text.strip():units+=1;add(('Paragraph %d'%units) if name=='word/document.xml' else name.split('/')[-1]+' paragraph '+str(units),[text])
                    if size>=MAX_TEXT:truncated=True;break
                if size>=MAX_TEXT:break
            if 'word/comments.xml' in names and size<MAX_TEXT:
                for comment in xml('word/comments.xml').iter(tag+'comment'):
                    ident=comment.attrib.get(tag+'id','');text='\n'.join(''.join(n.text or '' for n in paragraph.iter(tag+'t')) for paragraph in comment.iter(tag+'p')).strip()
                    if not text:continue
                    author=comment.attrib.get(tag+'author','Unknown')[:160];when=comment.attrib.get(tag+'date','Unknown')[:100]
                    label='Comment %s Author: %s Date: %s Anchor paragraph %s: %s Comment text:'%(ident,author,when,anchor_paragraph.get(ident,0),anchors.get(ident,'[anchor not available]'))
                    add(label,[text])
                    if size>=MAX_TEXT:truncated=True;break
            format,unit_label='docx','paragraphs'
        else:
            rels='ppt/_rels/presentation.xml.rels'
            if rels not in names:raise ValueError('Slide order missing')
            relmap={node.attrib.get('Id'):node.attrib.get('Target') for node in xml(rels) if node.attrib.get('TargetMode')!='External'}
            slides=[];rid='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
            for node in xml('ppt/presentation.xml').iter():
                if not node.tag.endswith('}sldId'):continue
                target=relmap.get(node.attrib.get(rid)) or ''
                path=posixpath.normpath(target.lstrip('/') if target.startswith('/') else 'ppt/'+target)
                if not re.fullmatch(r'ppt/slides/slide\d+\.xml',path) or path not in names:raise ValueError('Invalid slide relationship')
                slides.append(path)
            if len(slides)>100:truncated=True
            tag='{http://schemas.openxmlformats.org/drawingml/2006/main}'
            for index,name in enumerate(slides[:100],1):
                paragraphs=[''.join(node.text or '' for node in p.iter(tag+'t')) for p in xml(name).iter(tag+'p')]
                add('Slide %d'%index,paragraphs);units=index
                notes_rels='ppt/slides/_rels/'+name.split('/')[-1]+'.rels'
                if notes_rels in names:
                    for node in xml(notes_rels):
                        if node.attrib.get('TargetMode')=='External' or not node.attrib.get('Type','').endswith('/notesSlide'):continue
                        path=posixpath.normpath('ppt/slides/'+node.attrib.get('Target',''))
                        if not re.fullmatch(r'ppt/notesSlides/notesSlide\d+\.xml',path) or path not in names:raise ValueError('Invalid notes relationship')
                        add('Slide %d notes'%index,[''.join(t.text or '' for t in p.iter(tag+'t')) for p in xml(path).iter(tag+'p')])
                if size>=MAX_TEXT:truncated=True;break
            format,unit_label='pptx','slides'
        if not chunks and not allow_empty:raise ValueError('No readable Office text')
        return {'text':''.join(chunks),'format':format,'units':units,'unit_label':unit_label,'truncated':truncated,
          'limitations':['Text extraction does not interpret diagrams, embedded objects or visual reading order.','No submission, grade or deadline is inferred from this extraction.']+(['Slide formatting, including bold emphasis, is not preserved; check the original when formatting identifies required items.'] if format=='pptx' else [])}

if __name__=='__main__':
    resource.setrlimit(resource.RLIMIT_CPU,(30,35))
    # Darwin does not support lowering address space; the parent meters RSS.
    try:resource.setrlimit(resource.RLIMIT_AS,(1024**3,1024**3))
    except ValueError:pass
    try:result=extract(sys.stdin.buffer.read(MAX_INPUT+1))
    except Exception:result={'error':'Document extraction unavailable'}
    print(json.dumps(result,ensure_ascii=False))

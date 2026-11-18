"""Bounded OCR supplement for every PDF/Office read, preserving native text and gaps."""
import hashlib,io,json,math,os,posixpath,time,zipfile
from pathlib import Path
import xml.etree.ElementTree as ET
from bounded_process import run_bounded
MAX_TEXT=512000

def lines(value):
    items=value.get('lines',[])
    if not isinstance(items,list) or len(items)>1500:raise ValueError('Invalid OCR lines')
    out=[];low=0
    for item in items:
        if not isinstance(item,dict) or not isinstance(item.get('text'),str) or len(item['text'])>10000:raise ValueError('Invalid OCR line')
        score=item.get('confidence')
        if isinstance(score,bool) or not isinstance(score,(float,int)) or not math.isfinite(score) or not 0<=score<=1:raise ValueError('Invalid OCR confidence')
        if score<0.3:low+=1;continue
        if item['text'].strip():out.append(item['text'].strip())
    return '\n'.join(out),low

IMAGE_HEADER='Image 1 — local OCR supplement (unreviewed)'
UNCLEAR='[unclear OCR] '
OMITTED='[unreadable line omitted]'
# ISO-BMFF brands that macOS ImageIO decodes as HEIF/HEIC still images (iPhone camera default).
HEIF_BRANDS={b'heic',b'heix',b'heim',b'heis',b'hevc',b'hevx',b'mif1',b'msf1'}
MAX_REGIONS=300

def image_kind(data):
    if data.startswith(b'\x89PNG\r\n\x1a\n'):return 'png'
    if data.startswith(b'\xff\xd8\xff'):return 'jpeg'
    if data[:4]==b'RIFF' and data[8:12]==b'WEBP':return 'webp'
    if len(data)>=12 and data[4:8]==b'ftyp' and data[8:12] in HEIF_BRANDS:return 'heif'
    return None

def _unit(value,name):
    if value is None:return None
    if isinstance(value,bool) or not isinstance(value,(float,int)) or not math.isfinite(value) or not -0.01<=value<=1.01:raise ValueError('Invalid OCR '+name)
    return min(1.0,max(0.0,float(value)))

def _instruction_like(text):
    try:import injectionguard
    except Exception:return False
    return bool(injectionguard.INSTRUCTION.search(text) or injectionguard.ASSISTANT_INSTRUCTION.search(text))

def image_reading(page,truncated=False):
    """Photo OCR as citable text: observed wording, explicit uncertainty, located lines.

    Every recognized line keeps Vision's observed wording (no language repair).
    A line is marked [unclear OCR] when its confidence is low, a language-corrected
    checking pass read it differently or not at all, or its box touches the left or
    right photo edge (likely cut off). Lines under 0.3 confidence are replaced by an
    explicit omission marker so the gap remains visible in citations. The original
    image is preserved server-side; this transcription is never marked reviewed.
    """
    items=page.get('lines',[])
    if not isinstance(items,list) or len(items)>1500:raise ValueError('Invalid OCR lines')
    # A checked page omits `corrected` on lines both passes read identically.
    checked=page.get('correction_checked') is True
    out=[IMAGE_HEADER];regions=[];omitted=flagged=instructions=0;located=False
    for item in items:
        if not isinstance(item,dict) or not isinstance(item.get('text'),str) or len(item['text'])>10000:raise ValueError('Invalid OCR line')
        score=item.get('confidence')
        if isinstance(score,bool) or not isinstance(score,(float,int)) or not math.isfinite(score) or not 0<=score<=1:raise ValueError('Invalid OCR confidence')
        x,y,w,h=(_unit(item.get(k),k) for k in ('x','y','w','h'))
        corrected=item.get('corrected')
        if corrected is not None and (not isinstance(corrected,str) or len(corrected)>10000):raise ValueError('Invalid OCR check')
        text=' '.join(item['text'].split())
        if not text:continue
        flags=[]
        if score<0.3:flags.append('unreadable')
        elif score<0.5:flags.append('low_confidence')
        if corrected is not None:
            if not checked:raise ValueError('Unexpected OCR check')
            if not corrected.strip():flags.append('not_confirmed')
            elif ' '.join(corrected.split()).casefold()!=text.casefold():flags.append('correction_disagrees')
        if w is not None and x is not None:
            located=True
            if x<=0.01 or x+w>=0.98:flags.append('cut_at_edge')
        if _instruction_like(text):instructions+=1;flags.append('instruction_like')
        uncertain=[f for f in flags if f!='instruction_like']
        if 'unreadable' in flags:omitted+=1;out.append(OMITTED)
        else:
            if uncertain:flagged+=1
            out.append((UNCLEAR if uncertain else '')+text)
        if len(regions)<MAX_REGIONS:
            region={'line':len(out)-1,'confidence':round(float(score),3),'flags':flags}
            if None not in (x,y,w,h):region['box']=[round(x,4),round(1-y-h,4),round(w,4),round(h,4)] # left, top, width, height (0-1, top-left origin)
            regions.append(region)
    read=len(out)-1-omitted
    if read<1:raise ValueError('No readable image text')
    text='\n'.join(out)
    if len(text.encode())>MAX_TEXT:raise ValueError('Image text exceeds bound')
    total=len(out)-1
    quality='poor' if (flagged+omitted)*2>total else 'review' if flagged or omitted else 'clear'
    size={k:page[k] for k in ('width','height') if isinstance(page.get(k),int) and not isinstance(page.get(k),bool) and 0<page[k]<=100000}
    orientation=page.get('orientation') if page.get('orientation') in ('up','down') else None
    return {'text':text,'format':'image','pages':1,'truncated':truncated or len(items)>=1500,
      'image_ocr':{'reviewed':False,'method':'apple_vision_local','low_confidence_lines':omitted,'lines_read':read,'flagged_lines':flagged,
        'instruction_like_lines':instructions,'quality':quality,'checks':['confidence']+(['correction_pass'] if checked else [])+(['edge'] if located else []),
        **({'image':{**size,**({'orientation':orientation} if orientation else {})}} if size else {}),'regions':regions,'regions_truncated':len(regions)<total}}

def run(binary,data,mode,pages,remaining):
    code,raw,_=run_bounded([binary,mode,','.join(map(str,pages))],data,timeout=remaining,max_output=3000000,memory_kib=1024*1024)
    if code:raise ValueError('Local OCR unavailable')
    value=json.loads(raw)
    if not isinstance(value,dict) or not isinstance(value.get('pages'),list) or len(value['pages'])>len(pages):raise ValueError('Invalid OCR response')
    observed=[p.get('page') for p in value['pages']]
    if len(set(observed))!=len(observed) or any(p not in pages or isinstance(p,bool) for p in observed):raise ValueError('Invalid OCR pages')
    return value

def supplement(data,native,started=None,runner=run):
    binary=os.environ.get('SCHOOL_NATIVE_OCR')
    if not binary:return native
    path=Path(binary)
    if not path.is_absolute() or not path.is_file() or path.is_symlink():return native
    started=time.monotonic() if started is None else started
    remaining=lambda:max(0,min(75,95-(time.monotonic()-started)))
    if remaining()<5:return native
    if data.startswith(b'%PDF-'):
        reading=native.get('pdf_reading') or {};count=reading.get('pages_read')
        if isinstance(count,bool) or not isinstance(count,int) or not 1<=count<=500:return native # Password/corrupt input stays blocked.
        targets=sorted(set(reading.get('pages_without_text',[])+reading.get('visual_pages',[])+[x['page'] for x in reading.get('page_issues',[]) if x.get('code')=='layout_unverified']))
        if not targets:return native
        try:
            value=runner(binary,data,'pdf',targets,remaining())
            if value.get('total')!=reading['total_pages']:raise ValueError('Page count mismatch')
            text=native.get('text','');missing=list(reading.get('pages_without_text',[]));issues=[dict(x) for x in reading.get('page_issues',[])];recovered=[];truncated=bool(native.get('truncated')) or bool(value.get('truncated'))
            for p in value['pages']:
                body,low=lines(p);page=p['page']
                if not body:continue
                chunk='\n\nPage %d — local OCR supplement (unreviewed)\n%s\n'%(page,body)
                if len((text+chunk).encode())>MAX_TEXT:truncated=True;continue
                text+=chunk;recovered.append(page)
                if page in missing:missing.remove(page)
                for code in ['formula_unverified','layout_unverified']+(['ocr_unavailable'] if low else []):
                    item={'page':page,'code':code}
                    if item not in issues:issues.append(item)
            for page in targets:
                if page not in recovered and {'page':page,'code':'ocr_unavailable'} not in issues:issues.append({'page':page,'code':'ocr_unavailable'})
            out={**native,'text':text,'truncated':truncated,'pdf_reading':{**reading,'method':'native_with_ocr' if recovered else reading['method'],'pages_without_text':missing,'page_issues':issues[:2000],**({'ocr_pages':sorted(recovered)} if recovered else {})}}
            if recovered:out.pop('error',None)
            return out
        except Exception:return native
    if image_kind(data):
        try:
            value=runner(binary,data,'image',[1],remaining())
            if value.get('total')!=1 or len(value['pages'])!=1:raise ValueError('Image coverage missing')
            return image_reading(value['pages'][0],truncated=bool(value.get('truncated')))
        except Exception:return native
    if not data.startswith(b'PK\x03\x04'):return native
    try:
        from extract_pdf import extract_office
        base=extract_office(data,allow_empty=True) # Reuse the complete bounded archive/XML validation.
        images=office_images(data);text=base['text'];done=[];missing=[];truncated=bool(base.get('truncated'))
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            for item in images[:100]:
                if remaining()<5:break
                try:
                    image=archive.read(item['part']);value=runner(binary,image,'image',[1],remaining())
                    if value.get('total')!=1 or len(value['pages'])!=1:raise ValueError('Invalid image OCR')
                    body,low=lines(value['pages'][0])
                    if not body:raise ValueError('No OCR text')
                    chunk='\n\n%s — local OCR supplement (unreviewed)\n%s\n'%(item['location'],body)
                    if len((text+chunk).encode())>MAX_TEXT:truncated=True;break
                    text+=chunk;done.append({**item,'sha256':hashlib.sha256(image).hexdigest(),'low_confidence_lines':low})
                except Exception:missing.append(item)
        done_keys={(x['part'],x['location']) for x in done}
        missing=[x for x in images if (x['part'],x['location']) not in done_keys]
        out={**base,'text':text,'truncated':truncated,'office_reading':{'method':'native_with_ocr','images_total':len(images),'images_read':len(done),'ocr_images':done,'images_unread':missing[:100],'reviewed':False},'limitations':base['limitations']+['Embedded-image OCR is an unreviewed transcription; check original images, formulas and visual relationships.']}
        if not text.strip():out['error']='No readable Office text or OCR'
        return out
    except Exception:return native

def office_images(data):
    """Only internal drawing relationships in actual document/slide parts; no archive extraction."""
    images=[]
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names=set(archive.namelist());parts=[]
        if 'word/document.xml' in names:
            parts=['word/document.xml']+sorted(n for n in names if n.startswith('word/') and Path(n).name.startswith(('header','footer')) and n.endswith('.xml'))
        elif 'ppt/presentation.xml' in names:
            rels=ET.fromstring(archive.read('ppt/_rels/presentation.xml.rels'));mapping={r.get('Id'):r.get('Target') for r in rels if r.get('TargetMode')!='External'}
            for node in ET.fromstring(archive.read('ppt/presentation.xml')).iter():
                if node.tag.endswith('}sldId'):
                    target=mapping.get(node.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'),'');parts.append(posixpath.normpath('ppt/'+target))
        for index,part in enumerate(parts,1):
            folder=posixpath.dirname(part);relpath=folder+'/_rels/'+posixpath.basename(part)+'.rels'
            if relpath not in names:continue
            mapping={r.get('Id'):r.get('Target') for r in ET.fromstring(archive.read(relpath)) if r.get('TargetMode')!='External' and r.get('Type','').endswith('/image')}
            for node in ET.fromstring(archive.read(part)).iter():
                if not node.tag.endswith('}blip'):continue
                target=mapping.get(node.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed'),'')
                path=posixpath.normpath(folder+'/'+target)
                if not target or path not in names or not (path.startswith('word/media/') or path.startswith('ppt/media/')):continue
                images.append({'part':path,'location':('Slide %d'%index if part.startswith('ppt/') else part)+' image '+str(len(images)+1)})
                if len(images)>=1000:return images
    return images

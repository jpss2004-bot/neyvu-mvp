"""Optional, offline macOS Vision OCR over bounded original PDF pages.

Native text is preserved. OCR is an unreviewed transcription, never a claim
that diagrams, table order or equations were understood.
"""
import argparse,hashlib,io,json,math,os,socket,sys
from pathlib import Path
MAX_TEXT=64000

def supplement(data,native,render,recognize):
    reading=native.get('pdf_reading') or {}
    count=reading.get('pages_read');total=reading.get('total_pages')
    if not isinstance(count,int) or isinstance(count,bool) or not isinstance(total,int) or not 1<=count<=min(total,100):raise ValueError('Native page coverage is required')
    missing=list(reading.get('pages_without_text',[]));visual=list(reading.get('visual_pages',[]));issues=[dict(item) for item in reading.get('page_issues',[])]
    candidates=missing+visual+[item['page'] for item in issues if item.get('code')=='layout_unverified']
    if any(not isinstance(page,int) or isinstance(page,bool) or not 1<=page<=count for page in candidates):raise ValueError('Invalid OCR page')
    targets=sorted(set(candidates))
    original=native.get('text','');text=original;recovered=[];truncated=bool(native.get('truncated'))
    for page in targets:
        words=recognize(render(page))
        lines=[str(item[0]).strip() for item in words if isinstance(item,(list,tuple)) and len(item)>=2 and isinstance(item[0],str) and isinstance(item[1],(int,float)) and math.isfinite(item[1]) and item[1]>=0.3 and item[0].strip()]
        body='\n'.join(lines)
        if not body:
            if {'page':page,'code':'ocr_unavailable'} not in issues:issues.append({'page':page,'code':'ocr_unavailable'})
            continue
        chunk='\n\nPage %d — local OCR supplement (unreviewed)\n%s\n'%(page,body)
        if len((text+chunk).encode())>MAX_TEXT:truncated=True;continue
        text+=chunk;recovered.append(page)
        if page in missing:missing.remove(page)
        # OCR cannot distinguish a correct formula from a plausible-looking
        # mistranscription. Keep this limitation on every recovered page.
        if {'page':page,'code':'formula_unverified'} not in issues:issues.append({'page':page,'code':'formula_unverified'})
    result={**native,'text':text,'truncated':truncated,'pdf_reading':{**reading,'method':'native_with_ocr' if recovered else reading.get('method','selectable_text'),'pages_without_text':missing,'page_issues':issues}}
    result['pdf_reading']['page_issues']=issues[:400]
    if recovered:
        result.pop('error',None)
        result['pdf_reading']['ocr_pages']=recovered
    assert result['text'].startswith(original)
    return result

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--native',type=Path,required=True);args=parser.parse_args()
    try:
        data=sys.stdin.buffer.read(10*1024*1024+1);payload=json.loads(args.native.read_text())
        if len(data)>10*1024*1024 or not data.startswith(b'%PDF-') or hashlib.sha256(data).hexdigest()!=payload['original_sha256']:raise ValueError('Original mismatch')
        os.environ['HF_HUB_OFFLINE']='1';os.environ['TRANSFORMERS_OFFLINE']='1'
        def blocked(*_a,**_k):raise RuntimeError('OCR cannot access the network')
        socket.create_connection=blocked;socket.socket.connect=blocked;socket.socket.connect_ex=blocked
        import pypdfium2
        from ocrmac.ocrmac import text_from_image
        document=pypdfium2.PdfDocument(data)
        try:
            if len(document)!=payload['native']['pdf_reading']['total_pages']:raise ValueError('Page count mismatch')
            def render(page):
                source=document[page-1]
                try:
                    width,height=source.get_size();scale=min(2.0,2200/max(width,height))
                    bitmap=source.render(scale=scale)
                    try:return bitmap.to_pil().copy()
                    finally:bitmap.close()
                finally:source.close()
            value=supplement(data,payload['native'],render,lambda image:text_from_image(image,recognition_level='accurate',language_preference=['en-US']))
        finally:document.close()
    except Exception:value={'error':'Local OCR unavailable'}
    print(json.dumps(value,ensure_ascii=False))
if __name__=='__main__':main()

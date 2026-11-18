"""Optional isolated PDF OCR supplement. Original/native text stay authoritative evidence.

No downloads, external services or plugins are enabled here. The parent process
bounds CPU time, resident memory and output. Provision models separately.
"""
import argparse,hashlib,io,json,os,socket,sys
from pathlib import Path
MAX_INPUT=10*1024*1024
MAX_TEXT=64000
MAX_PAGES=100

def supplement(native,total_pages,document):
    """Combine native text with OCR of missing pages only; never replace math with Markdown."""
    if not isinstance(total_pages,int) or isinstance(total_pages,bool) or not 1<=total_pages<=1000000:raise ValueError('Invalid page count')
    reading=native.get('pdf_reading') or {}
    pages_read=reading.get('pages_read',min(total_pages,MAX_PAGES))
    if not isinstance(pages_read,int) or not 1<=pages_read<=min(total_pages,MAX_PAGES):raise ValueError('Invalid processed pages')
    missing=reading.get('pages_without_text',list(range(1,pages_read+1)))
    visual=reading.get('visual_pages',[])
    native_issues=reading.get('page_issues',[])
    if not isinstance(native_issues,list) or len(native_issues)>400 or any(not isinstance(p,dict) or p.get('code') not in ('ocr_unavailable','formula_unverified','visual_unread','layout_unverified') or not isinstance(p.get('page'),int) or isinstance(p['page'],bool) or not 1<=p['page']<=pages_read for p in native_issues) or len({(p['page'],p['code']) for p in native_issues})!=len(native_issues):raise ValueError('Invalid native page issues')
    layout=[p['page'] for p in native_issues if p['code']=='layout_unverified']
    target=sorted(set(missing+visual+layout))
    if not isinstance(target,list) or target!=sorted(set(target)) or any(not isinstance(p,int) or isinstance(p,bool) or not 1<=p<=pages_read for p in target):raise ValueError('Invalid OCR pages')
    body=native.get('text','')
    if not isinstance(body,str) or len(body.encode())>MAX_TEXT:raise ValueError('Invalid native text')
    preserved=body;missing=list(missing);ocr_pages=[];issues=[dict(p) for p in native_issues];regions=[];truncated=bool(native.get('truncated')) or pages_read<total_pages
    data=document.export_to_dict()
    for page in target:
        # The page number comes from bounded native coverage, not a model suggestion.
        if str(page) not in {str(k) for k in data.get('pages',{})}:
            issues.append({'page':page,'code':'ocr_unavailable'});continue
        text=document.export_to_markdown(page_no=page)
        for label,code,entries in [('formula','formula_unverified',data.get('texts',[])),('picture','visual_unread',data.get('pictures',[])),('table','layout_unverified',data.get('tables',[]))]:
            for item in entries:
                if item.get('label')!=label:continue
                provenance=[p for p in item.get('prov',[]) if p.get('page_no')==page]
                if not provenance:continue
                if {'page':page,'code':code} not in issues:issues.append({'page':page,'code':code})
                regions.append({'page':page,'code':code,'item':item.get('self_ref'),'provenance':provenance})
                # Keep observed words that Markdown otherwise hides. This is
                # explicitly an unverified transcription, not decoded math.
                if label=='formula' and item.get('orig') and not item.get('text'):
                    text+='\n\nUnverified formula-region transcription:\n'+item['orig']
        # An image/formula placeholder alone is not readable text.
        import re
        readable=re.sub(r'<!--.*?-->','',text,flags=re.S).strip()
        if not readable:issues.append({'page':page,'code':'ocr_unavailable'});continue
        chunk='\n\nPage %d — local OCR supplement (unreviewed)\n%s\n'%(page,text)
        raw=chunk.encode();remaining=MAX_TEXT-len(body.encode())
        if len(raw)>remaining:
            # Avoid claiming an OCR page was recovered if its supplement cannot fit.
            truncated=True;issues.append({'page':page,'code':'ocr_unavailable'});continue
        body+=chunk
        if page in missing:missing.remove(page)
        ocr_pages.append(page)
    if not body.strip():raise ValueError('No readable document text')
    assert body.startswith(preserved)
    metadata={'method':'native_with_ocr' if ocr_pages else 'selectable_text','total_pages':total_pages,'pages_read':pages_read,'pages_without_text':missing}
    if ocr_pages:metadata['ocr_pages']=ocr_pages
    if visual:metadata['visual_pages']=visual
    if issues:metadata['page_issues']=issues
    return {'text':body,'pages':pages_read,'truncated':truncated,'pdf_reading':metadata,
            'reader_evidence':{'reader':'docling-2.133.0','reviewed':False,'regions':regions[:400]}}

def convert(data,native,models):
    if len(data)>MAX_INPUT or not data.startswith(b'%PDF-'):raise ValueError('Invalid PDF')
    os.environ['HF_HUB_OFFLINE']='1';os.environ['TRANSFORMERS_OFFLINE']='1';os.environ['HF_HUB_DISABLE_TELEMETRY']='1'
    def blocked(*args,**kwargs):raise RuntimeError('Document conversion cannot access the network')
    socket.create_connection=blocked;socket.socket.connect=blocked;socket.socket.connect_ex=blocked
    from docling.document_converter import DocumentConverter,PdfFormatOption
    from docling.datamodel.base_models import InputFormat,DocumentStream
    from docling.datamodel.pipeline_options import PdfPipelineOptions,OcrMacOptions,OcrMode
    from docling.datamodel.accelerator_options import AcceleratorOptions,AcceleratorDevice
    import pypdfium2
    pdf=pypdfium2.PdfDocument(data)
    try:total=len(pdf)
    finally:pdf.close()
    if not 1<=total<=1000000:raise ValueError('Invalid PDF pages')
    # This initial reader is Mac-worker scoped. Windows distribution does not
    # execute it or download the Python stack; a Windows OCR engine is unqualified.
    # Docling's default four-page batches and 100-item queues exceeded the
    # parent's 2 GiB bound on ordinary raster lecture decks. Apply backpressure
    # at every stage without disabling tables or increasing that safety bound.
    # PDF-aware OCR suppresses visible raster words where native text overlaps
    # them, even when that native text differs from the rendered slide. Full-page
    # OCR keeps those words in this unreviewed supplement; the independently
    # extracted native text remains an unchanged prefix of the combined result.
    options=PdfPipelineOptions(artifacts_path=models,do_ocr=True,ocr_options=OcrMacOptions(lang=['en-US'],mode=OcrMode.FULL_PAGE),do_table_structure=True,do_formula_enrichment=False,document_timeout=30,enable_remote_services=False,allow_external_plugins=False,accelerator_options=AcceleratorOptions(num_threads=4,device=AcceleratorDevice.CPU),ocr_batch_size=1,layout_batch_size=1,table_batch_size=1,queue_max_size=1)
    converter=DocumentConverter(format_options={InputFormat.PDF:PdfFormatOption(pipeline_options=options)})
    count=min(total,MAX_PAGES,(native.get('pdf_reading') or {}).get('pages_read',MAX_PAGES))
    result=converter.convert(DocumentStream(name='source.pdf',stream=io.BytesIO(data)),raises_on_error=False,max_num_pages=1000000,max_file_size=MAX_INPUT,page_range=(1,count))
    if not result.document.pages:raise ValueError('OCR did not return readable pages')
    return supplement(native,total,result.document)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--models',required=True,type=Path);parser.add_argument('--native',required=True,type=Path);args=parser.parse_args()
    try:
        if not args.models.is_absolute() or not args.models.is_dir():raise ValueError('Local models unavailable')
        payload=json.loads(args.native.read_text());data=sys.stdin.buffer.read(MAX_INPUT+1)
        if payload['original_sha256']!=hashlib.sha256(data).hexdigest():raise ValueError('Native evidence belongs to another original')
        output=convert(data,payload['native'],args.models)
    except Exception:output={'error':'Local OCR supplement unavailable'}
    print(json.dumps(output,ensure_ascii=False))
if __name__=='__main__':main()

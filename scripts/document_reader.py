"""Optional isolated document-reader routing; disabled without explicit configuration."""
import hashlib,json,os,tempfile,time
from pathlib import Path
from bounded_process import run_bounded

def supplement_pdf(data,native,started=None):
    from offline_ocr import supplement
    native=supplement(data,native,started)
    runtime=os.environ.get('SCHOOL_DOCUMENT_READER_PYTHON');models=os.environ.get('SCHOOL_DOCUMENT_READER_MODELS');engine=os.environ.get('SCHOOL_DOCUMENT_READER_ENGINE','docling')
    if not runtime or (engine=='docling' and not models) or not data.startswith(b'%PDF-'):return native
    reading=native.get('pdf_reading') or {}
    layout=any(isinstance(issue,dict) and issue.get('code')=='layout_unverified' for issue in (reading.get('page_issues') or []))
    if not native.get('error') and not reading.get('pages_without_text') and not reading.get('visual_pages') and not layout:return native
    remaining=min(45,80-(time.monotonic()-started)) if started is not None else 45
    if remaining<5:return native
    try:
        if not Path(runtime).is_absolute() or (engine=='docling' and not Path(models).is_absolute()):raise ValueError('Reader paths must be absolute')
        with tempfile.TemporaryDirectory(prefix='schoolvault-reading-') as folder:
            evidence=Path(folder)/'native.json';evidence.write_text(json.dumps({'original_sha256':hashlib.sha256(data).hexdigest(),'native':native}));evidence.chmod(0o600)
            if engine not in ('docling','vision'):raise ValueError('Unknown document reader')
            command=([runtime,str(Path(__file__).with_name('vision_pdf.py')),'--native',str(evidence)] if engine=='vision' else [runtime,str(Path(__file__).with_name('docling_pdf.py')),'--models',models,'--native',str(evidence)])
            code,out,_=run_bounded(command,data,timeout=remaining,max_output=160000,memory_kib=2*1024*1024)
            if code:raise ValueError('OCR reader unavailable')
            value=json.loads(out)
            if value.get('error') or not isinstance(value.get('text'),str) or len(value['text'].encode())>64000 or not value['text'].startswith(native.get('text','')):raise ValueError('Invalid OCR supplement')
            return value
    except Exception:
        # Native partial text remains useful when OCR hits its own bounds. Its
        # missing-page metadata survives; do not publish a success certificate.
        return native

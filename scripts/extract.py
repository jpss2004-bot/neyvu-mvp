import sys
import subprocess
import zipfile
from pathlib import Path
from xml.etree import ElementTree

MAX_DOCX_XML = 4 * 1024 * 1024

class BoundedTree(ElementTree.TreeBuilder):
    def doctype(self, name, pubid, system):
        raise ValueError('Document type declarations are not supported')

def extract_docx(p):
    with zipfile.ZipFile(p) as z:
        members = [m for m in z.infolist() if m.filename == 'word/document.xml']
        if len(members) != 1 or members[0].file_size > MAX_DOCX_XML:
            raise ValueError('Word document text exceeds the extraction limit')
        parser = ElementTree.XMLParser(target=BoundedTree())
        size = 0
        with z.open(members[0]) as member:
            while True:
                chunk = member.read(65536)
                if not chunk: break
                size += len(chunk)
                if size > MAX_DOCX_XML: raise ValueError('Word document text exceeds the extraction limit')
                parser.feed(chunk)
        root = parser.close()
        return '\n'.join(''.join(n.itertext()) for n in root.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t'))

def main(p):
    if p.suffix.lower()=='.pdf':
        from extract_pdf import extract,MAX_INPUT
        with p.open('rb') as handle:data=handle.read(MAX_INPUT+1)
        print(extract(data)['text'])
    elif p.suffix.lower()=='.docx': print(extract_docx(p))
    elif p.suffix.lower() in {'.txt','.md'}: print(p.read_text(errors='replace'))
    else:
        # Optional OCR helper, built locally: swiftc image_text.swift -o image_text
        binary=Path(__file__).with_name('image_text')
        if binary.exists():
            result=subprocess.run([str(binary),str(p)],capture_output=True,text=True,timeout=45)
            if result.returncode==0: print(result.stdout)

if __name__ == '__main__':
    if len(sys.argv)>2 and sys.argv[2]=='--bounded-child':
        import resource
        resource.setrlimit(resource.RLIMIT_CPU,(40,45))
        main(Path(sys.argv[1]))
    else:
        from bounded_process import run_bounded
        code,out,err=run_bounded([sys.executable,str(Path(__file__).resolve()),sys.argv[1],'--bounded-child'],b'',timeout=50,max_output=1000000)
        if code:raise ValueError('Extraction unavailable')
        sys.stdout.buffer.write(out)

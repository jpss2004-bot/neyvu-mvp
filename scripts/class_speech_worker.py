"""Outbound per-section speech service; no owner vault or database adapters."""
import fcntl,hashlib,json,os,re,shutil,time,urllib.request
from pathlib import Path
from bounded_process import run_bounded
from class_transcribe import pinned_model,sha256,MAX_BYTES,MAX_SECONDS
CACHE_LIMIT=1024*1024*1024
UUID=re.compile(r'^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$',re.I)
FILES={'audio.original','audio.part','pcm.s16','pcm.json','pcm.part','job.json'}
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):raise ValueError('Speech download redirect refused.')

def configuration(config):
    spec=config.get('class_speech') or {}
    if spec.get('enabled') is not True:return None
    values={}
    for key in ['python','model_directory','model_manifest','cache_root']:
        value=spec.get(key)
        if not isinstance(value,str) or not Path(value).is_absolute() or key!='python' and Path(value).is_symlink():raise ValueError('Private absolute speech paths required.')
        values[key]=Path(value)
    # Invoke the virtual environment's Python entry point; it may legitimately
    # link to its base interpreter while retaining the environment's modules.
    if not values['python'].is_file() or not values['model_manifest'].is_file():raise ValueError('Cached speech runtime missing.')
    manifest=json.loads(values['model_manifest'].read_text());pinned_model(values['model_directory'],manifest)
    values['manifest']=manifest;values['model_sha256']=manifest['files']['model.bin'];return values

def ready(config):
    try:return (configuration(config) or {}).get('model_sha256')
    except Exception:return None

def private_root(path):
    if path.is_symlink():raise ValueError('Unsafe speech cache.')
    path.mkdir(mode=0o700,parents=True,exist_ok=True)
    if path.stat().st_mode&0o077:raise ValueError('Speech cache must be private.')
    marker=path/'cache.json'
    if marker.exists():
        if marker.is_symlink() or json.loads(marker.read_text())!={'version':1,'owner':'school-class-speech'}:raise ValueError('Unrecognized cache.')
    else:
        if any(path.iterdir()):raise ValueError('Choose an empty speech cache.')
        fd=os.open(marker,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'w') as f:json.dump({'version':1,'owner':'school-class-speech'},f)

def slot_owned(folder):
    if folder.is_symlink() or not folder.is_dir() or not all(UUID.fullmatch(part) for part in folder.name.split('_')) or len(folder.name.split('_'))!=2:raise ValueError('Unrecognized cache slot.')
    if folder.stat().st_mode&0o077:raise ValueError('Cache slot must be private.')
    files=list(folder.iterdir())
    if any(p.name not in FILES or p.is_symlink() or not p.is_file() for p in files):raise ValueError('Unrecognized cache contents.')
    marker=folder/'job.json'
    if not marker.is_file() or (json.loads(marker.read_text()).get('job_id')!=folder.name.split('_')[1] or json.loads(marker.read_text()).get('user_id')!=folder.name.split('_')[0]):raise ValueError('Missing cache ownership.')
    return files

def remove_slot(folder):
    for p in slot_owned(folder):p.unlink()
    folder.rmdir()

def cache_slot(root,job):
    if not UUID.fullmatch(job.get('job_id','')) or not UUID.fullmatch(job.get('session_id','')) or not re.fullmatch('[a-f0-9]{64}',job.get('audio_manifest_sha256','')):raise ValueError('Invalid speech job.')
    lease=job.get('lease','').split('.')
    if len(lease)!=3 or not UUID.fullmatch(lease[0]) or lease[1]!=job['job_id'] or not re.fullmatch('[A-Za-z0-9_-]{43}',lease[2]):raise ValueError('Invalid speech lease.')
    size=job.get('bytes');chunks=job.get('chunks')
    if not isinstance(size,int) or not 0<size<=MAX_BYTES or not isinstance(chunks,list) or not 0<len(chunks)<=1024:raise ValueError('Invalid recording size.')
    for i,c in enumerate(chunks):
        if c.get('sequence')!=i or not isinstance(c.get('bytes'),int) or not 0<c['bytes']<=4194304 or not re.fullmatch('[a-f0-9]{64}',c.get('sha256','')):raise ValueError('Invalid recording manifest.')
    manifest={'version':1,'mime':job['mime'],'chunks':[{'sequence':c['sequence'],'sha256':c['sha256'],'bytes':c['bytes']} for c in chunks]}
    if sum(c['bytes'] for c in chunks)!=size or hashlib.sha256(json.dumps(manifest,separators=(',',':')).encode()).hexdigest()!=job['audio_manifest_sha256']:raise ValueError('Recording manifest differs.')
    slots=[p for p in root.iterdir() if p.is_dir() or p.is_symlink()];folder=root/(lease[0]+'_'+job['job_id']);reserved=size+MAX_SECONDS*16000*2+10000
    used=sum(p.stat().st_size for slot in slots for p in slot_owned(slot))
    own=sum(p.stat().st_size for p in slot_owned(folder)) if folder.exists() else 0
    for old in sorted((p for p in slots if p!=folder),key=lambda p:p.stat().st_mtime):
        if used-own+reserved<=CACHE_LIMIT:break
        removed=sum(p.stat().st_size for p in slot_owned(old));remove_slot(old);used-=removed
    if used-own+reserved>CACHE_LIMIT or shutil.disk_usage(root).free<reserved+512*1024*1024:raise ValueError('Speech cache storage unavailable.')
    identity={'version':1,'user_id':lease[0],'job_id':job['job_id'],'session_id':job['session_id'],'audio_manifest_sha256':job['audio_manifest_sha256']}
    if folder.exists():
        if json.loads((folder/'job.json').read_text())!=identity:raise ValueError('Cached recording identity differs.')
    else:
        folder.mkdir(mode=0o700);fd=os.open(folder/'job.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'w') as f:json.dump(identity,f)
    os.utime(folder,None);return folder

def verify_audio(file,job):
    if file.is_symlink() or not file.is_file() or file.stat().st_size!=job['bytes']:return False
    with file.open('rb') as f:
        for chunk in job['chunks']:
            if hashlib.sha256(f.read(chunk['bytes'])).hexdigest()!=chunk['sha256']:return False
        return not f.read(1)

def resumable_prefix(partial,job):
    if partial.is_symlink() or partial.exists() and not partial.is_file():raise ValueError('Invalid partial audio.')
    if not partial.exists():return 0
    size=partial.stat().st_size;valid=0
    with partial.open('rb') as source:
        for chunk in job['chunks']:
            if size-valid<chunk['bytes']:return min(size,job['bytes'])
            if hashlib.sha256(source.read(chunk['bytes'])).hexdigest()!=chunk['sha256']:
                with partial.open('r+b') as target:target.truncate(valid);target.flush();os.fsync(target.fileno())
                return valid
            valid+=chunk['bytes']
    if size>valid:
        with partial.open('r+b') as target:target.truncate(valid);target.flush();os.fsync(target.fileno())
    return valid

def download(config,origin,job,folder):
    audio=folder/'audio.original'
    if verify_audio(audio,job):return audio,job['bytes']
    partial=folder/'audio.part';offset=resumable_prefix(partial,job)
    if offset==job['bytes'] and verify_audio(partial,job):os.replace(partial,audio);return audio,offset
    end=min(job['bytes']-1,offset+1024*1024-1)
    request=urllib.request.Request(origin+'/api/beta/worker?kind=class',headers={'Authorization':'Bearer '+config['worker_key'],'X-SchoolVault-Lease':job['lease'],'Range':'bytes=%d-%d'%(offset,end)})
    fd=os.open(partial,os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'r+b') as output,urllib.request.build_opener(NoRedirect()).open(request,timeout=5) as response:
        if response.status!=206 or response.headers.get('Content-Range')!='bytes %d-%d/%d'%(offset,end,job['bytes']):raise ValueError('Audio download range differs.')
        output.seek(offset);total=0;deadline=time.monotonic()+30
        while True:
            if time.monotonic()>deadline:raise ValueError('Audio download timed out.')
            data=response.read1(65536)
            if not data:break
            total+=len(data)
            if total>end-offset+1:raise ValueError('Audio download exceeds its range.')
            output.write(data)
        output.flush();os.fsync(output.fileno())
    if total!=end-offset+1:raise ValueError('Audio download range is incomplete.')
    copied=resumable_prefix(partial,job)
    if copied==job['bytes'] and verify_audio(partial,job):os.replace(partial,audio);return audio,copied
    return None,copied

def speech_once(config,api,origin,stop):
    spec=configuration(config)
    if not spec:return False
    private_root(spec['cache_root'])
    fd=os.open(spec['cache_root']/'worker.lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'w') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:return False
        job=api(config,{'op':'transcribe.lease'},timeout=5).get('job')
        if not job:return False
        if stop.is_set() or api(config,{'op':'transcribe.yield'},timeout=3).get('yield') is True:
            api(config,{'op':'transcribe.finish','lease':job['lease'],'output':{'yielded':True}},timeout=10);return True
        folder=None
        try:
            if job.get('model_sha256')!=spec['model_sha256'] or job.get('window_ms')!=30000:raise ValueError('Pinned speech runtime differs.')
            folder=cache_slot(spec['cache_root'],job);audio,copied=download(config,origin,job,folder)
            if audio is None:
                api(config,{'op':'transcribe.finish','lease':job['lease'],'output':{'download_only':True,'downloaded_bytes':copied,'audio_manifest_sha256':job['audio_manifest_sha256']}},timeout=15);return True
            code,stdout,_=run_bounded([str(spec['python']),str(Path(__file__).with_name('class_speech_section.py')),'--audio',str(audio),'--model-directory',str(spec['model_directory']),'--model-manifest',str(spec['model_manifest']),'--pcm',str(folder/'pcm.s16'),'--cursor-ms',str(job['cursor_ms'])],b'',timeout=45,max_output=128000,memory_kib=768*1024)
            if code:raise ValueError('Speech section unavailable.')
            output=json.loads(stdout)
            if output.get('audio_sha256')!=sha256(audio) or output.get('cursor_ms')!=job['cursor_ms']:raise ValueError('Speech result differs from original.')
            output['audio_manifest_sha256']=job['audio_manifest_sha256']
        except Exception:output={'error':'Local speech unavailable'}
        response=api(config,{'op':'transcribe.finish','lease':job['lease'],'output':output},timeout=15)
        if response.get('status')=='complete' and folder:remove_slot(folder)
        return True

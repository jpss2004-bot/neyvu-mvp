"""One pinned offline speech section over a private, hash-checked PCM cache."""
import argparse,hashlib,json,math,os,socket,sys
from pathlib import Path
from class_transcribe import pinned_model,deny_network,sha256,MAX_BYTES,MAX_SECONDS
RATE=16000
WINDOW_MS=30000
OVERLAP_MS=2000

def prepare_pcm(audio,pcm):
    import av
    audio,pcm=Path(audio),Path(pcm)
    if not audio.is_absolute() or audio.is_symlink() or not audio.is_file() or not 0<audio.stat().st_size<=MAX_BYTES:raise ValueError('Invalid private audio.')
    if not pcm.is_absolute() or pcm.parent.is_symlink() or pcm.is_symlink():raise ValueError('Invalid private PCM cache.')
    identity=sha256(audio);meta=pcm.with_suffix('.json')
    if pcm.exists() and not pcm.is_file() or meta.is_symlink() or meta.exists() and not meta.is_file():raise ValueError('Invalid private PCM cache.')
    if pcm.exists() and meta.is_file() and not meta.is_symlink():
        try:saved=json.loads(meta.read_text())
        except (ValueError,UnicodeError):saved={}
        if (isinstance(saved,dict) and saved.get('audio_sha256')==identity and saved.get('bytes')==pcm.stat().st_size
                and 0<saved['bytes']<=MAX_SECONDS*RATE*2 and saved['bytes']%2==0
                and saved.get('pcm_sha256')==sha256(pcm)):
            return saved
    # Rebuild only the disposable decode cache. Keeping an invalid old PCM
    # beside its replacement would exceed the reserved per-recording space.
    if pcm.exists():pcm.unlink()
    if meta.exists():meta.unlink()
    partial=pcm.with_suffix('.part')
    if partial.exists():
        if partial.is_symlink() or not partial.is_file():raise ValueError('Invalid cache recovery.')
        partial.unlink()
    size=0;digest=hashlib.sha256();resampler=av.audio.resampler.AudioResampler(format='s16',layout='mono',rate=RATE)
    def write(output,frame):
        nonlocal size
        data=frame.to_ndarray().tobytes();size+=len(data)
        if size>MAX_SECONDS*RATE*2:raise ValueError('Decoded audio exceeds two hours.')
        output.write(data);digest.update(data)
    try:
        fd=os.open(partial,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'wb') as output, audio.open('rb') as source, av.open(source,mode='r',options={'protocol_whitelist':'pipe','enable_drefs':'0','use_absolute_path':'0'}) as container:
            for frame in container.decode(audio=0):
                frame.pts=None
                for decoded in resampler.resample(frame):write(output,decoded)
            for decoded in resampler.resample(None):write(output,decoded)
            if not size:raise ValueError('No decoded audio.')
            output.flush();os.fsync(output.fileno())
        os.replace(partial,pcm)
        saved={'version':1,'audio_sha256':identity,'pcm_sha256':digest.hexdigest(),'bytes':size,'decoded_duration_ms':math.ceil(size/2/RATE*1000)}
        fd=os.open(meta,os.O_WRONLY|os.O_CREAT|os.O_TRUNC|os.O_NOFOLLOW,0o600)
        with os.fdopen(fd,'w') as output:json.dump(saved,output);output.flush();os.fsync(output.fileno())
        return saved
    finally:
        if partial.exists():partial.unlink()

def core_words(items,cursor,next_cursor,offset,duration):
    """Keep words by midpoint in one core interval; overlap provides context.

    Boundary times are estimates, so neighboring words remain marked uncertain.
    Do not fabricate speaker attribution or repair mathematical notation.
    """
    result=[]
    for item in items:
        selected=[]
        for word in item.words or []:
            if not math.isfinite(word.start) or not math.isfinite(word.end):raise ValueError('Invalid word timestamp.')
            start,end=round(word.start*1000)+offset,round(word.end*1000)+offset
            midpoint=(start+end)/2
            if cursor<=midpoint<next_cursor or next_cursor==duration and midpoint==duration:
                selected.append((max(0,start),min(duration,end),word.word))
        if not selected:continue
        content=''.join(word[2] for word in selected).strip();start,end=selected[0][0],selected[-1][1]
        if not content:continue
        if start<0 or end<start or end>duration or len(content)>10000:raise ValueError('Invalid segment bounds.')
        uncertain=(not math.isfinite(item.avg_logprob) or not math.isfinite(item.no_speech_prob)
                   or item.avg_logprob<-1 or item.no_speech_prob>0.6
                   or cursor>0 and start<cursor+500 or next_cursor<duration and end>next_cursor-500)
        result.append({'start_ms':start,'end_ms':end,'text':content,'speaker':'unidentified','uncertain':bool(uncertain)})
    return result

def transcribe_section(audio,model_folder,manifest,pcm,cursor):
    folder=pinned_model(model_folder,manifest)
    os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1')
    socket.create_connection=deny_network;socket.socket.connect=deny_network;socket.socket.connect_ex=deny_network;socket.getaddrinfo=deny_network
    import numpy as np
    from faster_whisper import WhisperModel
    import importlib.metadata
    saved=prepare_pcm(audio,pcm);duration=saved['decoded_duration_ms']
    if isinstance(cursor,bool) or not isinstance(cursor,int) or not 0<=cursor<duration or cursor%WINDOW_MS:raise ValueError('Invalid speech cursor.')
    next_cursor=min(duration,cursor+WINDOW_MS);left=max(0,cursor-OVERLAP_MS);right=min(duration,next_cursor+OVERLAP_MS)
    with Path(pcm).open('rb') as source:source.seek(left*RATE*2//1000);data=source.read((right-left)*RATE*2//1000)
    decoded=np.frombuffer(data,dtype=np.int16).astype(np.float32)/32768.0
    model=WhisperModel(str(folder),device='cpu',compute_type='int8',cpu_threads=2,local_files_only=True)
    items,info=model.transcribe(decoded,beam_size=3,vad_filter=True,word_timestamps=True)
    items=list(items)
    if len(items)>1000:raise ValueError('Too many speech sections.')
    segments=core_words(items,cursor,next_cursor,left,duration)
    boundary=(core_words(items,left,cursor,left,duration) if cursor>left else [])+(core_words(items,next_cursor,right,left,duration) if right>next_cursor else [])
    for alternative in boundary:alternative['uncertain']=True
    if len(segments)>5000 or sum(len(s['text']) for s in segments)>240000:raise ValueError('Speech output exceeds its bounds.')
    return {'version':1,'cursor_ms':cursor,'next_cursor_ms':next_cursor,'decoded_duration_ms':duration,
            'audio_sha256':saved['audio_sha256'],'language':info.language,'segments':segments,'boundary_evidence':boundary,
            'runtime':{'engine':'faster-whisper','version':importlib.metadata.version('faster-whisper'),'model_sha256':manifest['files']['model.bin']},
            'limitations':['Speakers are unidentified.','Word timestamps and speech at section boundaries need review.','Unseen board work, diagrams and mathematical notation need course evidence.']}

def main():
    os.umask(0o077);parser=argparse.ArgumentParser()
    for name in ['audio','model-directory','model-manifest','pcm']:parser.add_argument('--'+name,required=True)
    parser.add_argument('--cursor-ms',type=int,required=True);args=parser.parse_args()
    try:result=transcribe_section(args.audio,args.model_directory,json.loads(Path(args.model_manifest).read_text()),args.pcm,args.cursor_ms)
    except Exception:
        print('Local speech section failed; original audio and accepted sections are kept.',file=sys.stderr);return 1
    print(json.dumps(result,ensure_ascii=False,allow_nan=False));return 0
if __name__=='__main__':sys.exit(main())

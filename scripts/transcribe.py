import json
import sys
from faster_whisper import WhisperModel

model = WhisperModel('base', device='cpu', compute_type='int8', cpu_threads=4)
segments, info = model.transcribe(sys.argv[1], beam_size=3, vad_filter=True)
result = [{'start':round(s.start,2),'end':round(s.end,2),'text':s.text.strip()} for s in segments]
print(json.dumps({'text':'\n'.join(s['text'] for s in result),'segments':result,'language':info.language},ensure_ascii=False))

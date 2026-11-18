"""Isolate symbolic answer grading from the harness with CPU/address-space limits."""
import json,resource,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
resource.setrlimit(resource.RLIMIT_CPU,(10,12));# Darwin memory is metered by the parent.
try:resource.setrlimit(resource.RLIMIT_AS,(1024**3,1024**3))
except ValueError:pass
from evallib.graders import grade
job=json.loads(sys.stdin.buffer.read(4*1024*1024+1))
print(json.dumps(grade(job['item'],job['response'],job['sources'],job['clock_dates'])))

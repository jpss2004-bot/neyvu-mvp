#!/bin/sh
# Writes the worker configuration the unchanged worker expects
# (~/Library/Application Support/SchoolVault AI/worker.json, mode 0600) from
# runtime secrets, then execs the worker. Nothing secret is stored in the image.
set -eu
umask 077
: "${SCHOOL_BETA_WORKER_KEY:?SCHOOL_BETA_WORKER_KEY must be injected at runtime}"
dir="$HOME/Library/Application Support/SchoolVault AI"
mkdir -p "$dir"
python3 -I - "$dir/worker.json" <<'PY'
import json,os,sys
cfg={'worker_key':os.environ['SCHOOL_BETA_WORKER_KEY']}
# Experimental class processing stays off unless explicitly enabled.
for name,env in (('class_speech','SCHOOL_WORKER_CLASS_SPEECH'),('class_cornell','SCHOOL_WORKER_CLASS_CORNELL'),('class_actions','SCHOOL_WORKER_CLASS_ACTIONS')):
    cfg[name]={'enabled':os.environ.get(env)=='1'}
with open(sys.argv[1],'w') as f:json.dump(cfg,f)
os.chmod(sys.argv[1],0o600)
PY
unset SCHOOL_BETA_WORKER_KEY
exec python3 -u /app/scripts/beta_ai_worker.py

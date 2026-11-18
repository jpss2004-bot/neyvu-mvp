"""Local embedding and rerank service for Neyvu retrieval (workstream B2/B4).

Runs on this machine only (127.0.0.1), offline after the one-time, owner-approved
model download. Text sent here never leaves the process; nothing is written to
disk. Endpoints (JSON):

  GET  /health                 -> {ok, embed_model, dim, rerank_model}
  POST /embed  {texts, kind}   -> {model, dim, vectors}     kind: query|passage
  POST /rerank {query, documents} -> {model, scores}

Environment:
  NEYVU_EMBED_MODEL   default sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
  NEYVU_RERANK_MODEL  default jinaai/jina-reranker-v2-base-multilingual ('' disables)
  NEYVU_RERANK_PATH   local model dir (onnx/model.onnx + tokenizer.json) served by the
                      ONNX Runtime cross-encoder in cross_encoder.py, e.g. the int8 copy
                      from quantize_reranker.py. Recommended for CPU (build/intelligence).
  NEYVU_RERANK_THREADS (4) / NEYVU_RERANK_MAX_TOKENS (256) / NEYVU_RERANK_BATCH (8)
  NEYVU_MODEL_DIR     default services/answer/retrieval/models
  NEYVU_EMBED_PORT    default 8765
  NEYVU_EMBED_THREADS default 2 (embedding model CPU threads)
  NEYVU_EMBED_TOKEN   optional shared bearer token
  NEYVU_ALLOW_DOWNLOAD=1 to permit the first download (otherwise offline only)
"""
import json
import math
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
EMBED_MODEL = os.environ.get('NEYVU_EMBED_MODEL', 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2')
RERANK_MODEL = os.environ.get('NEYVU_RERANK_MODEL', 'jinaai/jina-reranker-v2-base-multilingual')
RERANK_PATH = os.environ.get('NEYVU_RERANK_PATH', '')
MODEL_DIR = os.environ.get('NEYVU_MODEL_DIR', str(HERE / 'models'))
MAX_TEXTS = 256
MAX_CHARS = 8000

if os.environ.get('NEYVU_ALLOW_DOWNLOAD') != '1':
    os.environ['HF_HUB_OFFLINE'] = '1'
os.environ.setdefault('HF_HUB_DISABLE_TELEMETRY', '1')
os.environ.setdefault('DO_NOT_TRACK', '1')

_lock = threading.Lock()
_embedder = None
_reranker = None
_dim = None


def embedder():
    global _embedder, _dim
    if _embedder is None:
        from fastembed import TextEmbedding
        _embedder = TextEmbedding(EMBED_MODEL, cache_dir=MODEL_DIR, threads=int(os.environ.get('NEYVU_EMBED_THREADS', '2')))
        _dim = len(next(iter(_embedder.embed(['dimension probe']))))
    return _embedder


def reranker():
    global _reranker
    if not RERANK_MODEL and not RERANK_PATH:
        return None
    if _reranker is None and RERANK_PATH:
        sys.path.insert(0, str(HERE))
        from cross_encoder import from_env
        _reranker = from_env(RERANK_PATH)
    if _reranker is None:
        from fastembed.rerank.cross_encoder import TextCrossEncoder
        _reranker = TextCrossEncoder(RERANK_MODEL, cache_dir=MODEL_DIR, threads=2)
    return _reranker


def checked_texts(value, limit=MAX_TEXTS):
    if not isinstance(value, list) or not 1 <= len(value) <= limit or not all(isinstance(t, str) for t in value):
        raise ValueError('texts must be a non-empty list of strings')
    return [t[:MAX_CHARS] for t in value]


def embed(texts, kind='passage'):
    texts = checked_texts(texts)
    with _lock:
        model = embedder()
        vectors = [[float(x) for x in v] for v in model.embed(texts)]
    for v in vectors:
        norm = math.sqrt(sum(x * x for x in v))
        if not norm or not all(math.isfinite(x) for x in v):
            raise ValueError('invalid embedding')
    return {'model': EMBED_MODEL, 'dim': len(vectors[0]), 'vectors': vectors}


class Expired(Exception):
    pass


def rerank(query, documents, budget_ms=None, received=None):
    if not isinstance(query, str) or not query.strip():
        raise ValueError('query required')
    documents = checked_texts(documents, 64)
    model = reranker()
    if model is None:
        raise ValueError('reranker disabled')
    with _lock:
        # The caller abandons the request at budget_ms. If waiting for the lock
        # used most of that budget, answer at once instead of computing scores
        # nobody will read (they would delay every later question).
        if isinstance(budget_ms, (int, float)) and received is not None and (time.monotonic() - received) * 1000 > 0.5 * budget_ms:
            raise Expired()
        scores = [float(s) for s in model.rerank(query[:2000], documents)]
    return {'model': rerank_name(), 'scores': scores}


def rerank_name():
    return ('local:' + Path(RERANK_PATH).name) if RERANK_PATH else (RERANK_MODEL or None)


class Handler(BaseHTTPRequestHandler):
    server_version = 'neyvu-embed/1'

    def log_message(self, *_):
        pass  # never log request bodies (private course text)

    def reply(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def authorized(self):
        token = os.environ.get('NEYVU_EMBED_TOKEN')
        return not token or self.headers.get('Authorization') == 'Bearer ' + token

    def do_GET(self):
        if self.path != '/health':
            return self.reply(404, {'error': 'not found'})
        try:
            embedder()
            return self.reply(200, {'ok': True, 'embed_model': EMBED_MODEL, 'dim': _dim, 'rerank_model': rerank_name()})
        except Exception as error:  # model missing offline
            return self.reply(503, {'ok': False, 'error': type(error).__name__})

    def do_POST(self):
        if not self.authorized():
            return self.reply(401, {'error': 'unauthorized'})
        length = int(self.headers.get('Content-Length') or 0)
        if length > 4_000_000:
            return self.reply(413, {'error': 'too large'})
        try:
            body = json.loads(self.rfile.read(length) or b'{}')
            started = time.monotonic()
            if self.path == '/embed':
                out = embed(body.get('texts'), body.get('kind', 'passage'))
            elif self.path == '/rerank':
                out = rerank(body.get('query'), body.get('documents'), body.get('budget_ms'), started)
            else:
                return self.reply(404, {'error': 'not found'})
            out['ms'] = round((time.monotonic() - started) * 1000, 1)
            return self.reply(200, out)
        except Expired:
            return self.reply(408, {'error': 'budget expired while queued'})
        except ValueError as error:
            return self.reply(400, {'error': str(error)})
        except Exception as error:
            return self.reply(500, {'error': type(error).__name__})


def main():
    port = int(os.environ.get('NEYVU_EMBED_PORT', '8765'))
    embedder()
    if '--no-rerank-warmup' not in sys.argv:
        reranker()
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    print(json.dumps({'event': 'embed-service-ready', 'port': port, 'embed_model': EMBED_MODEL, 'dim': _dim, 'rerank_model': rerank_name()}), flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()

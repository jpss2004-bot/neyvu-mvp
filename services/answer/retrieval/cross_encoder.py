"""CPU cross-encoder for Neyvu reranking (build/intelligence, 2026-11-12).

A thin ONNX Runtime wrapper with the knobs the latency budget needs:
- max_length: (query, passage) pairs are truncated to this many tokens
  (passage side only). The fastembed default for jina-reranker-v2 lets pairs
  run to 1,024 tokens, which is what made the Nov 12 integration run take
  905 ms for 16 candidates on CPU.
- batching: pairs are sorted by length and run in small batches so short
  passages are not padded to the longest one.
- threads: intra-op threads for the ONNX session.
- an LRU score cache keyed by sha256(query, passage), so a retried or
  rephrased-but-identical question does not pay twice.
- int8: services/answer/retrieval/quantize_reranker.py writes a dynamically
  quantized copy of the model (MatMul/Gemm weights int8).

Local files only; nothing is downloaded and no text is logged or stored.
"""
import hashlib
import json
import os
import threading
from collections import OrderedDict
from pathlib import Path

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer


class CrossEncoder:
    def __init__(self, model_dir, threads=4, max_length=256, batch_size=8, cache_size=4096):
        model_dir = Path(model_dir)
        onnx_path = model_dir / 'onnx' / 'model.onnx'
        if not onnx_path.exists():
            onnx_path = model_dir / 'model.onnx'
        options = ort.SessionOptions()
        options.intra_op_num_threads = int(threads)
        options.inter_op_num_threads = 1
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self.session = ort.InferenceSession(str(onnx_path), options, providers=['CPUExecutionProvider'])
        self.inputs = {i.name for i in self.session.get_inputs()}
        self.tokenizer = Tokenizer.from_file(str(model_dir / 'tokenizer.json'))
        self.tokenizer.enable_truncation(max_length=int(max_length), strategy='only_second')
        pad_id = 1
        try:
            cfg = json.loads((model_dir / 'config.json').read_text())
            pad_id = int(cfg.get('pad_token_id', pad_id))
        except Exception:
            pass
        self.pad_id = pad_id
        self.batch_size = int(batch_size)
        self.max_length = int(max_length)
        self.name = model_dir.name
        self._cache = OrderedDict()
        self._cache_size = int(cache_size)
        self._lock = threading.Lock()

    @staticmethod
    def _key(query, doc):
        return hashlib.sha256(query.encode() + b'\x00' + doc.encode()).digest()

    def _run(self, query, docs):
        enc = self.tokenizer.encode_batch([(query, d) for d in docs])
        order = sorted(range(len(enc)), key=lambda i: len(enc[i].ids))
        scores = [0.0] * len(docs)
        for start in range(0, len(order), self.batch_size):
            idx = order[start:start + self.batch_size]
            width = max(len(enc[i].ids) for i in idx)
            ids = np.full((len(idx), width), self.pad_id, dtype=np.int64)
            mask = np.zeros((len(idx), width), dtype=np.int64)
            for row, i in enumerate(idx):
                n = len(enc[i].ids)
                ids[row, :n] = enc[i].ids
                mask[row, :n] = 1
            feed = {'input_ids': ids, 'attention_mask': mask}
            if 'token_type_ids' in self.inputs:
                feed['token_type_ids'] = np.zeros_like(ids)
            logits = self.session.run(None, feed)[0].reshape(len(idx), -1)[:, 0]
            for row, i in enumerate(idx):
                scores[i] = float(logits[row])
        return scores

    def rerank(self, query, docs):
        keys = [self._key(query, d) for d in docs]
        with self._lock:
            cached = [self._cache.get(k) for k in keys]
        todo = [i for i, s in enumerate(cached) if s is None]
        if todo:
            fresh = self._run(query, [docs[i] for i in todo])
            with self._lock:
                for i, s in zip(todo, fresh):
                    cached[i] = s
                    self._cache[keys[i]] = s
                    self._cache.move_to_end(keys[i])
                while len(self._cache) > self._cache_size:
                    self._cache.popitem(last=False)
        return [float(s) for s in cached]


def from_env(default_dir):
    """Reranker configured by NEYVU_RERANK_* environment variables."""
    path = os.environ.get('NEYVU_RERANK_PATH') or default_dir
    return CrossEncoder(path,
                        threads=int(os.environ.get('NEYVU_RERANK_THREADS', '4')),
                        max_length=int(os.environ.get('NEYVU_RERANK_MAX_TOKENS', '256')),
                        batch_size=int(os.environ.get('NEYVU_RERANK_BATCH', '8')),
                        cache_size=int(os.environ.get('NEYVU_RERANK_CACHE', '4096')))

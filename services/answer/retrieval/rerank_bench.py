"""Reranker latency/quality bench on the synthetic fixture (build/intelligence, 2026-11-12).

  services/answer/retrieval/.venv/bin/python services/answer/retrieval/rerank_bench.py \
     --fp32 <jina snapshot dir> --int8 <quantized dir> [--fixture f.json] [--out bench.json]

For every wording in the fixture, candidates are the tenant's documents (the
relevant one included, the rest distractors), rendered like the hybrid path
renders them ("Document: title" header + passage). Each configuration is timed
per question (cold cache: the score cache is cleared for every question) and
scored by the rank of the relevant document (top1, MRR) and by top-1 agreement
with the fp32 / 1,024-token / 16-candidate reference.
"""
import argparse
import json
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cross_encoder import CrossEncoder  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--model', action='append', required=True, help='key=model_dir (repeat); the first config is the reference')
ap.add_argument('--config', action='append', help='key:threads:max_tokens:candidates[:batch] (repeat)')
ap.add_argument('--fixture', default=str(Path(__file__).resolve().parent / 'fixtures' / 'retrieval-fixture.json'))
ap.add_argument('--out', default='')
ap.add_argument('--repeat', type=int, default=1)
args = ap.parse_args()

fx = json.loads(Path(args.fixture).read_text())
docs = fx['documents']


def render(d, chars):
    return 'Document: ' + d['title'] + '\n' + d['body'][:chars]


def cases(n_cand):
    out = []
    for q in fx['queries']:
        pool = [d for d in docs if d['tenant'] == q['tenant']]
        # Relevant first in the pool is irrelevant to the model; keep fixture order but cap at n_cand.
        rel = [d for d in pool if d['id'] in q['relevant']]
        rest = [d for d in pool if d['id'] not in q['relevant']]
        cand = (rel + rest)[:n_cand]
        cand.sort(key=lambda d: d['id'])
        for w in q['wordings']:
            out.append((q, w, cand))
    return out


MODELS = dict(m.split('=', 1) for m in args.model)
CONFIGS = []
for c in args.config or []:
    parts = c.split(':')
    key, threads, max_tokens, n_cand = parts[0], int(parts[1]), int(parts[2]), int(parts[3])
    batch = int(parts[4]) if len(parts) > 4 else 8
    CONFIGS.append((f'{key} t{threads} {max_tokens}tok {n_cand}c b{batch}', key, threads, max_tokens, n_cand, 1800, batch))

models = {}
results = []
reference = {}
for name, kind, threads, max_tokens, n_cand, chars, batch in CONFIGS:
    key = (kind, threads, max_tokens, batch)
    if key not in models:
        models[key] = CrossEncoder(MODELS[kind], threads=threads, max_length=max_tokens, batch_size=batch)
    ce = models[key]
    ce.rerank('warm up', ['warm up passage'])
    lat, top1, rr, agree = [], 0, 0.0, 0
    tokens = []
    for q, w, cand in cases(n_cand):
        texts = [render(d, chars) for d in cand]
        tokens.append(sum(min(len(e.ids), max_tokens) for e in ce.tokenizer.encode_batch([(w['text'], t) for t in texts])))
        for _ in range(args.repeat):
            ce._cache.clear()
            t = time.perf_counter()
            scores = ce.rerank(w['text'], texts)
            lat.append((time.perf_counter() - t) * 1000)
        order = [cand[i]['id'] for i in sorted(range(len(cand)), key=lambda i: -scores[i])]
        rank = next((i + 1 for i, d in enumerate(order) if d in q['relevant']), None)
        top1 += rank == 1
        rr += 1 / rank if rank else 0
        k = (q['group'], w['text'])
        if name == CONFIGS[0][0]:
            reference[k] = order[0]
        agree += reference.get(k) == order[0]
    n = len(lat) // args.repeat
    lat.sort()
    row = {'config': name, 'model': kind, 'threads': threads, 'max_tokens': max_tokens, 'candidates': n_cand, 'batch': batch,
           'median_ms': round(statistics.median(lat), 1), 'p95_ms': round(lat[int(0.95 * (len(lat) - 1))], 1), 'max_ms': round(lat[-1], 1),
           'mean_pair_tokens': round(statistics.mean(tokens) / n_cand, 1), 'top1': round(top1 / n, 3), 'mrr': round(rr / n, 3),
           'top1_agrees_with_ref': round(agree / n, 3), 'questions': n}
    results.append(row)
    print(json.dumps(row), flush=True)

if args.out:
    Path(args.out).write_text(json.dumps({'fixture': Path(args.fixture).name, 'documents': len(docs), 'results': results}, indent=1) + '\n')

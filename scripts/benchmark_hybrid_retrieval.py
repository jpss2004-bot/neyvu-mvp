"""Offline retrieval experiment; never changes the production source ranker.

Run lexical evaluation with --fixture. Optional --model-dir uses already
approved/downloaded ONNX weights through FastEmbed, strictly offline. Tenant,
course and source-authority filters run BEFORE any passage reaches the encoder.
The held-out answer bank is not training data for this experiment.
"""
import argparse
from collections import Counter, OrderedDict
import hashlib
import json
import math
import os
from pathlib import Path
import re
import time

MODEL = 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2'
STOP = set('a an the of to in is are what why how do does for and or my with que qué por para de del la las el los un una y en es son como cómo'.split())


def checked_vectors(values, count):
    vectors = [list(vector) for vector in values]
    if len(vectors) != count or not vectors or not 1 <= len(vectors[0]) <= 4096:
        raise ValueError('Invalid embedding count/dimensions')
    size = len(vectors[0])
    if any(len(v) != size or any(not isinstance(n, (int, float)) or not math.isfinite(n) for n in v) for v in vectors):
        raise ValueError('Invalid embedding dimensions/values')
    return vectors


class ScopedEmbeddingCache:
    """Bounded, run-local vectors; no text/vectors written to disk or shared runs."""
    def __init__(self, encoder, max_entries=512):
        if not isinstance(max_entries, int) or not 1 <= max_entries <= 2048:
            raise ValueError('Invalid embedding cache budget')
        self.encoder, self.max_entries = encoder, max_entries
        self.values = OrderedDict()
        self.calls = self.encoded_texts = self.hits = 0

    def encode(self, query, candidates, tenant, courses):
        digest = lambda text: hashlib.sha256(text.encode('utf-8')).hexdigest()
        records = [(('query', tenant, tuple(sorted(set(courses))), digest(query)), query)]
        records += [(('document', tenant, c['course'], c['id'], c['version'], digest(c['text'])), c['text']) for c in candidates]
        missing = [(key, text) for key, text in records if key not in self.values]
        self.hits += len(records) - len(missing)
        # Validate an entire batch before admitting any of its vectors.
        fresh = checked_vectors(self.encoder([text for _, text in missing]), len(missing)) if missing else []
        if missing:
            self.calls += 1
            self.encoded_texts += len(missing)
        available = dict(zip((key for key, _ in missing), fresh))
        vectors = checked_vectors([available.get(key, self.values.get(key)) for key, _ in records], len(records))
        for (key, _), vector in zip(records, vectors):
            self.values[key] = vector
            self.values.move_to_end(key)
            while len(self.values) > self.max_entries:
                self.values.popitem(last=False)
        return vectors

    def stats(self):
        return {'encoder_calls': self.calls, 'encoded_texts': self.encoded_texts,
                'cache_hits': self.hits, 'retained_vectors': len(self.values),
                'max_entries': self.max_entries, 'persistence': 'memory_only_for_this_evaluation'}


def tokens(text):
    return set(re.findall(r'\w+', text.casefold())) - STOP


def scope(candidates, tenant, courses):
    if not tenant or not courses:
        raise ValueError('An explicit tenant and course scope is required')
    selected = [c for c in candidates if c['tenant'] == tenant and c['course'] in courses
                and c['role'] in ('official', 'course_material')]
    if len(selected) > 500:
        raise ValueError('Experiment candidate budget exceeded')
    identities = [(c['id'], c['version']) for c in selected]
    if len(set(identities)) != len(identities):
        raise ValueError('Duplicate source versions')
    if len({c['id'] for c in selected}) != len(selected):
        raise ValueError('Ambiguous source IDs; use version-qualified IDs for multiple versions')
    return selected


def fuse(orders):
    scores = Counter()
    for order in orders:
        for position, source in enumerate(order, 1):
            scores[source] += 1 / (60 + position)
    return sorted(scores, key=lambda source: (-scores[source], source))


def rank(query, candidates, tenant, courses, embed=None, lexical_order=None):
    candidates = scope(candidates, tenant, courses)
    if not candidates:
        return {'lexical': [], 'dense': [], 'hybrid': []}
    terms = tokens(query)
    lexical = sorted(candidates, key=lambda c: (-len(terms & tokens(c['text'])), c['id']))
    lexical_ids = [c['id'] for c in lexical if terms & tokens(c['text'])]
    if lexical_order is not None:
        if len(lexical_order)!=len(set(lexical_order)) or not set(lexical_order)<={c['id'] for c in candidates}:
            raise ValueError('Lexical baseline escaped the authorized source scope')
        lexical_ids=lexical_order
    if embed is None:
        return {'lexical': lexical_ids, 'dense': [], 'hybrid': []}
    # Query and documents stay local. No outside-scope/AI-draft text is encoded.
    vectors = (embed.encode(query, candidates, tenant, courses) if isinstance(embed, ScopedEmbeddingCache)
               else checked_vectors(embed([query] + [c['text'] for c in candidates]), len(candidates) + 1))
    def cosine(vector):
        denominator = math.sqrt(sum(x*x for x in vectors[0]) * sum(x*x for x in vector))
        return sum(a*b for a,b in zip(vectors[0],vector)) / denominator if denominator else 0
    dense = [c['id'] for _,c in sorted(zip(vectors[1:],candidates), key=lambda pair: (-cosine(pair[0]),pair[1]['id']))]
    return {'lexical': lexical_ids, 'dense': dense, 'hybrid': fuse([lexical_ids,dense])}


def evaluate(fixture, embed=None, lexical_orders=None):
    # Scope admission still happens in rank before any encoder/cache access.
    encoder = ScopedEmbeddingCache(embed) if embed else None
    methods = ('lexical','dense','hybrid') if embed else ('lexical',)
    totals = {method: {'top1':0, 'recall_at_3':0, 'mrr':0} for method in methods}
    timings = []
    languages = {}
    misses = {method:[] for method in methods}
    for case in fixture['queries']:
        start = time.monotonic()
        if lexical_orders is not None and case['id'] not in lexical_orders:
            raise ValueError('Incomplete SQL baseline')
        result = rank(case['query'],fixture['documents'],case['tenant'],case['courses'],encoder,
                      None if lexical_orders is None else lexical_orders[case['id']])
        timings.append(time.monotonic()-start)
        expected = set(case['relevant'])
        if not expected:
            raise ValueError('An evaluation query needs a relevant-source key')
        eligible = {c['id'] for c in scope(fixture['documents'],case['tenant'],case['courses'])}
        if not expected <= eligible:
            raise ValueError('Evaluation key is outside the authorized source scope')
        for method in methods:
            hits=result[method]
            totals[method]['top1'] += bool(hits and hits[0] in expected)
            totals[method]['recall_at_3'] += len(set(hits[:3]) & expected)/len(expected)
            totals[method]['mrr'] += next((1/i for i,source in enumerate(hits,1) if source in expected),0)
            language=case.get('language','unspecified')
            subset=languages.setdefault(language,{m:{'queries':0,'top1_correct':0} for m in methods})[method]
            subset['queries']+=1;subset['top1_correct']+=bool(hits and hits[0] in expected)
            if not hits or hits[0] not in expected:
                misses[method].append({'query_id':case.get('id'),'expected':sorted(expected),'top1':hits[0] if hits else None})
    n=len(fixture['queries'])
    if not n:
        raise ValueError('Empty evaluation')
    return {'queries':n,'fixture_kind':fixture['kind'],'methods':{m:{k:round(v/n,4) for k,v in values.items()} for m,values in totals.items()},
            'per_language':languages,'top1_misses':misses,
            'median_query_seconds':round(sorted(timings)[len(timings)//2],6),
            'model':MODEL if embed else None,'production_changed':False,
            'embedding_work':encoder.stats() if encoder else None,
            'lexical_baseline':'current_production_SQL_on_synthetic_fixture' if lexical_orders is not None else 'word_overlap_experiment_baseline',
            'limitations':['Synthetic retrieval fixture, not the private 150-answer release bank.',
                            'The source corpus is tiny; production corpus size, distributions and answer quality are not measured.',
                            'No academic answer correctness or production latency is established.']}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture',type=Path,required=True)
    parser.add_argument('--model-dir',type=Path)
    parser.add_argument('--lexical-orders',type=Path)
    args=parser.parse_args()
    raw=args.fixture.read_bytes()
    if len(raw)>2_000_000:
        raise ValueError('Fixture limit exceeded')
    fixture=json.loads(raw);encoder=None;initialization=None
    if args.model_dir:
        os.environ['HF_HUB_OFFLINE']='1';os.environ['DO_NOT_TRACK']='1';os.environ['HF_HUB_DISABLE_TELEMETRY']='1'
        if not (args.model_dir/'model_optimized.onnx').is_file():
            raise ValueError('Approved local ONNX weights are missing; no automatic download is permitted')
        from fastembed import TextEmbedding
        started=time.monotonic()
        model=TextEmbedding(MODEL,specific_model_path=str(args.model_dir),local_files_only=True,threads=2,providers=['CPUExecutionProvider'])
        initialization=round(time.monotonic()-started,3)
        encoder=lambda texts:[v.tolist() for v in model.embed(texts)]
    lexical_orders=None
    if args.lexical_orders:
        baseline=json.loads(args.lexical_orders.read_text())
        if baseline['fixture_sha256']!=hashlib.sha256(raw).hexdigest():
            raise ValueError('SQL baseline fixture hash mismatch')
        lexical_orders=baseline['orders']
    result=evaluate(fixture,encoder,lexical_orders);result['fixture_sha256']=hashlib.sha256(raw).hexdigest();result['model_initialization_seconds']=initialization
    print(json.dumps(result,indent=2))


if __name__=='__main__':
    main()

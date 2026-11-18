"""Worker-side hybrid retrieval (NEYVU_RETRIEVAL=hybrid on the web service).

The web service cannot reach the embedding and rerank models, which run on this
machine (services/answer/retrieval/embed_service.py, loopback only). So the
answer lease carries a pinned candidate set (`job['retrieval']`, built by
lib/beta/worker-retrieval.ts): keyword ranks plus stored passage vectors. Here
the worker

  1. embeds the question with the local embed service,
  2. scores every candidate passage by cosine (pure Python: the vectors arrive
     with the lease, so this works whether or not Postgres has pgvector),
  3. fuses the keyword and vector source orders with reciprocal rank fusion,
  4. reranks the fused candidates with the local cross-encoder within the
     lease's budget (NEYVU_RERANK_BUDGET_MS on the web service),

and returns the order for the `retrieval.rank` operation. The web service
re-pins the answer's sources in that order, so citations stay bound to the
pinned list. Any failure keeps the keyword order (a reason code is reported;
never question or passage text).

`embed_once` is the backfill: it leases passages that have no vector yet
(`embed.lease`), embeds them locally and stores them (`embed.finish`).
"""
import base64
import json
import math
import os
import socket
import struct
import time
import urllib.error
import urllib.request
from array import array
from urllib.parse import urlparse

FORMAT = 'worker-hybrid/1'
EMBED_TIMEOUT_S = 3.0


class EmbedUnavailable(Exception):
    pass


def embed_url():
    url = os.environ.get('NEYVU_EMBED_URL', 'http://127.0.0.1:8765')
    parsed = urlparse(url)
    # Course text may only go to a loopback service.
    if parsed.scheme != 'http' or parsed.hostname not in ('127.0.0.1', 'localhost', '::1'):
        return None
    return url.rstrip('/')


def post(path, body, timeout):
    url = embed_url()
    if not url:
        raise EmbedUnavailable('embed_url')
    headers = {'Content-Type': 'application/json'}
    token = os.environ.get('NEYVU_EMBED_TOKEN')
    if token:
        headers['Authorization'] = 'Bearer ' + token
    request = urllib.request.Request(url + path, data=json.dumps(body).encode(), headers=headers)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def decode_int8(b64):
    return array('b', base64.b64decode(b64))


def norm(vector):
    return math.sqrt(sum(x * x for x in vector))


def cosine(query, query_norm, vector):
    vector_norm = norm(vector)
    if not query_norm or not vector_norm:
        return 0.0
    return sum(a * b for a, b in zip(query, vector)) / (query_norm * vector_norm)


def reciprocal_rank_fusion(orders, k=60, weights=()):
    # Same as lib/beta/hybrid-search.ts: weighted sum, score desc, then id.
    score = {}
    for o, order in enumerate(orders):
        weight = weights[o] if o < len(weights) else 1.0
        for i, ident in enumerate(order):
            score[ident] = score.get(ident, 0.0) + weight / (k + i + 1)
    return sorted(score.items(), key=lambda item: (-item[1], item[0]))


def authority_order(fused, candidates, boost):
    """Course material ahead of student notes in the fused order (same rule as
    lib/beta/hybrid-search.ts authorityBoosted). fused: [(id, score)] in order;
    candidates carry the server-computed 'authority' tier (2 course material,
    0 student note). boost 0 keeps the fused order."""
    if not boost:
        return [ident for ident, _ in fused]
    tier = lambda ident: candidates.get(ident, {}).get('authority', 2) if isinstance(candidates.get(ident, {}).get('authority', 2), int) else 2
    ranked = sorted(enumerate(fused), key=lambda item: (-item[1][1] * (1 + boost * tier(item[1][0]) / 2), item[0]))
    return [ident for _, (ident, _) in ranked]


def authority_rerank(head, values, candidates, weight):
    """Reranked head: score + weight*tier, then one course-material source kept in
    the first three when the head had one (same rule as hybrid-search.ts authorityRerank)."""
    tier = lambda ident: candidates.get(ident, {}).get('authority', 2) if isinstance(candidates.get(ident, {}).get('authority', 2), int) else 2
    order = [ident for _, _, ident in sorted((-(v + weight * tier(ident)), i, ident) for i, (ident, v) in enumerate(zip(head, values)))]
    if weight and len(order) > 3 and not any(tier(ident) == 2 for ident in order[:3]):
        k = next((i for i, ident in enumerate(order) if tier(ident) == 2), None)
        if k is not None and k > 2:
            order.insert(2, order.pop(k))
    return order


def _vectors(out, count):
    vectors = out.get('vectors') if isinstance(out, dict) else None
    dim = out.get('dim') if isinstance(out, dict) else None
    if not isinstance(vectors, list) or len(vectors) != count or not isinstance(dim, int):
        raise EmbedUnavailable('invalid')
    for vector in vectors:
        if not isinstance(vector, list) or len(vector) != dim or not all(isinstance(x, (int, float)) and math.isfinite(x) for x in vector):
            raise EmbedUnavailable('invalid')
    return vectors, dim


def _ms(start, clock):
    return int(round((clock() - start) * 1000))


def rank(job, call=post, clock=time.monotonic):
    """Returns {'order': [...], 'stages': {...}} for retrieval.rank, or None."""
    plan = job.get('retrieval')
    if not isinstance(plan, dict) or plan.get('format') != FORMAT:
        return None
    candidates = [c for c in plan.get('candidates') or [] if isinstance(c, dict) and isinstance(c.get('source_id'), str)]
    if not candidates:
        return None
    by_id = {c['source_id']: c for c in candidates}
    keyword = [c['source_id'] for c in sorted((c for c in candidates if isinstance(c.get('keyword_rank'), int)), key=lambda c: c['keyword_rank'])]
    question = str(plan.get('question') or job.get('retrieval_question') or job.get('question') or '')[:3000]
    stages = {}
    best = {}

    def result(order):
        return {'order': [{'source_id': ident, 'passage_id': (best.get(ident) or (0, {}))[1].get('id')} for ident in order], 'stages': stages}

    start = clock()
    try:
        out = call('/embed', {'texts': [question], 'kind': 'query'}, EMBED_TIMEOUT_S)
        vectors, _dim = _vectors(out, 1)
    except Exception:
        stages['fallback'] = 'embed_unavailable'
        return result(keyword)
    stages['embed_ms'] = _ms(start, clock)
    if out.get('model') != plan.get('model'):
        # Stored passage vectors were written by another model: incomparable.
        stages['fallback'] = 'model_mismatch'
        return result(keyword)
    query = vectors[0]
    query_norm = norm(query)

    start = clock()
    for candidate in candidates:
        for passage in candidate.get('passages') or []:
            try:
                vector = decode_int8(passage['e'])
            except Exception:
                continue
            if len(vector) != len(query):
                continue
            similarity = cosine(query, query_norm, vector)
            if candidate['source_id'] not in best or similarity > best[candidate['source_id']][0]:
                best[candidate['source_id']] = (similarity, passage)
    vector_order = sorted(best, key=lambda ident: (-best[ident][0], ident))
    stages['vector'] = {'ids': vector_order[:200], 'ms': _ms(start, clock), 'model': str(plan.get('model') or '')}
    scores = {}
    for i, ident in enumerate(vector_order):
        similarity, passage = best[ident]
        scores[ident] = {'vector_rank': i + 1, 'similarity': round(similarity, 4), 'passage_id': passage.get('id'),
                         'ordinal': passage.get('ordinal'), 'section': passage.get('section')}
    stages['scores'] = scores
    if not vector_order:
        stages['fallback'] = 'no_vectors'
        return result(keyword)

    k = plan.get('rrf_k') if isinstance(plan.get('rrf_k'), int) and plan.get('rrf_k') > 0 else 60
    limit = plan.get('fuse_limit') if isinstance(plan.get('fuse_limit'), int) and plan.get('fuse_limit') > 0 else 16
    weight = plan.get('vector_weight') if isinstance(plan.get('vector_weight'), (int, float)) and 0 <= plan.get('vector_weight') <= 10 else 1.0
    # Older leases carry no authority fields: both default to 0 (previous behaviour).
    boost = plan.get('authority_boost') if isinstance(plan.get('authority_boost'), (int, float)) and 0 <= plan.get('authority_boost') <= 1 else 0.0
    rerank_authority = plan.get('rerank_authority') if isinstance(plan.get('rerank_authority'), (int, float)) and 0 <= plan.get('rerank_authority') <= 5 else 0.0
    fused = authority_order(reciprocal_rank_fusion([keyword, vector_order], k, (1.0, weight))[:limit], by_id, boost)
    stages['fused'] = fused
    order = fused

    if not plan.get('rerank'):
        stages['rerank'] = {'applied': False, 'ms': 0, 'reason': 'disabled'}
    elif len(fused) > 1:
        # Intelligence defaults: only the head of the fused order is reranked
        # (NEYVU_RERANK_CANDIDATES, 8) within NEYVU_RERANK_BUDGET_MS (300); the
        # tail keeps its fused order.
        budget = plan.get('budget_ms') if isinstance(plan.get('budget_ms'), (int, float)) and 50 <= plan.get('budget_ms') <= 10000 else 300
        head_n = plan.get('rerank_candidates') if isinstance(plan.get('rerank_candidates'), int) and 1 <= plan.get('rerank_candidates') <= 16 else 8
        chars = plan.get('rerank_chars') if isinstance(plan.get('rerank_chars'), int) and 200 <= plan.get('rerank_chars') <= 4000 else 1000
        head, tail = fused[:head_n], fused[head_n:]
        excerpts = {s.get('id'): s.get('excerpt') for s in job.get('sources') or [] if isinstance(s, dict)}
        documents = []
        for ident in head:
            candidate = by_id[ident]
            passage = (best.get(ident) or (0, None))[1] or ((candidate.get('passages') or [None])[0])
            header = (passage or {}).get('header') or 'Document: ' + str(candidate.get('title') or '')
            body = (passage or {}).get('text') or excerpts.get(ident) or ''
            documents.append((header + '\n\n' + str(body)[:chars]) if header else str(body)[:chars])
        start = clock()
        try:
            out = call('/rerank', {'query': question, 'documents': documents, 'budget_ms': budget}, budget / 1000.0)
            values = out.get('scores') if isinstance(out, dict) else None
            if not isinstance(values, list) or len(values) != len(head) or not all(isinstance(x, (int, float)) and math.isfinite(x) for x in values):
                raise EmbedUnavailable('invalid')
            elapsed = _ms(start, clock)
            if elapsed > budget:
                stages['rerank'] = {'applied': False, 'ms': elapsed, 'reason': 'budget_exceeded'}
            else:
                for ident, value in zip(head, values):
                    scores.setdefault(ident, {})['rerank_score'] = round(value, 4)
                order = authority_rerank(head, values, by_id, rerank_authority) + tail
                stages['rerank'] = {'applied': True, 'ms': elapsed, 'model': str(out.get('model') or 'local-cross-encoder')[:160]}
        except (socket.timeout, TimeoutError):
            stages['rerank'] = {'applied': False, 'ms': _ms(start, clock), 'reason': 'budget_exceeded'}
        except urllib.error.HTTPError as error:
            # 408: the service dropped work queued past half the budget.
            stages['rerank'] = {'applied': False, 'ms': _ms(start, clock), 'reason': 'budget_exceeded' if error.code == 408 else 'unavailable'}
        except urllib.error.URLError as error:
            timed_out = isinstance(getattr(error, 'reason', None), (socket.timeout, TimeoutError))
            stages['rerank'] = {'applied': False, 'ms': _ms(start, clock), 'reason': 'budget_exceeded' if timed_out else 'unavailable'}
        except Exception:
            stages['rerank'] = {'applied': False, 'ms': _ms(start, clock), 'reason': 'unavailable'}
    return result(order)


def apply(job, reply):
    """Adopts the re-pinned sources from retrieval.rank."""
    job = dict(job)
    job.pop('retrieval', None)
    if isinstance(reply, dict) and reply.get('ranked') is True and isinstance(reply.get('sources'), list):
        job['sources'] = reply['sources']
        if 'source_readings' in reply:
            job['source_readings'] = reply['source_readings']
    return job


_next_embed = [0.0]


def embed_once(config, api, call=post, clock=time.monotonic):
    """Backfill: embed one leased batch of passages that have no vector yet."""
    now = clock()
    if now < _next_embed[0] or not embed_url():
        return False
    job = api(config, {'op': 'embed.lease'}, timeout=10).get('job')
    if not job:
        _next_embed[0] = now + 60
        return False
    passages = [p for p in job.get('passages') or [] if isinstance(p, dict) and isinstance(p.get('text'), str)]
    if not passages:
        _next_embed[0] = now + 60
        return False
    try:
        out = call('/embed', {'texts': [p['text'] for p in passages], 'kind': 'passage'}, 120)
        vectors, dim = _vectors(out, len(passages))
    except Exception:
        _next_embed[0] = now + 120
        return False
    if out.get('model') != job.get('model'):
        _next_embed[0] = now + 600
        return False
    items = [{'id': p['id'], 'sha256': p['sha256'], 'dim': dim, 'v': base64.b64encode(struct.pack('<%df' % dim, *v)).decode()}
             for p, v in zip(passages, vectors)]
    stored = api(config, {'op': 'embed.finish', 'lease': job.get('lease'), 'user': job.get('user'), 'model': job.get('model'), 'items': items}, timeout=30).get('stored', 0)
    if not stored:
        _next_embed[0] = now + 300
    return bool(stored)

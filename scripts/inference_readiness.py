"""Inspect local inference readiness without leasing a job or loading a model.

Installation and a responsive HTTP server do not prove usable inference. The
optional generation check only runs when the expected model/context is already
loaded. This operator tool does not change production heartbeat semantics.
"""
import argparse
import json
import time
import urllib.request
from urllib.parse import urlsplit

MODEL = 'qwen3:4b-instruct'
DIGEST = '0edcdef34593eac1aa2be9c7d06c432dcf81945adca5eca2f27662c18f168ba0'


def local_origin(value):
    parsed = urlsplit(value)
    if (parsed.scheme != 'http' or parsed.hostname != '127.0.0.1'
            or not parsed.port or parsed.username or parsed.password
            or parsed.path not in ('', '/') or parsed.query or parsed.fragment):
        raise ValueError('Only an explicit loopback inference origin is supported')
    return value.rstrip('/')


def request_json(origin, path, body=None):
    request = urllib.request.Request(origin + path, method='POST' if body is not None else 'GET',
                                     data=None if body is None else json.dumps(body).encode(),
                                     headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=15 if body is not None else 3) as response:
        raw = response.read(262145)
        if len(raw) > 262144:
            raise ValueError('Response limit exceeded')
        result = json.loads(raw)
        if not isinstance(result, dict):
            raise ValueError('Invalid response')
        return result


def inspect(origin='http://127.0.0.1:11435', verify_generation=False, read=request_json):
    origin = local_origin(origin)
    result = {'model': MODEL, 'expected_digest': DIGEST, 'state': 'unreachable',
              'installed': False, 'loaded': False, 'generation_verified': False,
              'ready': False}
    started = time.monotonic()
    try:
        tags = read(origin, '/api/tags')
        if not isinstance(tags.get('models'), list) or any(not isinstance(m, dict) for m in tags['models']):
            raise ValueError('Invalid model inventory')
        installed = next((m for m in tags['models'] if m.get('name') == MODEL), None)
        if not installed:
            result['state'] = 'not_installed'
            return result
        if installed.get('digest') != DIGEST:
            result['state'] = 'unexpected_model_digest'
            return result
        result['installed'] = True
        processes = read(origin, '/api/ps')
        if not isinstance(processes.get('models'), list) or any(not isinstance(m, dict) for m in processes['models']):
            raise ValueError('Invalid loaded model inventory')
        loaded = next((m for m in processes['models'] if m.get('name') == MODEL
                       and m.get('digest') == DIGEST), None)
        if not loaded:
            result['state'] = 'installed_not_loaded'
            return result
        if loaded.get('context_length') != 8192:
            result['state'] = 'different_context'
            return result
        result.update(loaded=True, state='loaded_not_verified')
        if verify_generation:
            answer = read(origin, '/api/chat', {
                'model': MODEL, 'messages': [{'role': 'user', 'content': 'Reply with the single word Ready and nothing else.'}],
                'stream': False, 'think': False, 'keep_alive': -1,
                'options': {'temperature': 0, 'num_ctx': 8192, 'num_predict': 8}})
            if (answer.get('done') is True and answer.get('done_reason') == 'stop'
                    and answer.get('message', {}).get('content', '').strip() == 'Ready'):
                result.update(generation_verified=True, ready=True, state='generation_verified')
            else:
                result['state'] = 'generation_unverified'
        return result
    except (OSError, ValueError, KeyError, TypeError, StopIteration):
        result['state'] = 'probe_failed' if result['installed'] else 'unreachable'
        return result
    finally:
        result['elapsed_seconds'] = round(time.monotonic() - started, 3)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--origin', default='http://127.0.0.1:11435')
    parser.add_argument('--verify-generation', action='store_true')
    args = parser.parse_args()
    print(json.dumps(inspect(args.origin, args.verify_generation)))

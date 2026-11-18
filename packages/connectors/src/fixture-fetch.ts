// A `fetch` replacement that answers only from fixture responses. Any request
// that was not recorded, any non-GET method, or a missing/foreign bearer token
// fails loudly, so tests prove the connectors stay read-only and in scope.
import {readFileSync} from 'node:fs';

export type Recorded = {status: number; headers: Record<string, string>; body: unknown};
export type FixtureFile = {origin: string; accessToken: string; expectedIdentity: string; responses: Record<string, Recorded>; [k: string]: unknown};
export type RequestLog = {method: string; url: string}[];

export function loadFixture(path: string): FixtureFile {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function fixtureFetch(fixture: FixtureFile, log: RequestLog = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    log.push({method, url: url.href});
    if (method !== 'GET') throw new Error(`fixture: write method ${method} refused`);
    if (url.origin !== fixture.origin) throw new Error(`fixture: foreign origin ${url.origin}`);
    const auth = new Headers(init?.headers).get('authorization');
    if (auth !== `Bearer ${fixture.accessToken}`) return new Response('{}', {status: 401, headers: {'content-type': 'application/json'}});
    const hit = fixture.responses[url.pathname + url.search];
    if (!hit) return new Response(JSON.stringify({errors: [{message: 'not recorded'}]}), {status: 404, headers: {'content-type': 'application/json'}});
    const text = JSON.stringify(hit.body);
    return new Response(text, {status: hit.status, headers: {...hit.headers, 'content-length': String(Buffer.byteLength(text))}});
  }) as typeof fetch;
}

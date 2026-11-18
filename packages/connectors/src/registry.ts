// Builds connectors from a registry file. Every entry is a reviewed institution
// record (origin, provider, API versions). In this prototype every entry points
// at a fixture; a live entry would supply an OAuth-issued token from a server-side
// grant store instead (not built here).
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {LmsError} from './read-only';
import {CanvasConnector} from './connectors/canvas';
import {BrightspaceConnector} from './connectors/brightspace';
import {MoodleConnector} from './connectors/moodle';
import {fixtureFetch, loadFixture, type RequestLog} from './fixture-fetch';
import type {LmsConnector} from './types';

type Entry = {id: string; provider: 'canvas' | 'brightspace' | 'moodle'; fixture: string; displayTimeZone?: string};

export function connectorsFromRegistry(registryPath: string, opts: {log?: RequestLog; now?: () => string} = {}): LmsConnector[] {
  const base = dirname(resolve(registryPath));
  const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as {connectors: Entry[]};
  const ids = new Set<string>();
  return registry.connectors.map(e => {
    if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(e.id) || ids.has(e.id)) throw new LmsError('configuration');
    ids.add(e.id);
    const path = resolve(base, e.fixture);
    if (e.provider === 'moodle') {
      const f = JSON.parse(readFileSync(path, 'utf8'));
      return new MoodleConnector({id: e.id, captures: f.captures, expectedIdentity: f.expectedIdentity, displayTimeZone: e.displayTimeZone, now: opts.now});
    }
    const f = loadFixture(path);
    const common = {id: e.id, origin: f.origin, approvedOrigins: [f.origin], accessToken: f.accessToken, expectedIdentity: f.expectedIdentity, fetch: fixtureFetch(f, opts.log), now: opts.now};
    if (e.provider === 'canvas') return new CanvasConnector(common);
    if (e.provider === 'brightspace') return new BrightspaceConnector({...common, lpVersion: String(f.lpVersion), leVersion: String(f.leVersion)});
    throw new LmsError('configuration');
  });
}

/** Resolve "<connectorId>/<courseId>" to its connector. */
export function resolveCourse(connectors: LmsConnector[], courseRef: string): {connector: LmsConnector; courseId: string} {
  const m = /^([a-z0-9][a-z0-9-]{0,40})\/([1-9]\d{0,18})$/.exec(courseRef);
  const connector = m && connectors.find(c => c.id === m[1]);
  if (!m || !connector) throw new LmsError('not_found');
  return {connector, courseId: m[2]};
}

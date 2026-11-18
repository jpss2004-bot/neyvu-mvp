import {createHash} from 'node:crypto';
import type {Provenance, Provider} from './types';

/** JSON with object keys sorted at every level, so equal records hash equally. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return '{' + entries.map(([k, v]) => JSON.stringify(k) + ':' + canonicalJson(v)).join(',') + '}';
  }
  return JSON.stringify(value ?? null);
}

export function sha256(text: string): string {
  return 'sha256:' + createHash('sha256').update(text, 'utf8').digest('hex');
}

export function provenance(provider: Provider, raw: unknown, fields: {sourceUrl: string; readFrom: string; version: unknown; observedAt: string}): Provenance {
  return {
    provider,
    sourceUrl: fields.sourceUrl,
    readFrom: fields.readFrom,
    version: typeof fields.version === 'string' && fields.version ? fields.version : null,
    contentHash: sha256(canonicalJson(raw)),
    observedAt: fields.observedAt,
  };
}

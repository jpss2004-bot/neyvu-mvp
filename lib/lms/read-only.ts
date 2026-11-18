// Connector preview core. No public route, credential store or production import
// calls this module yet. Origins must come from an approved institution registry,
// never from a student-supplied URL. OAuth grants stay on the server.
export type Provider = 'canvas' | 'brightspace';
export type Row = Record<string, unknown>;
export type Page = {items: Row[]; complete: boolean; continuation: string | null};
export class LmsError extends Error {
 constructor(public code: 'configuration'|'identity_changed'|'reauthorize'|'forbidden'|'rate_limited'|'temporary'|'invalid_response'|'boundary'|'budget', public retryAfter: number|null = null) {
  super(`LMS read could not finish: ${code}`);
 }
}
export function row(value: unknown): Row {
 if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LmsError('invalid_response');
 return value as Row;
}
export function rows(value: unknown): Row[] {
 if (!Array.isArray(value)) throw new LmsError('invalid_response');
 return value.map(row);
}
export function id(value: unknown): string {
 if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new LmsError('invalid_response');
 if (!['string','number'].includes(typeof value) || !/^[1-9]\d{0,18}$/.test(String(value))) throw new LmsError('invalid_response');
 return String(value);
}
export function label(value: unknown): string {
 if (typeof value !== 'string' || !value.trim() || value.length > 1000) throw new LmsError('invalid_response');
 return value.trim();
}
export function explicitDate(value: unknown): string|null {
 if (value === null || value === undefined) return null;
 // Never silently assign the server timezone to an unzoned/date-only value.
 if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) throw new LmsError('invalid_response');
 const [year,month,day]=value.slice(0,10).split('-').map(Number);
 if(month<1||month>12||day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate())throw new LmsError('invalid_response');
 return value;
}
export function origin(value: string): string {
 let u: URL; try { u = new URL(value); } catch { throw new LmsError('configuration'); }
 if (u.protocol !== 'https:' || u.username || u.password || u.port || u.pathname !== '/' || u.search || u.hash || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname) || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/i.test(u.hostname)) throw new LmsError('configuration');
 return u.origin;
}
export type ReadConfig = {origin: string; approvedOrigins: readonly string[]; accessToken: string; fetch?: typeof fetch; maxPages?: number};
export class ReadOnlyLms {
 readonly origin: string;
 readonly maxPages: number;
 private readonly token: string;
 private readonly fetcher: typeof fetch;
 constructor(config: ReadConfig) {
  this.origin = origin(config.origin);
  if (!config.approvedOrigins.map(origin).includes(this.origin) || !config.accessToken || config.accessToken.length > 4096 || /[\r\n]/.test(config.accessToken)) throw new LmsError('configuration');
  this.maxPages = config.maxPages ?? 10;
  if (!Number.isInteger(this.maxPages) || this.maxPages < 1 || this.maxPages > 25) throw new LmsError('configuration');
  this.token = config.accessToken; this.fetcher = config.fetch ?? fetch;
 }
 private scopedURL(path: string, prefix: string): URL {
  let u: URL; try { u = new URL(path, this.origin); } catch { throw new LmsError('boundary'); }
  if (u.origin !== this.origin || u.username || u.password || u.hash || ![prefix,prefix+'.json'].includes(u.pathname) || /%2f|%5c/i.test(u.pathname) || [...u.searchParams.keys()].some(k => /token|secret|password|masquerade|as_user|action|sesskey/i.test(k))) throw new LmsError('boundary');
  return u;
 }
 async get(path: string, prefix: string): Promise<{data: unknown; headers: Headers}> {
  const url = this.scopedURL(path, prefix), abort = new AbortController(), timer = setTimeout(() => abort.abort(), 15000);
  try {
   const response = await this.fetcher(url.href, {method:'GET', headers:{Authorization:`Bearer ${this.token}`, Accept:'application/json'}, redirect:'error', credentials:'omit', cache:'no-store', signal:abort.signal});
   if (response.status === 401) throw new LmsError('reauthorize');
   if (response.status === 403) throw new LmsError('forbidden');
   if (response.status === 429) {
    const n = Number(response.headers.get('retry-after'));
    throw new LmsError('rate_limited', Number.isFinite(n) && n > 0 ? Math.min(n,3600) : null);
   }
   if (response.status >= 500) throw new LmsError('temporary');
   if (!response.ok || response.redirected || response.status !== 200 || !response.headers.get('content-type')?.includes('application/json')) throw new LmsError('invalid_response');
   if (response.url && new URL(response.url).origin !== this.origin) throw new LmsError('boundary');
   const length = Number(response.headers.get('content-length') || 0);
   if (!Number.isFinite(length) || length > 2_000_000 || !response.body) throw new LmsError('invalid_response');
   const reader = response.body.getReader(), decoder = new TextDecoder('utf-8',{fatal:true}); let bytes = 0, text = '';
   try {
    while (true) {
     const part = await reader.read(); if (part.done) break;
     bytes += part.value.byteLength; if (bytes > 2_000_000) throw new LmsError('invalid_response');
     text += decoder.decode(part.value,{stream:true});
    }
    text += decoder.decode();
    let data:unknown;try{data=JSON.parse(text);}catch{throw new LmsError('invalid_response');}
    return {data, headers:response.headers};
   } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  } catch (error) {
   if (error instanceof LmsError) throw error;
   // Do not surface provider bodies/URLs, tokens or raw network exceptions.
   throw new LmsError('temporary');
  } finally { clearTimeout(timer); }
 }
 async list(path: string, prefix: string, decode: (data: unknown, headers: Headers, current: string) => {items: Row[]; next: string|null}): Promise<Page> {
  const items: Row[] = [], seen = new Set<string>(); let next: string|null = path;
  for (let n=0; next && n<this.maxPages; n++) {
   const current = this.scopedURL(next,prefix).href;
   if (seen.has(current)) throw new LmsError('invalid_response'); seen.add(current);
   const response = await this.get(current,prefix), page = decode(response.data,response.headers,current);
   if (items.length + page.items.length > 5000) throw new LmsError('budget');
   items.push(...page.items); next = page.next;
   if (next) this.scopedURL(next,prefix);
  }
  return {items, complete:next === null, continuation:next};
 }
}
export type Course = {provider:Provider; origin:string; externalId:string; code:string; title:string};
export type Assignment = {provider:Provider; origin:string; identityId:string; courseId:string; externalId:string; title:string; originalUrl:string; observedAt:string; instructions:string; instructionsFormat:'html'|'text'; dueAt:string|null; submission:'unverified'; grade:'unverified'};
export function canvasPage(data:unknown, headers:Headers) {
 const links = headers.get('link') || '', pattern=/<([^>]+)>\s*;\s*rel="([^"]+)"(?:\s*;\s*[^,]+)?\s*(?:,|$)/g;
 const matches = [...links.matchAll(pattern)].filter(m => m[2].split(/\s+/).includes('next'));
 if (matches.length > 1 || links.replace(pattern,'').trim()) throw new LmsError('invalid_response');
 return {items:rows(data), next:matches[0]?.[1] || null};
}
export function brightspacePage(data:unknown, _headers:Headers, current:string) {
 const value = row(data), paging = row(value.PagingInfo), items = rows(value.Items);
 if (typeof paging.HasMoreItems !== 'boolean') throw new LmsError('invalid_response');
 if (!paging.HasMoreItems) return {items,next:null};
 if (typeof paging.Bookmark !== 'string' || !paging.Bookmark || paging.Bookmark.length > 2000) throw new LmsError('invalid_response');
 const next = new URL(current); next.searchParams.set('bookmark',paging.Bookmark);
 return {items,next:next.href};
}

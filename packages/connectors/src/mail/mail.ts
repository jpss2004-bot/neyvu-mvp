// C3/C4 read-only mail connectors (Microsoft Graph Mail.Read, Gmail
// gmail.readonly). Only messages from senders the learner confirmed for a
// course are returned; every other message is dropped inside the connector and
// never leaves it. No send, draft, label, move or delete call exists here.
import {createHash} from 'node:crypto';
import {LmsError} from '../read-only';
import {provenance} from '../provenance';
import type {FileBody, Listing, Provenance} from '../types';

export type MailProvider = 'outlook' | 'gmail';

export type MailAttachment = {id: string; filename: string; mime: string; size: number};

export type MailMessage = {
  provider: MailProvider;
  externalId: string;
  threadId: string | null;
  from: {address: string; name: string};
  subject: string;
  /** ISO 8601 UTC. */
  receivedAt: string;
  /** Opens the message in the learner's own mailbox. */
  webLink: string;
  bodyText: string;
  attachments: MailAttachment[];
  role: 'untrusted course material';
  provenance: Provenance;
};

export interface MailConnector {
  readonly provider: MailProvider;
  /** Messages from these confirmed senders only, newest first, received after `since` when given. */
  listMessagesFrom(senders: string[], since: string | null): Promise<Listing<MailMessage> & {discarded: number}>;
  fetchAttachment(messageId: string, attachment: MailAttachment): Promise<FileBody>;
}

const MAX_JSON = 8_000_000, MAX_ATTACHMENT = 25 * 1024 * 1024, MAX_PAGES = 10;

export function normalizeAddress(value: string): string {
  const a = (value || '').trim().toLowerCase();
  if (a.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(a)) throw new LmsError('configuration');
  return a;
}

/** The single matching rule: exact address equality with a confirmed sender. */
export function isConfirmedSender(address: string, senders: string[]): boolean {
  try { const a = normalizeAddress(address); return senders.some(s => normalizeAddress(s) === a); } catch { return false; }
}

const stripHtml = (html: string) => html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();

async function guardedGet(url: string, token: string, allowedOrigin: string, fetcher: typeof fetch, extraHeaders: Record<string, string> = {}): Promise<any> {
  const u = new URL(url);
  if (u.origin !== allowedOrigin || u.username || u.password) throw new LmsError('boundary');
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 20000);
  try {
    const r = await fetcher(u.href, {method: 'GET', headers: {Authorization: `Bearer ${token}`, Accept: 'application/json', ...extraHeaders}, redirect: 'error', credentials: 'omit', cache: 'no-store', signal: abort.signal});
    if (r.status === 401) throw new LmsError('reauthorize');
    if (r.status === 403) throw new LmsError('forbidden');
    if (r.status === 404) throw new LmsError('not_found');
    if (r.status === 429) throw new LmsError('rate_limited', Number(r.headers.get('retry-after')) || null);
    if (r.status >= 500) throw new LmsError('temporary');
    if (r.status !== 200) throw new LmsError('invalid_response');
    const text = await r.text();
    if (text.length > MAX_JSON) throw new LmsError('budget');
    try { return JSON.parse(text); } catch { throw new LmsError('invalid_response'); }
  } catch (e) {
    if (e instanceof LmsError) throw e;
    throw new LmsError('temporary');
  } finally { clearTimeout(timer); }
}

const b64urlBytes = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const iso = (v: unknown) => { const t = Date.parse(String(v)); if (!Number.isFinite(t)) throw new LmsError('invalid_response'); return new Date(t).toISOString(); };

// ---------------------------------------------------------------- Outlook

export class OutlookMailConnector implements MailConnector {
  readonly provider = 'outlook' as const;
  static readonly origin = 'https://graph.microsoft.com';
  private readonly token: string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => string;
  constructor(config: {accessToken: string; fetch?: typeof fetch; now?: () => string}) {
    if (!config.accessToken || /[\r\n]/.test(config.accessToken)) throw new LmsError('configuration');
    this.token = config.accessToken; this.fetcher = config.fetch ?? fetch; this.now = config.now ?? (() => new Date().toISOString());
  }

  async listMessagesFrom(senders: string[], since: string | null) {
    const list = [...new Set(senders.map(normalizeAddress))];
    if (!list.length) return {items: [], complete: true, issues: [], discarded: 0};
    if (list.length > 20) throw new LmsError('budget');
    const filter = '(' + list.map(a => `from/emailAddress/address eq '${a.replace(/'/g, "''")}'`).join(' or ') + ')' + (since ? ` and receivedDateTime ge ${iso(since)}` : '');
    const u = new URL(OutlookMailConnector.origin + '/v1.0/me/messages');
    u.searchParams.set('$filter', filter);
    u.searchParams.set('$select', 'id,conversationId,subject,from,receivedDateTime,webLink,body,hasAttachments');
    u.searchParams.set('$top', '50');
    const observedAt = this.now(), items: MailMessage[] = [];
    let next: string | null = u.href, pages = 0, discarded = 0;
    while (next && pages++ < MAX_PAGES) {
      const data: any = await guardedGet(next, this.token, OutlookMailConnector.origin, this.fetcher, {Prefer: 'outlook.body-content-type="text"'});
      for (const m of data.value || []) {
        const address = m.from?.emailAddress?.address || '';
        // Graph already filtered; re-check locally so a provider quirk can never widen what is kept.
        if (!isConfirmedSender(address, list)) { discarded++; continue; }
        const attachments: MailAttachment[] = m.hasAttachments ? await this.attachments(String(m.id)) : [];
        const body = m.body?.contentType === 'html' ? stripHtml(String(m.body?.content || '')) : String(m.body?.content || '');
        items.push({provider: 'outlook', externalId: String(m.id), threadId: m.conversationId ? String(m.conversationId) : null, from: {address: normalizeAddress(address), name: String(m.from?.emailAddress?.name || '')},
          subject: String(m.subject || '(no subject)').slice(0, 500), receivedAt: iso(m.receivedDateTime), webLink: String(m.webLink || ''), bodyText: body.slice(0, 200_000), attachments,
          role: 'untrusted course material', provenance: provenance('outlook', m, {sourceUrl: String(m.webLink || ''), readFrom: 'graph /me/messages', version: m.receivedDateTime, observedAt})});
      }
      next = typeof data['@odata.nextLink'] === 'string' ? data['@odata.nextLink'] : null;
    }
    return {items, complete: !next, issues: next ? ['Outlook read stopped at the page budget; older course mail may be missing.'] : [], discarded};
  }

  private async attachments(messageId: string): Promise<MailAttachment[]> {
    const u = new URL(`${OutlookMailConnector.origin}/v1.0/me/messages/${encodeURIComponent(messageId)}/attachments`);
    u.searchParams.set('$select', 'id,name,contentType,size');
    const data: any = await guardedGet(u.href, this.token, OutlookMailConnector.origin, this.fetcher);
    return (data.value || []).filter((a: any) => a['@odata.type'] !== '#microsoft.graph.itemAttachment' && a['@odata.type'] !== '#microsoft.graph.referenceAttachment')
      .map((a: any) => ({id: String(a.id), filename: String(a.name || 'attachment').slice(0, 255), mime: String(a.contentType || 'application/octet-stream'), size: Number(a.size) || 0}));
  }

  async fetchAttachment(messageId: string, attachment: MailAttachment): Promise<FileBody> {
    if (attachment.size > MAX_ATTACHMENT) throw new LmsError('budget');
    const u = `${OutlookMailConnector.origin}/v1.0/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachment.id)}`;
    const data: any = await guardedGet(u, this.token, OutlookMailConnector.origin, this.fetcher);
    if (typeof data.contentBytes !== 'string') throw new LmsError('invalid_response');
    const bytes = new Uint8Array(Buffer.from(data.contentBytes, 'base64'));
    if (bytes.byteLength > MAX_ATTACHMENT) throw new LmsError('budget');
    return {filename: attachment.filename, mime: attachment.mime, bytes, sha256: sha(bytes),
      provenance: provenance('outlook', {id: attachment.id, name: attachment.filename}, {sourceUrl: '', readFrom: 'graph attachment', version: null, observedAt: this.now()})};
  }
}

// ---------------------------------------------------------------- Gmail

type GmailPart = {mimeType?: string; filename?: string; headers?: {name: string; value: string}[]; body?: {data?: string; attachmentId?: string; size?: number}; parts?: GmailPart[]};

export class GmailConnector implements MailConnector {
  readonly provider = 'gmail' as const;
  static readonly origin = 'https://gmail.googleapis.com';
  private readonly token: string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => string;
  constructor(config: {accessToken: string; fetch?: typeof fetch; now?: () => string}) {
    if (!config.accessToken || /[\r\n]/.test(config.accessToken)) throw new LmsError('configuration');
    this.token = config.accessToken; this.fetcher = config.fetch ?? fetch; this.now = config.now ?? (() => new Date().toISOString());
  }

  private walk(part: GmailPart, out: {text: string[]; html: string[]; attachments: MailAttachment[]}) {
    if (part.filename && part.body?.attachmentId) out.attachments.push({id: part.body.attachmentId, filename: part.filename.slice(0, 255), mime: part.mimeType || 'application/octet-stream', size: part.body.size || 0});
    else if (part.mimeType === 'text/plain' && part.body?.data) out.text.push(b64urlBytes(part.body.data).toString('utf8'));
    else if (part.mimeType === 'text/html' && part.body?.data) out.html.push(b64urlBytes(part.body.data).toString('utf8'));
    for (const p of part.parts || []) this.walk(p, out);
  }

  async listMessagesFrom(senders: string[], since: string | null) {
    const list = [...new Set(senders.map(normalizeAddress))];
    if (!list.length) return {items: [], complete: true, issues: [], discarded: 0};
    if (list.length > 20) throw new LmsError('budget');
    const q = `from:(${list.join(' OR ')})` + (since ? ` after:${Math.floor(Date.parse(iso(since)) / 1000)}` : '');
    const observedAt = this.now(), items: MailMessage[] = [];
    let pageToken: string | null = null, pages = 0, discarded = 0, more = true;
    while (more && pages++ < MAX_PAGES) {
      const u = new URL(GmailConnector.origin + '/gmail/v1/users/me/messages');
      u.searchParams.set('q', q); u.searchParams.set('maxResults', '50');
      if (pageToken) u.searchParams.set('pageToken', pageToken);
      const data: any = await guardedGet(u.href, this.token, GmailConnector.origin, this.fetcher);
      for (const ref of data.messages || []) {
        const mu = new URL(`${GmailConnector.origin}/gmail/v1/users/me/messages/${encodeURIComponent(String(ref.id))}`);
        mu.searchParams.set('format', 'full');
        const m: any = await guardedGet(mu.href, this.token, GmailConnector.origin, this.fetcher);
        const headers = Object.fromEntries((m.payload?.headers || []).map((h: any) => [String(h.name).toLowerCase(), String(h.value)]));
        const fromHeader = headers.from || '', address = (/<([^>]+)>/.exec(fromHeader)?.[1] || fromHeader).trim();
        if (!isConfirmedSender(address, list)) { discarded++; continue; }
        const parts = {text: [] as string[], html: [] as string[], attachments: [] as MailAttachment[]};
        this.walk(m.payload || {}, parts);
        const body = parts.text.length ? parts.text.join('\n') : stripHtml(parts.html.join('\n'));
        const receivedAt = m.internalDate ? new Date(Number(m.internalDate)).toISOString() : iso(headers.date);
        const webLink = `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(String(m.id))}`;
        items.push({provider: 'gmail', externalId: String(m.id), threadId: m.threadId ? String(m.threadId) : null,
          from: {address: normalizeAddress(address), name: fromHeader.replace(/<[^>]+>/, '').replace(/"/g, '').trim()}, subject: String(headers.subject || '(no subject)').slice(0, 500),
          receivedAt, webLink, bodyText: body.slice(0, 200_000), attachments: parts.attachments, role: 'untrusted course material',
          provenance: provenance('gmail', {id: m.id, historyId: m.historyId, internalDate: m.internalDate}, {sourceUrl: webLink, readFrom: 'gmail users.messages.get', version: m.historyId ? String(m.historyId) : null, observedAt})});
      }
      pageToken = typeof data.nextPageToken === 'string' ? data.nextPageToken : null;
      more = !!pageToken;
    }
    return {items, complete: !more, issues: more ? ['Gmail read stopped at the page budget; older course mail may be missing.'] : [], discarded};
  }

  async fetchAttachment(messageId: string, attachment: MailAttachment): Promise<FileBody> {
    if (attachment.size > MAX_ATTACHMENT) throw new LmsError('budget');
    const u = `${GmailConnector.origin}/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachment.id)}`;
    const data: any = await guardedGet(u, this.token, GmailConnector.origin, this.fetcher);
    if (typeof data.data !== 'string') throw new LmsError('invalid_response');
    const bytes = new Uint8Array(b64urlBytes(data.data));
    if (bytes.byteLength > MAX_ATTACHMENT) throw new LmsError('budget');
    return {filename: attachment.filename, mime: attachment.mime, bytes, sha256: sha(bytes),
      provenance: provenance('gmail', {id: attachment.id, name: attachment.filename}, {sourceUrl: '', readFrom: 'gmail attachment', version: null, observedAt: this.now()})};
  }
}

// Synthetic Microsoft Graph, Gmail and OAuth token endpoints. The mail mocks
// deliberately ignore the sender filter and return every message, so tests
// prove the connector itself discards anything from an unconfirmed sender.
export const MAIL_TOKEN = 'mail-fixture-access-token';
export const COURSE_SENDER = 'prof.sample@example.edu';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
const b64url = (s: string | Buffer) => Buffer.from(s).toString('base64url');
const PDF = Buffer.from('%PDF-1.4\n% synthetic attachment\n%%EOF\n');

export type MailMockLog = {method: string; url: string}[];

const messages = [
  {id: 'm1', from: COURSE_SENDER, name: 'Prof. Sample', subject: 'DEMO 1020: Lab 6 moved to Thursday', at: '2026-11-10T14:00:00Z', body: 'Lab 6 is moved to Thursday 2 pm for Section Alpha.', attachment: true},
  {id: 'm2', from: 'newsletter@example.com', name: 'Campus News', subject: 'Weekly newsletter', at: '2026-11-10T15:00:00Z', body: 'Not course mail.', attachment: false},
  {id: 'm3', from: COURSE_SENDER, name: 'Prof. Sample', subject: 'DEMO 1020: Problem set 7 hint', at: '2026-11-11T09:30:00Z', body: 'Question 4 uses the Henderson equation.', attachment: false},
];

export function graphMockFetch(log: MailMockLog = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input)), method = (init?.method ?? 'GET').toUpperCase();
    log.push({method, url: url.href});
    if (method !== 'GET' || url.origin !== 'https://graph.microsoft.com') throw new Error('graph mock: refused ' + method + ' ' + url.href);
    if (new Headers(init?.headers).get('authorization') !== `Bearer ${MAIL_TOKEN}`) return json({error: {code: 'InvalidAuthenticationToken'}}, 401);
    const p = url.pathname;
    if (p === '/v1.0/me/messages') return json({value: messages.map(m => ({id: m.id, conversationId: 'c-' + m.id, subject: m.subject, from: {emailAddress: {address: m.from, name: m.name}}, receivedDateTime: m.at, webLink: `https://outlook.office365.com/owa/?ItemID=${m.id}`, hasAttachments: m.attachment, body: {contentType: 'text', content: m.body}}))});
    let match = /^\/v1\.0\/me\/messages\/([^/]+)\/attachments$/.exec(p);
    if (match) return json({value: [{'@odata.type': '#microsoft.graph.fileAttachment', id: 'a1', name: 'Lab6-update.pdf', contentType: 'application/pdf', size: PDF.length}]});
    match = /^\/v1\.0\/me\/messages\/([^/]+)\/attachments\/([^/]+)$/.exec(p);
    if (match) return json({'@odata.type': '#microsoft.graph.fileAttachment', id: 'a1', name: 'Lab6-update.pdf', contentType: 'application/pdf', size: PDF.length, contentBytes: PDF.toString('base64')});
    return json({error: {code: 'ResourceNotFound'}}, 404);
  }) as typeof fetch;
}

export function gmailMockFetch(log: MailMockLog = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input)), method = (init?.method ?? 'GET').toUpperCase();
    log.push({method, url: url.href});
    if (method !== 'GET' || url.origin !== 'https://gmail.googleapis.com') throw new Error('gmail mock: refused ' + method + ' ' + url.href);
    if (new Headers(init?.headers).get('authorization') !== `Bearer ${MAIL_TOKEN}`) return json({error: {code: 401}}, 401);
    const p = url.pathname;
    if (p === '/gmail/v1/users/me/profile') return json({emailAddress: 'sample.learner@example.edu', messagesTotal: 3});
    if (p === '/gmail/v1/users/me/messages') return json({messages: messages.map(m => ({id: m.id, threadId: 't-' + m.id})), resultSizeEstimate: messages.length});
    let match = /^\/gmail\/v1\/users\/me\/messages\/([^/]+)$/.exec(p);
    if (match) {
      const m = messages.find(x => x.id === match![1]);
      if (!m) return json({error: {code: 404}}, 404);
      const parts: any[] = [{mimeType: 'text/plain', body: {data: b64url(m.body), size: m.body.length}}];
      if (m.attachment) parts.push({mimeType: 'application/pdf', filename: 'Lab6-update.pdf', body: {attachmentId: 'att-1', size: PDF.length}});
      return json({id: m.id, threadId: 't-' + m.id, historyId: '9001', internalDate: String(Date.parse(m.at)),
        payload: {mimeType: 'multipart/mixed', headers: [{name: 'From', value: `"${m.name}" <${m.from}>`}, {name: 'Subject', value: m.subject}, {name: 'Date', value: new Date(m.at).toUTCString()}], parts}});
    }
    match = /^\/gmail\/v1\/users\/me\/messages\/([^/]+)\/attachments\/([^/]+)$/.exec(p);
    if (match) return json({size: PDF.length, data: PDF.toString('base64url')});
    return json({error: {code: 404}}, 404);
  }) as typeof fetch;
}

/** A token endpoint for any provider: accepts the fixture code + verifier and the fixture refresh token. */
export function tokenEndpointMock(expect: {code: string; verifier?: string; clientId: string; clientSecret: string}, log: MailMockLog = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input), method = (init?.method ?? 'GET').toUpperCase();
    log.push({method, url});
    if (method === 'DELETE' || url.endsWith('/revoke')) return new Response(null, {status: 200});
    if (method !== 'POST') throw new Error('token mock: refused');
    const b = new URLSearchParams(String(init?.body ?? ''));
    if (b.get('client_id') !== expect.clientId || b.get('client_secret') !== expect.clientSecret) return json({error: 'invalid_client'}, 401);
    if (b.get('grant_type') === 'authorization_code') {
      if (b.get('code') !== expect.code || (expect.verifier && b.get('code_verifier') !== expect.verifier)) return json({error: 'invalid_grant'}, 400);
      return json({access_token: MAIL_TOKEN, refresh_token: 'fixture-refresh', expires_in: 3600, scope: 'fixture'});
    }
    if (b.get('grant_type') === 'refresh_token' && b.get('refresh_token') === 'fixture-refresh') return json({access_token: MAIL_TOKEN, expires_in: 3600});
    return json({error: 'invalid_grant'}, 400);
  }) as typeof fetch;
}

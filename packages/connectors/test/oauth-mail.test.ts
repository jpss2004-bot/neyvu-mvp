import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {clientFor, authorizationUrl, pkcePair, newState, exchangeCode, refreshTokens, revokeAtProvider, type InstitutionClient} from '../src/oauth';
import {OutlookMailConnector, GmailConnector, isConfirmedSender} from '../src/mail/mail';
import {graphMockFetch, gmailMockFetch, tokenEndpointMock, MAIL_TOKEN, COURSE_SENDER, type MailMockLog} from '../src/mocks/mail-mock';
import {liveLmsConnector, lmsIdentity} from '../src/live';
import {fixtureFetch, loadFixture} from '../src/fixture-fetch';
import {LmsError} from '../src/read-only';

const env = {CID: 'fixture-client', CSECRET: 'fixture-secret'};
const inst = (provider: InstitutionClient['provider'], extra: Partial<InstitutionClient> = {}): InstitutionClient => ({id: 'synthetic-' + provider, name: 'Synthetic', provider, clientIdEnv: 'CID', clientSecretEnv: 'CSECRET', ...extra});
const now = () => '2026-11-12T12:00:00.000Z';

test('missing client configuration makes a provider unavailable', () => {
  assert.throws(() => clientFor(inst('google'), 'https://neyvu.example.org/cb', {}), (e: unknown) => e instanceof LmsError && e.code === 'configuration');
});

test('authorization URLs use PKCE and the documented endpoints for every provider', () => {
  const {challenge} = pkcePair(), state = newState();
  const cases: [InstitutionClient, string][] = [
    [inst('canvas', {origin: 'https://canvas.example.com'}), 'https://canvas.example.com/login/oauth2/auth'],
    [inst('brightspace', {origin: 'https://learn.example.com'}), 'https://auth.brightspace.com/oauth2/auth'],
    [inst('microsoft', {tenant: 'organizations'}), 'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize'],
    [inst('google'), 'https://accounts.google.com/o/oauth2/v2/auth'],
  ];
  for (const [i, endpoint] of cases) {
    const u = new URL(authorizationUrl(clientFor(i, 'https://neyvu.example.org/cb', env), state, challenge));
    assert.equal(u.origin + u.pathname, endpoint);
    assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(u.searchParams.get('state'), state);
  }
  const g = new URL(authorizationUrl(clientFor(inst('google'), 'https://neyvu.example.org/cb', env), state, challenge));
  assert.match(g.searchParams.get('scope')!, /gmail\.readonly/);
  assert.doesNotMatch(g.searchParams.get('scope')!, /gmail\.(modify|send|compose)|mail\.google\.com/);
  const m = new URL(authorizationUrl(clientFor(inst('microsoft'), 'https://neyvu.example.org/cb', env), state, challenge));
  assert.match(m.searchParams.get('scope')!, /Mail\.Read/);
  assert.doesNotMatch(m.searchParams.get('scope')!, /Mail\.(Send|ReadWrite)/);
});

test('code exchange, refresh and revocation against a mocked token endpoint', async () => {
  const client = clientFor(inst('google'), 'https://neyvu.example.org/cb', env), {verifier} = pkcePair();
  const mock = tokenEndpointMock({code: 'fixture-code', verifier, clientId: env.CID, clientSecret: env.CSECRET});
  const tokens = await exchangeCode(client, 'fixture-code', verifier, mock);
  assert.equal(tokens.accessToken, MAIL_TOKEN);
  assert.equal(tokens.refreshToken, 'fixture-refresh');
  await assert.rejects(exchangeCode(client, 'stolen-code', verifier, mock), (e: unknown) => e instanceof LmsError && e.code === 'reauthorize');
  const refreshed = await refreshTokens(client, 'fixture-refresh', mock);
  assert.equal(refreshed.refreshToken, 'fixture-refresh');
  assert.equal(await revokeAtProvider(client, tokens, mock), true);
});

for (const [name, make, mockFetch] of [
  ['Outlook', (f: typeof fetch) => new OutlookMailConnector({accessToken: MAIL_TOKEN, fetch: f, now}), graphMockFetch],
  ['Gmail', (f: typeof fetch) => new GmailConnector({accessToken: MAIL_TOKEN, fetch: f, now}), gmailMockFetch],
] as const) {
  test(`${name}: keeps only confirmed course senders, with sender, date, link and attachments; never writes`, async () => {
    const log: MailMockLog = [];
    const c = make(mockFetch(log));
    const result = await c.listMessagesFrom([COURSE_SENDER], null);
    assert.deepEqual(result.items.map(m => m.externalId).sort(), ['m1', 'm3']);
    assert.equal(result.discarded, 1);
    const m1 = result.items.find(m => m.externalId === 'm1')!;
    assert.equal(m1.from.address, COURSE_SENDER);
    assert.equal(m1.receivedAt, '2026-11-10T14:00:00.000Z');
    assert.match(m1.webLink, /^https:\/\//);
    assert.equal(m1.role, 'untrusted course material');
    assert.equal(m1.attachments.length, 1);
    const file = await c.fetchAttachment('m1', m1.attachments[0]);
    assert.ok(Buffer.from(file.bytes).toString().startsWith('%PDF'));
    assert.ok(!JSON.stringify(result).includes('newsletter'));
    assert.ok(log.every(l => l.method === 'GET'));
    assert.deepEqual((await c.listMessagesFrom([], null)).items, []);
  });
}

test('sender matching is exact, case-insensitive and rejects look-alikes', () => {
  assert.ok(isConfirmedSender('Prof.Sample@Example.edu', [COURSE_SENDER]));
  assert.ok(!isConfirmedSender('prof.sample@example.edu.evil.com', [COURSE_SENDER]));
  assert.ok(!isConfirmedSender('', [COURSE_SENDER]));
});

test('live Canvas and Brightspace adapters run over the institution record and an OAuth token', async () => {
  for (const [provider, fixture] of [['canvas', 'canvas/api-responses.json'], ['brightspace', 'brightspace/api-responses.json']] as const) {
    const f = loadFixture(fileURLToPath(new URL(`../fixtures/${fixture}`, import.meta.url)));
    const i = inst(provider, {origin: f.origin, lpVersion: String(f.lpVersion ?? '1.46'), leVersion: String(f.leVersion ?? '1.74')});
    const identity = await lmsIdentity(i, f.accessToken, fixtureFetch(f));
    assert.equal(identity, f.expectedIdentity);
    const c = liveLmsConnector('live-' + provider, i, f.accessToken, identity, fixtureFetch(f));
    assert.ok((await c.listCourses()).items.length > 0);
  }
});

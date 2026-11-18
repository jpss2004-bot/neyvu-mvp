// Contract tests: every connector must satisfy the same LmsConnector behaviour.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {connectorsFromRegistry, resolveCourse} from '../src/registry';
import {CanvasConnector} from '../src/connectors/canvas';
import {BrightspaceConnector} from '../src/connectors/brightspace';
import {MoodleConnector, moodleDueToIso} from '../src/connectors/moodle';
import {fixtureFetch, loadFixture, type RequestLog} from '../src/fixture-fetch';
import {canonicalJson, sha256} from '../src/provenance';
import {LmsError} from '../src/read-only';

const REGISTRY = fileURLToPath(new URL('../connectors.fixture.json', import.meta.url));
const NOW = () => '2026-11-11T12:00:00.000Z';
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/;
const fixturePath = (p: string) => fileURLToPath(new URL(`../fixtures/${p}`, import.meta.url));

for (const provider of ['moodle', 'canvas', 'brightspace'] as const) {
  test(`${provider}: satisfies the LmsConnector contract`, async () => {
    const log: RequestLog = [];
    const c = connectorsFromRegistry(REGISTRY, {log, now: NOW}).find(x => x.provider === provider)!;
    const courses = await c.listCourses();
    assert.ok(courses.items.length >= 1);
    for (const course of courses.items) {
      assert.equal(course.ref, `${c.id}/${course.externalId}`);
      assert.match(course.provenance.contentHash, /^sha256:[0-9a-f]{64}$/);
      assert.ok(course.provenance.sourceUrl.startsWith(c.origin + '/'));
      assert.equal(course.provenance.observedAt, NOW());
      const assignments = await c.listAssignments(course.externalId);
      for (const a of assignments.items) {
        assert.equal(a.courseRef, course.ref);
        assert.ok(a.dueAt === null || ISO.test(a.dueAt), `dueAt ${a.dueAt}`);
        assert.equal(a.submission, 'unverified');
        assert.equal(a.grade, 'unverified');
        assert.match(a.provenance.contentHash, /^sha256:[0-9a-f]{64}$/);
      }
      const docs = await c.listDocuments(course.externalId);
      for (const d of docs.items) {
        const full = await c.getDocument(course.externalId, d.externalId);
        assert.equal(full.ref, d.ref);
        assert.equal(full.role, 'untrusted course material');
        assert.equal(full.contentSha256, sha256(full.content));
        assert.equal(full.contentAvailable, full.content.length > 0);
      }
    }
    // Read-only: every request any connector made was a GET to its own origin.
    // Moodle reads captures only and makes no requests at all.
    if (provider === 'moodle') assert.equal(log.length, 0);
    else assert.ok(log.length > 0 && log.every(r => r.method === 'GET' && r.url.startsWith(c.origin + '/')));
  });
}

test('canvas: follows Link-header pagination to the second course page', async () => {
  const c = connectorsFromRegistry(REGISTRY, {now: NOW}).find(x => x.provider === 'canvas')!;
  const r = await c.listCourses();
  assert.deepEqual(r.items.map(x => x.externalId), ['101', '205']);
  assert.equal(r.complete, true);
});

test('brightspace: follows bookmark paging and keeps only course offerings', async () => {
  const c = connectorsFromRegistry(REGISTRY, {now: NOW}).find(x => x.provider === 'brightspace')!;
  const r = await c.listCourses();
  assert.deepEqual(r.items.map(x => x.externalId), ['6606', '6710']); // department 6000 dropped
});

test('canvas: a different signed-in user is refused (identity_changed)', async () => {
  const f = loadFixture(fixturePath('canvas/api-responses.json'));
  const c = new CanvasConnector({id: 'x', origin: f.origin, approvedOrigins: [f.origin], accessToken: f.accessToken, expectedIdentity: '4002', fetch: fixtureFetch(f)});
  await assert.rejects(c.listCourses(), (e: LmsError) => e.code === 'identity_changed');
});

test('canvas: a course outside the enrollment list is refused (boundary)', async () => {
  const c = connectorsFromRegistry(REGISTRY).find(x => x.provider === 'canvas')!;
  await assert.rejects(c.listAssignments('999'), (e: LmsError) => e.code === 'boundary');
  await assert.rejects(c.getDocument('999', 'page:31'), (e: LmsError) => e.code === 'boundary');
});

test('canvas: wrong token surfaces reauthorize, not provider text', async () => {
  const f = loadFixture(fixturePath('canvas/api-responses.json'));
  const c = new CanvasConnector({id: 'x', origin: f.origin, approvedOrigins: [f.origin], accessToken: 'other', expectedIdentity: f.expectedIdentity, fetch: fixtureFetch(f)});
  await assert.rejects(c.listCourses(), (e: LmsError) => e.code === 'reauthorize');
});

test('origins must come from the approved registry list', () => {
  const f = loadFixture(fixturePath('canvas/api-responses.json'));
  assert.throws(() => new CanvasConnector({id: 'x', origin: f.origin, approvedOrigins: ['https://other.example.com'], accessToken: 't', expectedIdentity: '1'}), (e: LmsError) => e.code === 'configuration');
  assert.throws(() => new CanvasConnector({id: 'x', origin: 'http://canvas.example.com', approvedOrigins: ['http://canvas.example.com'], accessToken: 't', expectedIdentity: '1'}), (e: LmsError) => e.code === 'configuration');
});

test('brightspace: an unzoned due date is rejected instead of guessed', async () => {
  const f = loadFixture(fixturePath('brightspace/api-responses.json'));
  const key = '/d2l/api/le/1.74/6606/dropbox/folders/';
  const body = structuredClone(f.responses[key].body) as Record<string, unknown>[];
  body[0].DueDate = '2026-11-18T03:59:00';
  const patched = {...f, responses: {...f.responses, [key]: {...f.responses[key], body}}};
  const c = new BrightspaceConnector({id: 'x', origin: f.origin, approvedOrigins: [f.origin], accessToken: f.accessToken, expectedIdentity: f.expectedIdentity, lpVersion: '1.46', leVersion: '1.74', fetch: fixtureFetch(patched)});
  await assert.rejects(c.listAssignments('6606'), (e: LmsError) => e.code === 'invalid_response');
});

test('moodle: newest capture wins and due text converts only with a declared zone', async () => {
  const f = JSON.parse(readFileSync(fixturePath('moodle/companion-captures.json'), 'utf8'));
  const zoned = new MoodleConnector({id: 'm', captures: f.captures, expectedIdentity: f.expectedIdentity, displayTimeZone: 'America/Halifax'});
  const [a] = (await zoned.listAssignments('42')).items;
  assert.equal(a.dueText, 'Friday, 14 November 2026, 11:59 PM');
  assert.equal(a.dueAt, '2026-11-14T23:59:00-04:00');
  const unzoned = new MoodleConnector({id: 'm', captures: f.captures, expectedIdentity: f.expectedIdentity});
  const r = await unzoned.listAssignments('42');
  assert.equal(r.items[0].dueAt, null);
  assert.ok(r.issues.some(i => /time zone/.test(i)));
  assert.equal(r.complete, false); // captured pages never prove completeness
});

test('moodle: captures from another account are refused', () => {
  const f = JSON.parse(readFileSync(fixturePath('moodle/companion-captures.json'), 'utf8'));
  assert.throws(() => new MoodleConnector({id: 'm', captures: f.captures, expectedIdentity: 'moodle-user:53'}), (e: LmsError) => e.code === 'identity_changed');
});

test('moodle due-date parser: DST, 12 AM/PM and nonexistent times', () => {
  assert.equal(moodleDueToIso('Friday, 3 July 2026, 12:00 PM', 'America/Halifax'), '2026-07-03T12:00:00-03:00');
  assert.equal(moodleDueToIso('Thursday, 1 January 2026, 12:05 AM', 'America/Halifax'), '2026-01-01T00:05:00-04:00');
  assert.equal(moodleDueToIso('9 October 2026, 14:00', 'America/Halifax'), '2026-10-09T14:00:00-03:00');
  assert.equal(moodleDueToIso('Sunday, 8 March 2026, 2:30 AM', 'America/Halifax'), null); // spring-forward gap
  assert.equal(moodleDueToIso('Friday, 31 February 2026, 1:00 PM', 'America/Halifax'), null);
  assert.equal(moodleDueToIso('Friday, 14 November 2026, 11:59 PM', undefined), null);
});

test('provenance hash is stable under key order and changes with content', () => {
  assert.equal(sha256(canonicalJson({b: 1, a: [1, {d: 2, c: 3}]})), sha256(canonicalJson({a: [1, {c: 3, d: 2}], b: 1})));
  assert.notEqual(sha256(canonicalJson({a: 1})), sha256(canonicalJson({a: 2})));
});

test('course refs resolve to exactly one connector', () => {
  const cs = connectorsFromRegistry(REGISTRY);
  assert.equal(resolveCourse(cs, 'sample-canvas/101').connector.provider, 'canvas');
  assert.throws(() => resolveCourse(cs, 'unknown/1'), (e: LmsError) => e.code === 'not_found');
  assert.throws(() => resolveCourse(cs, 'sample-canvas/../101'), (e: LmsError) => e.code === 'not_found');
});

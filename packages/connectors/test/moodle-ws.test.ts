import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {MoodleTokenConnector, moodleSiteUrl, moodlePublicConfig, moodleTokenFromPassword, moodleSsoLaunchUrl, parseMoodleSsoCallback, newPassport} from '../src/connectors/moodle-ws';
import {loadMoodleFixture, moodleMockFetch, moodleSsoCallbackFor, type MockLog} from '../src/mocks/moodle-mock';
import {LmsError} from '../src/read-only';

const f = loadMoodleFixture(fileURLToPath(new URL('../fixtures/moodle-ws/site.json', import.meta.url)));
const now = () => '2026-11-12T12:00:00.000Z';
const code = (c: string) => (e: unknown) => e instanceof LmsError && e.code === c;

test('site URL normalisation accepts what learners type and refuses unsafe hosts', () => {
  assert.equal(moodleSiteUrl('moodle.example.edu'), 'https://moodle.example.edu/');
  assert.equal(moodleSiteUrl('https://lms.example.edu/moodle/login/index.php'), 'https://lms.example.edu/moodle/');
  for (const bad of ['http://moodle.example.edu', 'https://user:pw@moodle.example.edu', 'https://localhost', 'https://10.0.0.5', 'https://moodle.example.edu:8443', 'javascript:alert(1)'])
    assert.throws(() => moodleSiteUrl(bad), code('configuration'), bad);
});

test('public config tells the app whether to use the password form or SSO launch', async () => {
  const cfg = await moodlePublicConfig('moodle.example.edu', moodleMockFetch(f));
  assert.equal(cfg.typeOfLogin, 2);
  assert.equal(cfg.mobileServiceEnabled, true);
});

test('password exchange returns only the token; wrong password asks to re-authorize', async () => {
  const log: MockLog = [];
  const token = await moodleTokenFromPassword(f.site, f.login.username, f.login.password, moodleMockFetch(f, log));
  assert.equal(token, f.token);
  await assert.rejects(moodleTokenFromPassword(f.site, f.login.username, 'wrong', moodleMockFetch(f)), code('reauthorize'));
  assert.ok(log.every(l => l.method === 'POST'));
});

test('SSO launch callback is verified with md5(wwwroot + passport)', () => {
  const passport = newPassport();
  const launch = new URL(moodleSsoLaunchUrl(f.site, passport));
  assert.equal(launch.pathname, '/admin/tool/mobile/launch.php');
  assert.equal(launch.searchParams.get('service'), 'moodle_mobile_app');
  assert.equal(parseMoodleSsoCallback(moodleSsoCallbackFor(f, passport), f.site, passport), f.token);
  assert.throws(() => parseMoodleSsoCallback(moodleSsoCallbackFor(f, passport), f.site, newPassport()), code('boundary'));
  assert.throws(() => parseMoodleSsoCallback('neyvu://token=!!', f.site, passport), code('invalid_response'));
});

test('token connector reads courses, contents, files, assignments, calendar and groups', async () => {
  const log: MockLog = [];
  const c = new MoodleTokenConnector({id: 'synthetic-moodle', site: f.site, token: f.token, fetch: moodleMockFetch(f, log), now});
  const courses = await c.listCourses();
  assert.deepEqual(courses.items.map(x => x.code), ['DEMO 1020', 'DEMO 2210']);
  const docs = await c.listDocuments('42');
  assert.deepEqual(docs.items.map(d => d.externalId), ['file:811.0', 'page:812', 'assignment:901', 'link:905']);
  const page = await c.getDocument('42', 'page:812');
  assert.match(page.content, /chapter 9/);
  assert.equal(page.role, 'untrusted course material');
  const file = await c.fetchFile('42', 'file:811.0');
  assert.equal(file.mime, 'application/pdf');
  assert.match(file.sha256, /^[a-f0-9]{64}$/);
  const assignments = await c.listAssignments('42');
  assert.equal(assignments.items[0].dueAt, '2026-11-15T03:59:00.000Z');
  assert.equal(assignments.items[0].submission, 'unverified');
  const events = await c.listEvents('42');
  assert.equal(events.items[0].endAt, new Date((1794582000 + 10800) * 1000).toISOString());
  const groups = await c.listGroups('42');
  assert.deepEqual(groups.items.map(g => g.name), ['Lab Section Alpha']);
  // Only allowlisted read functions were ever called.
  assert.ok(log.filter(l => l.fn).every(l => /^(core_webservice_get_site_info|core_enrol_get_users_courses|core_course_get_contents|mod_assign_get_assignments|core_calendar_get_calendar_events|core_group_get_course_user_groups)$/.test(l.fn!)));
});

test('write functions, foreign courses, revoked tokens and identity changes are refused', async () => {
  let revoked = false;
  const c = new MoodleTokenConnector({id: 'synthetic-moodle', site: f.site, token: f.token, fetch: moodleMockFetch(f, [], {revoked: () => revoked}), now});
  await assert.rejects(c.call('mod_assign_save_submission'), code('boundary'));
  await assert.rejects(c.listDocuments('999'), code('boundary'));
  const other = new MoodleTokenConnector({id: 'synthetic-moodle', site: f.site, token: f.token, expectedUserId: '53', fetch: moodleMockFetch(f), now});
  await assert.rejects(other.listCourses(), code('identity_changed'));
  revoked = true;
  const fresh = new MoodleTokenConnector({id: 'synthetic-moodle', site: f.site, token: f.token, fetch: moodleMockFetch(f, [], {revoked: () => revoked}), now});
  await assert.rejects(fresh.listCourses(), code('reauthorize'));
});

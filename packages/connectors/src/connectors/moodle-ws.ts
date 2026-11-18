// C2 Moodle token connector. Reads Moodle through the official mobile web
// service ("moodle_mobile_app") with a per-learner token. The learner enters
// their Moodle site URL; the token is obtained either from a one-time password
// exchange (the password is forwarded once and never stored or logged) or from
// Moodle's SSO launch flow (admin/tool/mobile/launch.php), whose callback is
// verified with md5(wwwroot + passport). Read-only: only the functions in
// READ_FUNCTIONS can be called. Course material is untrusted data.
import {createHash, randomBytes} from 'node:crypto';
import {LmsError, id, label} from '../read-only';
import {provenance, sha256} from '../provenance';
import type {Assignment, CalendarEvent, Course, CourseGroup, DocumentContent, DocumentKind, DocumentRef, FileBody, Listing, LmsConnector} from '../types';

export const MOODLE_SERVICE = 'moodle_mobile_app';

/** Every web-service function this connector may call. None of them writes. */
export const READ_FUNCTIONS = new Set([
  'core_webservice_get_site_info',
  'core_enrol_get_users_courses',
  'core_course_get_contents',
  'mod_assign_get_assignments',
  'core_calendar_get_calendar_events',
  'core_group_get_course_user_groups',
]);

const MAX_JSON = 4_000_000;
const MAX_FILE = 25 * 1024 * 1024;

/**
 * Normalise the site URL a learner typed ("moodle.example.edu", "https://x.edu/moodle/login/index.php").
 * Returns the wwwroot with a trailing slash. HTTPS only, no credentials, no private hosts.
 */
export function moodleSiteUrl(input: string): string {
  if (typeof input !== 'string' || !input.trim() || input.length > 500) throw new LmsError('configuration');
  let raw = input.trim();
  if (!/^[a-z]+:\/\//i.test(raw)) raw = 'https://' + raw;
  let u: URL;
  try { u = new URL(raw); } catch { throw new LmsError('configuration'); }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) throw new LmsError('configuration');
  const host = u.hostname.toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) || /(?:^|\.)(?:localhost|local|internal|invalid|test)$/.test(host) || /^\d+\.\d+\.\d+\.\d+$/.test(host)) throw new LmsError('configuration');
  let path = u.pathname.replace(/\/(?:login\/index\.php|my\/?|index\.php|course\/view\.php)?$/i, '/');
  if (!path.endsWith('/')) path += '/';
  if (/[^a-zA-Z0-9/_.~-]/.test(path) || path.includes('..')) throw new LmsError('configuration');
  return `https://${host}${path}`;
}

/** wwwroot as Moodle stores it (no trailing slash); used in the SSO signature. */
export const wwwroot = (site: string) => moodleSiteUrl(site).replace(/\/$/, '');

export type PublicConfig = {
  siteName: string;
  /** 1 = app login form, 2 = browser SSO, 3 = embedded browser SSO. */
  typeOfLogin: 1 | 2 | 3;
  launchUrl: string | null;
  mobileServiceEnabled: boolean;
};

async function readJson(response: Response): Promise<unknown> {
  const length = Number(response.headers.get('content-length') || 0);
  if (!Number.isFinite(length) || length > MAX_JSON) throw new LmsError('invalid_response');
  const text = await response.text();
  if (text.length > MAX_JSON) throw new LmsError('invalid_response');
  try { return JSON.parse(text); } catch { throw new LmsError('invalid_response'); }
}

function moodleError(data: unknown): never | void {
  if (data && typeof data === 'object' && !Array.isArray(data) && 'exception' in data) {
    const code = String((data as {errorcode?: unknown}).errorcode || '');
    if (/invalidtoken|accessexception_token|invalidlogin/.test(code)) throw new LmsError('reauthorize');
    if (/nopermission|accessexception|requireloginerror|servicenotavailable|enablewsdescription/.test(code)) throw new LmsError('forbidden');
    throw new LmsError('invalid_response');
  }
}

/** Ask the site how its learners log in (tool_mobile_get_public_config). No login needed. */
export async function moodlePublicConfig(site: string, fetcher: typeof fetch = fetch): Promise<PublicConfig> {
  const base = moodleSiteUrl(site);
  const response = await fetcher(base + 'lib/ajax/service-nologin.php?info=tool_mobile_get_public_config', {
    method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json'}, redirect: 'error', credentials: 'omit', cache: 'no-store',
    body: JSON.stringify([{index: 0, methodname: 'tool_mobile_get_public_config', args: {}}]),
  }).catch(() => { throw new LmsError('temporary'); });
  if (response.status !== 200) throw new LmsError(response.status >= 500 ? 'temporary' : 'invalid_response');
  const data = await readJson(response);
  const first = Array.isArray(data) ? data[0] : null;
  if (!first || first.error) {
    // Older sites or sites without the mobile plugin.
    return {siteName: '', typeOfLogin: 1, launchUrl: null, mobileServiceEnabled: false};
  }
  const d = first.data || {};
  const type = [1, 2, 3].includes(d.typeoflogin) ? d.typeoflogin : 1;
  let launchUrl: string | null = null;
  if (typeof d.launchurl === 'string' && d.launchurl) {
    const u = new URL(d.launchurl, base);
    if (u.origin === new URL(base).origin) launchUrl = u.href;
  }
  return {siteName: typeof d.sitename === 'string' ? d.sitename.slice(0, 200) : '', typeOfLogin: type as 1 | 2 | 3, launchUrl, mobileServiceEnabled: d.enablemobilewebservice !== 0 && d.enablemobilewebservice !== false};
}

/**
 * Exchange a username and password for a mobile-service token, once.
 * The password lives only in this call's arguments: it is never stored, logged or returned.
 * Moodle's private token (used for auto-login) is discarded on purpose.
 */
export async function moodleTokenFromPassword(site: string, username: string, password: string, fetcher: typeof fetch = fetch): Promise<string> {
  const base = moodleSiteUrl(site);
  if (!username || !password || username.length > 200 || password.length > 1000) throw new LmsError('configuration');
  const body = new URLSearchParams({username, password, service: MOODLE_SERVICE});
  const response = await fetcher(base + 'login/token.php', {
    method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json'}, body: body.toString(),
    redirect: 'error', credentials: 'omit', cache: 'no-store',
  }).catch(() => { throw new LmsError('temporary'); });
  if (response.status !== 200) throw new LmsError(response.status >= 500 ? 'temporary' : 'invalid_response');
  const data = await readJson(response) as {token?: unknown; error?: unknown; errorcode?: unknown};
  if (data.errorcode === 'invalidlogin' || data.errorcode === 'usernamenotfound') throw new LmsError('reauthorize');
  if (data.errorcode === 'enablewsdescription' || data.errorcode === 'servicenotavailable') throw new LmsError('forbidden');
  if (typeof data.token !== 'string' || !/^[a-zA-Z0-9]{16,128}$/.test(data.token)) throw new LmsError('invalid_response');
  return data.token;
}

/** A fresh passport for one SSO launch. Store it server-side with the OAuth-style state until the callback returns. */
export const newPassport = () => randomBytes(16).toString('hex');

/** Where to send the learner for an SSO login. Moodle redirects to `${urlScheme}://token=...` afterwards. */
export function moodleSsoLaunchUrl(site: string, passport: string, urlScheme = 'neyvu'): string {
  const base = moodleSiteUrl(site);
  if (!/^[a-f0-9]{16,64}$/.test(passport) || !/^[a-z][a-z0-9+.-]{1,30}$/.test(urlScheme)) throw new LmsError('configuration');
  const u = new URL(base + 'admin/tool/mobile/launch.php');
  u.searchParams.set('service', MOODLE_SERVICE);
  u.searchParams.set('passport', passport);
  u.searchParams.set('urlscheme', urlScheme);
  return u.href;
}

/**
 * Parse `neyvu://token=<base64(signature:::token[:::privatetoken])>` and check the signature,
 * which Moodle computes as md5(wwwroot + passport). Returns only the web-service token.
 */
export function parseMoodleSsoCallback(callback: string, site: string, passport: string): string {
  const m = /^[a-z][a-z0-9+.-]{1,30}:\/\/token=([A-Za-z0-9+/=_-]{8,4096})$/.exec((callback || '').trim());
  if (!m) throw new LmsError('invalid_response');
  let decoded: string;
  try { decoded = Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch { throw new LmsError('invalid_response'); }
  const [signature, token] = decoded.split(':::');
  const expected = createHash('md5').update(wwwroot(site) + passport).digest('hex');
  if (signature !== expected) throw new LmsError('boundary');
  if (!token || !/^[a-zA-Z0-9]{16,128}$/.test(token)) throw new LmsError('invalid_response');
  return token;
}

export type MoodleWsConfig = {
  id: string;
  site: string;
  token: string;
  /** Moodle user id the token must keep belonging to (from the first site-info read). */
  expectedUserId?: string;
  fetch?: typeof fetch;
  now?: () => string;
};

type Raw = Record<string, any>;

export class MoodleTokenConnector implements LmsConnector {
  readonly provider = 'moodle' as const;
  readonly mode = 'token' as const;
  readonly id: string;
  readonly origin: string;
  readonly base: string;
  private readonly token: string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => string;
  private expectedUserId: string | undefined;
  private site: {userid: string; sitename: string; username: string} | undefined;
  private contentsCache = new Map<string, Raw[]>();

  constructor(config: MoodleWsConfig) {
    this.id = label(config.id);
    this.base = moodleSiteUrl(config.site);
    this.origin = new URL(this.base).origin;
    if (typeof config.token !== 'string' || !/^[a-zA-Z0-9]{16,128}$/.test(config.token)) throw new LmsError('configuration');
    this.token = config.token;
    this.fetcher = config.fetch ?? fetch;
    this.now = config.now ?? (() => new Date().toISOString());
    this.expectedUserId = config.expectedUserId ? id(config.expectedUserId) : undefined;
  }

  /** Call one allowlisted read function. The token travels in the POST body, never in a logged URL. */
  async call(fn: string, params: Record<string, string | number> = {}): Promise<any> {
    if (!READ_FUNCTIONS.has(fn)) throw new LmsError('boundary');
    const body = new URLSearchParams({wstoken: this.token, wsfunction: fn, moodlewsrestformat: 'json'});
    for (const [k, v] of Object.entries(params)) {
      if (/token|password|secret/i.test(k)) throw new LmsError('boundary');
      body.set(k, String(v));
    }
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 20000);
    try {
      const response = await this.fetcher(this.base + 'webservice/rest/server.php', {
        method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json'}, body: body.toString(),
        redirect: 'error', credentials: 'omit', cache: 'no-store', signal: abort.signal,
      });
      if (response.status === 429) throw new LmsError('rate_limited');
      if (response.status >= 500) throw new LmsError('temporary');
      if (response.status !== 200) throw new LmsError('invalid_response');
      const data = await readJson(response);
      moodleError(data);
      return data;
    } catch (error) {
      if (error instanceof LmsError) throw error;
      throw new LmsError('temporary');
    } finally { clearTimeout(timer); }
  }

  /** Who the token belongs to. Throws identity_changed if it no longer matches the connected account. */
  async siteInfo() {
    if (this.site) return this.site;
    const info = await this.call('core_webservice_get_site_info');
    const userid = id(info.userid);
    if (this.expectedUserId && userid !== this.expectedUserId) throw new LmsError('identity_changed');
    this.expectedUserId = userid;
    this.site = {userid, sitename: typeof info.sitename === 'string' ? info.sitename : '', username: typeof info.username === 'string' ? info.username : ''};
    return this.site;
  }

  private ref(courseId: string, rest?: string) { return rest ? `${this.id}/${courseId}/${rest}` : `${this.id}/${courseId}`; }
  private courseUrl(courseId: string) { return `${this.base}course/view.php?id=${courseId}`; }

  async listCourses(): Promise<Listing<Course>> {
    const {userid} = await this.siteInfo(), observedAt = this.now();
    const raw = await this.call('core_enrol_get_users_courses', {userid});
    if (!Array.isArray(raw)) throw new LmsError('invalid_response');
    const items = raw.filter((c: Raw) => c.visible !== 0 && c.id !== 1).map((c: Raw) => {
      const externalId = id(c.id);
      return {ref: this.ref(externalId), externalId, code: label(c.shortname || c.fullname), title: label(c.fullname || c.shortname),
        provenance: provenance('moodle', c, {sourceUrl: this.courseUrl(externalId), readFrom: 'core_enrol_get_users_courses', version: c.timemodified ? String(c.timemodified) : null, observedAt})};
    });
    return {items, complete: true, issues: []};
  }

  private async enrolled(courseExternalId: string) {
    const courseId = id(courseExternalId), courses = await this.listCourses();
    if (!courses.items.some(c => c.externalId === courseId)) throw new LmsError('boundary');
    return courseId;
  }

  private async contents(courseId: string): Promise<Raw[]> {
    const cached = this.contentsCache.get(courseId);
    if (cached) return cached;
    const sections = await this.call('core_course_get_contents', {courseid: courseId});
    if (!Array.isArray(sections)) throw new LmsError('invalid_response');
    this.contentsCache.set(courseId, sections);
    return sections;
  }

  private iso(seconds: unknown): string | null {
    if (typeof seconds !== 'number' || !Number.isSafeInteger(seconds) || seconds <= 0) return null;
    return new Date(seconds * 1000).toISOString();
  }

  async listAssignments(courseExternalId: string): Promise<Listing<Assignment>> {
    const courseId = await this.enrolled(courseExternalId), observedAt = this.now();
    const data = await this.call('mod_assign_get_assignments', {'courseids[0]': courseId});
    const course = (data?.courses || []).find((c: Raw) => String(c.id) === courseId);
    const list: Raw[] = course?.assignments || [];
    const items = list.map(a => {
      const cm = id(a.cmid);
      return {ref: this.ref(courseId, `assignment:${cm}`), courseRef: this.ref(courseId), externalId: cm, title: label(a.name),
        dueAt: this.iso(a.duedate), dueText: null, submission: 'unverified' as const, grade: 'unverified' as const,
        provenance: provenance('moodle', a, {sourceUrl: `${this.base}mod/assign/view.php?id=${cm}`, readFrom: 'mod_assign_get_assignments', version: a.timemodified ? String(a.timemodified) : null, observedAt})};
    });
    const issues = (data?.warnings || []).length ? ['Moodle returned warnings for some assignments; they may be hidden from this account.'] : [];
    return {items, complete: !issues.length, issues};
  }

  async listDocuments(courseExternalId: string): Promise<Listing<DocumentRef>> {
    const courseId = await this.enrolled(courseExternalId), observedAt = this.now(), courseRef = this.ref(courseId);
    const items: DocumentRef[] = [];
    for (const section of await this.contents(courseId)) {
      for (const m of (section.modules || []) as Raw[]) {
        if (m.uservisible === false) continue;
        const cm = id(m.id), sourceUrl = typeof m.url === 'string' ? m.url : this.courseUrl(courseId);
        const prov = (raw: unknown, version: unknown) => provenance('moodle', raw, {sourceUrl, readFrom: 'core_course_get_contents', version: version ? String(version) : null, observedAt});
        const doc = (externalId: string, kind: DocumentKind, title: string, available: boolean, raw: unknown, version: unknown) =>
          items.push({ref: `${courseRef}/${externalId}`, courseRef, externalId, kind, title: label(title), contentAvailable: available, provenance: prov(raw, version)});
        if (m.modname === 'resource' || m.modname === 'folder') {
          (m.contents || []).forEach((f: Raw, i: number) => { if (f.type === 'file') doc(`file:${cm}.${i}`, 'file', m.modname === 'folder' ? `${m.name} / ${f.filename}` : (m.name || f.filename), true, f, f.timemodified); });
        } else if (m.modname === 'page') doc(`page:${cm}`, 'page', m.name, true, m, m.contents?.[0]?.timemodified);
        else if (m.modname === 'assign') doc(`assignment:${cm}`, 'assignment-instructions', m.name, !!m.description, m, null);
        else if (m.modname === 'url') doc(`link:${cm}`, 'link', m.name, true, m, null);
        else if (m.modname === 'label' && m.description) doc(`label:${cm}`, 'course-page', m.name || 'Course note', true, m, null);
      }
    }
    return {items, complete: true, issues: []};
  }

  private async module(courseId: string, cm: string): Promise<Raw> {
    for (const s of await this.contents(courseId)) for (const m of (s.modules || []) as Raw[]) if (String(m.id) === cm && m.uservisible !== false) return m;
    throw new LmsError('not_found');
  }

  /** pluginfile URLs must stay on this site; the token is added only at download time. */
  private fileUrl(raw: unknown): URL {
    if (typeof raw !== 'string') throw new LmsError('invalid_response');
    const u = new URL(raw);
    if (u.origin !== this.origin || !u.pathname.startsWith(new URL(this.base).pathname + 'webservice/pluginfile.php/') || u.username || u.password) throw new LmsError('boundary');
    return u;
  }

  private async download(raw: unknown, max = MAX_FILE): Promise<{bytes: Uint8Array; mime: string}> {
    const u = this.fileUrl(raw);
    u.searchParams.set('token', this.token);
    const response = await this.fetcher(u.href, {method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store'}).catch(() => { throw new LmsError('temporary'); });
    if (response.status === 401 || response.status === 403) throw new LmsError('reauthorize');
    if (response.status !== 200) throw new LmsError(response.status >= 500 ? 'temporary' : 'not_found');
    const length = Number(response.headers.get('content-length') || 0);
    if (length > max) throw new LmsError('budget');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > max) throw new LmsError('budget');
    const mime = (response.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim();
    if (mime === 'application/json') { try { moodleError(JSON.parse(new TextDecoder().decode(bytes))); } catch (e) { if (e instanceof LmsError) throw e; } }
    return {bytes, mime};
  }

  async getDocument(courseExternalId: string, documentExternalId: string): Promise<DocumentContent> {
    const courseId = await this.enrolled(courseExternalId), courseRef = this.ref(courseId);
    const docs = await this.listDocuments(courseId);
    const ref = docs.items.find(d => d.externalId === documentExternalId);
    if (!ref) throw new LmsError('not_found');
    const m = await this.module(courseId, documentExternalId.split(':')[1].split('.')[0]);
    const out = (format: DocumentContent['format'], content: string): DocumentContent => ({...ref, courseRef, role: 'untrusted course material', format, content, contentSha256: sha256(content)});
    if (ref.kind === 'page') {
      const index = (m.contents || []).find((f: Raw) => f.type === 'file' && /\.html?$/i.test(f.filename));
      if (!index) return out('none', '');
      const {bytes} = await this.download(index.fileurl, 2_000_000);
      return out('html', new TextDecoder().decode(bytes));
    }
    if (ref.kind === 'link') return out('text', String(m.contents?.[0]?.fileurl || m.url || ''));
    if (ref.kind === 'file') return out('none', '');
    return out('html', String(m.description || ''));
  }

  async fetchFile(courseExternalId: string, documentExternalId: string): Promise<FileBody> {
    const courseId = await this.enrolled(courseExternalId);
    const match = /^file:([1-9]\d{0,18})\.(\d{1,4})$/.exec(documentExternalId);
    if (!match) throw new LmsError('not_found');
    const m = await this.module(courseId, match[1]);
    const f = (m.contents || [])[Number(match[2])];
    if (!f || f.type !== 'file') throw new LmsError('not_found');
    if (typeof f.filesize === 'number' && f.filesize > MAX_FILE) throw new LmsError('budget');
    const {bytes, mime} = await this.download(f.fileurl);
    const hash = createHash('sha256').update(bytes).digest('hex');
    return {filename: label(f.filename), mime: typeof f.mimetype === 'string' && f.mimetype ? f.mimetype : mime, bytes, sha256: hash,
      provenance: provenance('moodle', f, {sourceUrl: typeof m.url === 'string' ? m.url : this.courseUrl(courseId), readFrom: 'webservice/pluginfile.php', version: f.timemodified ? String(f.timemodified) : null, observedAt: this.now()})};
  }

  async listEvents(courseExternalId: string): Promise<Listing<CalendarEvent>> {
    const courseId = await this.enrolled(courseExternalId), observedAt = this.now();
    const start = Math.floor(Date.parse(observedAt) / 1000) - 30 * 86400;
    const data = await this.call('core_calendar_get_calendar_events', {'events[courseids][0]': courseId, 'options[userevents]': 0, 'options[siteevents]': 0, 'options[timestart]': start});
    const items = ((data?.events || []) as Raw[]).filter(e => String(e.courseid) === courseId).map(e => {
      const eid = id(e.id), startAt = this.iso(e.timestart);
      if (!startAt) throw new LmsError('invalid_response');
      return {ref: this.ref(courseId, `event:${eid}`), courseRef: this.ref(courseId), externalId: eid, title: label(e.name), startAt,
        endAt: e.timeduration > 0 ? this.iso(e.timestart + e.timeduration) : null, eventType: String(e.eventtype || 'course'),
        provenance: provenance('moodle', e, {sourceUrl: `${this.base}calendar/view.php?view=day&time=${e.timestart}`, readFrom: 'core_calendar_get_calendar_events', version: e.timemodified ? String(e.timemodified) : null, observedAt})};
    });
    return {items, complete: true, issues: []};
  }

  async listGroups(courseExternalId: string): Promise<Listing<CourseGroup>> {
    const courseId = await this.enrolled(courseExternalId), {userid} = await this.siteInfo(), observedAt = this.now();
    const data = await this.call('core_group_get_course_user_groups', {courseid: courseId, userid});
    const items = ((data?.groups || []) as Raw[]).map(g => {
      const gid = id(g.id);
      return {ref: this.ref(courseId, `group:${gid}`), courseRef: this.ref(courseId), externalId: gid, name: label(g.name),
        provenance: provenance('moodle', g, {sourceUrl: `${this.base}user/index.php?id=${courseId}`, readFrom: 'core_group_get_course_user_groups', version: null, observedAt})};
    });
    return {items, complete: true, issues: []};
  }
}

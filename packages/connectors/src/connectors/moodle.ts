// Moodle connector over page-capture records. It does not call Moodle: it reads
// records in the shape the Neyvu desktop Companion produces ({course, identity,
// title, url, body, assessment?, captured_at, coverage}) and presents them
// through the same LmsConnector interface as the API-backed Canvas and
// Brightspace connectors. The Companion itself is not part of this repository.
import {LmsError, id, label} from '../read-only';
import {provenance, sha256} from '../provenance';
import type {Assignment, Course, DocumentContent, DocumentKind, DocumentRef, Listing, LmsConnector} from '../types';

export type MoodleCapture = {
  course: {id: string; title: string; url: string; shortname?: string};
  identity: string;
  title: string;
  url: string;
  body: string;
  assessment?: unknown;
  captured_at: string;
  coverage?: {scope?: string; files?: {url: string; title: string}[]; files_truncated?: boolean; issues?: string[]};
};

export type MoodleConfig = {
  id: string;
  captures: MoodleCapture[];
  /** "moodle-user:<id>" — all captures must belong to this account. */
  expectedIdentity: string;
  /**
   * IANA zone the student's Moodle profile displays dates in (e.g. "America/Halifax").
   * Moodle prints due dates without an offset, so without this the connector keeps
   * the text and returns dueAt: null instead of guessing.
   */
  displayTimeZone?: string;
  now?: () => string;
};

const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];

/** Offset (minutes) of `zone` at the given UTC instant, via Intl only. */
function zoneOffsetMinutes(zone: string, utcMs: number): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'})
    .formatToParts(new Date(utcMs)).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
  return (Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - utcMs) / 60000;
}

/** Parse Moodle's "Due: Friday, 14 November 2026, 11:59 PM" display line. */
export function moodleDueText(body: string): string | null {
  const m = /(?:^|\n)\s*Due:\s*([^\n]{1,120})/.exec(body);
  return m ? m[1].trim() : null;
}

export function moodleDueToIso(text: string, zone: string | undefined): string | null {
  if (!zone) return null;
  const m = /^(?:[A-Za-z]+,\s*)?(\d{1,2})\s+([A-Za-z]+)\s+(\d{4}),\s*(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(text.trim());
  if (!m) return null;
  const month = MONTHS.indexOf(m[2].toLowerCase());
  let hour = Number(m[4]);
  const day = Number(m[1]), year = Number(m[3]), minute = Number(m[5]);
  if (month < 0 || minute > 59) return null;
  if (m[6]) { if (hour < 1 || hour > 12) return null; hour = (hour % 12) + (m[6].toUpperCase() === 'PM' ? 12 : 0); }
  else if (hour > 23) return null;
  if (day < 1 || day > new Date(Date.UTC(year, month + 1, 0)).getUTCDate()) return null;
  const wall = Date.UTC(year, month, day, hour, minute);
  let utc = wall - zoneOffsetMinutes(zone, wall) * 60000;
  utc = wall - zoneOffsetMinutes(zone, utc) * 60000;
  const off = zoneOffsetMinutes(zone, utc);
  // Reject wall times that do not exist in the zone (spring-forward gap).
  if (utc + off * 60000 !== wall) return null;
  const sign = off < 0 ? '-' : '+', abs = Math.abs(off);
  const local = new Date(wall).toISOString().slice(0, 19);
  return `${local}${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

function kindOf(url: URL): DocumentKind | 'assignment' | null {
  if (url.pathname === '/course/view.php') return 'course-page';
  if (url.pathname === '/mod/assign/view.php') return 'assignment';
  if (url.pathname === '/calendar/view.php') return null;
  if (url.pathname === '/mod/url/view.php') return 'link';
  return 'page';
}

export class MoodleConnector implements LmsConnector {
  readonly provider = 'moodle' as const;
  readonly id: string;
  readonly origin: string;
  private readonly captures: MoodleCapture[];
  private readonly zone: string | undefined;
  private readonly now: () => string;

  constructor(config: MoodleConfig) {
    this.id = label(config.id);
    if (!Array.isArray(config.captures) || !config.captures.length || config.captures.length > 20000) throw new LmsError('configuration');
    if (!/^moodle-user:[1-9]\d{0,11}$/.test(config.expectedIdentity)) throw new LmsError('configuration');
    if (config.displayTimeZone) { try { new Intl.DateTimeFormat('en-US', {timeZone: config.displayTimeZone}); } catch { throw new LmsError('configuration'); } }
    const origins = new Set<string>();
    for (const c of config.captures) {
      // The Companion identity string is "moodle-user:<id> · <display name>".
      if (typeof c.identity !== 'string' || c.identity.split(' · ')[0] !== config.expectedIdentity) throw new LmsError('identity_changed');
      let u: URL, cu: URL;
      try { u = new URL(c.url); cu = new URL(c.course.url); } catch { throw new LmsError('invalid_response'); }
      if (u.protocol !== 'https:' || cu.origin !== u.origin || cu.searchParams.get('id') !== id(c.course.id)) throw new LmsError('boundary');
      if (typeof c.body !== 'string' || !Number.isFinite(Date.parse(c.captured_at))) throw new LmsError('invalid_response');
      origins.add(u.origin);
    }
    if (origins.size !== 1) throw new LmsError('boundary');
    this.origin = [...origins][0];
    // Keep only the newest capture of each page.
    const latest = new Map<string, MoodleCapture>();
    for (const c of config.captures) { const prev = latest.get(c.url); if (!prev || Date.parse(c.captured_at) > Date.parse(prev.captured_at)) latest.set(c.url, c); }
    this.captures = [...latest.values()];
    this.zone = config.displayTimeZone;
    this.now = config.now ?? (() => new Date().toISOString());
  }

  private courseCaptures(courseExternalId: string) {
    const courseId = id(courseExternalId), list = this.captures.filter(c => c.course.id === courseId);
    if (!list.length) throw new LmsError('boundary');
    return {courseId, list};
  }

  private issues(list: MoodleCapture[]) {
    return [...new Set([
      'Moodle data comes from pages the Companion captured, not a live Moodle API; anything not yet captured is missing.',
      ...list.flatMap(c => c.coverage?.issues ?? []),
      ...(list.some(c => c.coverage?.files_truncated) ? ['A captured page listed more than 200 files; file discovery is incomplete.'] : []),
    ])];
  }

  async listCourses(): Promise<Listing<Course>> {
    const observedAt = this.now(), seen = new Map<string, MoodleCapture>();
    for (const c of this.captures) { const prev = seen.get(c.course.id); if (!prev || c.captured_at > prev.captured_at) seen.set(c.course.id, c); }
    const items = [...seen.values()].map(c => ({
      ref: `${this.id}/${c.course.id}`, externalId: c.course.id, code: label(c.course.shortname ?? c.course.title), title: label(c.course.title),
      provenance: provenance('moodle', c.course, {sourceUrl: c.course.url, readFrom: 'companion capture', version: c.captured_at, observedAt}),
    }));
    return {items, complete: false, issues: this.issues(this.captures)};
  }

  private docId(url: URL): string {
    if (url.pathname === '/course/view.php') return 'course';
    if (url.pathname === '/mod/forum/discuss.php') return `discussion:${id(url.searchParams.get('d'))}`;
    return `cm:${id(url.searchParams.get('id'))}`;
  }

  async listAssignments(courseExternalId: string): Promise<Listing<Assignment>> {
    const {courseId, list} = this.courseCaptures(courseExternalId), observedAt = this.now();
    const items = list.filter(c => new URL(c.url).pathname === '/mod/assign/view.php').map(c => {
      const cm = id(new URL(c.url).searchParams.get('id')), dueText = moodleDueText(c.body);
      return {
        ref: `${this.id}/${courseId}/assignment:${cm}`, courseRef: `${this.id}/${courseId}`, externalId: cm, title: label(c.title),
        dueAt: dueText ? moodleDueToIso(dueText, this.zone) : null, dueText,
        submission: 'unverified' as const, grade: 'unverified' as const,
        provenance: provenance('moodle', c, {sourceUrl: c.url, readFrom: 'companion capture', version: c.captured_at, observedAt}),
      };
    });
    const issues = this.issues(list);
    if (!this.zone && items.some(a => a.dueText)) issues.push('Moodle shows due dates without a time zone; set displayTimeZone to the student\'s Moodle profile zone to get exact due times.');
    return {items, complete: false, issues};
  }

  async listDocuments(courseExternalId: string): Promise<Listing<DocumentRef>> {
    const {courseId, list} = this.courseCaptures(courseExternalId), observedAt = this.now(), courseRef = `${this.id}/${courseId}`;
    const items: DocumentRef[] = [];
    const files = new Map<string, {url: string; title: string; from: MoodleCapture}>();
    for (const c of list) {
      const u = new URL(c.url), k = kindOf(u);
      if (k) {
        const externalId = this.docId(u);
        items.push({ref: `${courseRef}/${externalId}`, courseRef, externalId, kind: k === 'assignment' ? 'assignment-instructions' : k, title: label(c.title), contentAvailable: !!c.body.trim(),
          provenance: provenance('moodle', c, {sourceUrl: c.url, readFrom: 'companion capture', version: c.captured_at, observedAt})});
      }
      for (const f of c.coverage?.files ?? []) if (!files.has(f.url)) files.set(f.url, {...f, from: c});
    }
    for (const f of files.values()) {
      const externalId = 'file:' + sha256(f.url).slice(7, 23);
      items.push({ref: `${courseRef}/${externalId}`, courseRef, externalId, kind: 'file', title: label(f.title), contentAvailable: false,
        provenance: provenance('moodle', {url: f.url, title: f.title}, {sourceUrl: f.url, readFrom: f.from.url, version: f.from.captured_at, observedAt})});
    }
    const issues = this.issues(list);
    if (files.size) issues.push('Moodle files are listed from captured links only; this connector does not read file bodies (the Companion\'s attachment reader does).');
    return {items, complete: false, issues};
  }

  async getDocument(courseExternalId: string, documentExternalId: string): Promise<DocumentContent> {
    const docs = await this.listDocuments(courseExternalId);
    const ref = docs.items.find(d => d.externalId === documentExternalId);
    if (!ref) throw new LmsError('not_found');
    if (ref.kind === 'file') return {...ref, role: 'untrusted course material', format: 'none', content: '', contentSha256: sha256('')};
    const {list} = this.courseCaptures(courseExternalId);
    const c = list.find(x => this.docId(new URL(x.url)) === documentExternalId && kindOf(new URL(x.url)));
    if (!c) throw new LmsError('not_found');
    return {...ref, role: 'untrusted course material', format: 'text', content: c.body, contentSha256: sha256(c.body)};
  }
}

// Canvas LMS connector (REST API v1, read-only): profile identity check, courses
// with Link-header paging, assignments, pages and file metadata.
import {ReadOnlyLms, LmsError, row, id, label, explicitDate, canvasPage, type ReadConfig} from '../read-only';
import {provenance, sha256} from '../provenance';
import type {Assignment, Course, DocumentContent, DocumentRef, Listing, LmsConnector} from '../types';

export type CanvasConfig = ReadConfig & {id: string; expectedIdentity: string; now?: () => string};

export class CanvasConnector implements LmsConnector {
  readonly provider = 'canvas' as const;
  readonly id: string;
  readonly origin: string;
  private readonly api: ReadOnlyLms;
  private readonly expectedIdentity: string;
  private readonly now: () => string;

  constructor(config: CanvasConfig) {
    this.api = new ReadOnlyLms(config);
    this.origin = this.api.origin;
    this.id = label(config.id);
    this.expectedIdentity = id(config.expectedIdentity);
    this.now = config.now ?? (() => new Date().toISOString());
  }

  private async checkIdentity() {
    const path = '/api/v1/users/self/profile';
    const who = id(row((await this.api.get(path, path)).data).id);
    if (who !== this.expectedIdentity) throw new LmsError('identity_changed');
  }

  async listCourses(): Promise<Listing<Course>> {
    await this.checkIdentity();
    const observedAt = this.now(), path = '/api/v1/courses';
    const page = await this.api.list(path + '?enrollment_type=student&enrollment_state=active&per_page=100', path, canvasPage);
    const items = page.items.map(c => {
      const externalId = id(c.id);
      return {
        ref: `${this.id}/${externalId}`, externalId, code: label(c.course_code), title: label(c.name),
        provenance: provenance('canvas', c, {sourceUrl: `${this.origin}/courses/${externalId}`, readFrom: path, version: c.updated_at, observedAt}),
      };
    });
    return {items, complete: page.complete, issues: page.complete ? [] : ['Canvas course list stopped at the page budget; more courses may exist.']};
  }

  /** Every course-scoped read first proves the course is one of this student's active enrollments. */
  private async enrolled(courseExternalId: string): Promise<string> {
    const courseId = id(courseExternalId), courses = await this.listCourses();
    if (!courses.items.some(c => c.externalId === courseId)) throw new LmsError(courses.complete ? 'boundary' : 'budget');
    return courseId;
  }

  private async rawAssignments(courseId: string) {
    const path = `/api/v1/courses/${courseId}/assignments`;
    const page = await this.api.list(path + '?per_page=100', path, canvasPage);
    for (const a of page.items) {
      if (a.course_id !== undefined && id(a.course_id) !== courseId) throw new LmsError('boundary');
      if (a.description !== null && a.description !== undefined && typeof a.description !== 'string') throw new LmsError('invalid_response');
    }
    return {page, path};
  }

  async listAssignments(courseExternalId: string): Promise<Listing<Assignment>> {
    const courseId = await this.enrolled(courseExternalId), observedAt = this.now();
    const {page, path} = await this.rawAssignments(courseId);
    const items = page.items.map(a => {
      const externalId = id(a.id);
      return {
        ref: `${this.id}/${courseId}/assignment:${externalId}`, courseRef: `${this.id}/${courseId}`, externalId,
        title: label(a.name), dueAt: explicitDate(a.due_at), dueText: null, submission: 'unverified' as const, grade: 'unverified' as const,
        provenance: provenance('canvas', a, {sourceUrl: `${this.origin}/courses/${courseId}/assignments/${externalId}`, readFrom: path, version: a.updated_at, observedAt}),
      };
    });
    return {items, complete: page.complete, issues: page.complete ? [] : ['Canvas assignment list stopped at the page budget.']};
  }

  async listDocuments(courseExternalId: string): Promise<Listing<DocumentRef>> {
    const courseId = await this.enrolled(courseExternalId), observedAt = this.now(), courseRef = `${this.id}/${courseId}`;
    const pagesPath = `/api/v1/courses/${courseId}/pages`, filesPath = `/api/v1/courses/${courseId}/files`;
    const pages = await this.api.list(pagesPath + '?per_page=100', pagesPath, canvasPage);
    const files = await this.api.list(filesPath + '?per_page=100', filesPath, canvasPage);
    const {page: assignments, path: assignPath} = await this.rawAssignments(courseId);
    const items: DocumentRef[] = [
      ...pages.items.map(p => {
        const pid = id(p.page_id), slug = label(p.url);
        return {ref: `${courseRef}/page:${pid}`, courseRef, externalId: `page:${pid}`, kind: 'page' as const, title: label(p.title), contentAvailable: true,
          provenance: provenance('canvas', p, {sourceUrl: `${this.origin}/courses/${courseId}/pages/${slug}`, readFrom: pagesPath, version: p.updated_at, observedAt})};
      }),
      ...assignments.items.map(a => {
        const aid = id(a.id);
        return {ref: `${courseRef}/assignment:${aid}`, courseRef, externalId: `assignment:${aid}`, kind: 'assignment-instructions' as const, title: label(a.name), contentAvailable: typeof a.description === 'string' && !!a.description,
          provenance: provenance('canvas', a, {sourceUrl: `${this.origin}/courses/${courseId}/assignments/${aid}`, readFrom: assignPath, version: a.updated_at, observedAt})};
      }),
      ...files.items.map(f => {
        const fid = id(f.id);
        return {ref: `${courseRef}/file:${fid}`, courseRef, externalId: `file:${fid}`, kind: 'file' as const, title: label(f.display_name), contentAvailable: false,
          provenance: provenance('canvas', f, {sourceUrl: `${this.origin}/courses/${courseId}/files/${fid}`, readFrom: filesPath, version: f.updated_at, observedAt})};
      }),
    ];
    const complete = pages.complete && files.complete && assignments.complete;
    const issues = [
      ...(files.items.length ? ['Canvas files are listed with metadata only; this prototype does not download or extract file bodies.'] : []),
      ...(complete ? [] : ['A Canvas document list stopped at the page budget.']),
    ];
    return {items, complete, issues};
  }

  async getDocument(courseExternalId: string, documentExternalId: string): Promise<DocumentContent> {
    const courseId = await this.enrolled(courseExternalId), observedAt = this.now(), courseRef = `${this.id}/${courseId}`;
    const m = /^(page|assignment|file):([1-9]\d{0,18})$/.exec(documentExternalId);
    if (!m) throw new LmsError('not_found');
    const [, kind, docId] = m;
    if (kind === 'page') {
      const path = `/api/v1/courses/${courseId}/pages/${docId}`;
      const p = row((await this.api.get(path, path)).data);
      if (id(p.page_id) !== docId) throw new LmsError('boundary');
      if (p.body !== null && p.body !== undefined && typeof p.body !== 'string') throw new LmsError('invalid_response');
      const content = (p.body as string | null) || '';
      return {ref: `${courseRef}/page:${docId}`, courseRef, externalId: documentExternalId, kind: 'page', title: label(p.title), contentAvailable: true,
        role: 'untrusted course material', format: 'html', content, contentSha256: sha256(content),
        provenance: provenance('canvas', p, {sourceUrl: `${this.origin}/courses/${courseId}/pages/${label(p.url)}`, readFrom: path, version: p.updated_at, observedAt})};
    }
    if (kind === 'assignment') {
      const {page, path} = await this.rawAssignments(courseId);
      const a = page.items.find(x => id(x.id) === docId);
      if (!a) throw new LmsError('not_found');
      const content = (a.description as string | null) || '';
      return {ref: `${courseRef}/assignment:${docId}`, courseRef, externalId: documentExternalId, kind: 'assignment-instructions', title: label(a.name), contentAvailable: !!content,
        role: 'untrusted course material', format: content ? 'html' : 'none', content, contentSha256: sha256(content),
        provenance: provenance('canvas', a, {sourceUrl: `${this.origin}/courses/${courseId}/assignments/${docId}`, readFrom: path, version: a.updated_at, observedAt})};
    }
    const filesPath = `/api/v1/courses/${courseId}/files`;
    const files = await this.api.list(filesPath + '?per_page=100', filesPath, canvasPage);
    const f = files.items.find(x => id(x.id) === docId);
    if (!f) throw new LmsError(files.complete ? 'not_found' : 'budget');
    return {ref: `${courseRef}/file:${docId}`, courseRef, externalId: documentExternalId, kind: 'file', title: label(f.display_name), contentAvailable: false,
      role: 'untrusted course material', format: 'none', content: '', contentSha256: sha256(''),
      provenance: provenance('canvas', f, {sourceUrl: `${this.origin}/courses/${courseId}/files/${docId}`, readFrom: filesPath, version: f.updated_at, observedAt})};
  }
}

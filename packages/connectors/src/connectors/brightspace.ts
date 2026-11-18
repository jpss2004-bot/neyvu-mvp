// D2L Brightspace connector (Valence LP/LE APIs, read-only): identity check,
// enrollments with bookmark paging, dropbox folders and the content TOC.
import {ReadOnlyLms, LmsError, row, rows, id, label, explicitDate, brightspacePage, type ReadConfig, type Row} from '../read-only';
import {provenance, sha256} from '../provenance';
import type {Assignment, Course, DocumentContent, DocumentRef, Listing, LmsConnector} from '../types';

export type BrightspaceConfig = ReadConfig & {id: string; expectedIdentity: string; lpVersion: string; leVersion: string; now?: () => string};

type Topic = {raw: Row; topicId: string; title: string; html: string; text: string};

export class BrightspaceConnector implements LmsConnector {
  readonly provider = 'brightspace' as const;
  readonly id: string;
  readonly origin: string;
  private readonly api: ReadOnlyLms;
  private readonly lp: string;
  private readonly le: string;
  private readonly expectedIdentity: string;
  private readonly now: () => string;

  constructor(config: BrightspaceConfig) {
    this.api = new ReadOnlyLms(config);
    this.origin = this.api.origin;
    // API versions are registered per institution, never guessed from the UI.
    if (![config.lpVersion, config.leVersion].every(v => /^1\.\d{1,3}$/.test(v))) throw new LmsError('configuration');
    this.lp = config.lpVersion; this.le = config.leVersion;
    this.id = label(config.id);
    this.expectedIdentity = id(config.expectedIdentity);
    this.now = config.now ?? (() => new Date().toISOString());
  }

  private async checkIdentity() {
    const path = `/d2l/api/lp/${this.lp}/users/whoami`;
    if (id(row((await this.api.get(path, path)).data).Identifier) !== this.expectedIdentity) throw new LmsError('identity_changed');
  }

  async listCourses(): Promise<Listing<Course>> {
    await this.checkIdentity();
    const observedAt = this.now(), path = `/d2l/api/lp/${this.lp}/enrollments/myenrollments/`;
    const page = await this.api.list(path, path, brightspacePage);
    const items = page.items.map(e => row(e.OrgUnit)).filter(c => row(c.Type).Id === 3).map(c => {
      const externalId = id(c.Id);
      return {
        ref: `${this.id}/${externalId}`, externalId, code: label(c.Code), title: label(c.Name),
        provenance: provenance('brightspace', c, {sourceUrl: `${this.origin}/d2l/home/${externalId}`, readFrom: path, version: null, observedAt}),
      };
    });
    return {items, complete: page.complete, issues: page.complete ? [] : ['Brightspace enrollment list stopped at the page budget; more courses may exist.']};
  }

  private async enrolled(courseExternalId: string): Promise<string> {
    const courseId = id(courseExternalId), courses = await this.listCourses();
    if (!courses.items.some(c => c.externalId === courseId)) throw new LmsError(courses.complete ? 'boundary' : 'budget');
    return courseId;
  }

  private async folders(courseId: string) {
    const path = `/d2l/api/le/${this.le}/${courseId}/dropbox/folders/`, folders = rows((await this.api.get(path, path)).data);
    if (folders.length > 5000) throw new LmsError('budget');
    return {path, folders: folders.map(a => {
      const instructions = a.Instructions === null || a.Instructions === undefined ? {} : row(a.Instructions);
      if (instructions.Html !== undefined && typeof instructions.Html !== 'string' || instructions.Text !== undefined && typeof instructions.Text !== 'string') throw new LmsError('invalid_response');
      const html = typeof instructions.Html === 'string' ? instructions.Html : '', text = typeof instructions.Text === 'string' ? instructions.Text : '';
      return {raw: a, externalId: id(a.Id), title: label(a.Name), dueAt: explicitDate(a.DueDate), content: html || text, format: html ? 'html' as const : text ? 'text' as const : 'none' as const};
    })};
  }

  private folderUrl(courseId: string, folderId: string) {
    return `${this.origin}/d2l/lms/dropbox/user/folder_submit_files.d2l?db=${folderId}&ou=${courseId}`;
  }

  async listAssignments(courseExternalId: string): Promise<Listing<Assignment>> {
    const courseId = await this.enrolled(courseExternalId), observedAt = this.now();
    const {path, folders} = await this.folders(courseId);
    const items = folders.map(f => ({
      ref: `${this.id}/${courseId}/assignment:${f.externalId}`, courseRef: `${this.id}/${courseId}`, externalId: f.externalId,
      title: f.title, dueAt: f.dueAt, dueText: null, submission: 'unverified' as const, grade: 'unverified' as const,
      provenance: provenance('brightspace', f.raw, {sourceUrl: this.folderUrl(courseId, f.externalId), readFrom: path, version: null, observedAt}),
    }));
    return {items, complete: true, issues: []};
  }

  /** Walk the content table of contents (modules may nest). */
  private async topics(courseId: string): Promise<{path: string; topics: Topic[]}> {
    const path = `/d2l/api/le/${this.le}/${courseId}/content/toc`, toc = row((await this.api.get(path, path)).data);
    const topics: Topic[] = [];
    const walk = (modules: unknown, depth: number) => {
      if (depth > 20) throw new LmsError('budget');
      for (const m of rows(modules)) {
        for (const t of rows(m.Topics ?? [])) {
          const d = t.Description === null || t.Description === undefined ? {} : row(t.Description);
          topics.push({raw: t, topicId: id(t.TopicId), title: label(t.Title), html: typeof d.Html === 'string' ? d.Html : '', text: typeof d.Text === 'string' ? d.Text : ''});
          if (topics.length > 5000) throw new LmsError('budget');
        }
        walk(m.Modules ?? [], depth + 1);
      }
    };
    walk(toc.Modules, 0);
    return {path, topics};
  }

  private topicUrl(courseId: string, topicId: string) {
    return `${this.origin}/d2l/le/content/${courseId}/viewContent/${topicId}/View`;
  }

  async listDocuments(courseExternalId: string): Promise<Listing<DocumentRef>> {
    const courseId = await this.enrolled(courseExternalId), observedAt = this.now(), courseRef = `${this.id}/${courseId}`;
    const {path: tocPath, topics} = await this.topics(courseId);
    const {path: dropPath, folders} = await this.folders(courseId);
    const items: DocumentRef[] = [
      ...topics.map(t => ({ref: `${courseRef}/topic:${t.topicId}`, courseRef, externalId: `topic:${t.topicId}`,
        kind: (t.raw.TypeIdentifier === 'Link' ? 'link' : 'file') as 'link' | 'file', title: t.title, contentAvailable: !!(t.html || t.text),
        provenance: provenance('brightspace', t.raw, {sourceUrl: this.topicUrl(courseId, t.topicId), readFrom: tocPath, version: t.raw.LastModifiedDate, observedAt})})),
      ...folders.map(f => ({ref: `${courseRef}/assignment:${f.externalId}`, courseRef, externalId: `assignment:${f.externalId}`,
        kind: 'assignment-instructions' as const, title: f.title, contentAvailable: f.format !== 'none',
        provenance: provenance('brightspace', f.raw, {sourceUrl: this.folderUrl(courseId, f.externalId), readFrom: dropPath, version: null, observedAt})})),
    ];
    return {items, complete: true, issues: topics.length ? ['Brightspace topics return their description only; this prototype does not download topic files.'] : []};
  }

  async getDocument(courseExternalId: string, documentExternalId: string): Promise<DocumentContent> {
    const courseId = await this.enrolled(courseExternalId), observedAt = this.now(), courseRef = `${this.id}/${courseId}`;
    const m = /^(topic|assignment):([1-9]\d{0,18})$/.exec(documentExternalId);
    if (!m) throw new LmsError('not_found');
    const [, kind, docId] = m;
    if (kind === 'topic') {
      const {path, topics} = await this.topics(courseId), t = topics.find(x => x.topicId === docId);
      if (!t) throw new LmsError('not_found');
      const content = t.html || t.text;
      return {ref: `${courseRef}/topic:${docId}`, courseRef, externalId: documentExternalId, kind: t.raw.TypeIdentifier === 'Link' ? 'link' : 'file', title: t.title, contentAvailable: !!content,
        role: 'untrusted course material', format: t.html ? 'html' : t.text ? 'text' : 'none', content, contentSha256: sha256(content),
        provenance: provenance('brightspace', t.raw, {sourceUrl: this.topicUrl(courseId, docId), readFrom: path, version: t.raw.LastModifiedDate, observedAt})};
    }
    const {path, folders} = await this.folders(courseId), f = folders.find(x => x.externalId === docId);
    if (!f) throw new LmsError('not_found');
    return {ref: `${courseRef}/assignment:${docId}`, courseRef, externalId: documentExternalId, kind: 'assignment-instructions', title: f.title, contentAvailable: f.format !== 'none',
      role: 'untrusted course material', format: f.format, content: f.content, contentSha256: sha256(f.content),
      provenance: provenance('brightspace', f.raw, {sourceUrl: this.folderUrl(courseId, docId), readFrom: path, version: null, observedAt})};
  }
}

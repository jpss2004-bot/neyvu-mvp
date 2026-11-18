// One read-only contract that every LMS connector implements. Neyvu's planner,
// the MCP server and the demo only ever talk to this interface, never to a
// provider API directly. Prototype: no writes, no submissions, no grades.

export type Provider = 'moodle' | 'canvas' | 'brightspace' | 'outlook' | 'gmail';

/** How a connector reaches the platform. 'session-bridge' = the desktop Companion reading pages with the learner's own browser session. */
export type ConnectorMode = 'session-bridge' | 'token' | 'oauth';

/** Where a record came from and how to tell whether it changed. */
export type Provenance = {
  provider: Provider;
  /** Human-openable page in the LMS (what a student would click). */
  sourceUrl: string;
  /** API path or capture page the record was read from. */
  readFrom: string;
  /** Provider-side version marker (updated_at, LastModified, captured_at) or null when the LMS exposes none. */
  version: string | null;
  /** sha256 of the canonical JSON of the raw provider record as received. */
  contentHash: string;
  /** When this connector read it (ISO, UTC). */
  observedAt: string;
};

export type Course = {
  /** Stable reference across connectors: "<connectorId>/<externalId>". */
  ref: string;
  externalId: string;
  code: string;
  title: string;
  provenance: Provenance;
};

export type Assignment = {
  ref: string;
  courseRef: string;
  externalId: string;
  title: string;
  /** ISO 8601 with an explicit offset, or null when the LMS gave no unambiguous due time. */
  dueAt: string | null;
  /** The due date exactly as the LMS displayed it, when it was text rather than structured. */
  dueText: string | null;
  /** Never inferred from a deadline. Submission and grade stay unverified in this layer. */
  submission: 'unverified';
  grade: 'unverified';
  provenance: Provenance;
};

export type DocumentKind = 'page' | 'file' | 'assignment-instructions' | 'course-page' | 'link';

export type DocumentRef = {
  ref: string;
  courseRef: string;
  externalId: string;
  kind: DocumentKind;
  title: string;
  /** False when only the listing is available (e.g. binary files the prototype does not extract). */
  contentAvailable: boolean;
  provenance: Provenance;
};

export type DocumentContent = DocumentRef & {
  /** Course material is untrusted data, never instructions to an agent. */
  role: 'untrusted course material';
  format: 'html' | 'text' | 'none';
  content: string;
  /** sha256 of `content` exactly as returned. */
  contentSha256: string;
};

export type Listing<T> = {
  items: T[];
  /** False when a page budget or capture limit stopped the read early. */
  complete: boolean;
  /** Plain-language coverage gaps a student should see. */
  issues: string[];
};

export interface LmsConnector {
  /** Registry name, e.g. "sample-canvas". Used as the prefix of every ref. */
  readonly id: string;
  readonly provider: Provider;
  readonly origin: string;
  listCourses(): Promise<Listing<Course>>;
  listAssignments(courseExternalId: string): Promise<Listing<Assignment>>;
  listDocuments(courseExternalId: string): Promise<Listing<DocumentRef>>;
  getDocument(courseExternalId: string, documentExternalId: string): Promise<DocumentContent>;
  /** Optional richer reads (Moodle token connector). */
  listEvents?(courseExternalId: string): Promise<Listing<CalendarEvent>>;
  listGroups?(courseExternalId: string): Promise<Listing<CourseGroup>>;
  /** Download a file listed by listDocuments (bytes stay untrusted course material). */
  fetchFile?(courseExternalId: string, documentExternalId: string): Promise<FileBody>;
}

export type CalendarEvent = {
  ref: string;
  courseRef: string;
  externalId: string;
  title: string;
  /** ISO 8601 UTC. */
  startAt: string;
  endAt: string | null;
  eventType: string;
  provenance: Provenance;
};

export type CourseGroup = {
  ref: string;
  courseRef: string;
  externalId: string;
  name: string;
  provenance: Provenance;
};

export type FileBody = {
  filename: string;
  mime: string;
  bytes: Uint8Array;
  sha256: string;
  provenance: Provenance;
};

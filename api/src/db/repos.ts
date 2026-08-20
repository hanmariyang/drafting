import type { DatabaseSync } from 'node:sqlite';
import { nanoid } from 'nanoid';
import { getDb, nowIso } from './index.ts';
import { seal, open, type Sealed } from '../lib/crypto.ts';
import type {
  Project,
  Document,
  Section,
  SectionStatus,
  Suggestion,
  SuggestionKind,
  InterviewSession,
  InterviewAnswer,
  DocumentSnapshot,
  DocumentType,
  ProviderId,
  VersionEvent,
} from '../lib/types.ts';

function db(): DatabaseSync {
  return getDb();
}

// ─── Projects ──────────────────────────────────────────────────────────────

export function createProject(name: string, description = ''): Project {
  const id = nanoid();
  const ts = nowIso();
  db()
    .prepare(
      `INSERT INTO projects (id, name, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, name, description, ts, ts);
  return getProject(id)!;
}

export function listProjects(): Project[] {
  return db()
    .prepare('SELECT * FROM projects ORDER BY updated_at DESC')
    .all() as unknown as Project[];
}

export function getProject(id: string): Project | null {
  return (db().prepare('SELECT * FROM projects WHERE id = ?').get(id) as
    | Project
    | undefined) ?? null;
}

export function updateProject(
  id: string,
  patch: Partial<Pick<Project, 'name' | 'description'>>,
): Project | null {
  const cur = getProject(id);
  if (!cur) return null;
  db()
    .prepare('UPDATE projects SET name = ?, description = ?, updated_at = ? WHERE id = ?')
    .run(patch.name ?? cur.name, patch.description ?? cur.description, nowIso(), id);
  return getProject(id);
}

export function deleteProject(id: string): void {
  db().prepare('DELETE FROM projects WHERE id = ?').run(id);
}

// ─── Documents ───────────────────────────────────────────────────────────────

export function createDocument(input: {
  projectId: string;
  type: DocumentType;
  title: string;
  parentDocumentId?: string | null;
}): Document {
  const id = nanoid();
  const ts = nowIso();
  // inherit source version from parent at creation time (SPEC-04)
  let sourceVersion: number | null = null;
  if (input.parentDocumentId) {
    const parent = getDocument(input.parentDocumentId);
    sourceVersion = parent ? parent.version : null;
  }
  db()
    .prepare(
      `INSERT INTO documents
         (id, project_id, type, title, status, parent_document_id, version,
          context_stale, context_source_version, context_pending_version,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, 'draft', ?, 0, 0, ?, NULL, ?, ?)`,
    )
    .run(
      id,
      input.projectId,
      input.type,
      input.title,
      input.parentDocumentId ?? null,
      sourceVersion,
      ts,
      ts,
    );
  return getDocument(id)!;
}

export function getDocument(id: string): Document | null {
  return (db().prepare('SELECT * FROM documents WHERE id = ?').get(id) as
    | Document
    | undefined) ?? null;
}

export function listDocuments(projectId: string): Document[] {
  return db()
    .prepare('SELECT * FROM documents WHERE project_id = ? ORDER BY created_at ASC')
    .all(projectId) as unknown as Document[];
}

export function updateDocumentTitle(id: string, title: string): Document | null {
  if (!getDocument(id)) return null;
  db()
    .prepare('UPDATE documents SET title = ?, updated_at = ? WHERE id = ?')
    .run(title, nowIso(), id);
  return getDocument(id);
}

export function setDocumentStatus(id: string, status: Document['status']): void {
  db()
    .prepare('UPDATE documents SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, nowIso(), id);
}

export function deleteDocument(id: string): void {
  db().prepare('DELETE FROM documents WHERE id = ?').run(id);
}

// ─── Sections ────────────────────────────────────────────────────────────────

export function listSections(documentId: string): Section[] {
  return db()
    .prepare('SELECT * FROM sections WHERE document_id = ? ORDER BY position ASC')
    .all(documentId) as unknown as Section[];
}

export function getSection(id: string): Section | null {
  return (db().prepare('SELECT * FROM sections WHERE id = ?').get(id) as
    | Section
    | undefined) ?? null;
}

export function createSection(
  documentId: string,
  heading: string,
  body: string,
  position?: number,
  status: SectionStatus = 'accepted',
): Section {
  const id = nanoid();
  const ts = nowIso();
  const pos =
    position ??
    ((db()
      .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM sections WHERE document_id = ?')
      .get(documentId) as { p: number }).p);
  db()
    .prepare(
      `INSERT INTO sections (id, document_id, position, heading, body, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, documentId, pos, heading, body, status, ts, ts);
  return getSection(id)!;
}

export function setSectionStatus(id: string, status: SectionStatus): Section | null {
  if (!getSection(id)) return null;
  db()
    .prepare('UPDATE sections SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, nowIso(), id);
  return getSection(id);
}

/** Accepted sections only — the actual document (SYSTEM.md §0.2). Used by export/share. */
export function listAcceptedSections(documentId: string): Section[] {
  return db()
    .prepare(
      "SELECT * FROM sections WHERE document_id = ? AND status = 'accepted' ORDER BY position ASC",
    )
    .all(documentId) as unknown as Section[];
}

/** Count of sections excluded from export (proposed or rejected). */
export function countExcludedSections(documentId: string): number {
  return (
    db()
      .prepare(
        "SELECT COUNT(*) AS n FROM sections WHERE document_id = ? AND status != 'accepted'",
      )
      .get(documentId) as { n: number }
  ).n;
}

export function updateSection(
  id: string,
  patch: Partial<Pick<Section, 'heading' | 'body'>>,
): Section | null {
  const cur = getSection(id);
  if (!cur) return null;
  db()
    .prepare('UPDATE sections SET heading = ?, body = ?, updated_at = ? WHERE id = ?')
    .run(patch.heading ?? cur.heading, patch.body ?? cur.body, nowIso(), id);
  return getSection(id);
}

export function deleteSection(id: string): void {
  db().prepare('DELETE FROM sections WHERE id = ?').run(id);
}

/**
 * Replace all sections of a document. `status` sets the state of the new
 * sections — 'accepted' for direct/restore writes (default, preserves prior
 * behaviour), 'proposed' when the AI drafts them (SYSTEM.md §0.1).
 */
export function replaceSections(
  documentId: string,
  sections: Array<{ heading: string; body: string }>,
  status: SectionStatus = 'accepted',
): Section[] {
  db().prepare('DELETE FROM sections WHERE document_id = ?').run(documentId);
  sections.forEach((s, i) => createSection(documentId, s.heading, s.body, i, status));
  return listSections(documentId);
}

/** Reorder sections by an explicit id ordering. Missing ids are appended. */
export function reorderSections(documentId: string, orderedIds: string[]): Section[] {
  const existing = listSections(documentId);
  const byId = new Map(existing.map((s) => [s.id, s]));
  let pos = 0;
  const ts = nowIso();
  for (const id of orderedIds) {
    if (byId.has(id)) {
      db()
        .prepare('UPDATE sections SET position = ?, updated_at = ? WHERE id = ?')
        .run(pos++, ts, id);
      byId.delete(id);
    }
  }
  // append any not mentioned, preserving old order
  for (const s of byId.values()) {
    db().prepare('UPDATE sections SET position = ? WHERE id = ?').run(pos++, s.id);
  }
  return listSections(documentId);
}

// ─── Suggestions / AI proposal queue (SYSTEM.md §0) ──────────────────────────

export function createSuggestion(input: {
  documentId: string;
  sectionId?: string | null;
  kind: SuggestionKind;
  title: string;
  body?: string;
  quoteBefore?: string;
  quoteAfter?: string;
  source: string;
}): Suggestion {
  const id = nanoid();
  const ts = nowIso();
  db()
    .prepare(
      `INSERT INTO suggestions
         (id, document_id, section_id, kind, title, body, quote_before, quote_after,
          source, status, created_at, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, NULL)`,
    )
    .run(
      id,
      input.documentId,
      input.sectionId ?? null,
      input.kind,
      input.title,
      input.body ?? '',
      input.quoteBefore ?? '',
      input.quoteAfter ?? '',
      input.source,
      ts,
    );
  return getSuggestion(id)!;
}

export function getSuggestion(id: string): Suggestion | null {
  return (db().prepare('SELECT * FROM suggestions WHERE id = ?').get(id) as
    | Suggestion
    | undefined) ?? null;
}

export function listSuggestions(
  documentId: string,
  status?: Suggestion['status'],
): Suggestion[] {
  if (status) {
    return db()
      .prepare(
        'SELECT * FROM suggestions WHERE document_id = ? AND status = ? ORDER BY created_at ASC',
      )
      .all(documentId, status) as unknown as Suggestion[];
  }
  return db()
    .prepare('SELECT * FROM suggestions WHERE document_id = ? ORDER BY created_at ASC')
    .all(documentId) as unknown as Suggestion[];
}

export function countOpenSuggestions(documentId: string): number {
  return (
    db()
      .prepare("SELECT COUNT(*) AS n FROM suggestions WHERE document_id = ? AND status = 'open'")
      .get(documentId) as { n: number }
  ).n;
}

export function resolveSuggestion(id: string, status: Suggestion['status']): Suggestion | null {
  if (!getSuggestion(id)) return null;
  db()
    .prepare('UPDATE suggestions SET status = ?, resolved_at = ? WHERE id = ?')
    .run(status, nowIso(), id);
  return getSuggestion(id);
}

// ─── Version history & context chain (P-01, SPEC-12) ─────────────────────────

export function snapshotDocument(
  documentId: string,
  event: VersionEvent,
  meta: Record<string, unknown> = {},
  note = '',
): number {
  const doc = getDocument(documentId);
  if (!doc) throw new Error('document not found');
  const sections = listSections(documentId);
  const snapshot: DocumentSnapshot = {
    title: doc.title,
    sections: sections.map((s) => ({
      heading: s.heading,
      body: s.body,
      position: s.position,
    })),
  };
  const newVersion = doc.version + 1;
  db()
    .prepare('UPDATE documents SET version = ?, updated_at = ? WHERE id = ?')
    .run(newVersion, nowIso(), documentId);
  db()
    .prepare(
      `INSERT INTO document_versions
         (id, document_id, version, event_type, snapshot, meta, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      nanoid(),
      documentId,
      newVersion,
      event,
      JSON.stringify(snapshot),
      JSON.stringify(meta),
      note,
      nowIso(),
    );
  // Any structural change to this doc invalidates the inherited context of its
  // children (P-01 §2). We only ever mark them stale — never auto-overwrite.
  markChildrenStale(documentId, newVersion);
  return newVersion;
}

/**
 * Mark every direct child whose inherited version is out of date as stale.
 * Per SYSTEM.md §0.5, a parent change sends the affected child's accepted
 * sections back to 'proposed' and opens a kind='stale' suggestion so the editor
 * re-reviews them. We never rewrite bodies here (G-02) — only flip status.
 */
export function markChildrenStale(parentId: string, parentVersion: number): void {
  const parent = getDocument(parentId);
  const children = db()
    .prepare('SELECT * FROM documents WHERE parent_document_id = ?')
    .all(parentId) as unknown as Document[];
  for (const child of children) {
    // Only act on a fresh transition to avoid re-flipping already-stale children.
    const wasStale = child.context_stale === 1;
    if (child.context_source_version !== parentVersion) {
      db()
        .prepare(
          `UPDATE documents
             SET context_stale = 1, context_pending_version = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(parentVersion, nowIso(), child.id);
      if (!wasStale) {
        db()
          .prepare(
            "UPDATE sections SET status = 'proposed', updated_at = ? WHERE document_id = ? AND status = 'accepted'",
          )
          .run(nowIso(), child.id);
        createSuggestion({
          documentId: child.id,
          sectionId: null,
          kind: 'stale',
          title: '상위 문서 변경으로 재검토 필요',
          body: '상위 문서가 갱신되어 이 문서의 섹션이 다시 제안 상태로 돌아왔습니다. 컨텍스트를 갱신하고 각 섹션을 다시 수락하세요.',
          source: parent
            ? `${parent.type} "${parent.title}" v${parentVersion}`
            : `상위 문서 v${parentVersion}`,
        });
      }
    }
  }
}

export interface ParentContext {
  parentId: string;
  parentType: DocumentType;
  parentTitle: string;
  parentVersion: number;
  sections: Array<{ heading: string; body: string }>;
}

export function getParentContext(documentId: string): ParentContext | null {
  const doc = getDocument(documentId);
  if (!doc?.parent_document_id) return null;
  const parent = getDocument(doc.parent_document_id);
  if (!parent) return null;
  return {
    parentId: parent.id,
    parentType: parent.type,
    parentTitle: parent.title,
    parentVersion: parent.version,
    sections: listSections(parent.id).map((s) => ({
      heading: s.heading,
      body: s.body,
    })),
  };
}

/**
 * Flow (A) from P-01: refresh inherited context ONLY. Child section bodies are
 * left byte-for-byte unchanged. Records a `context_inherit` version event.
 */
export function refreshContext(documentId: string): Document | null {
  const doc = getDocument(documentId);
  if (!doc?.parent_document_id) return doc;
  const parent = getDocument(doc.parent_document_id);
  if (!parent) return doc;
  db()
    .prepare(
      `UPDATE documents
         SET context_stale = 0, context_source_version = ?, context_pending_version = NULL,
             updated_at = ?
       WHERE id = ?`,
    )
    .run(parent.version, nowIso(), documentId);
  snapshotDocument(documentId, 'context_inherit', {
    inherited_from: { parent_document_id: parent.id, parent_version: parent.version },
  });
  return getDocument(documentId);
}

export interface VersionRow {
  id: string;
  document_id: string;
  version: number;
  event_type: VersionEvent;
  snapshot: string;
  meta: string;
  note: string;
  created_at: string;
}

export function listVersions(documentId: string): Array<Omit<VersionRow, 'snapshot'>> {
  return db()
    .prepare(
      `SELECT id, document_id, version, event_type, meta, note, created_at
         FROM document_versions WHERE document_id = ? ORDER BY version DESC`,
    )
    .all(documentId) as Array<Omit<VersionRow, 'snapshot'>>;
}

export function getVersion(versionRowId: string): VersionRow | null {
  return (db()
    .prepare('SELECT * FROM document_versions WHERE id = ?')
    .get(versionRowId) as VersionRow | undefined) ?? null;
}

/** Restore a document's sections from a version snapshot. Records `restore`. */
export function restoreVersion(documentId: string, versionRowId: string): Document | null {
  const v = getVersion(versionRowId);
  if (!v || v.document_id !== documentId) return null;
  const snap = JSON.parse(v.snapshot) as DocumentSnapshot;
  const ordered = [...snap.sections].sort((a, b) => a.position - b.position);
  replaceSections(
    documentId,
    ordered.map((s) => ({ heading: s.heading, body: s.body })),
  );
  updateDocumentTitle(documentId, snap.title);
  snapshotDocument(documentId, 'restore', { restored_from_version: v.version });
  return getDocument(documentId);
}

// ─── Interview sessions ──────────────────────────────────────────────────────

interface SessionRow {
  id: string;
  document_id: string;
  template_id: string;
  status: 'active' | 'complete';
  current_index: number;
  answers: string;
  created_at: string;
  updated_at: string;
}

function hydrateSession(row: SessionRow): InterviewSession {
  return { ...row, answers: JSON.parse(row.answers) as unknown as InterviewAnswer[] };
}

export function createSession(documentId: string, templateId: string): InterviewSession {
  const id = nanoid();
  const ts = nowIso();
  db()
    .prepare(
      `INSERT INTO interview_sessions
         (id, document_id, template_id, status, current_index, answers, created_at, updated_at)
       VALUES (?, ?, ?, 'active', 0, '[]', ?, ?)`,
    )
    .run(id, documentId, templateId, ts, ts);
  return getSession(id)!;
}

export function getSession(id: string): InterviewSession | null {
  const row = db().prepare('SELECT * FROM interview_sessions WHERE id = ?').get(id) as
    | SessionRow
    | undefined;
  return row ? hydrateSession(row) : null;
}

export function getSessionByDocument(documentId: string): InterviewSession | null {
  const row = db()
    .prepare(
      'SELECT * FROM interview_sessions WHERE document_id = ? ORDER BY created_at DESC LIMIT 1',
    )
    .get(documentId) as SessionRow | undefined;
  return row ? hydrateSession(row) : null;
}

export function updateSession(
  id: string,
  patch: Partial<Pick<InterviewSession, 'status' | 'current_index' | 'answers'>>,
): InterviewSession | null {
  const cur = getSession(id);
  if (!cur) return null;
  db()
    .prepare(
      `UPDATE interview_sessions
         SET status = ?, current_index = ?, answers = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      patch.status ?? cur.status,
      patch.current_index ?? cur.current_index,
      JSON.stringify(patch.answers ?? cur.answers),
      nowIso(),
      id,
    );
  return getSession(id);
}

// ─── BYOK keys (encrypted) ───────────────────────────────────────────────────

export interface KeyMeta {
  id: string;
  provider: ProviderId;
  label: string;
  last4: string;
  created_at: string;
  updated_at: string;
}

export function upsertApiKey(provider: ProviderId, plaintextKey: string, label = ''): KeyMeta {
  const sealed = seal(plaintextKey);
  const last4 = plaintextKey.slice(-4);
  const ts = nowIso();
  const existing = db()
    .prepare('SELECT id FROM api_keys WHERE provider = ?')
    .get(provider) as { id: string } | undefined;
  if (existing) {
    db()
      .prepare(
        `UPDATE api_keys
           SET label = ?, ciphertext = ?, iv = ?, auth_tag = ?, last4 = ?, updated_at = ?
         WHERE provider = ?`,
      )
      .run(label, sealed.ciphertext, sealed.iv, sealed.authTag, last4, ts, provider);
  } else {
    db()
      .prepare(
        `INSERT INTO api_keys
           (id, provider, label, ciphertext, iv, auth_tag, last4, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(nanoid(), provider, label, sealed.ciphertext, sealed.iv, sealed.authTag, last4, ts, ts);
  }
  return getKeyMeta(provider)!;
}

export function getKeyMeta(provider: ProviderId): KeyMeta | null {
  return (db()
    .prepare(
      'SELECT id, provider, label, last4, created_at, updated_at FROM api_keys WHERE provider = ?',
    )
    .get(provider) as KeyMeta | undefined) ?? null;
}

export function listKeyMeta(): KeyMeta[] {
  return db()
    .prepare(
      'SELECT id, provider, label, last4, created_at, updated_at FROM api_keys ORDER BY provider',
    )
    .all() as unknown as KeyMeta[];
}

/** Decrypt and return the raw key for a provider (server-internal use only). */
export function getDecryptedKey(provider: ProviderId): string | null {
  const row = db()
    .prepare('SELECT ciphertext, iv, auth_tag FROM api_keys WHERE provider = ?')
    .get(provider) as
    | { ciphertext: string; iv: string; auth_tag: string }
    | undefined;
  if (!row) return null;
  const sealed: Sealed = {
    ciphertext: row.ciphertext,
    iv: row.iv,
    authTag: row.auth_tag,
  };
  return open(sealed);
}

export function deleteApiKey(provider: ProviderId): void {
  db().prepare('DELETE FROM api_keys WHERE provider = ?').run(provider);
}

// ─── Share links (SPEC-14) ───────────────────────────────────────────────────

export interface ShareLink {
  id: string;
  document_id: string;
  token: string;
  expires_at: string | null;
  revoked: number;
  created_at: string;
}

export function createShareLink(documentId: string, expiresAt: string | null): ShareLink {
  const id = nanoid();
  const token = nanoid(24);
  db()
    .prepare(
      `INSERT INTO share_links (id, document_id, token, expires_at, revoked, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`,
    )
    .run(id, documentId, token, expiresAt, nowIso());
  return db().prepare('SELECT * FROM share_links WHERE id = ?').get(id) as unknown as ShareLink;
}

export function getShareByToken(token: string): ShareLink | null {
  return (db().prepare('SELECT * FROM share_links WHERE token = ?').get(token) as
    | ShareLink
    | undefined) ?? null;
}

export function listShareLinks(documentId: string): ShareLink[] {
  return db()
    .prepare('SELECT * FROM share_links WHERE document_id = ? ORDER BY created_at DESC')
    .all(documentId) as unknown as ShareLink[];
}

export function revokeShareLink(id: string): void {
  db().prepare('UPDATE share_links SET revoked = 1 WHERE id = ?').run(id);
}

// ─── Settings (SPEC-19, onboarding) ──────────────────────────────────────────

export function getSetting<T = unknown>(key: string): T | null {
  const row = db().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row ? (JSON.parse(row.value) as T) : null;
}

export function setSetting(key: string, value: unknown): void {
  db()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, JSON.stringify(value), nowIso());
}

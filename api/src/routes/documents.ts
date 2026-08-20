import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as repo from '../db/repos.ts';
import { HttpError, parse } from './helpers.ts';
import { documentToMarkdown, documentToHtml } from '../lib/render.ts';
import { nowIso } from '../db/index.ts';

const DOC_TYPES = ['prd', 'feature-spec', 'ia', 'user-flow'] as const;

export async function documentRoutes(app: FastifyInstance): Promise<void> {
  // create a document under a project
  app.post('/api/projects/:pid/documents', async (req) => {
    const { pid } = req.params as { pid: string };
    if (!repo.getProject(pid)) throw new HttpError(404, 'project not found');
    const body = parse(
      z.object({
        type: z.enum(DOC_TYPES),
        title: z.string().min(1),
        parentDocumentId: z.string().nullable().optional(),
      }),
      req.body,
    );
    if (body.parentDocumentId && !repo.getDocument(body.parentDocumentId)) {
      throw new HttpError(400, 'parent document not found');
    }
    return repo.createDocument({
      projectId: pid,
      type: body.type,
      title: body.title,
      parentDocumentId: body.parentDocumentId ?? null,
    });
  });

  // full document view: doc + sections + session + context state
  app.get('/api/documents/:id', async (req) => {
    const { id } = req.params as { id: string };
    const doc = repo.getDocument(id);
    if (!doc) throw new HttpError(404, 'document not found');
    return {
      document: doc,
      sections: repo.listSections(id),
      session: repo.getSessionByDocument(id),
      parentContextAvailable: repo.getParentContext(id) !== null,
      openSuggestions: repo.countOpenSuggestions(id),
    };
  });

  app.patch('/api/documents/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(z.object({ title: z.string().min(1) }), req.body);
    const updated = repo.updateDocumentTitle(id, body.title);
    if (!updated) throw new HttpError(404, 'document not found');
    return updated;
  });

  app.delete('/api/documents/:id', async (req) => {
    const { id } = req.params as { id: string };
    if (!repo.getDocument(id)) throw new HttpError(404, 'document not found');
    repo.deleteDocument(id);
    return { ok: true };
  });

  // ── sections ──────────────────────────────────────────────────────────────
  app.get('/api/documents/:id/sections', async (req) => {
    const { id } = req.params as { id: string };
    if (!repo.getDocument(id)) throw new HttpError(404, 'document not found');
    return repo.listSections(id);
  });

  app.post('/api/documents/:id/sections', async (req) => {
    const { id } = req.params as { id: string };
    if (!repo.getDocument(id)) throw new HttpError(404, 'document not found');
    const body = parse(
      z.object({ heading: z.string(), body: z.string().optional() }),
      req.body,
    );
    const section = repo.createSection(id, body.heading, body.body ?? '');
    repo.snapshotDocument(id, 'save', { reason: 'add_section' });
    return section;
  });

  app.patch('/api/sections/:sid', async (req) => {
    const { sid } = req.params as { sid: string };
    const section = repo.getSection(sid);
    if (!section) throw new HttpError(404, 'section not found');
    const body = parse(
      z.object({ heading: z.string().optional(), body: z.string().optional() }),
      req.body,
    );
    const updated = repo.updateSection(sid, body);
    // A manual edit is a structural change -> version bump + child staleness.
    repo.snapshotDocument(section.document_id, 'save', { reason: 'edit_section', sectionId: sid });
    return updated;
  });

  app.delete('/api/sections/:sid', async (req) => {
    const { sid } = req.params as { sid: string };
    const section = repo.getSection(sid);
    if (!section) throw new HttpError(404, 'section not found');
    repo.deleteSection(sid);
    repo.snapshotDocument(section.document_id, 'save', { reason: 'delete_section' });
    return { ok: true };
  });

  app.post('/api/documents/:id/sections/reorder', async (req) => {
    const { id } = req.params as { id: string };
    if (!repo.getDocument(id)) throw new HttpError(404, 'document not found');
    const body = parse(z.object({ orderedIds: z.array(z.string()) }), req.body);
    const sections = repo.reorderSections(id, body.orderedIds);
    repo.snapshotDocument(id, 'save', { reason: 'reorder' });
    return sections;
  });

  // ── context chain (P-01) ────────────────────────────────────────────────────
  app.get('/api/documents/:id/context/parent', async (req) => {
    const { id } = req.params as { id: string };
    if (!repo.getDocument(id)) throw new HttpError(404, 'document not found');
    const ctx = repo.getParentContext(id);
    if (!ctx) return { available: false };
    return { available: true, ...ctx };
  });

  app.post('/api/documents/:id/context/refresh', async (req) => {
    const { id } = req.params as { id: string };
    if (!repo.getDocument(id)) throw new HttpError(404, 'document not found');
    // Only 'context-only' is supported here. Section regeneration (flow B) is
    // driven per-section by the client via the regenerate endpoint (SPEC-07).
    const body = parse(
      z.object({ mode: z.literal('context-only').default('context-only') }),
      req.body ?? {},
    );
    void body;
    const updated = repo.refreshContext(id);
    return updated;
  });

  // ── versions (SPEC-12) ──────────────────────────────────────────────────────
  app.get('/api/documents/:id/versions', async (req) => {
    const { id } = req.params as { id: string };
    if (!repo.getDocument(id)) throw new HttpError(404, 'document not found');
    return repo.listVersions(id).map((v) => ({ ...v, meta: JSON.parse(v.meta) }));
  });

  app.post('/api/documents/:id/versions/:vid/restore', async (req) => {
    const { id, vid } = req.params as { id: string; vid: string };
    const restored = repo.restoreVersion(id, vid);
    if (!restored) throw new HttpError(404, 'version not found');
    return {
      document: restored,
      sections: repo.listSections(id),
    };
  });

  // ── export (SPEC-13/14) ─────────────────────────────────────────────────────
  app.get('/api/documents/:id/export.md', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!repo.getDocument(id)) throw new HttpError(404, 'document not found');
    reply
      .header('Content-Type', 'text/markdown; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${id}.md"`);
    return documentToMarkdown(id);
  });

  app.get('/api/documents/:id/export.html', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!repo.getDocument(id)) throw new HttpError(404, 'document not found');
    reply.header('Content-Type', 'text/html; charset=utf-8');
    return documentToHtml(id);
  });

  // ── share links (SPEC-14) ───────────────────────────────────────────────────
  app.post('/api/documents/:id/shares', async (req) => {
    const { id } = req.params as { id: string };
    if (!repo.getDocument(id)) throw new HttpError(404, 'document not found');
    const body = parse(
      z.object({ expiresInHours: z.number().positive().nullable().optional() }),
      req.body ?? {},
    );
    let expiresAt: string | null = null;
    if (body.expiresInHours) {
      expiresAt = new Date(Date.now() + body.expiresInHours * 3600_000).toISOString();
    }
    const link = repo.createShareLink(id, expiresAt);
    return { ...link, url: `/s/${link.token}` };
  });

  app.get('/api/documents/:id/shares', async (req) => {
    const { id } = req.params as { id: string };
    if (!repo.getDocument(id)) throw new HttpError(404, 'document not found');
    return repo.listShareLinks(id).map((l) => ({
      ...l,
      url: `/s/${l.token}`,
      expired: isExpired(l.expires_at),
    }));
  });

  app.post('/api/shares/:sid/revoke', async (req) => {
    const { sid } = req.params as { sid: string };
    repo.revokeShareLink(sid);
    return { ok: true, at: nowIso() };
  });
}

export function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() < Date.now();
}

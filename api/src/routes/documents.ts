import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as repo from '../db/repos.ts';
import { HttpError, parse } from './helpers.ts';
import { documentToMarkdown, documentToHtml } from '../lib/render.ts';
import { nowIso } from '../db/index.ts';
import {
  collectRepoBrief,
  renderBriefContext,
  briefSourceSummary,
  BriefExtractError,
} from '../lib/brief-extract.ts';
import { streamDocumentDraft } from '../lib/ai.ts';

const DOC_TYPES = [
  'prd',
  'feature-spec',
  'ia',
  'user-flow',
  'design-system',
  'feature',
  'brief',
] as const;

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

  // ── project brief: extract from a local repo folder (설계 노트 §1·§2) ────────
  // 프라이빗 레포 권한 문제를 "이미 로컬에 클론된 폴더 읽기"로 소거한다. GitHub 인증 없음.
  // 읽는 것은 README·매니페스트·트리·엔트리 head 뿐 — 코드 전량은 읽지 않는다.
  app.post('/api/documents/:id/brief/extract', async (req) => {
    const { id } = req.params as { id: string };
    const doc = repo.getDocument(id);
    if (!doc) throw new HttpError(404, 'document not found');
    if (doc.type !== 'brief') {
      throw new HttpError(400, '프로젝트 브리프(brief) 문서에서만 추출할 수 있습니다');
    }
    const body = parse(z.object({ path: z.string().min(1) }), req.body);

    let brief;
    try {
      brief = collectRepoBrief(body.path);
    } catch (e) {
      if (e instanceof BriefExtractError) {
        // 컨테이너 등에서 폴더가 안 보이는 경우도 여기로 온다 —
        // 사용자는 섹션을 직접 쓰거나 붙여넣는 경로로 우회한다.
        throw new HttpError(
          400,
          `${(e as Error).message} · 앱에서 접근 가능한 로컬 폴더인지 확인하세요(도커로 실행 중이면 폴더가 보이지 않습니다). 섹션을 직접 작성하거나 붙여넣어도 됩니다.`,
        );
      }
      throw e;
    }

    const read = briefSourceSummary(brief);
    let failure = '';
    for await (const evt of streamDocumentDraft(id, undefined, {
      extraContext: renderBriefContext(brief),
      sourceLabel: `레포 폴더 추출 · ${read}`,
    })) {
      if (evt.type === 'error') failure = evt.message;
    }
    if (failure) throw new HttpError(502, failure);

    return { root: brief.root, read, sections: repo.listSections(id) };
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

  // 되돌리기(undo) — 직전 스냅샷으로 1단계 복원. 더 깊은 복원은 버전 기록 사용.
  app.post('/api/documents/:id/undo', async (req) => {
    const { id } = req.params as { id: string };
    if (!repo.getDocument(id)) throw new HttpError(404, 'document not found');
    const versions = repo.listVersions(id); // 최신순
    if (versions.length < 2) throw new HttpError(400, '되돌릴 변경이 없습니다');
    const restored = repo.restoreVersion(id, versions[1].id);
    if (!restored) throw new HttpError(404, 'version not found');
    return { document: restored, sections: repo.listSections(id) };
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
    // ?print=1 → 로드 시 인쇄 대화상자 자동 실행(브라우저 'PDF로 저장'). 의존성 없는 PDF 경로.
    const print = (req.query as { print?: string })?.print === '1';
    reply.header('Content-Type', 'text/html; charset=utf-8');
    return documentToHtml(id, { print });
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

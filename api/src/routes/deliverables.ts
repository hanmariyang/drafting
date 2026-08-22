import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as repo from '../db/repos.ts';
import { HttpError, parse, sseStream } from './helpers.ts';
import {
  streamItemsGeneration,
  materializeSpec,
  materializeIa,
  materializeFlow,
  type ItemGenEvent,
} from '../lib/items-gen.ts';
import { lintReport, suggestLint } from '../lib/lint-service.ts';
import { deriveWireframes } from '../lib/wireframes.ts';
import { compileHandoff, promptPack, getHandoffDoc, HandoffGateError } from '../lib/handoff.ts';
import { PRD_SECTIONS, SPEC_FIXTURE, IA_FIXTURE, FLOW_FIXTURE } from '../lib/fixtures.ts';
import type { PlanItemKind } from '../lib/types.ts';

const ITEM_KINDS = ['feature-group', 'feature', 'page', 'flow', 'step'] as const;

export async function deliverableRoutes(app: FastifyInstance): Promise<void> {
  // ── plan items (structure docs) ─────────────────────────────────────────────
  app.get('/api/documents/:id/items', async (req) => {
    const { id } = req.params as { id: string };
    if (!repo.getDocument(id)) throw new HttpError(404, 'document not found');
    return { items: repo.listItems(id) };
  });

  app.post('/api/documents/:id/items', async (req) => {
    const { id } = req.params as { id: string };
    if (!repo.getDocument(id)) throw new HttpError(404, 'document not found');
    const body = parse(
      z.object({
        kind: z.enum(ITEM_KINDS),
        title: z.string().min(1),
        body: z.string().optional(),
        meta: z.record(z.unknown()).optional(),
        parentId: z.string().nullable().optional(),
        status: z.enum(['proposed', 'accepted', 'rejected']).optional(),
      }),
      req.body,
    );
    return repo.createItem({
      documentId: id,
      kind: body.kind as PlanItemKind,
      title: body.title,
      body: body.body,
      meta: body.meta as never,
      parentId: body.parentId ?? null,
      status: body.status ?? 'accepted', // manual add is the editor's own text
    });
  });

  app.patch('/api/items/:id', async (req) => {
    const { id } = req.params as { id: string };
    if (!repo.getItem(id)) throw new HttpError(404, 'item not found');
    const body = parse(
      z.object({
        title: z.string().optional(),
        body: z.string().optional(),
        meta: z.record(z.unknown()).optional(),
        position: z.number().int().optional(),
      }),
      req.body ?? {},
    );
    return repo.updateItem(id, body as never);
  });

  app.delete('/api/items/:id', async (req) => {
    const { id } = req.params as { id: string };
    if (!repo.getItem(id)) throw new HttpError(404, 'item not found');
    repo.deleteItem(id);
    return { ok: true };
  });

  app.post('/api/items/:id/accept', async (req) => {
    const { id } = req.params as { id: string };
    const item = repo.getItem(id);
    if (!item) throw new HttpError(404, 'item not found');
    repo.setItemStatus(id, 'accepted');
    for (const s of repo.listItemSuggestions(id)) repo.resolveSuggestion(s.id, 'accepted');
    return repo.getItem(id);
  });

  app.post('/api/items/:id/reject', async (req) => {
    const { id } = req.params as { id: string };
    const item = repo.getItem(id);
    if (!item) throw new HttpError(404, 'item not found');
    repo.setItemStatus(id, 'rejected');
    for (const s of repo.listItemSuggestions(id)) repo.resolveSuggestion(s.id, 'rejected');
    return repo.getItem(id);
  });

  // 플로우(:id)의 links.features 에 기능 ref 를 추가/제거한다 — W-NO-FLOW 등 근본 해소.
  // 링크는 플로우 쪽 배열에 산다(lint 가 검사하는 곳). 기능은 다른 문서라 ref 로만 잇는다.
  app.post('/api/items/:id/link-feature', async (req) => {
    const { id } = req.params as { id: string };
    const flow = repo.getItem(id);
    if (!flow) throw new HttpError(404, 'item not found');
    if (flow.kind !== 'flow') throw new HttpError(400, 'link target must be a flow');
    const { featureRef } = parse(z.object({ featureRef: z.string().min(1) }), req.body);
    const meta = repo.parsePlanItemMeta(flow);
    const links = meta.links ?? {};
    const features = Array.from(new Set([...(links.features ?? []), featureRef]));
    return repo.updateItem(id, { meta: { ...meta, links: { ...links, features } } as never });
  });

  app.post('/api/items/:id/unlink-feature', async (req) => {
    const { id } = req.params as { id: string };
    const flow = repo.getItem(id);
    if (!flow) throw new HttpError(404, 'item not found');
    const { featureRef } = parse(z.object({ featureRef: z.string().min(1) }), req.body);
    const meta = repo.parsePlanItemMeta(flow);
    const links = meta.links ?? {};
    const features = (links.features ?? []).filter((f) => f !== featureRef);
    return repo.updateItem(id, { meta: { ...meta, links: { ...links, features } } as never });
  });

  // 제외(rejected)된 항목을 되살린다 — 정합성 '모두 수락' 등으로 통째로 제외돼
  // 화면에서 사라진 항목을 재검토(proposed)로 복귀. 본문은 보존돼 있어 손실 없음.
  app.post('/api/items/:id/restore', async (req) => {
    const { id } = req.params as { id: string };
    const item = repo.getItem(id);
    if (!item) throw new HttpError(404, 'item not found');
    repo.setItemStatus(id, 'proposed');
    return repo.getItem(id);
  });

  // SSE generation of a structure document's items (EventSource)
  app.get('/api/documents/:id/items/generate/stream', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!repo.getDocument(id)) throw new HttpError(404, 'document not found');
    await pipeItems(streamItemsGeneration(id), req, reply);
  });

  // ── project-level deliverables ──────────────────────────────────────────────
  app.get('/api/projects/:id/lint', async (req) => {
    const { id } = req.params as { id: string };
    if (!repo.getProject(id)) throw new HttpError(404, 'project not found');
    return lintReport(id);
  });

  app.post('/api/projects/:id/lint/suggest', async (req) => {
    const { id } = req.params as { id: string };
    if (!repo.getProject(id)) throw new HttpError(404, 'project not found');
    const created = suggestLint(id);
    return { created, report: lintReport(id) };
  });

  // 위반 하나를 키로 무시(waive)한다 — 인라인 배지에서 개별 처리. 비파괴적.
  app.post('/api/projects/:id/lint/waive', async (req) => {
    const { id } = req.params as { id: string };
    if (!repo.getProject(id)) throw new HttpError(404, 'project not found');
    const { key } = parse(z.object({ key: z.string().min(1) }), req.body);
    suggestLint(id); // 해당 위반의 lint 제안이 없으면 생성
    let waived = false;
    for (const doc of repo.listDocuments(id)) {
      for (const s of repo.listLintSuggestions(doc.id, 'open')) {
        if (s.quote_before === key) {
          repo.resolveSuggestion(s.id, 'rejected');
          waived = true;
        }
      }
    }
    return { waived, report: lintReport(id) };
  });

  // 모든 현재 위반을 비파괴적으로 무시(waive)한다 — 항목·본문은 그대로 두고
  // 게이트만 통과시킨다('모두 수락'의 항목 제외와 다름). §4.3 waive 를 일괄 적용.
  app.post('/api/projects/:id/lint/waive-all', async (req) => {
    const { id } = req.params as { id: string };
    if (!repo.getProject(id)) throw new HttpError(404, 'project not found');
    suggestLint(id); // 위반마다 lint 제안 생성(없는 것만)
    let waived = 0;
    for (const doc of repo.listDocuments(id)) {
      for (const s of repo.listLintSuggestions(doc.id, 'open')) {
        repo.resolveSuggestion(s.id, 'rejected'); // waive — 항목 상태는 건드리지 않음
        waived++;
      }
    }
    return { waived, report: lintReport(id) };
  });

  app.get('/api/projects/:id/wireframes', async (req) => {
    const { id } = req.params as { id: string };
    if (!repo.getProject(id)) throw new HttpError(404, 'project not found');
    return { wireframes: deriveWireframes(id) };
  });

  app.post('/api/projects/:id/handoff', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!repo.getProject(id)) throw new HttpError(404, 'project not found');
    try {
      const { documentId } = await compileHandoff(id);
      return { documentId, report: lintReport(id) };
    } catch (e) {
      if (e instanceof HandoffGateError) {
        reply.code(409);
        return { error: e.message, violations: e.violations };
      }
      throw e;
    }
  });

  app.get('/api/projects/:id/handoff/prompt-pack', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!repo.getProject(id)) throw new HttpError(404, 'project not found');
    reply
      .header('Content-Type', 'text/markdown; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="handoff-${id}.md"`);
    return promptPack(id);
  });

  app.get('/api/projects/:id/hub', async (req) => {
    const { id } = req.params as { id: string };
    if (!repo.getProject(id)) throw new HttpError(404, 'project not found');
    return hubSnapshot(id);
  });

  // Seed a fully-populated demo project (the 회의실 예약 example) so the hub /
  // wireframes / handoff / lint have real cross-linked data with no AI/keys.
  app.post('/api/sample/deliverables', async () => {
    const existing = repo.listProjects().find((p) => p.name === DELIVERABLES_SAMPLE);
    if (existing) return { projectId: existing.id, created: false };
    const projectId = seedDeliverables();
    return { projectId, created: true };
  });
}

async function pipeItems(
  gen: AsyncGenerator<ItemGenEvent>,
  req: Parameters<typeof sseStream>[0],
  reply: Parameters<typeof sseStream>[1],
): Promise<void> {
  const sse = sseStream(req, reply);
  try {
    for await (const evt of gen) {
      const { type, ...rest } = evt;
      sse.send(type, rest);
      if (evt.type === 'done' || evt.type === 'error') break;
    }
  } catch (e) {
    sse.send('error', { message: (e as Error).message });
  } finally {
    sse.end();
  }
}

interface DocRollup {
  accepted: number;
  proposed: number;
  total: number;
}
function rollupItems(documentId: string): DocRollup {
  const items = repo.listItems(documentId).filter((i) => i.status !== 'rejected');
  return {
    accepted: items.filter((i) => i.status === 'accepted').length,
    proposed: items.filter((i) => i.status === 'proposed').length,
    total: items.length,
  };
}
function rollupSections(documentId: string): DocRollup {
  const secs = repo.listSections(documentId).filter((s) => s.status !== 'rejected');
  return {
    accepted: secs.filter((s) => s.status === 'accepted').length,
    proposed: secs.filter((s) => s.status === 'proposed').length,
    total: secs.length,
  };
}

/** 6-deliverable roll-up for the hub (§3). */
export function hubSnapshot(projectId: string) {
  const docs = repo.listDocuments(projectId);
  const perDoc: Record<string, DocRollup & { documentId: string | null }> = {};
  for (const type of ['prd', 'feature-spec', 'ia', 'user-flow'] as const) {
    const doc = docs.find((d) => d.type === type);
    if (!doc) {
      perDoc[type] = { accepted: 0, proposed: 0, total: 0, documentId: null };
      continue;
    }
    const roll = type === 'prd' ? rollupSections(doc.id) : rollupItems(doc.id);
    perDoc[type] = { ...roll, documentId: doc.id };
  }
  const report = lintReport(projectId);
  const wireframes = deriveWireframes(projectId);
  const handoffDoc = getHandoffDoc(projectId);
  return {
    perDoc,
    lint: report,
    derived: {
      wireframes: { count: wireframes.length },
      handoff: {
        compiled: !!handoffDoc,
        documentId: handoffDoc?.id ?? null,
        locked: !report.gatePasses,
        blocking: report.effectiveCount,
      },
    },
  };
}

const DELIVERABLES_SAMPLE = '예시: 회의실 예약 정리';

/** Build the full demo chain (PRD accepted + SPEC/IA/FLOW items accepted). */
export function seedDeliverables(): string {
  const project = repo.createProject(DELIVERABLES_SAMPLE, '겹침 없는 예약과 자동 반납·노쇼 처리');
  const prd = repo.createDocument({ projectId: project.id, type: 'prd', title: '제품 요구사항' });
  for (const s of PRD_SECTIONS) repo.createSection(prd.id, s.heading, s.body, undefined, 'accepted');

  const spec = repo.createDocument({
    projectId: project.id,
    type: 'feature-spec',
    title: '기능명세서',
    parentDocumentId: prd.id,
  });
  materializeSpec(spec.id, SPEC_FIXTURE, { status: 'accepted', withSuggestions: false });
  repo.setDocumentStatus(spec.id, 'ready');

  const ia = repo.createDocument({
    projectId: project.id,
    type: 'ia',
    title: '정보 구조',
    parentDocumentId: spec.id,
  });
  materializeIa(ia.id, IA_FIXTURE, { status: 'accepted', withSuggestions: false });
  repo.setDocumentStatus(ia.id, 'ready');

  const flow = repo.createDocument({
    projectId: project.id,
    type: 'user-flow',
    title: '유저 플로우',
    parentDocumentId: ia.id,
  });
  materializeFlow(flow.id, FLOW_FIXTURE, { status: 'accepted', withSuggestions: false });
  repo.setDocumentStatus(flow.id, 'ready');

  return project.id;
}

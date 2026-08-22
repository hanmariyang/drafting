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
import { compileHandoff, promptPack, handoffTickets, getHandoffDoc, HandoffGateError } from '../lib/handoff.ts';
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

  // 범용 링크 편집 — 항목(:id)의 meta.links.<field> 배열에서 ref 를 추가/제거한다.
  // 링크 위반 근본 해소에 공용: 기능→요구(reqs)·화면→기능(features)·플로우→기능(features).
  // lint 가 검사하는 배열이 subject 쪽에 있으므로 편집도 subject 항목에서 한다.
  app.post('/api/items/:id/link', async (req) => {
    const { id } = req.params as { id: string };
    const item = repo.getItem(id);
    if (!item) throw new HttpError(404, 'item not found');
    const { field, ref, op } = parse(
      z.object({
        field: z.enum(['reqs', 'pages', 'flows', 'features']),
        ref: z.string().min(1),
        op: z.enum(['add', 'remove']),
      }),
      req.body,
    );
    const meta = repo.parsePlanItemMeta(item);
    const links = meta.links ?? {};
    const cur = links[field] ?? [];
    const next = op === 'add' ? Array.from(new Set([...cur, ref])) : cur.filter((r) => r !== ref);
    return repo.updateItem(id, { meta: { ...meta, links: { ...links, [field]: next } } as never });
  });

  // 스텝(:id)의 meta.page 를 지정/해제한다 — W-UNREACHED-PAGE 근본 해소.
  // page 는 배열이 아니라 스칼라(스텝이 한 화면에 도달)이므로 /link 와 별도.
  app.post('/api/items/:id/step-page', async (req) => {
    const { id } = req.params as { id: string };
    const step = repo.getItem(id);
    if (!step) throw new HttpError(404, 'item not found');
    if (step.kind !== 'step') throw new HttpError(400, 'page can only be set on a step');
    const { page } = parse(z.object({ page: z.string().nullable() }), req.body);
    const meta = repo.parsePlanItemMeta(step);
    return repo.updateItem(id, { meta: { ...meta, page: page || null } as never });
  });

  // 이 프로젝트의 유효 REQ id 목록 (PRD 수락 섹션에서 파생) — 기능→요구 연결 드롭다운용.
  app.get('/api/projects/:id/reqs', async (req) => {
    const { id } = req.params as { id: string };
    if (!repo.getProject(id)) throw new HttpError(404, 'project not found');
    return { reqs: repo.reqIdsForProject(id) };
  });

  // 하위호환: 기존 link-feature/unlink-feature (플로우→기능) 유지
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

  // 개발 티켓(체크리스트 MD) — 게이트 무관, 현재 수락분 실행 목록.
  app.get('/api/projects/:id/handoff/tickets.md', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!repo.getProject(id)) throw new HttpError(404, 'project not found');
    reply
      .header('Content-Type', 'text/markdown; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="tickets-${id}.md"`);
    return handoffTickets(id);
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

const CHAIN = ['prd', 'feature-spec', 'ia', 'user-flow'] as const;
const CHAIN_LABEL: Record<(typeof CHAIN)[number], string> = {
  prd: 'PRD',
  'feature-spec': '기능명세서',
  ia: '정보 구조',
  'user-flow': '유저 플로우',
};

/** 6-deliverable roll-up for the hub (§3) + per-doc stale/open + 다음 할 일. */
export function hubSnapshot(projectId: string) {
  const docs = repo.listDocuments(projectId);
  const perDoc: Record<
    string,
    DocRollup & { documentId: string | null; stale: boolean; openSuggestions: number; status: string | null }
  > = {};
  for (const type of CHAIN) {
    const doc = docs.find((d) => d.type === type);
    if (!doc) {
      perDoc[type] = { accepted: 0, proposed: 0, total: 0, documentId: null, stale: false, openSuggestions: 0, status: null };
      continue;
    }
    const roll = type === 'prd' ? rollupSections(doc.id) : rollupItems(doc.id);
    perDoc[type] = {
      ...roll,
      documentId: doc.id,
      stale: doc.context_stale === 1,
      openSuggestions: repo.countOpenSuggestions(doc.id),
      status: doc.status,
    };
  }
  const report = lintReport(projectId);
  const wireframes = deriveWireframes(projectId);
  const handoffDoc = getHandoffDoc(projectId);

  // ── 다음 할 일: 체인 순서 + 위반/제안/stale 을 종합해 가장 중요한 한 걸음을 고른다 ──
  const nextAction = computeNextAction(perDoc, report, !!handoffDoc);

  return {
    perDoc,
    lint: report,
    nextAction,
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

interface NextAction {
  kind: 'create' | 'review' | 'stale' | 'lint' | 'handoff' | 'done';
  label: string;
  detail: string;
  documentId: string | null;
  target: 'document' | 'handoff' | 'none';
}

function computeNextAction(
  perDoc: Record<string, { documentId: string | null; total: number; proposed: number; stale: boolean; openSuggestions: number }>,
  report: ReturnType<typeof lintReport>,
  handoffCompiled: boolean,
): NextAction {
  // 1) 아직 없는/빈 문서 — 체인 순서대로 첫 번째
  for (const type of CHAIN) {
    const d = perDoc[type];
    if (!d.documentId || d.total === 0) {
      return {
        kind: 'create',
        label: `${CHAIN_LABEL[type]} 생성`,
        detail: `${CHAIN_LABEL[type]} 가 아직 없습니다. 여기서 체인을 이어가세요.`,
        documentId: d.documentId,
        target: d.documentId ? 'document' : 'none',
      };
    }
  }
  // 2) stale — 상위 변경으로 재검토 필요한 문서
  for (const type of CHAIN) {
    const d = perDoc[type];
    if (d.stale) {
      return {
        kind: 'stale',
        label: `${CHAIN_LABEL[type]} 재검토`,
        detail: `상위 문서 변경으로 ${CHAIN_LABEL[type]} 가 재검토 대기 상태입니다.`,
        documentId: d.documentId,
        target: 'document',
      };
    }
  }
  // 3) 열린 제안 — 검토 대기
  for (const type of CHAIN) {
    const d = perDoc[type];
    if (d.openSuggestions > 0) {
      return {
        kind: 'review',
        label: `${CHAIN_LABEL[type]} 제안 ${d.openSuggestions}건 검토`,
        detail: '수락·거절로 제안을 정리하면 문서가 확정됩니다.',
        documentId: d.documentId,
        target: 'document',
      };
    }
  }
  // 4) 정합성 위반
  if (report.effectiveCount > 0) {
    const specId = perDoc['feature-spec']?.documentId ?? null;
    return {
      kind: 'lint',
      label: `정합성 위반 ${report.effectiveCount}건 해소`,
      detail: '연결 편집·우선순위·무시로 위반을 정리하세요.',
      documentId: specId,
      target: specId ? 'document' : 'none',
    };
  }
  // 5) 게이트 통과 — 개발 지시서
  return {
    kind: handoffCompiled ? 'done' : 'handoff',
    label: handoffCompiled ? '완성 · 개발 지시서 내보내기' : '개발 지시서 생성',
    detail: handoffCompiled ? '체인이 완성됐습니다. 지시서를 공유하거나 내보내세요.' : '정합성 검사를 통과했습니다. 지시서를 생성할 수 있어요.',
    documentId: null,
    target: 'handoff',
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

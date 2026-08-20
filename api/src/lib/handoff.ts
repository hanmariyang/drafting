// Development handoff = a COMPILED deliverable (§6). Gate: the lint set (E+W
// minus waived) must be empty. The skeleton (scope/reqs/features/screens/
// non-scope) is deterministic; only the §1 summary is AI-generated and it comes
// in as a proposal (accept to confirm). Handoff is a `documents` row of a new
// type 'handoff', so the existing section editor + export/share are reused.

import * as repo from '../db/repos.ts';
import { resolveProvider } from '../providers/index.ts';
import { getModelConfig } from './ai.ts';
import { effectiveViolations } from './lint-service.ts';
import type { PlanItem, PlanItemMeta } from './types.ts';

export class HandoffGateError extends Error {
  violations: ReturnType<typeof effectiveViolations>;
  constructor(violations: ReturnType<typeof effectiveViolations>) {
    super('정합성 검사 위반이 남아 있어 지시서를 생성할 수 없습니다.');
    this.name = 'HandoffGateError';
    this.violations = violations;
  }
}

function meta(i: PlanItem): PlanItemMeta {
  try {
    return JSON.parse(i.meta || '{}') as PlanItemMeta;
  } catch {
    return {};
  }
}

export function getHandoffDoc(projectId: string) {
  return repo.listDocuments(projectId).find((d) => d.type === 'handoff') ?? null;
}

interface Compiled {
  scope: string;
  reqs: string;
  features: string;
  screens: string;
  nonScope: string;
  summaryPrompt: string;
}

/** Build the deterministic handoff body from a project's ACCEPTED items. */
export function compileHandoffBody(projectId: string): Compiled {
  const project = repo.getProject(projectId);
  const items = repo.listProjectItems(projectId).filter((i) => i.status === 'accepted');
  const reqs = repo.reqIdsForProject(projectId);
  const features = items.filter((i) => i.kind === 'feature');
  const groups = items.filter((i) => i.kind === 'feature-group');
  const pages = items.filter((i) => i.kind === 'page');
  const flows = items.filter((i) => i.kind === 'flow');
  const p0 = features.filter((f) => meta(f).priority === 'P0').length;
  const p1 = features.filter((f) => meta(f).priority === 'P1').length;
  const p2 = features.filter((f) => meta(f).priority === 'P2').length;

  const groupRefs = groups.map((g) => g.ref_id);
  const scope =
    `**${project?.name ?? '프로젝트'}** — 수락된 기능 ${features.length}개를 구현한다.\n\n` +
    `범위: ${groupRefs.join(' · ') || '—'} (P0 ${p0} · P1 ${p1} · P2 ${p2}).`;

  const reqsBody = reqs.length
    ? reqs.map((r) => `- ${r.id} ${r.heading}`).join('\n')
    : '- (PRD 수락 섹션 없음)';

  const featuresBody = features.length
    ? features
        .map((f) => {
          const m = meta(f);
          const crit = f.body.split('\n').map((l) => l.replace(/^[·\-*]\s*/, '').trim()).filter(Boolean)[0];
          const links = [...(m.links?.reqs ?? []), ...(m.links?.flows ?? [])].join(', ');
          return `- ${f.ref_id} ${f.title} (${m.priority ?? 'P?'}${links ? ' · ' + links : ''})` +
            (crit ? `\n  - 수용 기준: ${crit}` : '');
        })
        .join('\n')
    : '- (수락된 기능 없음)';

  const screens = pages.length
    ? pages
        .map((pg) => {
          const m = meta(pg);
          return `- ${pg.ref_id} ${pg.title} [${m.page_type ?? 'GENERIC'}] · 기능 ${(m.links?.features ?? []).join(', ') || '—'}`;
        })
        .join('\n') +
      '\n\n플로우:\n' +
      (flows.length ? flows.map((fl) => `- ${fl.ref_id} ${fl.title}`).join('\n') : '- (없음)')
    : '- (화면 없음)';

  const nonScope = 'PRD 비범위 항목은 이번 지시서에서 제외한다. 수락하지 않은 항목은 지시서에 없습니다.';

  const summaryPrompt =
    `아래 스코프를 한 문단으로 요약하는 개요 문장을 한국어로 써라. 섹션 제목: 개요\n\n${scope}\n\n` +
    `요구 ${reqs.length}개, 기능 ${features.length}개, 화면 ${pages.length}개, 플로우 ${flows.length}개.`;

  return { scope, reqs: reqsBody, features: featuresBody, screens, nonScope, summaryPrompt };
}

/**
 * Compile (or recompile) the handoff document for a project. Throws
 * HandoffGateError (→ 409) if the effective lint set is non-empty. The §1 개요
 * section is AI-generated and left 'proposed' with an 'add' suggestion; the rest
 * of the deterministic skeleton is written directly as 'accepted'.
 */
export async function compileHandoff(projectId: string): Promise<{ documentId: string }> {
  const violations = effectiveViolations(projectId);
  if (violations.length > 0) throw new HandoffGateError(violations);

  const body = compileHandoffBody(projectId);

  // one AI summary sentence (proposal). Stub-capable (no network).
  const cfg = getModelConfig('handoff');
  const provider = resolveProvider(cfg.provider);
  let summary = '';
  try {
    for await (const delta of provider.streamChat({
      model: cfg.model,
      maxTokens: cfg.maxTokens,
      messages: [
        { role: 'system', content: '개발 지시서의 개요 문단만 간결히 쓴다. 한국어.' },
        { role: 'user', content: body.summaryPrompt },
      ],
    })) {
      summary += delta;
    }
  } catch {
    summary = body.scope;
  }

  let doc = getHandoffDoc(projectId);
  if (!doc) doc = repo.createDocument({ projectId, type: 'handoff', title: '개발 지시서' });

  // rebuild sections deterministically; §1 개요 is a fresh proposal
  repo.replaceSections(
    doc.id,
    [
      { heading: '§1 개요', body: summary.trim() || body.scope },
      { heading: '§2 스코프', body: body.scope },
      { heading: '§3 요구 (REQ)', body: body.reqs },
      { heading: '§4 기능 목록', body: body.features },
      { heading: '§5 화면 · 플로우', body: body.screens },
      { heading: '§6 비범위', body: body.nonScope },
    ],
    'accepted',
  );
  // §1 개요 back to proposed (the only AI-authored part) + a proposal card
  const sections = repo.listSections(doc.id);
  const overview = sections[0];
  repo.setSectionStatus(overview.id, 'proposed');
  repo.createSuggestion({
    documentId: doc.id,
    sectionId: overview.id,
    kind: 'add',
    title: '지시서 초안 v1',
    body: '검사를 통과해 지시서를 컴파일했어요. 개요를 수락하면 지시서가 확정됩니다.',
    quoteAfter: overview.body,
    source: '수락분 컴파일',
  });
  repo.setDocumentStatus(doc.id, 'ready');
  return { documentId: doc.id };
}

/**
 * Prompt pack for agent hand-off (§6 출구 ①): the full handoff (accepted
 * sections only) with an "implement only accepted items" header. Markdown.
 */
export function promptPack(projectId: string): string {
  const doc = getHandoffDoc(projectId);
  if (!doc) return '# 개발 지시서\n\n아직 컴파일되지 않았습니다. 정합성 검사를 통과한 뒤 생성하세요.\n';
  const project = repo.getProject(projectId);
  const sections = repo.listAcceptedSections(doc.id);
  const header =
    `# 발주: ${project?.name ?? '프로젝트'} 개발 지시서\n\n` +
    `> 이 지시서의 **수락된 항목만 구현하라.** 수락하지 않은 항목은 지시서에 없습니다.\n` +
    `> 각 기능의 수용 기준을 만족시키고, 임의 범위 확장을 하지 마라.\n\n---\n`;
  const bodyMd = sections.map((s) => `## ${s.heading}\n\n${s.body.trim()}`).join('\n\n');
  return `${header}\n${bodyMd}\n`;
}

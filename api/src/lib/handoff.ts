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
 * 개발 티켓(GitHub-flavored 체크리스트) — 수락된 기능 하나 = 티켓, 수용 기준 = 체크박스.
 * 게이트와 무관하게 언제든 내보낼 수 있다(현재 수락분의 실행 목록).
 */
export function handoffTickets(projectId: string): string {
  const project = repo.getProject(projectId);
  const items = repo.listProjectItems(projectId).filter((i) => i.status === 'accepted');
  const groups = items.filter((i) => i.kind === 'feature-group');
  const features = items.filter((i) => i.kind === 'feature');
  const lines: string[] = [
    `# ${project?.name ?? '프로젝트'} — 개발 티켓`,
    '',
    `> 수락된 기능 ${features.length}개. 각 기능 = 티켓, 수용 기준 = 체크리스트.`,
    '',
  ];

  const ticketFor = (f: PlanItem) => {
    const m = meta(f);
    const pri = m.priority ?? 'P?';
    const links = [...(m.links?.reqs ?? []), ...(m.links?.pages ?? []), ...(m.links?.flows ?? [])];
    lines.push(`### ${f.ref_id} ${f.title}  \`${pri}\``);
    if (links.length) lines.push(`연결: ${links.join(' · ')}`);
    const crit = f.body.split('\n').map((l) => l.replace(/^[·\-*]\s*/, '').trim()).filter(Boolean);
    if (crit.length) {
      lines.push('', '수용 기준:');
      for (const c of crit) lines.push(`- [ ] ${c}`);
    }
    lines.push('');
  };

  for (const g of groups) {
    const feats = features.filter((f) => f.parent_id === g.id);
    if (!feats.length) continue;
    lines.push(`## ${g.ref_id} ${g.title}`, '');
    for (const f of feats) ticketFor(f);
  }
  const orphans = features.filter((f) => !groups.some((g) => g.id === f.parent_id));
  if (orphans.length) {
    lines.push('## 기타 기능', '');
    for (const f of orphans) ticketFor(f);
  }
  if (features.length === 0) lines.push('_(수락된 기능이 없습니다. 기능명세에서 수락 후 다시 내보내세요.)_', '');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
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
/**
 * AI 코딩 에이전트가 바로 실행 가능한 발주서. 지시서 섹션 덤프가 아니라, 수락된 항목에서
 * 역할·요구·기능(수용 기준 체크박스)·화면·플로우·비범위·작업 순서를 구조적으로 조립한다.
 */
export function promptPack(projectId: string): string {
  const doc = getHandoffDoc(projectId);
  if (!doc) return '# 개발 지시서\n\n아직 컴파일되지 않았습니다. 정합성 검사를 통과한 뒤 생성하세요.\n';
  const project = repo.getProject(projectId);
  const items = repo.listProjectItems(projectId).filter((i) => i.status === 'accepted');
  const reqs = repo.reqIdsForProject(projectId);
  const groups = items.filter((i) => i.kind === 'feature-group');
  const features = items.filter((i) => i.kind === 'feature');
  const pages = items.filter((i) => i.kind === 'page');
  const flows = items.filter((i) => i.kind === 'flow');
  const steps = items.filter((i) => i.kind === 'step');

  // 수락된 지시서 §개요(있으면) — AI 생성 요약
  const overview = repo
    .listAcceptedSections(doc.id)
    .find((s) => /개요|overview|배경/i.test(s.heading))?.body.trim();

  const L: string[] = [];
  L.push(`# ${project?.name ?? '프로젝트'} — 구현 발주 (AI 에이전트용)`, '');
  L.push('## 역할과 규칙');
  L.push('너는 이 제품의 구현을 맡은 시니어 엔지니어다. 아래를 지켜라:');
  L.push('- **수락된 명세만 구현한다.** 여기 없는 것은 만들지 않는다(범위 확장 금지).');
  L.push('- 각 기능의 **수용 기준을 모두 충족**해야 그 기능이 완료다.');
  L.push('- 화면은 IA 명세를, 화면 전환은 유저 플로우를 따른다.');
  L.push('- 불명확한 점은 임의로 정하지 말고 **질문으로 남겨라**.', '');

  if (overview) L.push('## 제품 개요', overview, '');

  L.push('## 요구사항 (REQ)');
  if (reqs.length) for (const r of reqs) L.push(`- **${r.id}** ${r.heading}`);
  else L.push('- (PRD 수락 섹션 없음)');
  L.push('');

  L.push('## 구현할 기능 (수락분)');
  const prioRank = (f: PlanItem) => ({ P0: 0, P1: 1, P2: 2 }[meta(f).priority ?? 'P2'] ?? 3);
  const byGroup = (g: PlanItem) => features.filter((f) => f.parent_id === g.id).sort((a, b) => prioRank(a) - prioRank(b));
  const emit = (f: PlanItem) => {
    const m = meta(f);
    const links = [...(m.links?.reqs ?? []), ...(m.links?.pages ?? []), ...(m.links?.flows ?? [])];
    L.push(`### [${m.priority ?? 'P?'}] ${f.ref_id} ${f.title}`);
    if (links.length) L.push(`- 연결: ${links.join(' · ')}`);
    const crit = f.body.split('\n').map((l) => l.replace(/^[·\-*]\s*/, '').trim()).filter(Boolean);
    if (crit.length) {
      L.push('- 수용 기준:');
      for (const c of crit) L.push(`  - [ ] ${c}`);
    }
    L.push('');
  };
  for (const g of groups.sort((a, b) => a.ref_id.localeCompare(b.ref_id))) {
    const feats = byGroup(g);
    if (!feats.length) continue;
    L.push(`#### ${g.ref_id} ${g.title}`, '');
    for (const f of feats) emit(f);
  }
  const orphanFeats = features.filter((f) => !groups.some((g) => g.id === f.parent_id)).sort((a, b) => prioRank(a) - prioRank(b));
  if (orphanFeats.length) {
    L.push('#### 기타', '');
    for (const f of orphanFeats) emit(f);
  }

  if (pages.length) {
    L.push('## 화면 (IA)');
    for (const pg of pages) {
      const m = meta(pg);
      L.push(`- **${pg.ref_id}** ${pg.title} [${m.page_type ?? 'GENERIC'}]` + (m.links?.features?.length ? ` · 기능 ${m.links.features.join(', ')}` : ''));
    }
    L.push('');
  }

  if (flows.length) {
    L.push('## 유저 플로우');
    for (const fl of flows) {
      const flSteps = steps.filter((s) => s.parent_id === fl.id).sort((a, b) => a.position - b.position);
      const chain = flSteps
        .map((s) => {
          const sm = meta(s);
          const pg = sm.page ? `[${sm.page}] ` : '';
          const br = sm.branch?.label ? ` (${sm.branch.label})` : '';
          return `${pg}${s.title}${br}`;
        })
        .join(' → ');
      L.push(`- **${fl.ref_id}** ${fl.title}: ${chain || '(스텝 없음)'}`);
    }
    L.push('');
  }

  L.push('## 비범위 (구현 금지)');
  L.push('- PRD 비범위 및 수락하지 않은 항목은 이번 구현에서 제외한다.', '');

  L.push('## 작업 순서');
  L.push('1. **P0 기능**부터 순서대로 구현한다. 각 기능은 수용 기준 체크박스를 모두 충족해야 완료.');
  L.push('2. 화면(IA)과 플로우 명세대로 연결한다.');
  L.push('3. 범위 확장·임의 기능 추가 금지. 불명확하면 질문으로 남긴다.');
  L.push('4. 완료 시 각 수용 기준을 어떻게 충족했는지 근거와 함께 요약한다.', '');

  return L.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

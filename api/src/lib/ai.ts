import { resolveProvider } from '../providers/index.ts';
import type { ChatMessage } from '../providers/types.ts';
import { getTemplateForType } from './templates.ts';
import { getSetting } from '../db/repos.ts';
import * as repo from '../db/repos.ts';
import type { DocumentType, ProviderId, InterviewAnswer } from './types.ts';

export interface ModelConfig {
  provider: ProviderId;
  model: string;
  maxTokens: number;
}

const DEFAULT_MODELS: Record<ProviderId, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o-mini',
  // 3.5-sonnet 은 OpenRouter 에서 deprecated(404) — 활성 4.x 최신으로.
  openrouter: 'anthropic/claude-sonnet-4.6',
};

const PROVIDER_ORDER: ProviderId[] = ['openrouter', 'anthropic', 'openai'];

function pickDefaultProvider(): ProviderId {
  for (const p of PROVIDER_ORDER) {
    if (repo.getKeyMeta(p)) return p;
  }
  return 'openrouter';
}

/** Per-document-type model + token budget (SPEC-18/19). Settings override defaults. */
export function getModelConfig(docType: DocumentType): ModelConfig {
  const stored = getSetting<Record<string, Partial<ModelConfig>>>('provider_models') ?? {};
  const base: ModelConfig = {
    provider: pickDefaultProvider(),
    model: '',
    // 추론형(reasoning) 모델은 추론 토큰이 예산을 먹어 본문이 비기 쉽다 — 헤드룸 확보.
    maxTokens: 8192,
  };
  const merged = { ...base, ...(stored.default ?? {}), ...(stored[docType] ?? {}) };
  if (!merged.provider) merged.provider = base.provider;
  if (!merged.model) merged.model = DEFAULT_MODELS[merged.provider];
  if (!merged.maxTokens) merged.maxTokens = 8192;
  return merged as ModelConfig;
}

// ── prompt construction ──────────────────────────────────────────────────────

function parentContextBlock(documentId: string): string {
  const ctx = repo.getParentContext(documentId);
  if (!ctx) return '';
  const body = ctx.sections
    .map((s) => `### ${s.heading}\n${s.body}`)
    .join('\n\n');
  return (
    `상위 문서 컨텍스트 (${ctx.parentType}, "${ctx.parentTitle}", v${ctx.parentVersion}) — ` +
    `이 내용과 정합하도록 작성하라:\n\n${body}\n\n---\n`
  );
}

function answersBlock(answers: InterviewAnswer[]): string {
  if (!answers.length) return '(인터뷰 답변 없음 — 합리적 기본값으로 작성)';
  return answers.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join('\n\n');
}

/** Short human basis label for a suggestion (SYSTEM.md §0.3). */
export function draftSourceLabel(answers: InterviewAnswer[]): string {
  if (!answers.length) return '인터뷰 (기본값)';
  const ids = answers
    .map((a) => a.questionId)
    .filter(Boolean)
    .slice(0, 4);
  return ids.length ? `인터뷰 ${ids.join('·')}` : '인터뷰';
}

/** Messages to draft one section. Section-by-section keeps SSE boundaries clean. */
export function buildSectionMessages(params: {
  documentId: string;
  docType: DocumentType;
  heading: string;
  answers: InterviewAnswer[];
  guidance: string;
}): ChatMessage[] {
  const parent = parentContextBlock(params.documentId);
  // 문서 전체 섹션 구성을 알려줘야 섹션 간 내용 중복(개요에 문제 정의 통째 포함 등)이 없다
  const allSections = getTemplateForType(params.docType)?.sections ?? [];
  const outline = allSections.length
    ? `이 문서의 전체 섹션 구성: ${allSections.map((s) => `"${s}"`).join(' · ')}. ` +
      `너는 그중 "${params.heading}" 하나만 쓴다. 다른 섹션에서 다룰 내용은 이 섹션에서 반복하거나 미리 쓰지 말라. `
    : '';
  const system =
    `${params.guidance}\n\n` +
    `너는 지금 "${params.docType}" 문서의 한 섹션만 작성한다. ` +
    outline +
    `섹션 제목("${params.heading}")은 앱이 별도로 표시하므로 본문에 다시 쓰지 말라. ` +
    `제목이나 다른 섹션은 쓰지 말고, 요청된 섹션 본문만 마크다운으로 출력하라. ` +
    `간결하고 구체적으로, 불릿과 짧은 문단을 섞어 작성하라.`;
  const user =
    `${parent}` +
    `아래는 기획 인터뷰 답변이다:\n\n${answersBlock(params.answers)}\n\n` +
    `이제 다음 섹션을 작성하라.\n섹션 제목: ${params.heading}\n`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * 모델이 프롬프트 지시를 어기고 본문 첫 줄에 섹션 제목을 반복하는 경우가 있다
 * ("## 문제 정의" / "**문제 정의**" / "문제 정의:" 등). 앱이 heading 을 별도
 * 렌더하므로 저장 전에 걷어낸다. 제목과 일치할 때만 — 일반 본문은 건드리지 않는다.
 */
export function stripLeadingHeading(body: string, heading: string): string {
  const trimmed = body.trim();
  const nl = trimmed.indexOf('\n');
  const first = (nl === -1 ? trimmed : trimmed.slice(0, nl)).trim();
  const normalize = (s: string) =>
    s
      .replace(/^#{1,6}\s*/, '') // 마크다운 heading 마커
      .replace(/^\*\*(.*)\*\*$/, '$1') // 볼드 감싸기
      .replace(/[\s:：.]+$/, '') // 꼬리 콜론·마침표
      .trim();
  if (normalize(first) !== normalize(heading)) return trimmed;
  return nl === -1 ? '' : trimmed.slice(nl + 1).trim();
}

// ── streaming orchestration ──────────────────────────────────────────────────

export type DraftEvent =
  | { type: 'section_start'; sectionId: string; heading: string; index: number; total: number }
  | { type: 'token'; sectionId: string; delta: string }
  | { type: 'section_end'; sectionId: string }
  | { type: 'done'; documentId: string }
  | { type: 'error'; message: string };

/**
 * Generate a full document draft, section by section. Creates empty sections
 * up-front (so each has a stable id the client can target), then streams each
 * one. Emits SSE-shaped events per docs/spec/ux-mode-transition.md §3.
 */
export async function* streamDocumentDraft(
  documentId: string,
  signal?: AbortSignal,
): AsyncGenerator<DraftEvent> {
  const doc = repo.getDocument(documentId);
  if (!doc) {
    yield { type: 'error', message: 'document not found' };
    return;
  }
  const template = getTemplateForType(doc.type);
  const headings = template?.sections ?? ['개요'];
  const session = repo.getSessionByDocument(documentId);
  const answers = session?.answers ?? [];
  const guidance = template?.draftGuidance ?? '명확한 기획 문서를 작성한다.';
  const cfg = getModelConfig(doc.type);
  const provider = resolveProvider(cfg.provider);

  repo.setDocumentStatus(documentId, 'streaming');

  // AI output is always a PROPOSAL (SYSTEM.md §0.1). Create empty sections
  // up-front (stable ids for the client) in 'proposed' state.
  const created = repo.replaceSections(
    documentId,
    headings.map((h) => ({ heading: h, body: '' })),
    'proposed',
  );
  // Basis for the whole draft = the interview answers behind it (§0.3).
  const draftSource = draftSourceLabel(answers);

  try {
    for (let i = 0; i < created.length; i++) {
      const section = created[i];
      yield {
        type: 'section_start',
        sectionId: section.id,
        heading: section.heading,
        index: i,
        total: created.length,
      };
      const messages = buildSectionMessages({
        documentId,
        docType: doc.type,
        heading: section.heading,
        answers,
        guidance,
      });
      let body = '';
      for await (const delta of provider.streamChat({
        model: cfg.model,
        maxTokens: cfg.maxTokens,
        messages,
        signal,
      })) {
        body += delta;
        yield { type: 'token', sectionId: section.id, delta };
      }
      const finalBody = stripLeadingHeading(body, section.heading);
      repo.updateSection(section.id, { body: finalBody });
      // Each generated section arrives as an 'add' proposal with its basis.
      repo.createSuggestion({
        documentId,
        sectionId: section.id,
        kind: 'add',
        title: `"${section.heading}" 섹션 초안`,
        body: '인터뷰 답변을 바탕으로 생성된 초안입니다. 수락하면 문서에 반영됩니다.',
        quoteAfter: finalBody,
        source: draftSource,
      });
      yield { type: 'section_end', sectionId: section.id };
    }
    repo.setDocumentStatus(documentId, 'ready');
    repo.snapshotDocument(documentId, 'save', { reason: 'initial_draft' });
    yield { type: 'done', documentId };
  } catch (e) {
    repo.setDocumentStatus(documentId, 'draft');
    yield { type: 'error', message: (e as Error).message };
  }
}

/**
 * Rewrite one section from an explicit user instruction (SYSTEM.md §0.4, the
 * 3rd handling option). Non-streaming: runs the provider to completion, sets the
 * section back to 'proposed', and returns a NEW 'revise' suggestion whose source
 * is the user's own instruction. Works with the stub provider (no network).
 */
export async function rewriteSection(
  sectionId: string,
  instruction: string,
): Promise<{ section: import('./types.ts').Section; suggestion: import('./types.ts').Suggestion } | null> {
  const section = repo.getSection(sectionId);
  if (!section) return null;
  const doc = repo.getDocument(section.document_id);
  if (!doc) return null;
  const template = getTemplateForType(doc.type);
  const session = repo.getSessionByDocument(doc.id);
  const answers = session?.answers ?? [];
  const guidance = template?.draftGuidance ?? '명확한 기획 문서를 작성한다.';
  const cfg = getModelConfig(doc.type);
  const provider = resolveProvider(cfg.provider);

  const messages = buildSectionMessages({
    documentId: doc.id,
    docType: doc.type,
    heading: section.heading,
    answers,
    guidance,
  });
  // append the user's rewrite instruction + the current text as context
  messages.push({
    role: 'user',
    content:
      `현재 "${section.heading}" 섹션 본문:\n\n${section.body}\n\n` +
      `아래 지시에 따라 이 섹션을 다시 써라. 섹션 본문만 마크다운으로 출력하라.\n` +
      `지시: ${instruction}`,
  });

  const before = section.body;
  let body = '';
  for await (const delta of provider.streamChat({
    model: cfg.model,
    maxTokens: cfg.maxTokens,
    messages,
  })) {
    body += delta;
  }
  const next = stripLeadingHeading(body, section.heading);
  repo.updateSection(section.id, { body: next });
  repo.setSectionStatus(section.id, 'proposed');
  repo.snapshotDocument(doc.id, 'save', { reason: 'rewrite_section', sectionId });
  const trimmed = instruction.trim();
  const suggestion = repo.createSuggestion({
    documentId: doc.id,
    sectionId: section.id,
    kind: 'revise',
    title: `"${section.heading}" 고쳐쓰기`,
    body: '사용자 지시로 재작성했습니다. 수락하면 문서에 반영됩니다.',
    quoteBefore: before,
    quoteAfter: next,
    source: `사용자 지시: ${trimmed.length > 60 ? trimmed.slice(0, 60) + '…' : trimmed}`,
  });
  return { section: repo.getSection(section.id)!, suggestion };
}

/** Regenerate a single section (SPEC-07) — only this section is replaced. */
export async function* streamSectionRegeneration(
  sectionId: string,
  signal?: AbortSignal,
): AsyncGenerator<DraftEvent> {
  const section = repo.getSection(sectionId);
  if (!section) {
    yield { type: 'error', message: 'section not found' };
    return;
  }
  const doc = repo.getDocument(section.document_id);
  if (!doc) {
    yield { type: 'error', message: 'document not found' };
    return;
  }
  const template = getTemplateForType(doc.type);
  const session = repo.getSessionByDocument(doc.id);
  const answers = session?.answers ?? [];
  const guidance = template?.draftGuidance ?? '명확한 기획 문서를 작성한다.';
  const cfg = getModelConfig(doc.type);
  const provider = resolveProvider(cfg.provider);

  const before = section.body;
  yield {
    type: 'section_start',
    sectionId: section.id,
    heading: section.heading,
    index: 0,
    total: 1,
  };
  try {
    const messages = buildSectionMessages({
      documentId: doc.id,
      docType: doc.type,
      heading: section.heading,
      answers,
      guidance,
    });
    let body = '';
    for await (const delta of provider.streamChat({
      model: cfg.model,
      maxTokens: cfg.maxTokens,
      messages,
      signal,
    })) {
      body += delta;
      yield { type: 'token', sectionId: section.id, delta };
    }
    // Regenerated content is a fresh PROPOSAL — back to 'proposed' until re-accepted.
    const finalBody = stripLeadingHeading(body, section.heading);
    repo.updateSection(section.id, { body: finalBody });
    repo.setSectionStatus(section.id, 'proposed');
    repo.createSuggestion({
      documentId: doc.id,
      sectionId: section.id,
      kind: 'revise',
      title: `"${section.heading}" 섹션 재생성`,
      body: '섹션을 재생성했습니다. 수락하면 새 본문이 문서에 반영됩니다.',
      quoteBefore: before,
      quoteAfter: finalBody,
      source: draftSourceLabel(answers),
    });
    yield { type: 'section_end', sectionId: section.id };
    repo.snapshotDocument(doc.id, 'save', { reason: 'regenerate_section', sectionId });
    yield { type: 'done', documentId: doc.id };
  } catch (e) {
    yield { type: 'error', message: (e as Error).message };
  }
}

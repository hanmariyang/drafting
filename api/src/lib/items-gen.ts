// AI generation for the three STRUCTURE documents (§2). The LLM returns CONTENT
// ONLY ({groups|pages|flows}) — never ref_ids (server-numbered §1.2). Output is
// always 'proposed' with a per-item suggestion carrying its basis (§0.1/§0.3).
// AI_STUB=1 short-circuits to deterministic fixtures (§2 last bullet).

import { config } from './config.ts';
import { resolveProvider } from '../providers/index.ts';
import { getModelConfig } from './ai.ts';
import { getTemplateForType } from './templates.ts';
import * as repo from '../db/repos.ts';
import type { ChatMessage } from '../providers/types.ts';
import type { DocumentType, PlanItem, PlanItemStatus } from './types.ts';
import {
  SPEC_FIXTURE,
  IA_FIXTURE,
  FLOW_FIXTURE,
  type SpecData,
  type IaData,
  type FlowData,
} from './fixtures.ts';

export type StructureType = 'feature-spec' | 'ia' | 'user-flow';
export function isStructureType(t: DocumentType): t is StructureType {
  return t === 'feature-spec' || t === 'ia' || t === 'user-flow';
}

export type ItemGenEvent =
  | { type: 'item'; item: PlanItem }
  | { type: 'done'; documentId: string; count: number }
  | { type: 'error'; message: string };

// ── lenient JSON parsing (§2) ────────────────────────────────────────────────
export function extractJson(text: string): string {
  let t = text.trim();
  // drop a leading ```json / ``` fence and a trailing ``` fence
  t = t.replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```$/, '').trim();
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first >= 0 && last > first) return t.slice(first, last + 1);
  return t;
}
export function parseItemsJson(text: string): unknown {
  return JSON.parse(extractJson(text));
}

// ── prompt (non-stub path) ───────────────────────────────────────────────────
function buildItemsMessages(doc: { id: string; type: StructureType }): ChatMessage[] {
  const template = getTemplateForType(doc.type);
  const session = repo.getSessionByDocument(doc.id);
  const answers = session?.answers ?? [];
  const ctx = repo.getParentContext(doc.id);
  const parentBlock = ctx
    ? `상위 문서(${ctx.parentType} "${ctx.parentTitle}"):\n` +
      ctx.sections.map((s) => `### ${s.heading}\n${s.body}`).join('\n\n') +
      '\n\n---\n'
    : '';
  const answerBlock = answers.length
    ? answers.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join('\n\n')
    : '(답변 없음 — 합리적 기본값)';
  const shape = SHAPE_HINT[doc.type];
  const system =
    `${template?.draftGuidance ?? '구조 문서를 작성한다.'}\n\n` +
    `반드시 JSON 하나만 출력하라. 코드펜스·설명 문장 금지. ` +
    `id·번호(F-/PG-/FLOW-)는 절대 넣지 마라 — 번호는 서버가 매긴다.\n${shape}`;
  const user = `${parentBlock}인터뷰 답변:\n\n${answerBlock}\n\n위 계약대로 JSON 을 출력하라.`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

const SHAPE_HINT: Record<StructureType, string> = {
  'feature-spec':
    '형태: {"groups":[{"title":str,"features":[{"title":str,"body":str,"priority":"P0|P1|P2","source":str,"links":{"reqs":[str],"pages":[str],"flows":[str]}}]}]}',
  ia: '형태: {"pages":[{"title":str,"section":str,"page_type":"LIST|DETAIL|FORM|DASH|SETTINGS|GENERIC","links":{"features":[str]}}]}. ' +
    'section 은 사이트맵 계층 그룹(예: "예약","내 정보","관리자") — 관련 화면끼리 같은 section 으로 묶어라.',
  'user-flow':
    '형태: {"flows":[{"title":str,"source":str,"links":{"features":[str]},"steps":[{"title":str,"page":str|null,"node":"start|screen|decision|end","branch":{"label":str,"from_step":str}|null,"note":str}]}]}',
};

// ── materialize structured data into plan_items ──────────────────────────────
interface MaterializeOpts {
  status?: PlanItemStatus;
  /** create an 'add' suggestion per item (proposal grammar). Default true. */
  withSuggestions?: boolean;
  /** collect created items here (in creation order) */
  onItem?: (item: PlanItem) => void;
}

export function materializeSpec(documentId: string, data: SpecData, opts: MaterializeOpts): void {
  const status = opts.status ?? 'proposed';
  for (const g of data.groups) {
    const group = repo.createItem({
      documentId,
      kind: 'feature-group',
      title: g.title,
      meta: {},
      status,
    });
    opts.onItem?.(group);
    if (opts.withSuggestions !== false) addSuggestion(documentId, group, 'PRD');
    for (const f of g.features) {
      const feat = repo.createItem({
        documentId,
        kind: 'feature',
        parentId: group.id,
        title: f.title,
        body: f.body,
        meta: { priority: f.priority, source: f.source, links: f.links },
        status,
      });
      opts.onItem?.(feat);
      if (opts.withSuggestions !== false) addSuggestion(documentId, feat, f.source);
    }
  }
}

export function materializeIa(documentId: string, data: IaData, opts: MaterializeOpts): void {
  const status = opts.status ?? 'proposed';
  for (const p of data.pages) {
    const page = repo.createItem({
      documentId,
      kind: 'page',
      title: p.title,
      meta: { page_type: p.page_type, section: p.section, source: p.source, links: p.links },
      status,
    });
    opts.onItem?.(page);
    if (opts.withSuggestions !== false) addSuggestion(documentId, page, p.source ?? 'IA');
  }
}

export function materializeFlow(documentId: string, data: FlowData, opts: MaterializeOpts): void {
  const status = opts.status ?? 'proposed';
  for (const fl of data.flows) {
    const flow = repo.createItem({
      documentId,
      kind: 'flow',
      title: fl.title,
      meta: { source: fl.source, links: fl.links },
      status,
    });
    opts.onItem?.(flow);
    if (opts.withSuggestions !== false) addSuggestion(documentId, flow, fl.source);
    for (const st of fl.steps) {
      const step = repo.createItem({
        documentId,
        kind: 'step',
        parentId: flow.id,
        title: st.title,
        meta: { page: st.page ?? null, branch: st.branch ?? null, note: st.note, node: st.node },
        status,
      });
      opts.onItem?.(step);
      // steps are part of a flow proposal — no separate card (keeps queue readable)
    }
  }
}

function addSuggestion(documentId: string, item: PlanItem, source: string): void {
  repo.createSuggestion({
    documentId,
    targetItemId: item.id,
    kind: 'add',
    title: `${item.ref_id} "${item.title}"`,
    body: '인터뷰·상위 문서를 바탕으로 제안된 항목입니다. 수락하면 문서에 반영됩니다.',
    source: source || item.kind,
  });
}

// ── data acquisition (stub vs provider) ──────────────────────────────────────
async function acquireData(doc: { id: string; type: StructureType }): Promise<unknown> {
  if (config.aiStub || config.managedTier) return fixtureFor(doc.type);
  const cfg = getModelConfig(doc.type as DocumentType);
  const provider = resolveProvider(cfg.provider);
  const messages = buildItemsMessages(doc);
  const run = async (): Promise<string> => {
    let text = '';
    for await (const delta of provider.streamChat({
      model: cfg.model,
      maxTokens: cfg.maxTokens,
      messages,
    })) {
      text += delta;
    }
    return text;
  };
  // lenient parse with one retry (§2)
  const first = await run();
  try {
    return parseItemsJson(first);
  } catch {
    const second = await run();
    return parseItemsJson(second); // throws on second failure → surfaced as error
  }
}

export function fixtureFor(type: StructureType): unknown {
  if (type === 'feature-spec') return SPEC_FIXTURE;
  if (type === 'ia') return IA_FIXTURE;
  return FLOW_FIXTURE;
}

/**
 * Generate items for a structure document, replacing any prior generated set.
 * Streams an event per created item, then 'done'. Items land as 'proposed'.
 */
export async function* streamItemsGeneration(documentId: string): AsyncGenerator<ItemGenEvent> {
  const doc = repo.getDocument(documentId);
  if (!doc) {
    yield { type: 'error', message: 'document not found' };
    return;
  }
  if (!isStructureType(doc.type)) {
    yield { type: 'error', message: `document type ${doc.type} has no item generation` };
    return;
  }
  repo.setDocumentStatus(documentId, 'streaming');
  try {
    const data = await acquireData({ id: doc.id, type: doc.type });
    // fresh generation replaces prior generated items for this document
    for (const it of repo.listItems(documentId)) repo.deleteItem(it.id);
    const created: PlanItem[] = [];
    const opts: MaterializeOpts = { status: 'proposed', withSuggestions: true, onItem: (i) => created.push(i) };
    if (doc.type === 'feature-spec') materializeSpec(documentId, data as SpecData, opts);
    else if (doc.type === 'ia') materializeIa(documentId, data as IaData, opts);
    else materializeFlow(documentId, data as FlowData, opts);
    for (const it of created) yield { type: 'item', item: it };
    repo.setDocumentStatus(documentId, 'ready');
    yield { type: 'done', documentId, count: created.length };
  } catch (e) {
    repo.setDocumentStatus(documentId, 'draft');
    yield { type: 'error', message: (e as Error).message };
  }
}

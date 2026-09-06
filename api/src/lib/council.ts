// 카운슬 비평 — 수락 전에 받아보는 다관점 비평(경량판).
//
// 엔지니어(실현 가능성·기술 리스크·숨은 복잡도) / 디자이너(사용자 경험 갭·빈 상태·
// 엣지) / 회의론자(반례·가정 공격·범위 팽창) 세 관점을 **AI 호출 1회**로 받아,
// 각 비평을 해당 섹션에 붙는 제안 카드로 적재한다. 게이트 아님 — 카드는 사람이
// 처리한다(설정에서 통째로 끌 수 있다).
//
// 잘못 붙은 비평이 안 붙은 비평보다 해롭다: 모델이 말한 섹션 제목이 실제 섹션과
// 맞지 않으면 첫 섹션에 붙이지 않고 **버린다**.

import { config } from './config.ts';
import { resolveProvider } from '../providers/index.ts';
import { getModelConfig } from './ai.ts';
import * as repo from '../db/repos.ts';
import type { ChatMessage } from '../providers/types.ts';
import type { DocumentType, Section } from './types.ts';

export type CouncilPersona = 'engineer' | 'designer' | 'skeptic';

export const PERSONA_LABEL: Record<CouncilPersona, string> = {
  engineer: '엔지니어',
  designer: '디자이너',
  skeptic: '회의론자',
};

const PERSONA_FOCUS: Record<CouncilPersona, string> = {
  engineer: '실현 가능성·기술 리스크·숨은 복잡도',
  designer: '사용자 경험 갭·빈 상태·엣지 케이스',
  skeptic: '반례·가정 공격·범위 팽창',
};

export const MAX_CRITIQUES = 6;

export interface RawCritique {
  persona?: unknown;
  sectionHeading?: unknown;
  critique?: unknown;
}

export interface ResolvedCritique {
  persona: CouncilPersona;
  sectionId: string;
  heading: string;
  critique: string;
}

/** 카운슬 비평 기능 on/off (기본 켬). 꺼져 있으면 버튼도 API 도 닫힌다. */
export function councilEnabled(): boolean {
  return repo.getSetting<boolean>('council_enabled') ?? true;
}

/** council 대상 문서인가 — 산문 기획(prd·feature)만. */
export function isCouncilType(t: DocumentType): boolean {
  return t === 'prd' || t === 'feature';
}

/** 제목 비교용 정규화 — 공백·문장부호·대소문자 차이는 같은 섹션으로 본다. */
function normalizeHeading(h: string): string {
  return h
    .toLowerCase()
    .replace(/^#{1,6}\s*/, '')
    .replace(/["'“”‘’「」『』()[\]]/g, '')
    .replace(/[\s·:：.,\-—]/g, '');
}

function toPersona(v: unknown): CouncilPersona | null {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return null;
  if (s.includes('engineer') || s.includes('엔지니어') || s.includes('개발')) return 'engineer';
  if (s.includes('design') || s.includes('디자이너') || s.includes('디자인')) return 'designer';
  if (s.includes('skeptic') || s.includes('회의')) return 'skeptic';
  return null;
}

/**
 * 모델 출력 → 실제 섹션에 붙는 비평. 페르소나를 못 읽거나 섹션 제목이 문서의
 * 어떤 섹션과도 맞지 않으면 버린다(첫 섹션 폴백 없음). 최대 6개.
 */
export function resolveCritiques(
  sections: Array<Pick<Section, 'id' | 'heading'>>,
  raw: RawCritique[],
): { kept: ResolvedCritique[]; dropped: number } {
  const byHeading = new Map<string, { id: string; heading: string }>();
  for (const s of sections) {
    const k = normalizeHeading(s.heading);
    if (k && !byHeading.has(k)) byHeading.set(k, { id: s.id, heading: s.heading });
  }
  const kept: ResolvedCritique[] = [];
  let dropped = 0;
  for (const r of raw) {
    if (kept.length >= MAX_CRITIQUES) {
      dropped++;
      continue;
    }
    const persona = toPersona(r.persona);
    const critique = typeof r.critique === 'string' ? r.critique.trim() : '';
    const target = byHeading.get(normalizeHeading(String(r.sectionHeading ?? '')));
    if (!persona || !critique || !target) {
      dropped++;
      continue;
    }
    kept.push({ persona, sectionId: target.id, heading: target.heading, critique });
  }
  return { kept, dropped };
}

/** 모델 출력에서 배열을 꺼낸다 — 코드펜스·{"critiques":[...]} 래핑 허용. */
export function parseCritiques(text: string): RawCritique[] {
  const t = text
    .trim()
    .replace(/^```[a-zA-Z]*\s*/, '')
    .replace(/\s*```$/, '')
    .trim();
  const a = t.indexOf('[');
  const b = t.lastIndexOf(']');
  if (a >= 0 && b > a) {
    try {
      const arr = JSON.parse(t.slice(a, b + 1));
      if (Array.isArray(arr)) return arr as RawCritique[];
    } catch {
      /* 객체 래핑 시도로 폴백 */
    }
  }
  const o = t.indexOf('{');
  const p = t.lastIndexOf('}');
  if (o >= 0 && p > o) {
    const obj = JSON.parse(t.slice(o, p + 1)) as { critiques?: unknown };
    if (Array.isArray(obj.critiques)) return obj.critiques as RawCritique[];
  }
  throw new Error('비평 JSON 을 읽지 못했습니다');
}

function buildMessages(
  docType: DocumentType,
  sections: Array<Pick<Section, 'heading' | 'body'>>,
): ChatMessage[] {
  const personas = (Object.keys(PERSONA_LABEL) as CouncilPersona[])
    .map((p) => `- ${PERSONA_LABEL[p]}: ${PERSONA_FOCUS[p]}`)
    .join('\n');
  const headings = sections.map((s) => `"${s.heading}"`).join(' · ');
  const system =
    `너는 기획 리뷰 카운슬이다. 아래 "${docType}" 기획을 세 관점에서 동시에 비평한다.\n` +
    `${personas}\n\n` +
    `치명적인 것만 쓴다. 칭찬·요약·동의는 쓰지 마라. 한 항목은 한 문제만 다루고, ` +
    `무엇이 문제인지와 무엇을 정해야 하는지를 2~3문장 한국어 존댓말로 쓴다.\n` +
    `sectionHeading 은 반드시 이 문서에 실제로 있는 제목 그대로여야 한다: ${headings}\n` +
    `총 ${MAX_CRITIQUES}개 이하. 지적할 게 없으면 빈 배열을 출력하라.\n` +
    `오직 JSON 배열 하나만 출력(코드펜스·설명 없이): ` +
    `[{"persona":"엔지니어|디자이너|회의론자","sectionHeading":"섹션 제목","critique":"비평"}]`;
  const user =
    `기획 본문:\n\n` +
    sections.map((s) => `### ${s.heading}\n${s.body}`).join('\n\n') +
    `\n\n위 기준으로 비평 JSON 배열을 출력하라.`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * 스텁(오프라인) 경로 — 결정적. 세 페르소나가 각각 자기 관점의 상수 질문을 던진다
 * (엔지니어는 섹션이 둘 이상이면 두 번째 섹션까지 본다 = 3~4개).
 */
export function stubCritiques(
  sections: Array<Pick<Section, 'heading'>>,
): RawCritique[] {
  if (!sections.length) return [];
  const first = sections[0].heading;
  const second = sections[Math.min(1, sections.length - 1)].heading;
  const third = sections[Math.min(2, sections.length - 1)].heading;
  const out: RawCritique[] = [
    {
      persona: '엔지니어',
      sectionHeading: first,
      critique:
        '여기에 적힌 동작을 그대로 만들면 무엇이 가장 오래 걸릴지가 드러나 있지 않습니다. 가장 비싼 부분 하나를 지목하고, 그것을 뺀 형태도 성립하는지 적어 주세요.',
    },
    {
      persona: '디자이너',
      sectionHeading: second,
      critique:
        '데이터가 0건이거나 실패했을 때 화면이 정해져 있지 않습니다. 빈 상태와 실패 상태에서 사용자가 다음에 무엇을 누르는지 한 줄씩 정해 주세요.',
    },
    {
      persona: '회의론자',
      sectionHeading: third,
      critique:
        '이 기획은 사용자가 이 흐름을 실제로 쓴다는 가정 위에 서 있습니다. 그 가정이 틀렸을 때 무엇이 남는지, 무엇을 보고 가정이 틀렸다고 판단할지 적어 주세요.',
    },
  ];
  if (sections.length > 1) {
    out.push({
      persona: '엔지니어',
      sectionHeading: second,
      critique:
        '기존 데이터가 이미 쌓여 있을 때의 처리가 비어 있습니다. 이관이 필요한지, 필요 없다면 왜 없는지를 한 줄로 정해 주세요.',
    });
  }
  return out;
}

export class CouncilError extends Error {}

/**
 * 문서를 세 관점으로 비평하고, 각 비평을 해당 섹션의 제안 카드로 적재한다.
 * kind 는 'question' — 비평은 대체 텍스트가 아니라 답해야 할 질문이다(§0.4 카드 유형).
 */
export async function runCouncil(documentId: string): Promise<{
  created: number;
  dropped: number;
  /** 새 실행 결과에 없어 정리(dismissed)된 이전 열린 카드 수 */
  replaced: number;
  /** 동일 비평이 이미 있어(열림 유지 또는 처리됨) 새로 만들지 않은 수 */
  unchanged: number;
  critiques: ResolvedCritique[];
}> {
  const doc = repo.getDocument(documentId);
  if (!doc) throw new CouncilError('document not found');
  if (!isCouncilType(doc.type)) {
    throw new CouncilError('산문 기획 문서(prd·feature)만 비평합니다');
  }
  const sections = repo
    .listSections(documentId)
    .filter((s) => s.status !== 'rejected' && s.body.trim());
  if (!sections.length) throw new CouncilError('아직 비평할 본문이 없습니다');

  let raw: RawCritique[];
  if (config.aiStub || config.managedTier) {
    raw = stubCritiques(sections);
  } else {
    const cfg = getModelConfig(doc.type);
    const provider = resolveProvider(cfg.provider);
    let text = '';
    for await (const delta of provider.streamChat({
      model: cfg.model,
      maxTokens: Math.max(cfg.maxTokens, 3000),
      messages: buildMessages(doc.type, sections),
    })) {
      text += delta;
    }
    raw = parseCritiques(text);
  }

  const { kept, dropped } = resolveCritiques(sections, raw);

  // ── dedupe: 재실행 = 갱신 ──────────────────────────────────────────────────
  // 같은 비평(섹션·페르소나·본문 동일)이 이미 열려 있으면 그대로 두고(중첩 금지),
  // 이미 처리한(수락·거절·넘김) 비평과 동일한 것은 되살리지 않는다.
  // 새 실행 결과에 없는 열린 카운슬 카드는 낡은 비평이므로 정리(dismissed)한다.
  const keyOf = (sectionId: string, source: string, body: string) =>
    `${sectionId} ${source} ${body.trim()}`;
  const wanted = new Map<string, ResolvedCritique>();
  for (const c of kept) {
    wanted.set(keyOf(c.sectionId, `카운슬 · ${PERSONA_LABEL[c.persona]}`, c.critique), c);
  }
  let replaced = 0;
  let unchanged = 0;
  const prev = repo
    .listSuggestions(documentId)
    .filter((s) => (s.source ?? '').startsWith('카운슬 · '));
  for (const s of prev) {
    const k = keyOf(s.section_id ?? '', s.source ?? '', s.body ?? '');
    if (wanted.has(k)) {
      // 동일 비평이 이미 존재 — 열려 있으면 유지, 처리됐으면 부활 금지
      wanted.delete(k);
      unchanged++;
    } else if (s.status === 'open') {
      repo.resolveSuggestion(s.id, 'dismissed');
      replaced++;
    }
  }

  const createdList = [...wanted.values()];
  for (const c of createdList) {
    repo.createSuggestion({
      documentId,
      sectionId: c.sectionId,
      kind: 'question',
      title: `"${c.heading}" 비평`,
      body: c.critique,
      source: `카운슬 · ${PERSONA_LABEL[c.persona]}`,
    });
  }
  return { created: createdList.length, dropped, replaced, unchanged, critiques: kept };
}

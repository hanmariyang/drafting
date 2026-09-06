// 꼬리 질문(보강 질문) — 적응형 인터뷰 보강.
//
// 얕은 답변("빠르게 만들고 싶다")은 하류 기획 전부를 일반론으로 만든다. 여기서는
// AI 가 답변을 읽고 **얕은 곳만 골라** 최대 3개의 짧은 보강 질문을 만든다. 만들어진
// 질문은 세션의 extra_questions 에 붙고, 그 답변은 일반 답변과 같은 answers 배열로
// 들어간다 — 초안 프롬프트(ai.ts answersBlock)까지 별도 기계 없이 흘러간다.
//
// 게이트 아님: 질문이 0개면 그대로 초안으로 간다.

import { createHash } from 'node:crypto';
import { config } from './config.ts';
import { resolveProvider } from '../providers/index.ts';
import { getModelConfig } from './ai.ts';
import { getTemplateForType } from './templates.ts';
import * as repo from '../db/repos.ts';
import type { ChatMessage } from '../providers/types.ts';
import type { DocumentType, ExtraQuestion, InterviewAnswer } from './types.ts';

export const MAX_FOLLOWUPS = 3;

interface RawFollowup {
  question?: unknown;
  hint?: unknown;
  reason?: unknown;
}

/** 질문 문장에서 안정적인 id 를 만든다 — 같은 질문을 다시 받아도 이전 답변이 유지된다. */
export function followupId(question: string): string {
  return `fu-${createHash('sha1').update(question.trim()).digest('hex').slice(0, 8)}`;
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s);

/** 모델 출력에서 배열을 꺼낸다 — 코드펜스·설명·{"questions":[...]} 래핑을 모두 허용. */
export function parseFollowups(text: string): RawFollowup[] {
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
      if (Array.isArray(arr)) return arr as RawFollowup[];
    } catch {
      /* 객체 래핑 시도로 폴백 */
    }
  }
  const o = t.indexOf('{');
  const p = t.lastIndexOf('}');
  if (o >= 0 && p > o) {
    const obj = JSON.parse(t.slice(o, p + 1)) as { questions?: unknown };
    if (Array.isArray(obj.questions)) return obj.questions as RawFollowup[];
  }
  throw new Error('보강 질문 JSON 을 읽지 못했습니다');
}

/** 원시 출력 → 저장 가능한 질문. 빈 질문·중복은 버리고 최대 3개까지. */
export function normalizeFollowups(raw: RawFollowup[]): ExtraQuestion[] {
  const out: ExtraQuestion[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const prompt = typeof r.question === 'string' ? r.question.trim() : '';
    if (!prompt) continue;
    const id = followupId(prompt);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      prompt: clip(prompt, 300),
      hint: typeof r.hint === 'string' && r.hint.trim() ? clip(r.hint.trim(), 200) : undefined,
      reason:
        typeof r.reason === 'string' && r.reason.trim() ? clip(r.reason.trim(), 200) : undefined,
    });
    if (out.length >= MAX_FOLLOWUPS) break;
  }
  return out;
}

// ── prompt ───────────────────────────────────────────────────────────────────

function buildMessages(docType: DocumentType, answers: InterviewAnswer[]): ChatMessage[] {
  const template = getTemplateForType(docType);
  const purpose = template?.draftGuidance ?? '명확한 기획 문서를 작성한다.';
  const system =
    `너는 기획 인터뷰 코치다. 곧 이 답변들로 "${docType}" 문서를 쓴다: ${purpose}\n` +
    `답변이 측정 불가하거나(숫자 없는 목표), 비어 있거나("없음" 남발), 서로 모순인 곳만 골라 ` +
    `최대 ${MAX_FOLLOWUPS}개의 짧은 보강 질문을 만들라. 답변이 충분하면 질문을 만들지 마라.\n` +
    `한 질문은 한 가지만 묻는다. 답을 대신 쓰지 말고, 평가하거나 훈계하지 마라.\n` +
    `오직 JSON 배열 하나만 출력(코드펜스·설명 없이): ` +
    `[{"question":"보강 질문(한국어 존댓말, 1~2문장)","hint":"답하는 요령 한 줄","reason":"이 질문을 만든 이유 — 어느 답변이 왜 얕은지"}]\n` +
    `보강할 게 없으면 빈 배열 [] 을 출력하라.`;
  const user =
    `인터뷰 답변:\n\n` +
    answers.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join('\n\n') +
    `\n\n위 기준으로 보강 질문 JSON 배열을 출력하라.`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * 스텁(오프라인) 경로 — 결정적. 가장 짧은 답변 2개를 골라 측정 가능성을 되묻는다.
 * 실제 모델이 하는 일의 축소판이라 UI·테스트가 같은 모양을 본다.
 */
export function stubFollowups(answers: InterviewAnswer[]): ExtraQuestion[] {
  const ranked = [...answers]
    .filter((a) => a.answer.trim())
    .sort(
      (x, y) => x.answer.trim().length - y.answer.trim().length || x.questionId.localeCompare(y.questionId),
    )
    .slice(0, 2);
  return normalizeFollowups(
    ranked.map((a) => ({
      question: `"${clip(a.question.trim(), 40)}" — 이걸 무엇으로 확인할 수 있나요? 숫자나 확인 가능한 조건 하나로 말씀해 주세요.`,
      hint: '되면 "됐다"고 셀 수 있는 기준 하나면 충분합니다.',
      reason: `답변 "${clip(a.answer.trim(), 40)}" 만으로는 무엇이 완료인지 셀 수 없습니다.`,
    })),
  );
}

export class FollowupError extends Error {}

/**
 * 문서의 인터뷰 세션을 읽어 보강 질문을 만들고 세션에 붙인다(기존 목록 교체).
 * 재요청 가능 — 같은 질문은 같은 id 라 이미 쓴 답변이 유지된다.
 */
export async function generateFollowups(documentId: string): Promise<{
  questions: ExtraQuestion[];
  session: import('./types.ts').InterviewSession;
}> {
  const doc = repo.getDocument(documentId);
  if (!doc) throw new FollowupError('document not found');
  const session = repo.getSessionByDocument(documentId);
  if (!session) throw new FollowupError('인터뷰 세션이 없습니다');
  const answered = session.answers.filter((a) => a.answer.trim());
  if (answered.length === 0) {
    throw new FollowupError('답변이 하나도 없습니다 — 먼저 질문에 답해 주세요');
  }

  let questions: ExtraQuestion[];
  if (config.aiStub || config.managedTier) {
    questions = stubFollowups(answered);
  } else {
    const cfg = getModelConfig(doc.type);
    const provider = resolveProvider(cfg.provider);
    let text = '';
    for await (const delta of provider.streamChat({
      model: cfg.model,
      maxTokens: Math.max(cfg.maxTokens, 2000),
      messages: buildMessages(doc.type, answered),
    })) {
      text += delta;
    }
    questions = normalizeFollowups(parseFollowups(text));
  }

  const updated = repo.updateSession(session.id, { extra_questions: questions });
  return { questions, session: updated ?? session };
}

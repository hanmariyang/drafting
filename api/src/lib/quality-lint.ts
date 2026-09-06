// 기획 품질 advisory — 결정적, AI 없음, 순수 함수. 브리프 대조(brief-lint)와
// 같은 계열의 "조언 채널"이다: 게이트·waive 없음, 판단은 사람이 한다.
//
// 구조 정합(lint.ts)이 참조 무결성을 보듯, 여기는 **내용의 검증 가능성**을 본다:
// ① 수용 기준·목표의 측정 불가 표현 ② 숫자 없는 목표 ③ 빈약한 섹션
// ④ PRD 비범위 부재 ⑤ 만성 누락 영역(마이그레이션·권한·빈 상태·동시성·실패 처리)
// 미언급 — 워크스페이스 plan-preflight 의 "만성 누락" 점검을 제품화한 것.

import type { DocumentType } from './types.ts';

export interface QualitySection {
  heading: string;
  body: string;
}

export interface QualityNote {
  code: 'Q-VAGUE' | 'Q-NO-NUMBER' | 'Q-THIN' | 'Q-NO-NONSCOPE' | 'Q-PREFLIGHT';
  message: string;
  /** 해당 섹션 제목 (문서 전체 노트면 없음) */
  section?: string;
}

/** 측정 불가 수식어 — 수용 기준·목표 자리에서만 문제 삼는다(서사 산문은 자유). */
export const VAGUE_WORDS = [
  '빠르게', '빠른', '신속', '쉽게', '쉬운', '간단히', '간단한', '직관적',
  '유연한', '유연하게', '효율적', '최적화', '심리스', '매끄럽', '자연스럽',
  '편리', '원활', '최고의', '최상의', '뛰어난', '훌륭한',
];

/** 측정 가능 신호 — 숫자 또는 단위·비교 연산이 하나라도 있으면 통과. */
const MEASURABLE = /\d|퍼센트|이내|이하|이상|미만|초과/;

/** 수용 기준·목표 성격의 섹션 제목인가. */
function isCriteriaHeading(h: string): boolean {
  return /수용\s*기준|acceptance|성공\s*기준|목표|goal|metric|지표/i.test(h);
}

/** 만성 누락 영역 (plan-preflight 계보) — 문서 어디에도 언급이 없으면 알린다. */
export const PREFLIGHT_TOPICS: Array<{ topic: string; pattern: RegExp; ask: string }> = [
  { topic: '실패·에러 처리', pattern: /실패|에러|오류|장애|error|fail/i, ask: '실패하면 어떻게 되나? 조용히 삼키는 경로는 없나?' },
  { topic: '권한·인증', pattern: /권한|인증|로그인|접근\s*제어|auth/i, ask: '누가 이 기능을 쓸 수 있나? 막아야 할 사람은?' },
  { topic: '빈 상태', pattern: /빈\s*상태|비어|없을\s*때|empty/i, ask: '데이터가 0건일 때 화면·동작은?' },
  { topic: '동시성·다중 탭', pattern: /동시|경합|다중\s*탭|중복\s*(실행|클릭|요청)|race|concurren/i, ask: '두 곳에서 동시에 하면? 두 번 눌리면?' },
  { topic: '기존 데이터·마이그레이션', pattern: /마이그레이션|기존\s*데이터|이관|하위\s*호환|migration/i, ask: '이미 쌓인 데이터는 어떻게 되나?' },
];

const THIN_LIMIT = 40; // 자 — 이보다 짧은 본문은 기획이라기보다 메모다

/**
 * 산문 기획 문서(prd·feature)의 내용 품질을 본다.
 * 제안(proposed)도 포함해 검사한다 — 수락 전에 고치는 게 더 싸다.
 */
export function qualityAdvisory(docType: DocumentType, sections: QualitySection[]): QualityNote[] {
  const notes: QualityNote[] = [];
  if (sections.length === 0) return notes;

  for (const s of sections) {
    const body = s.body.trim();
    if (!body) continue;

    if (isCriteriaHeading(s.heading)) {
      const vague = VAGUE_WORDS.filter((w) => body.includes(w));
      if (vague.length) {
        notes.push({
          code: 'Q-VAGUE',
          section: s.heading,
          message: `측정할 수 없는 표현: ${vague.map((v) => `"${v}"`).join(' · ')} — 숫자나 확인 가능한 조건으로 바꿀 수 있나요?`,
        });
      }
      if (!MEASURABLE.test(body)) {
        notes.push({
          code: 'Q-NO-NUMBER',
          section: s.heading,
          message: '숫자·단위가 하나도 없습니다 — 무엇이 되면 "완료"인지 셀 수 있게 쓸 수 있나요?',
        });
      }
    }

    if (body.length < THIN_LIMIT) {
      notes.push({
        code: 'Q-THIN',
        section: s.heading,
        message: `본문이 ${body.length}자입니다 — 이대로 구현을 맡길 수 있을 만큼 구체적인가요?`,
      });
    }
  }

  if (docType === 'prd') {
    const all = sections.map((s) => `${s.heading}\n${s.body}`).join('\n');
    if (!/비범위|하지\s*않|않는다|non-?goal|범위\s*밖|제외/i.test(all)) {
      notes.push({
        code: 'Q-NO-NONSCOPE',
        message: '"하지 않는 것"이 없습니다 — 비범위가 없는 기획은 구현에서 범위가 불어납니다.',
      });
    }
  }

  // 만성 누락 — 문서 전체에서 한 번도 언급되지 않은 영역만 알린다
  const all = sections.map((s) => s.body).join('\n');
  const missing = PREFLIGHT_TOPICS.filter((t) => !t.pattern.test(all));
  // 전부 빠졌으면 초기 초안일 가능성이 높다 — 상위 3개만 짚어 잔소리를 줄인다
  for (const t of missing.slice(0, 3)) {
    notes.push({ code: 'Q-PREFLIGHT', message: `${t.topic} 언급 없음 — ${t.ask}` });
  }

  return notes;
}

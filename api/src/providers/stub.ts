import type { AIProvider, StreamParams, TestResult } from './types.ts';

/**
 * Deterministic, offline provider. Enabled via AI_STUB=1 or auto-selected when
 * no BYOK key is configured for a provider. Lets the whole pipeline (interview
 * -> streaming draft -> editor -> export) run in tests and demos with no network
 * and no real API key. Output is derived from the prompt so it is reproducible.
 */
export class StubProvider implements AIProvider {
  readonly id = 'stub';

  async *streamChat(params: StreamParams): AsyncIterable<string> {
    const userMsg = [...params.messages].reverse().find((m) => m.role === 'user');
    const heading = extractHeading(userMsg?.content ?? '') ?? '섹션';
    const answers = extractAnswers(userMsg?.content ?? '');

    const lines: string[] = [];
    lines.push(`이 섹션은 "${heading}" 에 대한 초안입니다.`);
    lines.push('');
    if (answers.length) {
      lines.push('인터뷰 답변을 반영한 핵심 항목:');
      for (const a of answers.slice(0, 4)) lines.push(`- ${a}`);
    } else {
      lines.push('- 핵심 가치 제안을 명확히 한다.');
      lines.push('- 대상 사용자와 문제를 정의한다.');
      lines.push('- 성공 기준을 측정 가능하게 둔다.');
    }
    lines.push('');
    lines.push('> (스텁 프로바이더 출력 · 실제 AI 키를 등록하면 대체됩니다.)');

    const text = lines.join('\n');
    // stream word/token-ish chunks so the SSE section boundaries exercise.
    // STUB_STREAM_DELAY_MS(>0) 로 청크 사이 지연 — 데모 녹화에서 스트리밍이 보이게(기본 0).
    const delay = Number(process.env.STUB_STREAM_DELAY_MS) || 0;
    for (const chunk of text.match(/\S+\s*|\n/g) ?? [text]) {
      yield chunk;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    }
  }

  async testConnection(_model: string): Promise<TestResult> {
    return { ok: true, detail: 'stub provider · always ok' };
  }
}

function extractHeading(prompt: string): string | null {
  const m = prompt.match(/섹션 제목[:：]\s*(.+)/) ?? prompt.match(/heading[:：]\s*(.+)/i);
  return m ? m[1].trim() : null;
}

function extractAnswers(prompt: string): string[] {
  // answers are embedded as "- Q: ... / A: ..." style lines in the draft prompt
  const out: string[] = [];
  for (const line of prompt.split('\n')) {
    const m = line.match(/^A[:：]\s*(.+)/);
    if (m && m[1].trim()) out.push(m[1].trim());
  }
  return out;
}

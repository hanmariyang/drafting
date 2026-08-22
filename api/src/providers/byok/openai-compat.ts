import type { AIProvider, StreamParams, TestResult } from '../types.ts';
import { iterateSse } from '../sse.ts';
import { humanizeProviderError } from '../../lib/provider-errors.ts';

/**
 * Shared implementation for OpenAI-compatible chat/completions endpoints.
 * OpenAI and OpenRouter differ only in base URL + optional extra headers.
 */
export class OpenAICompatProvider implements AIProvider {
  readonly id: string;
  private apiKey: string;
  private base: string;
  private extraHeaders: Record<string, string>;
  constructor(
    id: string,
    apiKey: string,
    base: string,
    extraHeaders: Record<string, string> = {},
  ) {
    this.id = id;
    this.apiKey = apiKey;
    this.base = base;
    this.extraHeaders = extraHeaders;
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.apiKey}`,
      'content-type': 'application/json',
      ...this.extraHeaders,
    };
  }

  async *streamChat(params: StreamParams): AsyncIterable<string> {
    const res = await fetch(`${this.base}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      signal: params.signal,
      body: JSON.stringify({
        model: params.model,
        max_tokens: params.maxTokens ?? 4096,
        messages: params.messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
      }),
    });
    if (!res.ok) {
      throw new Error(humanizeProviderError(res.status, await res.text()));
    }
    for await (const data of iterateSse(res)) {
      if (data === '[DONE]') break;
      try {
        const evt = JSON.parse(data);
        const delta = evt.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta.length) yield delta;
      } catch {
        // keep-alive / non-JSON line
      }
    }
  }

  async testConnection(model: string): Promise<TestResult> {
    try {
      const res = await fetch(`${this.base}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        }),
      });
      if (res.ok) return { ok: true };
      return { ok: false, detail: `${res.status}: ${(await res.text()).slice(0, 200)}` };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }
}

export class OpenAIProvider extends OpenAICompatProvider {
  // base 를 넘기면 OpenAI 호환 게이트웨이(LiteLLM·Azure·사내 프록시)를 그대로 사용한다.
  // 게이트웨이가 표준 Bearer 외 다른 헤더를 요구하면 extraHeaders 로 주입한다.
  constructor(apiKey: string, base?: string, extraHeaders: Record<string, string> = {}) {
    super('openai', apiKey, normalizeBase(base) ?? 'https://api.openai.com/v1', extraHeaders);
  }
}

/** 사용자가 붙인 base 를 정규화 — 끝 슬래시 제거. 빈 값이면 null(기본값 사용). */
function normalizeBase(base?: string): string | null {
  const b = (base ?? '').trim().replace(/\/+$/, '');
  return b || null;
}

export class OpenRouterProvider extends OpenAICompatProvider {
  // base 를 넘기면 OpenAI 호환 게이트웨이(LiteLLM 등)로 라우팅. 안 넘기면 openrouter.ai.
  constructor(apiKey: string, base?: string, extraHeaders: Record<string, string> = {}) {
    super('openrouter', apiKey, normalizeBase(base) ?? 'https://openrouter.ai/api/v1', {
      'HTTP-Referer': 'https://github.com/hanmariyang/drafting',
      'X-Title': 'Drafting',
      ...extraHeaders,
    });
  }
}

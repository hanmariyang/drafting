import type { AIProvider, StreamParams, TestResult } from '../types.ts';
import { iterateSse } from '../sse.ts';

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
      throw new Error(`${this.id} ${res.status}: ${await res.text()}`);
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
  constructor(apiKey: string) {
    super('openai', apiKey, 'https://api.openai.com/v1');
  }
}

export class OpenRouterProvider extends OpenAICompatProvider {
  constructor(apiKey: string) {
    super('openrouter', apiKey, 'https://openrouter.ai/api/v1', {
      'HTTP-Referer': 'https://github.com/hanmariyang/drafting',
      'X-Title': 'Drafting',
    });
  }
}

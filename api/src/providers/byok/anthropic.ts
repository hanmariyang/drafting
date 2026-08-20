import type { AIProvider, StreamParams, TestResult } from '../types.ts';
import { iterateSse } from '../sse.ts';

const BASE = 'https://api.anthropic.com/v1';

export class AnthropicProvider implements AIProvider {
  readonly id = 'anthropic';
  private apiKey: string;
  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private headers(): Record<string, string> {
    return {
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    };
  }

  async *streamChat(params: StreamParams): AsyncIterable<string> {
    const system = params.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const messages = params.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));

    const res = await fetch(`${BASE}/messages`, {
      method: 'POST',
      headers: this.headers(),
      signal: params.signal,
      body: JSON.stringify({
        model: params.model,
        max_tokens: params.maxTokens ?? 4096,
        system: system || undefined,
        messages,
        stream: true,
      }),
    });
    if (!res.ok) {
      throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    }
    for await (const data of iterateSse(res)) {
      if (data === '[DONE]') break;
      try {
        const evt = JSON.parse(data);
        if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
          yield evt.delta.text as string;
        } else if (evt.type === 'error') {
          throw new Error(evt.error?.message ?? 'anthropic stream error');
        }
      } catch {
        // non-JSON keep-alive line; ignore
      }
    }
  }

  async testConnection(model: string): Promise<TestResult> {
    try {
      const res = await fetch(`${BASE}/messages`, {
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

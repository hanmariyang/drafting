import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIProvider } from '../src/providers/byok/openai-compat.ts';

test('OpenAIProvider 는 커스텀 base URL(게이트웨이)로 요청한다', async () => {
  const calls: string[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
  try {
    const p = new OpenAIProvider('k', 'https://gw.example.com/v1/');
    await p.testConnection('some-model');
    assert.equal(calls[0], 'https://gw.example.com/v1/chat/completions', '끝 슬래시 정규화 + 게이트웨이 경로');
  } finally {
    globalThis.fetch = orig;
  }
});

test('base 를 안 주면 표준 OpenAI', async () => {
  const calls: string[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
  try {
    await new OpenAIProvider('k').testConnection('m');
    assert.equal(calls[0], 'https://api.openai.com/v1/chat/completions');
  } finally {
    globalThis.fetch = orig;
  }
});

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

import { probeGateway } from '../src/lib/gateway.ts';
import { OpenRouterProvider } from '../src/providers/byok/openai-compat.ts';

function stubFetch(map: Record<string, { status: number; body: unknown }>) {
  const calls: string[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    const hit = map[String(url)];
    if (!hit) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(hit.body), { status: hit.status });
  }) as unknown as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

test('probeGateway 는 /v1 을 자동 감지한다 (호스트만 넣어도)', async () => {
  const s = stubFetch({
    'https://gw.example.com/v1/models': { status: 200, body: { data: [{ id: 'm-a' }, { id: 'm-b' }] } },
  });
  try {
    const r = await probeGateway('https://ai-gateway.example.com'.replace('ai-gateway.example.com', 'gw.example.com'), 'k');
    assert.equal(r?.chatBase, 'https://gw.example.com/v1');
    assert.deepEqual(r?.models, ['m-a', 'm-b']);
  } finally {
    s.restore();
  }
});

test('probeGateway 는 /v1 이 없으면 루트로 폴백', async () => {
  const s = stubFetch({
    'https://gw2.example.com/models': { status: 200, body: { data: [{ id: 'x' }] } },
  });
  try {
    const r = await probeGateway('https://gw2.example.com/', 'k');
    assert.equal(r?.chatBase, 'https://gw2.example.com');
    assert.deepEqual(r?.models, ['x']);
  } finally {
    s.restore();
  }
});

test('OpenRouterProvider 도 base 를 주면 게이트웨이로 라우팅', async () => {
  const s = stubFetch({
    'https://gw3.example.com/v1/chat/completions': { status: 200, body: {} },
  });
  try {
    await new OpenRouterProvider('k', 'https://gw3.example.com/v1').testConnection('m');
    assert.ok(s.calls.includes('https://gw3.example.com/v1/chat/completions'));
  } finally {
    s.restore();
  }
});

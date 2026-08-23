import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  deltaFromLine,
  textFromAssistantLine,
  errorFromResultLine,
  nodeManagerBins,
  cliSpawnEnv,
} from '../src/providers/cli.ts';

test('stream_event text_delta 를 델타로 뽑는다', () => {
  const line = JSON.stringify({
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '안녕' } },
  });
  assert.equal(deltaFromLine(line), '안녕');
});

test('비텍스트 이벤트는 null', () => {
  assert.equal(deltaFromLine(JSON.stringify({ type: 'system', subtype: 'init' })), null);
  assert.equal(deltaFromLine('not-json'), null);
});

test('assistant 메시지에서 폴백 텍스트를 뽑는다', () => {
  const line = JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'text', text: '## 개요\n한 문장.' }] },
  });
  assert.equal(textFromAssistantLine(line), '## 개요\n한 문장.');
});

test('result is_error 를 오류로 뽑는다', () => {
  assert.equal(
    errorFromResultLine(JSON.stringify({ type: 'result', is_error: true, result: 'boom' })),
    'boom',
  );
  assert.equal(errorFromResultLine(JSON.stringify({ type: 'result', is_error: false })), null);
});

test('actionableCliError 는 조직 차단 메시지에 복구 안내를 덧붙인다', async () => {
  const { actionableCliError } = await import('../src/providers/cli.ts');
  const org = 'Your organization has disabled Claude subscription access for Claude Code';
  const out = actionableCliError(org);
  assert.ok(out.startsWith(org), '원문 보존');
  assert.match(out, /API 키|BYOK|로그인/, '복구 경로 안내 포함');
  // 일반 메시지는 그대로
  assert.equal(actionableCliError('some unrelated failure'), 'some unrelated failure');
});

test('nodeManagerBins 는 nvm 여러 버전 중 최신을 앞에 둔다', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'drafting-nvm-'));
  try {
    for (const v of ['v18.20.0', 'v22.14.0', 'v20.11.0']) {
      const bin = path.join(home, '.nvm', 'versions', 'node', v, 'bin');
      fs.mkdirSync(bin, { recursive: true });
      fs.writeFileSync(path.join(bin, 'claude'), '#!/usr/bin/env node\n');
    }
    const found = nodeManagerBins(home);
    assert.equal(found.length, 3, '세 버전 모두 발견');
    assert.match(found[0], /v22\.14\.0/, '최신 버전이 우선');
    assert.match(found[found.length - 1], /v18\.20\.0/, '가장 낮은 버전이 마지막');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('nodeManagerBins 는 설치가 없으면 빈 배열', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'drafting-empty-'));
  try {
    assert.deepEqual(nodeManagerBins(home), []);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('cliSpawnEnv 는 바이너리 dir 을 PATH 맨 앞에 얹는다(node 래퍼 셔뱅 해결)', () => {
  const bin = '/Users/x/.nvm/versions/node/v22.14.0/bin/claude';
  const env = cliSpawnEnv(bin, { PATH: '/usr/bin:/bin' });
  const parts = (env.PATH ?? '').split(path.delimiter);
  assert.equal(parts[0], '/Users/x/.nvm/versions/node/v22.14.0/bin', '바이너리 dir 이 최우선');
  assert.ok(parts.includes('/usr/bin'), '기존 PATH 보존');
  // 중복 없음
  assert.equal(new Set(parts).size, parts.length, 'PATH 중복 제거');
});

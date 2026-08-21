import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deltaFromLine, textFromAssistantLine, errorFromResultLine } from '../src/providers/cli.ts';

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

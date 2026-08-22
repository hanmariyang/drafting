import { test } from 'node:test';
import assert from 'node:assert/strict';
import { humanizeProviderError } from '../src/lib/provider-errors.ts';

test('401 은 게이트웨이 키 안내를 준다', () => {
  const m = humanizeProviderError(401, '{"error":{"message":"Missing Authentication header"}}');
  assert.match(m, /인증 실패\(401\)/);
  assert.match(m, /게이트웨이/);
  assert.match(m, /Missing Authentication header/); // 원문 보존
});

test('모델 접근 불가는 모델 변경을 안내', () => {
  const m = humanizeProviderError(401, 'key not allowed to access model. models=[...]');
  assert.match(m, /접근할 수 없는 모델|모델 칸/);
});

test('403 연령/게이트는 다른 모델 안내', () => {
  const m = humanizeProviderError(403, 'This model requires you to complete 18+ age confirmation');
  assert.match(m, /추가 확인|다른 모델/);
});

test('429·5xx 는 재시도 안내', () => {
  assert.match(humanizeProviderError(429, 'rate limit'), /429|다시 시도/);
  assert.match(humanizeProviderError(503, 'upstream'), /서버 오류|다시 시도/);
});

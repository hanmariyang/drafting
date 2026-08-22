import './setup.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restoreFromBytes } from '../src/db/index.ts';

test('restore 는 유효하지 않은 파일을 거부한다 (원본 보존)', () => {
  assert.throws(
    () => restoreFromBytes(Buffer.from('this is not a sqlite database')),
    /유효한 Drafting 백업이 아닙니다/,
  );
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractHtml, isCompleteHtml } from '../src/lib/mockup-gen.ts';

test('extractHtml 은 코드펜스·잡텍스트를 걷어내고 html 만 남긴다', () => {
  const raw = '설명입니다\n```html\n<!doctype html><html><body>hi</body></html>\n```\n끝';
  assert.equal(extractHtml(raw), '<!doctype html><html><body>hi</body></html>');
});

test('extractHtml 은 <html> 시작도 인식', () => {
  const raw = 'preface <html lang="ko"><body>x</body></html> trailing';
  assert.equal(extractHtml(raw), '<html lang="ko"><body>x</body></html>');
});

test('isCompleteHtml — 닫는 </html> + 최소 길이', () => {
  const full = '<!doctype html><html><head></head><body>' + 'x'.repeat(500) + '</body></html>';
  assert.equal(isCompleteHtml(full), true);
  // 잘린 것(닫는 태그 없음) → 미완성
  assert.equal(isCompleteHtml('<!doctype html><html><body>' + 'x'.repeat(500)), false);
  // 너무 짧음 → 미완성
  assert.equal(isCompleteHtml('<html></html>'), false);
});

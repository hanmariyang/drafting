import './setup.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractIdentifiers, briefAdvisory } from '../src/lib/brief-lint.ts';

test('brief-lint · 식별자 추출: 코드스팬·CamelCase·snake·kebab·경로·파일명', () => {
  const ids = extractIdentifiers(
    '공유는 `ShareLink` 모델이 담당하고 make_token() 이 `auth-guard` 를 거쳐 src/lib/share.ts 에 저장한다. render.py 도 참조.',
  );
  assert.ok(ids.has('sharelink'));
  assert.ok(ids.has('make_token'));
  assert.ok(ids.has('auth-guard'));
  assert.ok(ids.has('src/lib/share.ts'));
  assert.ok(ids.has('render.py'));
});

test('brief-lint · 한국어 산문·범용어·코드블록은 잡지 않는다', () => {
  const ids = extractIdentifiers(
    '사용자가 문서를 수락하면 공유 링크가 만들어진다. API 와 Docker, GitHub 는 범용어다.\n```\nSecretInsideBlock foo_bar\n```',
  );
  assert.equal(ids.has('api'), false);
  assert.equal(ids.has('docker'), false);
  assert.equal(ids.has('github'), false);
  assert.equal(ids.has('secretinsideblock'), false); // 코드 블록 통짜 제외
  assert.equal([...ids].some((t) => /[가-힣]/.test(t)), false);
});

test('brief-lint · 브리프에 있는 이름은 통과, 없는 이름만 노트', () => {
  const brief = [
    { heading: '스택', body: 'Fastify + `node:sqlite`, 프론트 Vite.' },
    { heading: '기존 기능 목록', body: '`ShareLink` 공유, `render.ts` 내보내기.' },
  ];
  const feature = [
    { heading: '변경 내용', body: '`ShareLink` 에 만료 알림을 더한다. 새 워커 `expiry_notifier` 를 둔다.' },
    { heading: '영향 범위', body: 'render.ts 와 `NotifyPanel` 화면.' },
  ];
  const r = briefAdvisory(feature, brief);
  assert.equal(r.briefEmpty, false);
  const names = r.notes.map((n) => n.name);
  assert.ok(names.includes('expiry_notifier'));
  assert.ok(names.includes('notifypanel'));
  assert.equal(names.includes('sharelink'), false);
  assert.equal(names.includes('render.ts'), false);
  const worker = r.notes.find((n) => n.name === 'expiry_notifier')!;
  assert.deepEqual(worker.sections, ['변경 내용']);
});

test('brief-lint · 브리프 수락 섹션 0 이면 briefEmpty 만 알리고 노트 없음', () => {
  const r = briefAdvisory([{ heading: '영향 범위', body: '`Anything` 가능' }], []);
  assert.equal(r.briefEmpty, true);
  assert.equal(r.notes.length, 0);
});

// ── 엔드포인트: GET /api/documents/:id/brief-check ───────────────────────────

import { freshDb } from './setup.ts';
import { buildServer } from '../src/index.ts';
import * as repo from '../src/db/repos.ts';

test('brief-check · feature 아님/브리프 부모 없음 → enabled:false, 정상 케이스 → 노트', async () => {
  freshDb();
  const app = await buildServer();
  const project = repo.createProject('P');
  const brief = repo.createDocument({ projectId: project.id, type: 'brief', title: '브리프', parentDocumentId: null });
  const feature = repo.createDocument({ projectId: project.id, type: 'feature', title: '기능', parentDocumentId: brief.id });
  const orphan = repo.createDocument({ projectId: project.id, type: 'feature', title: '단독', parentDocumentId: null });

  // 브리프 문서 자체에 호출 → feature 아님
  const notFeature = await app.inject({ url: `/api/documents/${brief.id}/brief-check` });
  assert.equal(notFeature.json().enabled, false);

  // 브리프 부모 없는 feature → 꺼짐 (§7 "브리프 없이 쓰면 lint 는 꺼진다")
  const noBrief = await app.inject({ url: `/api/documents/${orphan.id}/brief-check` });
  assert.equal(noBrief.json().enabled, false);

  // 브리프 수락 섹션 0 → briefEmpty
  const empty = await app.inject({ url: `/api/documents/${feature.id}/brief-check` });
  assert.equal(empty.json().enabled, true);
  assert.equal(empty.json().briefEmpty, true);

  // 브리프 수락 + feature 본문에 없는 이름 → 노트, 있는 이름 → 통과
  repo.createSection(brief.id, '기존 기능 목록', '`ShareLink` 공유와 `render.ts` 내보내기.');
  repo.createSection(feature.id, '영향 범위', '`ShareLink` 유지, 새로 `ExpiryWorker` 도입, render.ts 수정.');
  const r = await app.inject({ url: `/api/documents/${feature.id}/brief-check` });
  const body = r.json();
  assert.equal(body.enabled, true);
  assert.equal(body.briefEmpty, false);
  const names = body.notes.map((n: { name: string }) => n.name);
  assert.deepEqual(names, ['expiryworker']);
});

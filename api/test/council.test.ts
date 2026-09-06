import './setup.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './setup.ts';
import { buildServer } from '../src/index.ts';
import * as repo from '../src/db/repos.ts';
import { resolveCritiques } from '../src/lib/council.ts';

const LONG = '이 섹션은 비평 대상이 될 만큼 충분한 본문을 담고 있다. 상세한 설명이 이어진다.';

function seed(type: 'prd' | 'brief' = 'prd') {
  freshDb();
  repo.setSetting('council_enabled', true);
  const project = repo.createProject('P');
  const doc = repo.createDocument({
    projectId: project.id,
    type,
    title: '문서',
    parentDocumentId: null,
  });
  return doc;
}

test('council · 3관점 비평이 해당 섹션의 제안으로 적재된다', async () => {
  const doc = seed();
  const overview = repo.createSection(doc.id, '개요', LONG);
  const scope = repo.createSection(doc.id, '범위', LONG);

  const app = await buildServer();
  const res = await app.inject({ method: 'POST', url: `/api/documents/${doc.id}/council` });
  assert.equal(res.statusCode, 200);
  assert.ok(res.json().created >= 3);

  const open = repo.listSuggestions(doc.id, 'open');
  assert.equal(open.length, res.json().created);
  // 전부 question 카드이고, 실제 섹션에 붙어 있다
  const sectionIds = new Set([overview.id, scope.id]);
  for (const s of open) {
    assert.equal(s.kind, 'question');
    assert.ok(s.section_id && sectionIds.has(s.section_id));
  }
  // 근거 라벨 = "카운슬 · <페르소나>"
  const sources = new Set(open.map((s) => s.source));
  assert.ok(sources.has('카운슬 · 엔지니어'));
  assert.ok(sources.has('카운슬 · 디자이너'));
  assert.ok(sources.has('카운슬 · 회의론자'));
});

test('council · 비평 수락은 섹션을 문서로 확정시키지 않는다', async () => {
  const doc = seed();
  const sec = repo.createSection(doc.id, '개요', LONG);
  repo.setSectionStatus(sec.id, 'proposed');

  const app = await buildServer();
  await app.inject({ method: 'POST', url: `/api/documents/${doc.id}/council` });
  const card = repo.listSuggestions(doc.id, 'open')[0];
  const done = await app.inject({ method: 'POST', url: `/api/suggestions/${card.id}/accept` });
  assert.equal(done.statusCode, 200);
  // '답하기'는 물음을 처리한 것일 뿐 — 섹션은 여전히 제안 상태다
  assert.equal(repo.getSection(sec.id)!.status, 'proposed');
});

test('council · 꺼져 있으면 409, prd·feature 가 아니면 400', async () => {
  const doc = seed();
  repo.createSection(doc.id, '개요', LONG);
  repo.setSetting('council_enabled', false);

  const app = await buildServer();
  const off = await app.inject({ method: 'POST', url: `/api/documents/${doc.id}/council` });
  assert.equal(off.statusCode, 409);
  assert.match(off.json().error, /꺼져 있습니다/);
  assert.equal((await app.inject({ url: '/api/meta' })).json().councilEnabled, false);

  const brief = seed('brief');
  repo.createSection(brief.id, '개요', LONG);
  const app2 = await buildServer();
  const bad = await app2.inject({ method: 'POST', url: `/api/documents/${brief.id}/council` });
  assert.equal(bad.statusCode, 400);
});

test('council · 실제 섹션과 맞지 않는 sectionHeading 은 버린다(첫 섹션 폴백 없음)', () => {
  const sections = [
    { id: 's1', heading: '개요' },
    { id: 's2', heading: '수용 기준' },
  ];
  const { kept, dropped } = resolveCritiques(sections, [
    { persona: '엔지니어', sectionHeading: '수용기준', critique: '숫자가 없습니다' }, // 공백차이 = 같은 섹션
    { persona: '디자이너', sectionHeading: '## 개요', critique: '빈 상태가 없습니다' }, // 마커 무시
    { persona: '회의론자', sectionHeading: '리스크', critique: '없는 섹션' }, // 버림
    { persona: '엔지니어', sectionHeading: '개요', critique: '   ' }, // 빈 비평 — 버림
    { persona: '점술가', sectionHeading: '개요', critique: '모르는 페르소나' }, // 버림
  ]);
  assert.equal(kept.length, 2);
  assert.equal(dropped, 3);
  assert.deepEqual(
    kept.map((k) => k.sectionId),
    ['s2', 's1'],
  );
});

// ── dedupe: 재실행 = 갱신 (중첩·부활 금지) ────────────────────────────────────

test('council · 재실행해도 같은 비평은 중첩되지 않는다 (created 0 · unchanged)', async () => {
  const doc = seed();
  repo.createSection(doc.id, '개요', LONG);
  repo.createSection(doc.id, '범위', LONG);
  const app = await buildServer();

  const r1 = await app.inject({ method: 'POST', url: `/api/documents/${doc.id}/council` });
  const first = r1.json().created;
  assert.ok(first >= 3);

  const r2 = await app.inject({ method: 'POST', url: `/api/documents/${doc.id}/council` });
  assert.equal(r2.json().created, 0); // 스텁은 결정적 — 전부 동일 비평
  assert.equal(r2.json().unchanged, first);
  assert.equal(repo.listSuggestions(doc.id, 'open').length, first); // 중첩 없음
});

test('council · 처리한 비평은 재실행 시 부활하지 않는다', async () => {
  const doc = seed();
  repo.createSection(doc.id, '개요', LONG);
  repo.createSection(doc.id, '범위', LONG);
  const app = await buildServer();
  await app.inject({ method: 'POST', url: `/api/documents/${doc.id}/council` });

  const one = repo.listSuggestions(doc.id, 'open').find((s) => (s.source ?? '').startsWith('카운슬'))!;
  repo.resolveSuggestion(one.id, 'rejected'); // 사람이 거절함

  const r = await app.inject({ method: 'POST', url: `/api/documents/${doc.id}/council` });
  assert.equal(r.json().created, 0);
  const open = repo.listSuggestions(doc.id, 'open');
  assert.equal(open.some((s) => s.body === one.body && s.section_id === one.section_id), false);
});

test('council · 이전 판(중첩 시대)의 낡은 열린 카드는 정리된다', async () => {
  const doc = seed();
  repo.createSection(doc.id, '개요', LONG);
  repo.createSection(doc.id, '범위', LONG);
  // 새 실행 결과에 없는 낡은 카운슬 카드 (과거 중첩 잔재 시뮬레이션)
  const sec = repo.listSections(doc.id)[0];
  const stale = repo.createSuggestion({
    documentId: doc.id,
    sectionId: sec.id,
    kind: 'question',
    title: '"개요" 비평',
    body: '지금 실행 결과에는 없는 옛 비평입니다.',
    source: '카운슬 · 엔지니어',
  });
  const app = await buildServer();
  const r = await app.inject({ method: 'POST', url: `/api/documents/${doc.id}/council` });
  assert.ok(r.json().replaced >= 1);
  assert.equal(repo.listSuggestions(doc.id).find((s) => s.id === stale.id)!.status, 'dismissed');
});

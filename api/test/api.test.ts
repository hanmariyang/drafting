import './setup.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './setup.ts';
import { buildServer } from '../src/index.ts';
import * as repo from '../src/db/repos.ts';
import { getDb, nowIso } from '../src/db/index.ts';

async function makeApp() {
  freshDb();
  return buildServer();
}

test('project + document lifecycle', async () => {
  const app = await makeApp();
  const created = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { name: 'AI 기획', description: 'test' },
  });
  assert.equal(created.statusCode, 200);
  const project = created.json();
  assert.ok(project.id);

  const doc = await app.inject({
    method: 'POST',
    url: `/api/projects/${project.id}/documents`,
    payload: { type: 'prd', title: 'PRD 초안' },
  });
  assert.equal(doc.statusCode, 200);
  const document = doc.json();
  assert.equal(document.type, 'prd');

  const list = await app.inject({ url: '/api/projects' });
  assert.equal(list.json()[0].documentCount, 1);
  await app.close();
});

test('interview answers autosave and resume (SPEC-03)', async () => {
  const app = await makeApp();
  const project = repo.createProject('P');
  const document = repo.createDocument({ projectId: project.id, type: 'prd', title: 'PRD' });

  const start = await app.inject({ method: 'POST', url: `/api/documents/${document.id}/interview` });
  const { session } = start.json();
  assert.ok(session.id);

  await app.inject({
    method: 'POST',
    url: `/api/interview/${session.id}/answer`,
    payload: { questionId: 'problem', question: '문제?', answer: '백지 시작', currentIndex: 1 },
  });

  // "reopen" — fetch session again, answer must persist
  const resumed = await app.inject({ url: `/api/documents/${document.id}/interview` });
  const s = resumed.json().session;
  assert.equal(s.current_index, 1);
  assert.equal(s.answers.length, 1);
  assert.equal(s.answers[0].answer, '백지 시작');

  // re-answering same question updates, not duplicates
  await app.inject({
    method: 'POST',
    url: `/api/interview/${session.id}/answer`,
    payload: { questionId: 'problem', question: '문제?', answer: '수정된 답변' },
  });
  const again = await app.inject({ url: `/api/documents/${document.id}/interview` });
  assert.equal(again.json().session.answers.length, 1);
  assert.equal(again.json().session.answers[0].answer, '수정된 답변');
  await app.close();
});

test('BYOK keys endpoint returns masked info only (G-01)', async () => {
  const app = await makeApp();
  const put = await app.inject({
    method: 'PUT',
    url: '/api/keys/openrouter',
    payload: { key: 'sk-or-verysecret-1234', label: 'main' },
  });
  assert.equal(put.statusCode, 200);

  const list = await app.inject({ url: '/api/keys' });
  const body = list.body;
  assert.ok(!body.includes('verysecret'), 'plaintext key must not appear');
  const or = list.json().find((k: { provider: string }) => k.provider === 'openrouter');
  assert.equal(or.configured, true);
  assert.equal(or.last4, '1234');

  // stub test-connection succeeds
  const test = await app.inject({ method: 'POST', url: '/api/keys/openrouter/test', payload: {} });
  assert.equal(test.json().ok, true);
  await app.close();
});

test('markdown export mirrors section structure (SPEC-13)', async () => {
  const app = await makeApp();
  const project = repo.createProject('P');
  const document = repo.createDocument({ projectId: project.id, type: 'prd', title: '내보내기 문서' });
  repo.replaceSections(document.id, [
    { heading: '개요', body: '개요 본문' },
    { heading: '목표', body: '- 지표1\n- 지표2' },
  ]);

  const md = await app.inject({ url: `/api/documents/${document.id}/export.md` });
  assert.equal(md.statusCode, 200);
  assert.match(md.headers['content-type'] as string, /text\/markdown/);
  const text = md.body;
  assert.match(text, /^# 내보내기 문서/);
  assert.match(text, /## 개요/);
  assert.match(text, /## 목표/);
  assert.ok(text.indexOf('## 개요') < text.indexOf('## 목표'), 'order preserved');
  await app.close();
});

test('share link is public and honors expiry (SPEC-14)', async () => {
  const app = await makeApp();
  const project = repo.createProject('P');
  const document = repo.createDocument({ projectId: project.id, type: 'prd', title: '공유 문서' });
  repo.replaceSections(document.id, [{ heading: '개요', body: '본문' }]);

  const share = await app.inject({
    method: 'POST',
    url: `/api/documents/${document.id}/shares`,
    payload: {},
  });
  const link = share.json();
  assert.ok(link.token);

  // public read-only access, no auth
  const view = await app.inject({ url: `/s/${link.token}` });
  assert.equal(view.statusCode, 200);
  assert.match(view.body, /공유 문서/);
  assert.match(view.body, /읽기 전용/);

  // force expiry -> 410
  getDb()
    .prepare('UPDATE share_links SET expires_at = ? WHERE token = ?')
    .run(new Date(Date.now() - 1000).toISOString(), link.token);
  const expired = await app.inject({ url: `/s/${link.token}` });
  assert.equal(expired.statusCode, 410);
  assert.match(expired.body, /만료/);
  await app.close();
});

test('meta reflects onboarding + configured keys (SPEC-21/22)', async () => {
  const app = await makeApp();
  let meta = await app.inject({ url: '/api/meta' });
  assert.equal(meta.json().onboardingComplete, false);

  repo.upsertApiKey('anthropic', 'sk-ant-xxxx1111', '');
  await app.inject({ method: 'POST', url: '/api/settings/onboarding/complete' });

  meta = await app.inject({ url: '/api/meta' });
  const body = meta.json();
  assert.equal(body.onboardingComplete, true);
  assert.ok(body.keysConfigured.includes('anthropic'));
  assert.ok(body.version);
  assert.ok(body.latestVersion);
  void nowIso;
  await app.close();
});

test('템플릿 라이브러리: 커스텀 저장이 파일 템플릿을 override 하고 삭제로 복귀', async () => {
  const app = await makeApp();
  const before = await app.inject({ url: '/api/templates' });
  const prd = (before.json() as Array<{ id: string; source: string; name: string }>).find((t) => t.id === 'prd');
  assert.ok(prd, 'file prd 템플릿 존재');
  assert.equal(prd.source, 'file');

  // override prd
  const full = (await app.inject({ url: '/api/templates/prd' })).json() as Record<string, unknown>;
  const put = await app.inject({
    method: 'PUT',
    url: '/api/templates/prd',
    payload: { ...full, name: '커스텀 PRD' },
  });
  assert.equal(put.statusCode, 200);
  assert.equal(put.json().source, 'override');
  assert.equal(put.json().name, '커스텀 PRD');

  // revert
  const del = await app.inject({ method: 'DELETE', url: '/api/templates/prd' });
  assert.equal(del.statusCode, 200);
  assert.equal(del.json().reverted.source, 'file');
  assert.equal(del.json().reverted.name, prd.name);
  await app.close();
});

test('undo 는 마지막 변경을 되돌린다', async () => {
  const app = await makeApp();
  const project = repo.createProject('P');
  const doc = repo.createDocument({ projectId: project.id, type: 'prd', title: 'PRD' });
  const s = repo.createSection(doc.id, '개요', '원본', undefined, 'accepted');
  repo.snapshotDocument(doc.id, 'save', { reason: 'v1' }); // 원본 스냅샷
  // 편집 + 스냅샷
  repo.updateSection(s.id, { body: '수정됨' });
  repo.snapshotDocument(doc.id, 'save', { reason: 'edit' });
  assert.equal(repo.getSection(s.id)!.body, '수정됨');

  const res = await app.inject({ method: 'POST', url: `/api/documents/${doc.id}/undo` });
  assert.equal(res.statusCode, 200);
  const sec = repo.listSections(doc.id).find((x) => x.heading === '개요')!;
  assert.equal(sec.body, '원본', '직전 상태로 복원');

  // 되돌릴 게 없는 새 문서는 400
  const empty = repo.createDocument({ projectId: project.id, type: 'prd', title: 'E' });
  const r2 = await app.inject({ method: 'POST', url: `/api/documents/${empty.id}/undo` });
  assert.equal(r2.statusCode, 400);
  await app.close();
});

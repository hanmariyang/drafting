import './setup.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshDb } from './setup.ts';
import { buildServer } from '../src/index.ts';
import * as repo from '../src/db/repos.ts';
import { buildSectionMessages } from '../src/lib/ai.ts';

async function makeApp() {
  freshDb();
  return buildServer();
}

function fixtureRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drafting-fixture-'));
  fs.writeFileSync(path.join(root, 'README.md'), '# 픽스처 레포\n예약 관리 도구.');
  fs.writeFileSync(path.join(root, 'package.json'), '{ "name": "fixture", "type": "module" }');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/index.ts'), 'export const boot = () => 1;');
  return root;
}

// ── 체인 독립: feature·brief 는 부모 없이 만들 수 있다 ───────────────────────────

test('feature·brief 문서는 부모 없이 생성된다 (체인 독립)', async () => {
  const app = await makeApp();
  const project = repo.createProject('P');

  for (const type of ['feature', 'brief'] as const) {
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/documents`,
      payload: { type, title: type },
    });
    assert.equal(res.statusCode, 200, `${type} 은 parentDocumentId 없이 생성된다`);
    assert.equal(res.json().type, type);
    assert.equal(res.json().parent_document_id, null);
  }
  await app.close();
});

test('feature·brief 는 인터뷰 템플릿을 가진다 (feature 7문 · brief 1문)', async () => {
  const app = await makeApp();
  const project = repo.createProject('P');

  const feature = repo.createDocument({ projectId: project.id, type: 'feature', title: 'F' });
  const fv = await app.inject({ method: 'POST', url: `/api/documents/${feature.id}/interview` });
  assert.equal(fv.statusCode, 200);
  const ft = fv.json().template;
  assert.equal(ft.docType, 'feature');
  assert.deepEqual(
    ft.questions.map((q: { id: string }) => q.id),
    ['background', 'as_is', 'story', 'rules', 'acceptance', 'scope', 'edge'],
  );
  assert.deepEqual(ft.sections, ['배경', '현재 동작', '변경 내용', '동작 규칙', '수용 기준', '영향 범위']);

  const brief = repo.createDocument({ projectId: project.id, type: 'brief', title: 'B' });
  const bv = await app.inject({ method: 'POST', url: `/api/documents/${brief.id}/interview` });
  const bt = bv.json().template;
  assert.equal(bt.docType, 'brief');
  assert.ok(bt.questions.length >= 1);
  assert.deepEqual(bt.sections, ['스택', '아키텍처', '네이밍 컨벤션', '기존 기능 목록', '핵심 용어', '제약']);
  await app.close();
});

// ── 컨텍스트 상속: feature 가 brief 를 부모로 가지면 브리프 내용이 프롬프트에 흐른다 ──

test('feature 는 brief 를 부모로 가질 수 있고, 브리프 내용이 생성 프롬프트로 상속된다', async () => {
  freshDb();
  const project = repo.createProject('P');
  const brief = repo.createDocument({ projectId: project.id, type: 'brief', title: '브리프' });
  repo.replaceSections(brief.id, [
    { heading: '스택', body: 'Fastify · node:sqlite · Vite/React' },
    { heading: '네이밍 컨벤션', body: '라우트 파일은 routes/<도메인>.ts' },
  ]);

  const feature = repo.createDocument({
    projectId: project.id,
    type: 'feature',
    title: '공유 링크 열람 기록',
    parentDocumentId: brief.id,
  });

  const ctx = repo.getParentContext(feature.id);
  assert.ok(ctx, '브리프가 부모 컨텍스트로 잡힌다');
  assert.equal(ctx!.parentType, 'brief');

  const messages = buildSectionMessages({
    documentId: feature.id,
    docType: 'feature',
    heading: '영향 범위',
    answers: [{ questionId: 'scope', question: '어디를?', answer: 'share 엔드포인트' }],
    guidance: 'g',
  });
  const user = messages.find((m) => m.role === 'user')!.content;
  assert.match(user, /node:sqlite/, '브리프 스택이 프롬프트에 흐른다');
  assert.match(user, /routes\/<도메인>\.ts/, '브리프 컨벤션이 프롬프트에 흐른다');

  // 부모(브리프)가 바뀌면 기능 문서가 stale 로 표시된다 — 기존 체인 기계 그대로
  repo.snapshotDocument(brief.id, 'save', { reason: 'edit' });
  assert.equal(repo.getDocument(feature.id)!.context_stale, 1);
});

test('extraContext 는 인터뷰 답변과 별개로 프롬프트에 실린다', () => {
  freshDb();
  const project = repo.createProject('P');
  const doc = repo.createDocument({ projectId: project.id, type: 'brief', title: 'B' });
  const messages = buildSectionMessages({
    documentId: doc.id,
    docType: 'brief',
    heading: '스택',
    answers: [],
    guidance: 'g',
    extraContext: 'REPO_DIGEST_MARKER',
  });
  const user = messages.find((m) => m.role === 'user')!.content;
  assert.match(user, /REPO_DIGEST_MARKER/);
});

// ── 추출 엔드포인트 ────────────────────────────────────────────────────────────

test('brief 추출: brief 아닌 문서는 400', async () => {
  const app = await makeApp();
  const project = repo.createProject('P');
  const prd = repo.createDocument({ projectId: project.id, type: 'prd', title: 'PRD' });
  const res = await app.inject({
    method: 'POST',
    url: `/api/documents/${prd.id}/brief/extract`,
    payload: { path: fixtureRepo() },
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error ?? res.body, /brief/);
  await app.close();
});

test('brief 추출: 없는 경로·파일 경로는 400', async () => {
  const app = await makeApp();
  const project = repo.createProject('P');
  const doc = repo.createDocument({ projectId: project.id, type: 'brief', title: 'B' });

  const missing = await app.inject({
    method: 'POST',
    url: `/api/documents/${doc.id}/brief/extract`,
    payload: { path: path.join(os.tmpdir(), 'drafting-does-not-exist-xyz') },
  });
  assert.equal(missing.statusCode, 400);

  const notDir = await app.inject({
    method: 'POST',
    url: `/api/documents/${doc.id}/brief/extract`,
    payload: { path: path.join(fixtureRepo(), 'README.md') },
  });
  assert.equal(notDir.statusCode, 400);

  // 추출이 실패했으면 문서에 아무 섹션도 생기지 않는다
  assert.equal(repo.listSections(doc.id).length, 0);
  await app.close();
});

test('brief 추출: 정상 경로면 6개 섹션이 제안(proposed)으로 생긴다', async () => {
  const app = await makeApp();
  const project = repo.createProject('P');
  const doc = repo.createDocument({ projectId: project.id, type: 'brief', title: '브리프' });

  const res = await app.inject({
    method: 'POST',
    url: `/api/documents/${doc.id}/brief/extract`,
    payload: { path: fixtureRepo() },
  });
  assert.equal(res.statusCode, 200);
  const out = res.json();
  assert.match(out.read, /README\.md/);
  assert.match(out.read, /package\.json/);

  const sections = repo.listSections(doc.id);
  assert.deepEqual(
    sections.map((s) => s.heading),
    ['스택', '아키텍처', '네이밍 컨벤션', '기존 기능 목록', '핵심 용어', '제약'],
  );
  for (const s of sections) {
    assert.equal(s.status, 'proposed', 'AI 출력은 항상 제안이다 (SYSTEM.md §0.1)');
    assert.ok(s.body.length > 0);
  }

  // 섹션마다 근거가 "레포 폴더 추출" 인 제안 카드가 열려 있다
  const open = repo.listSuggestions(doc.id).filter((s) => s.status === 'open');
  assert.equal(open.length, sections.length);
  for (const sug of open) assert.match(sug.source, /레포 폴더 추출/);
  await app.close();
});

import './setup.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './setup.ts';
import { buildServer } from '../src/index.ts';
import * as repo from '../src/db/repos.ts';
import { streamDocumentDraft } from '../src/lib/ai.ts';
import type { DraftEvent } from '../src/lib/ai.ts';

async function makeApp() {
  freshDb();
  return buildServer();
}

async function drain(gen: AsyncGenerator<DraftEvent>): Promise<void> {
  for await (const _ of gen) void _;
}

function seedProject() {
  const project = repo.createProject('P');
  const doc = repo.createDocument({ projectId: project.id, type: 'prd', title: 'PRD' });
  const session = repo.createSession(doc.id, 'prd');
  repo.updateSession(session.id, {
    answers: [{ questionId: 'problem', question: '문제?', answer: '백지 시작' }],
  });
  return { project, doc };
}

test('AI draft creates proposed sections + one open suggestion each', async () => {
  const app = await makeApp();
  const { doc } = seedProject();
  await drain(streamDocumentDraft(doc.id));

  const sections = repo.listSections(doc.id);
  assert.ok(sections.length >= 5);
  for (const s of sections) assert.equal(s.status, 'proposed', `${s.heading} is proposed`);

  const open = repo.listSuggestions(doc.id, 'open');
  assert.equal(open.length, sections.length, 'one open suggestion per section');
  for (const sug of open) {
    assert.equal(sug.kind, 'add');
    assert.ok(sug.source.length > 0, 'suggestion carries a source (SYSTEM.md §0.3)');
    assert.ok(sug.section_id);
  }
  await app.close();
});

test('accept sets section accepted + resolves suggestion', async () => {
  const app = await makeApp();
  const { doc } = seedProject();
  await drain(streamDocumentDraft(doc.id));
  const sug = repo.listSuggestions(doc.id, 'open')[0];

  const res = await app.inject({ method: 'POST', url: `/api/suggestions/${sug.id}/accept` });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.suggestion.status, 'accepted');
  assert.ok(body.suggestion.resolved_at);
  assert.equal(repo.getSection(sug.section_id!)!.status, 'accepted');
  await app.close();
});

test('reject an add proposal excludes the section (rejected, body kept)', async () => {
  const app = await makeApp();
  const { doc } = seedProject();
  await drain(streamDocumentDraft(doc.id));
  const sug = repo.listSuggestions(doc.id, 'open')[0];
  const bodyBefore = repo.getSection(sug.section_id!)!.body;

  const res = await app.inject({ method: 'POST', url: `/api/suggestions/${sug.id}/reject` });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().suggestion.status, 'rejected');
  const section = repo.getSection(sug.section_id!)!;
  assert.equal(section.status, 'rejected');
  assert.equal(section.body, bodyBefore, 'body retained on reject');
  await app.close();
});

test('rewrite returns a new proposal sourced from the user instruction (stub)', async () => {
  const app = await makeApp();
  const { doc } = seedProject();
  await drain(streamDocumentDraft(doc.id));
  const sug = repo.listSuggestions(doc.id, 'open')[0];

  const res = await app.inject({
    method: 'POST',
    url: `/api/suggestions/${sug.id}/rewrite`,
    payload: { instruction: '더 간결하게 써줘' },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.suggestion.kind, 'revise');
  assert.match(body.suggestion.source, /사용자 지시/);
  assert.equal(body.section.status, 'proposed', 'rewritten section is a fresh proposal');
  // original suggestion is dismissed, new one is open
  assert.equal(repo.getSuggestion(sug.id)!.status, 'dismissed');
  assert.ok(repo.listSuggestions(doc.id, 'open').some((s) => s.id === body.suggestion.id));
  await app.close();
});

test('export includes only accepted sections + footnote for excluded (SYSTEM.md §0.2)', async () => {
  const app = await makeApp();
  const { doc } = seedProject();
  await drain(streamDocumentDraft(doc.id));

  // nothing accepted yet -> export body empty, footnote counts all sections
  const total = repo.listSections(doc.id).length;
  let md = (await app.inject({ url: `/api/documents/${doc.id}/export.md` })).body;
  assert.match(md, new RegExp(`검토 대기 ${total}개 제외`));
  assert.doesNotMatch(md, /^## /m, 'no section headings while all proposed');

  // accept the first suggestion -> its section appears, footnote drops by one
  const first = repo.listSuggestions(doc.id, 'open')[0];
  const acceptedSection = repo.getSection(first.section_id!)!;
  await app.inject({ method: 'POST', url: `/api/suggestions/${first.id}/accept` });

  md = (await app.inject({ url: `/api/documents/${doc.id}/export.md` })).body;
  assert.match(md, new RegExp(`## ${acceptedSection.heading}`));
  assert.match(md, new RegExp(`검토 대기 ${total - 1}개 제외`));

  // html export mirrors the same filter
  const html = (await app.inject({ url: `/api/documents/${doc.id}/export.html` })).body;
  assert.match(html, new RegExp(acceptedSection.heading));
  assert.match(html, /검토 대기/);
  await app.close();
});

test('share link only exposes accepted sections', async () => {
  const app = await makeApp();
  const { doc } = seedProject();
  await drain(streamDocumentDraft(doc.id));
  const first = repo.listSuggestions(doc.id, 'open')[0];
  const accepted = repo.getSection(first.section_id!)!;
  const other = repo.listSections(doc.id).find((s) => s.id !== accepted.id)!;
  await app.inject({ method: 'POST', url: `/api/suggestions/${first.id}/accept` });

  const share = await app.inject({
    method: 'POST',
    url: `/api/documents/${doc.id}/shares`,
    payload: {},
  });
  const view = await app.inject({ url: `/s/${share.json().token}` });
  assert.equal(view.statusCode, 200);
  assert.match(view.body, new RegExp(accepted.heading));
  // an un-accepted heading must not leak into the shared HTML
  assert.doesNotMatch(view.body, new RegExp(`<h2>${other.heading}</h2>`));
  await app.close();
});

test('accept-all resolves every open suggestion and accepts all sections', async () => {
  const app = await makeApp();
  const { doc } = seedProject();
  await drain(streamDocumentDraft(doc.id));
  const before = repo.countOpenSuggestions(doc.id);
  assert.ok(before > 0);

  const res = await app.inject({ method: 'POST', url: `/api/documents/${doc.id}/accept-all` });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().accepted, before);
  assert.equal(repo.countOpenSuggestions(doc.id), 0);
  for (const s of repo.listSections(doc.id)) assert.equal(s.status, 'accepted');
  await app.close();
});

test('open-suggestion count surfaces on the project tree (green dot)', async () => {
  const app = await makeApp();
  const { project, doc } = seedProject();
  await drain(streamDocumentDraft(doc.id));

  const res = await app.inject({ url: `/api/projects/${project.id}` });
  const treeDoc = res.json().documents.find((d: { id: string }) => d.id === doc.id);
  assert.ok(treeDoc.open_suggestions > 0, 'tree exposes open_suggestions for the dot');
  assert.equal(treeDoc.open_suggestions, repo.countOpenSuggestions(doc.id));
  await app.close();
});

test('parent change reverts child sections to proposed + opens a stale suggestion', async () => {
  const app = await makeApp();
  const project = repo.createProject('P');
  const prd = repo.createDocument({ projectId: project.id, type: 'prd', title: 'PRD' });
  repo.replaceSections(prd.id, [{ heading: '개요', body: '초안' }]); // accepted
  const spec = repo.createDocument({
    projectId: project.id,
    type: 'feature-spec',
    title: 'Spec',
    parentDocumentId: prd.id,
  });
  repo.replaceSections(spec.id, [{ heading: '기능', body: '자식 본문' }]); // accepted

  repo.snapshotDocument(prd.id, 'save', { reason: 'edit' }); // parent bump -> child stale

  assert.equal(repo.getDocument(spec.id)!.context_stale, 1);
  for (const s of repo.listSections(spec.id)) assert.equal(s.status, 'proposed');
  const stale = repo.listSuggestions(spec.id, 'open').filter((s) => s.kind === 'stale');
  assert.equal(stale.length, 1, 'exactly one stale suggestion');
  assert.ok(stale[0].source.includes('PRD') || stale[0].source.includes('prd'));
  await app.close();
});

test('accept-all skips destructive suggestions (lint/delete stay open, content kept)', async () => {
  const app = await makeApp();
  const { doc } = seedProject();
  await drain(streamDocumentDraft(doc.id));

  // 콘텐츠 제안 위에 파괴적 제안 2종을 얹는다
  const section = repo.listSections(doc.id)[0];
  repo.createSuggestion({
    documentId: doc.id,
    kind: 'lint',
    title: 'REQ-01 · W-ORPHAN-SPEC',
    body: '이 기능이 어느 요구에도 연결되지 않았어요.',
    quoteBefore: 'W-ORPHAN-SPEC::REQ-01',
    source: 'W-ORPHAN-SPEC',
  });
  repo.createSuggestion({
    documentId: doc.id,
    kind: 'delete',
    sectionId: section.id,
    title: '섹션 삭제 제안',
    source: 'review',
  });

  const res = await app.inject({ method: 'POST', url: `/api/documents/${doc.id}/accept-all` });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().skippedDestructive, 2, 'lint+delete are excluded from accept-all');
  assert.equal(repo.countOpenSuggestions(doc.id), 2, 'destructive suggestions remain open');
  // delete 제안이 일괄 수락으로 실행되지 않았다 — 섹션 보존
  assert.notEqual(repo.getSection(section.id)!.status, 'rejected');
  await app.close();
});

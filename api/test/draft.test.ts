import './setup.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './setup.ts';
import * as repo from '../src/db/repos.ts';
import { streamDocumentDraft, streamSectionRegeneration } from '../src/lib/ai.ts';
import type { DraftEvent } from '../src/lib/ai.ts';

async function collect(gen: AsyncGenerator<DraftEvent>): Promise<DraftEvent[]> {
  const out: DraftEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

test('streamDocumentDraft creates sections and fills bodies (stub)', async () => {
  freshDb();
  const project = repo.createProject('P');
  const doc = repo.createDocument({ projectId: project.id, type: 'prd', title: 'PRD' });
  const session = repo.createSession(doc.id, 'prd');
  repo.updateSession(session.id, {
    answers: [{ questionId: 'problem', question: '문제?', answer: '백지에서 시작' }],
  });

  const events = await collect(streamDocumentDraft(doc.id));

  const starts = events.filter((e) => e.type === 'section_start');
  const ends = events.filter((e) => e.type === 'section_end');
  const done = events.filter((e) => e.type === 'done');
  assert.ok(starts.length >= 5, 'PRD template has multiple sections');
  assert.equal(starts.length, ends.length);
  assert.equal(done.length, 1);

  const sections = repo.listSections(doc.id);
  assert.equal(sections.length, starts.length);
  for (const s of sections) assert.ok(s.body.length > 0, `section ${s.heading} has body`);

  // document is ready and has a save version
  assert.equal(repo.getDocument(doc.id)!.status, 'ready');
  assert.ok(repo.listVersions(doc.id).some((v) => v.event_type === 'save'));
});

test('section_start precedes tokens which precede section_end for each section', async () => {
  freshDb();
  const project = repo.createProject('P');
  const doc = repo.createDocument({ projectId: project.id, type: 'prd', title: 'PRD' });
  repo.createSession(doc.id, 'prd');
  const events = await collect(streamDocumentDraft(doc.id));

  const open = new Set<string>();
  const closed = new Set<string>();
  for (const e of events) {
    if (e.type === 'section_start') open.add(e.sectionId);
    if (e.type === 'token') assert.ok(open.has(e.sectionId) && !closed.has(e.sectionId));
    if (e.type === 'section_end') {
      assert.ok(open.has(e.sectionId));
      closed.add(e.sectionId);
    }
  }
  assert.deepEqual([...open].sort(), [...closed].sort());
});

test('regenerate replaces only the target section (SPEC-07)', async () => {
  freshDb();
  const project = repo.createProject('P');
  const doc = repo.createDocument({ projectId: project.id, type: 'prd', title: 'PRD' });
  repo.createSession(doc.id, 'prd');
  await collect(streamDocumentDraft(doc.id));

  const sections = repo.listSections(doc.id);
  const target = sections[1];
  const othersBefore = sections
    .filter((s) => s.id !== target.id)
    .map((s) => `${s.id}:${s.body}`);

  // mutate target to a sentinel, then regenerate
  repo.updateSection(target.id, { body: 'SENTINEL' });
  await collect(streamSectionRegeneration(target.id));

  const after = repo.listSections(doc.id);
  const othersAfter = after
    .filter((s) => s.id !== target.id)
    .map((s) => `${s.id}:${s.body}`);
  assert.deepEqual(othersAfter, othersBefore, 'other sections unchanged');

  const regenerated = after.find((s) => s.id === target.id)!;
  assert.notEqual(regenerated.body, 'SENTINEL', 'target section was regenerated');
});

// ── stripLeadingHeading — 모델이 본문 첫 줄에 섹션 제목을 반복한 경우만 걷어낸다 ──
test('stripLeadingHeading removes a repeated heading line (md/bold/colon variants)', async () => {
  const { stripLeadingHeading } = await import('../src/lib/ai.ts');
  assert.equal(stripLeadingHeading('## 문제 정의\n\n본문이다.', '문제 정의'), '본문이다.');
  assert.equal(stripLeadingHeading('**문제 정의**\n본문이다.', '문제 정의'), '본문이다.');
  assert.equal(stripLeadingHeading('문제 정의:\n본문이다.', '문제 정의'), '본문이다.');
  assert.equal(stripLeadingHeading('# 문제 정의', '문제 정의'), '');
});

test('stripLeadingHeading leaves normal bodies untouched', async () => {
  const { stripLeadingHeading } = await import('../src/lib/ai.ts');
  const stub = '이 섹션은 "문제 정의" 에 대한 초안입니다.\n\n- 항목';
  assert.equal(stripLeadingHeading(stub, '문제 정의'), stub);
  assert.equal(stripLeadingHeading('  본문만 있다  ', '개요 및 배경'), '본문만 있다');
  // 다른 섹션 제목은 건드리지 않는다
  assert.equal(stripLeadingHeading('## 목표\n본문', '문제 정의'), '## 목표\n본문');
});

test('reorderSections 는 순서를 바꾸고 position 을 재부여한다', () => {
  freshDb();
  const project = repo.createProject('P');
  const doc = repo.createDocument({ projectId: project.id, type: 'prd', title: 'PRD' });
  const a = repo.createSection(doc.id, 'A', 'a', undefined, 'accepted');
  const b = repo.createSection(doc.id, 'B', 'b', undefined, 'accepted');
  const c = repo.createSection(doc.id, 'C', 'c', undefined, 'accepted');
  // C, A, B 순으로 재정렬
  const out = repo.reorderSections(doc.id, [c.id, a.id, b.id]);
  assert.deepEqual(out.map((s) => s.heading), ['C', 'A', 'B']);
  // 저장 확인
  assert.deepEqual(repo.listSections(doc.id).map((s) => s.heading), ['C', 'A', 'B']);
});

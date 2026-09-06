import './setup.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './setup.ts';
import { buildServer } from '../src/index.ts';
import * as repo from '../src/db/repos.ts';
import { buildSectionMessages } from '../src/lib/ai.ts';
import { normalizeFollowups, followupId } from '../src/lib/followups.ts';

function seed() {
  freshDb();
  const project = repo.createProject('P');
  const doc = repo.createDocument({
    projectId: project.id,
    type: 'prd',
    title: 'PRD',
    parentDocumentId: null,
  });
  const session = repo.createSession(doc.id, 'prd');
  return { doc, session };
}

test('followups · 스텁이 보강 질문 2개를 만들고 세션에 붙인다', async () => {
  const { doc, session } = seed();
  repo.updateSession(session.id, {
    answers: [
      { questionId: 'q1', question: '무엇을 만드나요?', answer: '빠르게 만들고 싶다' },
      { questionId: 'q2', question: '성공 기준은?', answer: '좋으면 됨' },
      {
        questionId: 'q3',
        question: '누가 쓰나요?',
        answer: '교육운영실 매니저 4명이 매주 월요일 아침에 주간 리포트를 만들 때 사용합니다.',
      },
    ],
  });

  const app = await buildServer();
  const res = await app.inject({
    method: 'POST',
    url: `/api/documents/${doc.id}/interview/followups`,
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.questions.length, 2);
  for (const q of body.questions) {
    assert.ok(q.id.startsWith('fu-'));
    assert.ok(q.prompt.length > 0);
  }
  // 얕은 답변(q1·q2)만 골랐다 — 구체적인 q3 는 건드리지 않는다
  const joined = body.questions.map((q: { prompt: string }) => q.prompt).join(' ');
  assert.ok(joined.includes('성공 기준은?'));
  assert.equal(joined.includes('누가 쓰나요?'), false);

  // 세션에 붙어 다시 읽힌다
  const stored = repo.getSession(session.id)!;
  assert.equal(stored.extra_questions.length, 2);
  assert.deepEqual(
    stored.extra_questions.map((q) => q.id),
    body.questions.map((q: { id: string }) => q.id),
  );

  // 재요청은 1회성이 아니다 — 같은 답변이면 같은 질문(=같은 id)이 다시 온다
  const again = await app.inject({
    method: 'POST',
    url: `/api/documents/${doc.id}/interview/followups`,
  });
  assert.deepEqual(
    again.json().questions.map((q: { id: string }) => q.id),
    body.questions.map((q: { id: string }) => q.id),
  );
});

test('followups · 보강 질문의 답변이 초안 프롬프트(answersBlock)로 흘러든다', async () => {
  const { doc, session } = seed();
  repo.updateSession(session.id, {
    answers: [{ questionId: 'q1', question: '무엇을 만드나요?', answer: '빠르게' }],
  });

  const app = await buildServer();
  const gen = await app.inject({
    method: 'POST',
    url: `/api/documents/${doc.id}/interview/followups`,
  });
  const fu = gen.json().questions[0] as { id: string; prompt: string };

  // 보강 질문에 답한다 — 기존 answer API 가 그 id 를 그대로 받는다
  const saved = await app.inject({
    method: 'POST',
    url: `/api/interview/${session.id}/answer`,
    payload: { questionId: fu.id, question: fu.prompt, answer: '월요일 09:00 까지 리포트 1건 발행' },
  });
  assert.equal(saved.statusCode, 200);

  const answers = repo.getSession(session.id)!.answers;
  const messages = buildSectionMessages({
    documentId: doc.id,
    docType: 'prd',
    heading: '개요',
    answers,
    guidance: 'g',
  });
  const user = messages.find((m) => m.role === 'user')!.content;
  assert.ok(user.includes('월요일 09:00 까지 리포트 1건 발행'));
  assert.ok(user.includes(fu.prompt));
});

test('followups · 답변이 하나도 없으면 400', async () => {
  const { doc } = seed();
  const app = await buildServer();
  const res = await app.inject({
    method: 'POST',
    url: `/api/documents/${doc.id}/interview/followups`,
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /답변/);
});

test('followups · 정규화 — 빈 질문·중복 제거, 최대 3개', () => {
  const out = normalizeFollowups([
    { question: '  ' },
    { question: '목표를 숫자로 말해 주세요', hint: '하나면 충분합니다' },
    { question: '목표를 숫자로 말해 주세요' }, // 중복
    { question: '실패하면 어떻게 되나요' },
    { question: '누가 쓰나요' },
    { question: '언제 끝나나요' }, // 4번째 — 잘린다
  ]);
  assert.equal(out.length, 3);
  assert.equal(out[0].id, followupId('목표를 숫자로 말해 주세요'));
  assert.equal(out[0].hint, '하나면 충분합니다');
});

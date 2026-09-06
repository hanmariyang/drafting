import './setup.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qualityAdvisory } from '../src/lib/quality-lint.ts';
import { freshDb } from './setup.ts';
import { buildServer } from '../src/index.ts';
import * as repo from '../src/db/repos.ts';

const LONG = '이 내용은 빈약 판정을 피하기 위한 충분히 긴 본문이다. 상세한 설명이 이어진다.';

test('quality · 수용 기준의 측정 불가 표현·무숫자를 짚는다', () => {
  const notes = qualityAdvisory('feature', [
    { heading: '수용 기준', body: '· 검색이 빠르게 동작한다\n· 사용자가 쉽게 이해한다' },
  ]);
  const codes = notes.map((n) => n.code);
  assert.ok(codes.includes('Q-VAGUE'));
  assert.ok(codes.includes('Q-NO-NUMBER'));
  const vague = notes.find((n) => n.code === 'Q-VAGUE')!;
  assert.match(vague.message, /"빠르게"/);
  assert.match(vague.message, /"쉽게"/);
});

test('quality · 숫자·단위가 있으면 Q-NO-NUMBER 없음, 서사 산문의 수식어는 자유', () => {
  const notes = qualityAdvisory('feature', [
    { heading: '수용 기준', body: '· 검색 응답 500ms 이내\n· 결과 20건 표시' },
    { heading: '배경', body: `사용자는 빠르게 찾고 싶어한다. ${LONG}` }, // 배경의 "빠르게"는 자유
  ]);
  const codes = notes.map((n) => n.code);
  assert.equal(codes.includes('Q-NO-NUMBER'), false);
  assert.equal(codes.includes('Q-VAGUE'), false);
});

test('quality · 빈약 섹션(Q-THIN)과 PRD 비범위 부재(Q-NO-NONSCOPE)', () => {
  const thin = qualityAdvisory('feature', [{ heading: '변경 내용', body: '검색 추가.' }]);
  assert.ok(thin.some((n) => n.code === 'Q-THIN' && n.section === '변경 내용'));

  const prd = qualityAdvisory('prd', [{ heading: '개요', body: LONG }]);
  assert.ok(prd.some((n) => n.code === 'Q-NO-NONSCOPE'));

  const prdOk = qualityAdvisory('prd', [
    { heading: '개요', body: LONG },
    { heading: '비범위', body: `대시보드 UI는 만들지 않는다. ${LONG}` },
  ]);
  assert.equal(prdOk.some((n) => n.code === 'Q-NO-NONSCOPE'), false);
});

test('quality · 만성 누락은 미언급 영역만, 최대 3개', () => {
  const notes = qualityAdvisory('feature', [{ heading: '변경 내용', body: LONG }]);
  const pf = notes.filter((n) => n.code === 'Q-PREFLIGHT');
  assert.ok(pf.length > 0 && pf.length <= 3);

  const covered = qualityAdvisory('feature', [
    {
      heading: '변경 내용',
      body: `${LONG} 실패하면 에러를 표시하고, 권한은 로그인 사용자만, 빈 상태는 안내 문구, 동시 요청은 중복 실행을 막고, 기존 데이터 마이그레이션은 없다.`,
    },
  ]);
  assert.equal(covered.some((n) => n.code === 'Q-PREFLIGHT'), false);
});

test('quality-check 엔드포인트 · prd·feature 만 검사, 나머지는 꺼짐', async () => {
  freshDb();
  const app = await buildServer();
  const project = repo.createProject('P');
  const prd = repo.createDocument({ projectId: project.id, type: 'prd', title: 'PRD', parentDocumentId: null });
  const brief = repo.createDocument({ projectId: project.id, type: 'brief', title: '브리프', parentDocumentId: null });
  repo.createSection(prd.id, '수용 기준', '빠르게 동작한다');

  const on = await app.inject({ url: `/api/documents/${prd.id}/quality-check` });
  assert.equal(on.json().enabled, true);
  assert.ok(on.json().notes.some((n: { code: string }) => n.code === 'Q-VAGUE'));

  const off = await app.inject({ url: `/api/documents/${brief.id}/quality-check` });
  assert.equal(off.json().enabled, false);
});

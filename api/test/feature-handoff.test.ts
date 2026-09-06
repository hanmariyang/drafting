import './setup.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshDb } from './setup.ts';
import * as repo from '../src/db/repos.ts';
import { featurePromptPack } from '../src/lib/handoff.ts';
import { collectRepoBrief } from '../src/lib/brief-extract.ts';

function seed() {
  freshDb();
  const project = repo.createProject('P');
  const brief = repo.createDocument({ projectId: project.id, type: 'brief', title: '브리프', parentDocumentId: null });
  const feature = repo.createDocument({ projectId: project.id, type: 'feature', title: '만료 알림', parentDocumentId: brief.id });
  return { project, brief, feature };
}

test('feature 프롬프트 팩 · feature 아니면 거절, 수락 0이면 안내문', () => {
  const { brief, feature } = seed();
  assert.throws(() => featurePromptPack(brief.id), /feature 문서/);
  const md = featurePromptPack(feature.id);
  assert.match(md, /수락된 섹션이 없습니다/);
});

test('feature 프롬프트 팩 · 브리프 맥락 + 수락 기획 + 수용기준 체크박스 + 미확인 이름', () => {
  const { brief, feature } = seed();
  repo.createSection(brief.id, '스택', 'Fastify + `node:sqlite`, `ShareLink` 모델.');
  repo.createSection(feature.id, '변경 내용', '`ShareLink` 만료 24시간 전 알림. 새 워커 `expiry_notifier`.');
  repo.createSection(feature.id, '수용 기준', '· 만료 24시간 전 알림 발송\n· 알림은 1회만');
  // 제안(proposed) 섹션은 발주에 실리면 안 된다
  repo.createSection(feature.id, '검토 중', '아직 수락 안 됨', undefined, 'proposed');

  const md = featurePromptPack(feature.id);
  assert.match(md, /## 프로젝트 맥락 — 브리프 「브리프」/);
  assert.match(md, /node:sqlite/);
  assert.match(md, /### 변경 내용/);
  assert.match(md, /- \[ \] 만료 24시간 전 알림 발송/);
  assert.match(md, /- \[ \] 알림은 1회만/);
  assert.match(md, /## 확인 필요한 이름/);
  assert.match(md, /`expiry_notifier`/);
  assert.equal(md.includes('아직 수락 안 됨'), false);
  assert.equal(md.includes('sharelink 확인'), false); // 브리프에 있는 이름은 미확인 목록에 없다
  assert.doesNotMatch(md, /- `sharelink`/);
});

test('feature 프롬프트 팩 · 브리프 없으면 맥락 안내로 대체(발주는 그대로 가능)', () => {
  freshDb();
  const project = repo.createProject('P');
  const feature = repo.createDocument({ projectId: project.id, type: 'feature', title: '단독', parentDocumentId: null });
  repo.createSection(feature.id, '변경 내용', '검색 필터를 추가한다.');
  const md = featurePromptPack(feature.id);
  assert.match(md, /연결된 브리프가 없다/);
  assert.match(md, /검색 필터를 추가한다/);
  assert.equal(md.includes('확인 필요한 이름'), false);
});

test('brief-extract · 모노레포 엔트리(api/src/index.ts 등)를 수집한다', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drafting-mono-'));
  fs.writeFileSync(path.join(root, 'package.json'), '{ "name": "mono", "workspaces": ["api", "web"] }');
  fs.mkdirSync(path.join(root, 'api/src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'api/src/index.ts'), 'export const boot = 1;');
  fs.mkdirSync(path.join(root, 'web/src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'web/src/main.tsx'), 'export const ui = 1;');
  const brief = collectRepoBrief(root);
  const entries = brief.entries.map((e: { file: string }) => e.file);
  assert.ok(entries.includes('api/src/index.ts'));
  assert.ok(entries.includes('web/src/main.tsx'));
});

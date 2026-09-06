import './setup.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  collectRepoBrief,
  renderBriefContext,
  briefSourceSummary,
  BriefExtractError,
  README_LIMIT,
  MANIFEST_LIMIT,
  ENTRY_LIMIT,
  TREE_MAX_ENTRIES,
  ENTRY_MAX_FILES,
} from '../src/lib/brief-extract.ts';

/** 임시 레포 fixture. { 'rel/path': '내용' } — 디렉터리는 자동 생성. */
function makeRepo(files: Record<string, string>, dirs: string[] = []): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drafting-brief-'));
  for (const d of dirs) fs.mkdirSync(path.join(root, d), { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

test('collectRepoBrief 는 README·매니페스트·트리·엔트리만 모은다', () => {
  const root = makeRepo({
    'README.md': '# 데모 레포\n셀프호스트 도구.',
    'package.json': '{ "name": "demo", "dependencies": { "fastify": "5" } }',
    'src/index.ts': 'export const boot = () => 1;',
    'src/deep/secret.ts': 'const NEVER_READ = 1;',
    'LICENSE.md': 'MIT',
  });

  const brief = collectRepoBrief(root);

  assert.equal(brief.readme?.file, 'README.md');
  assert.match(brief.readme!.text, /데모 레포/);
  assert.deepEqual(brief.manifests.map((m) => m.file), ['package.json']);
  assert.deepEqual(brief.entries.map((e) => e.file), ['src/index.ts']);

  // 트리는 깊이 2까지 — src/deep/ 은 보이되 그 안의 파일은 안 보인다
  assert.ok(brief.tree.includes('src/'));
  assert.ok(brief.tree.includes('src/index.ts'));
  assert.ok(brief.tree.includes('src/deep/'));
  assert.ok(!brief.tree.includes('src/deep/secret.ts'), '깊이 3은 트리에 없다');

  // 코드 전량을 읽지 않는다 — 엔트리 후보가 아닌 파일 본문은 어디에도 없다
  const ctx = renderBriefContext(brief);
  assert.ok(!ctx.includes('NEVER_READ'), '엔트리 후보가 아닌 코드는 읽지 않는다');
  assert.match(ctx, /fastify/, '매니페스트 내용은 컨텍스트에 들어간다');
});

test('제외 규칙: node_modules·.git·dist·build·venv·__pycache__ 는 트리에 없다', () => {
  const root = makeRepo(
    {
      'README.md': 'x',
      'node_modules/pkg/index.js': 'junk',
      'dist/bundle.js': 'junk',
      'build/out.o': 'junk',
      'venv/pyvenv.cfg': 'junk',
      '__pycache__/mod.pyc': 'junk',
      'src/index.ts': 'ok',
    },
    ['.git'],
  );

  const brief = collectRepoBrief(root);
  for (const skipped of ['node_modules', '.git', 'dist', 'build', 'venv', '__pycache__']) {
    assert.ok(
      !brief.tree.some((t) => t.startsWith(`${skipped}/`)),
      `${skipped} 는 트리에서 제외된다`,
    );
  }
  assert.ok(brief.tree.includes('src/index.ts'));
});

test('크기 상한: README 8KB · 매니페스트 4KB · 엔트리 2KB 에서 잘린다', () => {
  const root = makeRepo({
    'README.md': 'A'.repeat(README_LIMIT + 5000),
    'package.json': 'B'.repeat(MANIFEST_LIMIT + 5000),
    'src/index.ts': 'C'.repeat(ENTRY_LIMIT + 5000),
  });

  const brief = collectRepoBrief(root);
  assert.equal(brief.readme!.text.length, README_LIMIT);
  assert.equal(brief.readme!.truncated, true);
  assert.equal(brief.manifests[0].text.length, MANIFEST_LIMIT);
  assert.equal(brief.manifests[0].truncated, true);
  assert.equal(brief.entries[0].text.length, ENTRY_LIMIT);
  assert.equal(brief.entries[0].truncated, true);
});

test('트리는 200 엔트리에서 잘리고, 엔트리 파일은 3개까지', () => {
  const files: Record<string, string> = { 'README.md': 'x' };
  for (let i = 0; i < TREE_MAX_ENTRIES + 50; i++) files[`f${String(i).padStart(4, '0')}.txt`] = 'x';
  // 엔트리 후보를 상한보다 많이 둔다
  for (const rel of ['src/index.ts', 'src/main.ts', 'main.py', 'app.py']) files[rel] = 'entry';

  const brief = collectRepoBrief(makeRepo(files));
  assert.equal(brief.tree.length, TREE_MAX_ENTRIES);
  assert.equal(brief.treeTruncated, true);
  assert.equal(brief.entries.length, ENTRY_MAX_FILES);
});

test('심볼릭 링크는 따라가지 않는다', () => {
  const outside = makeRepo({ 'secret.txt': 'OUTSIDE_SECRET', 'README.md': '남의 레포' });
  const root = makeRepo({ 'README.md': '내 레포' });
  fs.symlinkSync(outside, path.join(root, 'linked'));

  const brief = collectRepoBrief(root);
  assert.ok(!brief.tree.some((t) => t.startsWith('linked/')), '심볼릭 링크 안으로 내려가지 않는다');
  assert.ok(!renderBriefContext(brief).includes('OUTSIDE_SECRET'));
});

test('README·매니페스트가 없어도 트리만으로 수집된다', () => {
  const brief = collectRepoBrief(makeRepo({ 'notes/todo.txt': 'x' }));
  assert.equal(brief.readme, null);
  assert.deepEqual(brief.manifests, []);
  assert.ok(brief.tree.includes('notes/'));
  assert.match(renderBriefContext(brief), /디렉터리 구조/);
  assert.match(briefSourceSummary(brief), /트리 \d+개/);
});

test('없는 경로·파일 경로는 BriefExtractError', () => {
  const root = makeRepo({ 'README.md': 'x' });
  assert.throws(
    () => collectRepoBrief(path.join(root, 'nope')),
    (e: unknown) => e instanceof BriefExtractError,
  );
  assert.throws(
    () => collectRepoBrief(path.join(root, 'README.md')),
    (e: unknown) => e instanceof BriefExtractError && /디렉터리가 아닙니다/.test(e.message),
  );
  assert.throws(
    () => collectRepoBrief('   '),
    (e: unknown) => e instanceof BriefExtractError,
  );
});

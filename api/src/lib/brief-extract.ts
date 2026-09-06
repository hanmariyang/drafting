import fs from 'node:fs';
import path from 'node:path';

/**
 * 프로젝트 브리프 수집기 — 설계 노트 §2("레포 통째 X, 압축 브리프 O").
 *
 * 로컬 레포 폴더에서 **README · 매니페스트 · 디렉터리 구조 · 엔트리 파일 head** 만 읽는다.
 * 코드 전량을 읽지 않는다 — 토큰 낭비 + 노이즈로 오히려 엉뚱한 참조를 낳기 때문.
 * 순수 수집기(파일시스템만 읽고 아무것도 쓰지 않음)라 단위 테스트가 가능하다.
 * 심볼릭 링크는 따라가지 않는다(레포 밖으로 새는 경로 차단).
 */

/** README 앞부분만 (bytes). */
export const README_LIMIT = 8 * 1024;
/** 매니페스트 1개당 (bytes). */
export const MANIFEST_LIMIT = 4 * 1024;
/** 엔트리 후보 파일 1개당 (bytes). */
export const ENTRY_LIMIT = 2 * 1024;
/** 디렉터리 트리 최대 엔트리 수. */
export const TREE_MAX_ENTRIES = 200;
/** 디렉터리 트리 깊이 (2 = 루트의 자식과 그 자식). */
export const TREE_DEPTH = 2;
/** 엔트리 후보 파일 최대 개수. */
export const ENTRY_MAX_FILES = 3;

/** 트리에서 통째로 건너뛰는 디렉터리. */
export const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'venv',
  '.venv',
  '__pycache__',
]);

/** 존재하면 읽는 매니페스트 (이 순서대로). */
export const MANIFEST_FILES = [
  'package.json',
  'pyproject.toml',
  'go.mod',
  'Cargo.toml',
  'requirements.txt',
];

/** 존재하면 head 를 읽는 엔트리 후보 (이 순서대로, 최대 ENTRY_MAX_FILES 개). */
export const ENTRY_CANDIDATES = [
  'src/index.ts',
  'src/index.js',
  'src/index.tsx',
  'src/main.ts',
  'src/main.js',
  'src/main.tsx',
  'src/main.py',
  'main.py',
  'app.py',
  'index.ts',
  'index.js',
  'main.go',
  'src/main.rs',
];

export class BriefExtractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BriefExtractError';
  }
}

export interface CollectedFile {
  /** 레포 루트 기준 상대 경로 */
  file: string;
  text: string;
  /** 상한에 걸려 잘렸는지 */
  truncated: boolean;
}

export interface RepoBrief {
  root: string;
  readme: CollectedFile | null;
  manifests: CollectedFile[];
  /** "dir/" 또는 "dir/file" 꼴의 상대 경로 목록 (정렬됨) */
  tree: string[];
  /** 트리가 TREE_MAX_ENTRIES 에서 잘렸는지 */
  treeTruncated: boolean;
  entries: CollectedFile[];
}

/** 파일 앞 `limit` 바이트만 읽는다. 디렉터리·심볼릭 링크·읽기 실패는 null. */
function readHead(abs: string, limit: number): { text: string; truncated: boolean } | null {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(abs); // lstat — 심볼릭 링크를 따라가지 않는다
  } catch {
    return null;
  }
  if (!st.isFile()) return null;
  let fd: number | null = null;
  try {
    fd = fs.openSync(abs, 'r');
    const buf = Buffer.alloc(Math.min(limit, st.size));
    const read = fs.readSync(fd, buf, 0, buf.length, 0);
    return { text: buf.subarray(0, read).toString('utf8'), truncated: st.size > limit };
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

function readDirSafe(abs: string): fs.Dirent[] {
  try {
    return fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/** README* 중 하나(사전순 첫 번째). 대소문자 무시. */
function findReadme(root: string): CollectedFile | null {
  for (const ent of readDirSafe(root)) {
    if (!ent.isFile()) continue; // 심볼릭 링크(isSymbolicLink)는 isFile()이 false
    if (!/^readme(\.|$)/i.test(ent.name)) continue;
    const head = readHead(path.join(root, ent.name), README_LIMIT);
    if (head) return { file: ent.name, text: head.text, truncated: head.truncated };
  }
  return null;
}

/**
 * 깊이 TREE_DEPTH 까지의 디렉터리 트리. SKIP_DIRS 는 통째로 제외하고,
 * 숨김 디렉터리(.으로 시작)도 내려가지 않는다. 상한은 TREE_MAX_ENTRIES.
 */
function collectTree(root: string): { tree: string[]; truncated: boolean } {
  const out: string[] = [];
  let truncated = false;

  const walk = (rel: string, depth: number): void => {
    if (truncated) return;
    for (const ent of readDirSafe(path.join(root, rel))) {
      if (truncated) return;
      if (ent.isSymbolicLink()) continue; // 심볼릭 링크는 따라가지 않는다
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        if (out.length >= TREE_MAX_ENTRIES) {
          truncated = true;
          return;
        }
        out.push(`${childRel}/`);
        if (ent.name.startsWith('.')) continue; // 숨김 디렉터리는 안으로 내려가지 않는다
        if (depth + 1 < TREE_DEPTH) walk(childRel, depth + 1);
      } else if (ent.isFile()) {
        if (out.length >= TREE_MAX_ENTRIES) {
          truncated = true;
          return;
        }
        out.push(childRel);
      }
    }
  };

  walk('', 0);
  return { tree: out, truncated };
}

/**
 * 로컬 레포 폴더에서 브리프 재료를 모은다.
 * 경로가 없거나 디렉터리가 아니면 BriefExtractError.
 */
export function collectRepoBrief(inputPath: string): RepoBrief {
  const raw = (inputPath ?? '').trim();
  if (!raw) throw new BriefExtractError('레포 폴더 경로가 비어 있습니다');
  const root = path.resolve(raw);

  let st: fs.Stats;
  try {
    st = fs.statSync(root);
  } catch {
    throw new BriefExtractError(`경로를 찾을 수 없습니다: ${root}`);
  }
  if (!st.isDirectory()) throw new BriefExtractError(`디렉터리가 아닙니다: ${root}`);

  const manifests: CollectedFile[] = [];
  for (const name of MANIFEST_FILES) {
    const head = readHead(path.join(root, name), MANIFEST_LIMIT);
    if (head) manifests.push({ file: name, text: head.text, truncated: head.truncated });
  }

  const entries: CollectedFile[] = [];
  for (const rel of ENTRY_CANDIDATES) {
    if (entries.length >= ENTRY_MAX_FILES) break;
    const head = readHead(path.join(root, rel), ENTRY_LIMIT);
    if (head) entries.push({ file: rel, text: head.text, truncated: head.truncated });
  }

  const { tree, truncated: treeTruncated } = collectTree(root);

  return { root, readme: findReadme(root), manifests, tree, treeTruncated, entries };
}

function fileBlock(f: CollectedFile): string {
  return `#### ${f.file}${f.truncated ? ' (앞부분만)' : ''}\n\`\`\`\n${f.text.trimEnd()}\n\`\`\``;
}

/** 수집 결과를 AI 프롬프트에 넣을 하나의 텍스트 블록으로 만든다(결정적). */
export function renderBriefContext(brief: RepoBrief): string {
  const parts: string[] = [
    `아래는 로컬 레포 "${path.basename(brief.root)}" 에서 읽은 자료다. ` +
      `README · 매니페스트 · 디렉터리 구조 · 엔트리 파일 앞부분만 읽었고 코드 전량은 읽지 않았다. ` +
      `여기에 실제로 있는 사실만 근거로 삼아라:`,
  ];
  if (brief.readme) parts.push(`### README\n${fileBlock(brief.readme)}`);
  if (brief.manifests.length) {
    parts.push(`### 매니페스트\n${brief.manifests.map(fileBlock).join('\n\n')}`);
  }
  if (brief.tree.length) {
    parts.push(
      `### 디렉터리 구조 (깊이 ${TREE_DEPTH})\n\`\`\`\n${brief.tree.join('\n')}\n\`\`\`` +
        (brief.treeTruncated ? `\n(${TREE_MAX_ENTRIES}개에서 잘림)` : ''),
    );
  }
  if (brief.entries.length) {
    parts.push(`### 엔트리 파일\n${brief.entries.map(fileBlock).join('\n\n')}`);
  }
  if (!brief.readme && !brief.manifests.length && !brief.entries.length) {
    parts.push('(README·매니페스트·엔트리 파일이 없다 — 디렉터리 구조만으로 판단하고, 모르는 것은 모른다고 밝혀라.)');
  }
  return parts.join('\n\n');
}

/** 사용자에게 "무엇을 읽었는지" 보여주는 짧은 요약(라운드트립 신뢰용). */
export function briefSourceSummary(brief: RepoBrief): string {
  const bits: string[] = [];
  if (brief.readme) bits.push(brief.readme.file);
  for (const m of brief.manifests) bits.push(m.file);
  bits.push(`트리 ${brief.tree.length}개`);
  for (const e of brief.entries) bits.push(e.file);
  return bits.join(' · ');
}

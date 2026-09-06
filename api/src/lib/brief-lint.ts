// 브리프 정합성 advisory (설계 노트 §3·§7) — 결정적, AI 없음, 순수 함수.
//
// 기능 기획(feature)이 프로젝트 브리프(brief)에 **없는 이름**(모듈·파일·식별자)을
// 참조하면 "기존에 없는데 신규인가?" 를 묻는다. **차단이 아니다** — 신규 도입은
// 정당할 수 있으니 사람이 판단한다. 목적은 "그럴듯하지만 코드와 안 맞는 기획 →
// 토큰 낭비" 의 조기 발견. 컴파일 lint(E/W·waive 게이트)와는 별개 채널이다.
//
// 산문 문서라 구조화된 scope 가 없다 → 식별자처럼 생긴 토큰만 본다:
// 코드 스팬(`…`) · CamelCase · snake_case · kebab-case · 경로/파일명.
// 한국어 산문은 이 패턴에 걸리지 않으므로 노이즈가 낮다.

export interface SectionText {
  heading: string;
  body: string;
}

export interface BriefAdvisoryNote {
  /** 브리프에 없는 이름 */
  name: string;
  /** 이 이름이 등장한 기능 문서 섹션 제목들 */
  sections: string[];
}

export interface BriefAdvisoryResult {
  /** 브리프에 수락된 섹션이 하나도 없으면 비교 자체가 무의미 */
  briefEmpty: boolean;
  notes: BriefAdvisoryNote[];
}

/** 흔한 범용 기술 단어 — 브리프에 없어도 "신규 이름" 신호가 아니다. */
const STOPWORDS = new Set([
  'api', 'url', 'http', 'https', 'json', 'html', 'css', 'sql', 'jwt', 'ui', 'ux',
  'id', 'db', 'env', 'cli', 'sdk', 'npm', 'readme', 'todo', 'ok', 'byok',
  'github', 'docker', 'redis', 'postgres', 'sqlite', 'node', 'react', 'vite',
  'typescript', 'javascript', 'python', 'markdown', 'oauth', 'webhook',
]);

const PATTERNS: RegExp[] = [
  /(?:[A-Z][a-z0-9]+){2,}/g, // CamelCase (두 험프 이상 — Docker 같은 단일어 제외)
  /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g, // snake_case
  /\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+\b/g, // kebab-case
  /\b[\w.-]+\/[\w./-]+\b/g, // 경로 (a/b, src/lib/x.ts)
  /\b[\w-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|json|yml|yaml|toml|sql|css|html|md)\b/g, // 파일명
];

/** 마크다운 텍스트에서 식별자류 토큰을 뽑는다 (소문자 정규화). */
export function extractIdentifiers(text: string): Set<string> {
  const out = new Set<string>();
  const add = (raw: string) => {
    const t = raw.trim().replace(/^[`'".,;:()[\]{}]+|[`'".,;:()[\]{}]+$/g, '');
    if (t.length < 3 || t.length > 120) return;
    const key = t.toLowerCase();
    if (STOPWORDS.has(key)) return;
    if (/^\d/.test(key)) return;
    out.add(key);
  };
  // 코드 스팬은 통째로 하나의 "이름 주장" — 가장 강한 신호
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    const inner = m[1].trim();
    if (!/\s/.test(inner)) add(inner);
    // 공백이 있으면 명령·문장일 수 있으니 안의 토큰만 패턴으로 줍는다
  }
  const plain = text.replace(/```[\s\S]*?```/g, ' '); // 코드 블록 통짜 제외
  for (const re of PATTERNS) {
    for (const m of plain.matchAll(re)) add(m[0]);
  }
  return out;
}

/**
 * 기능 문서(제외되지 않은 섹션들)를 브리프(수락 섹션들)와 대조한다.
 * 브리프가 비어 있으면(수락 0) notes 를 내지 않고 briefEmpty 만 알린다.
 */
export function briefAdvisory(
  featureSections: SectionText[],
  briefSections: SectionText[],
): BriefAdvisoryResult {
  if (briefSections.length === 0) return { briefEmpty: true, notes: [] };

  const known = new Set<string>();
  for (const s of briefSections) {
    for (const t of extractIdentifiers(`${s.heading}\n${s.body}`)) known.add(t);
  }

  const where = new Map<string, Set<string>>();
  for (const s of featureSections) {
    for (const t of extractIdentifiers(s.body)) {
      if (known.has(t)) continue;
      if (!where.has(t)) where.set(t, new Set());
      where.get(t)!.add(s.heading);
    }
  }

  const notes = [...where.entries()]
    .map(([name, secs]) => ({ name, sections: [...secs] }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { briefEmpty: false, notes };
}

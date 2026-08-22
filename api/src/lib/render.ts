import { marked } from 'marked';
import * as repo from '../db/repos.ts';

marked.setOptions({ gfm: true, breaks: false });

export function documentToMarkdown(documentId: string): string {
  const doc = repo.getDocument(documentId);
  if (!doc) throw new Error('document not found');
  // Only ACCEPTED sections are the document (SYSTEM.md §0.2).
  const sections = repo.listAcceptedSections(documentId);
  const parts = [`# ${doc.title}`, ''];
  for (const s of sections) {
    parts.push(`## ${s.heading}`, '', s.body.trim(), '');
  }
  // 구조 문서(기능명세·IA·유저플로우)는 내용이 sections 가 아니라 plan_items 에 있다.
  // sections 만 렌더하면 제목만 나오므로, 수락된 항목을 마크다운으로 렌더한다.
  parts.push(structureItemsToMarkdown(documentId));
  const excluded = repo.countExcludedSections(documentId);
  if (excluded > 0) {
    parts.push('---', '', `> 검토 대기 ${excluded}개 제외`, '');
  }
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/** 수락된 plan_items 를 트리(그룹/부모 → 자식)로 마크다운 렌더. 항목이 없으면 빈 문자열. */
export function structureItemsToMarkdown(documentId: string): string {
  const items = repo.listItems(documentId).filter((i) => i.status === 'accepted');
  if (items.length === 0) return '';
  const byParent = new Map<string | null, typeof items>();
  for (const it of items) {
    const key = it.parent_id ?? null;
    (byParent.get(key) ?? byParent.set(key, []).get(key)!).push(it);
  }
  const roots = (byParent.get(null) ?? []).sort((a, b) => a.position - b.position);
  const lines: string[] = [];

  const linkLine = (it: (typeof items)[number]): string | null => {
    const m = repo.parsePlanItemMeta(it);
    const refs = [
      ...(m.links?.reqs ?? []),
      ...(m.links?.features ?? []),
      ...(m.links?.pages ?? []),
      ...(m.links?.flows ?? []),
    ];
    return refs.length ? `연결: ${refs.join(' · ')}` : null;
  };

  for (const root of roots) {
    const rm = repo.parsePlanItemMeta(root);
    const pri = rm.priority ? ` — ${rm.priority}` : '';
    lines.push('', `## ${root.ref_id} ${root.title}${pri}`, '');
    if (root.body.trim()) lines.push(root.body.trim(), '');
    const rl = linkLine(root);
    if (rl) lines.push(rl, '');

    const kids = (byParent.get(root.id) ?? []).sort((a, b) => a.position - b.position);
    kids.forEach((kid, idx) => {
      const km = repo.parsePlanItemMeta(kid);
      const kpri = km.priority ? ` — ${km.priority}` : '';
      // 스텝(플로우 자식)은 번호 목록, 그 외(기능 등)는 소제목으로
      if (kid.kind === 'step') {
        const page = km.page ? `[${km.page}] ` : '';
        const branch = km.branch?.label ? ` _(분기: ${km.branch.label})_` : '';
        lines.push(`${idx + 1}. ${page}${kid.title}${branch}`);
        if (km.note) lines.push(`   ${km.note}`);
      } else {
        lines.push(`### ${kid.ref_id} ${kid.title}${kpri}`, '');
        if (kid.body.trim()) lines.push(kid.body.trim(), '');
        const kl = linkLine(kid);
        if (kl) lines.push(kl, '');
      }
    });
    lines.push('');
  }
  return lines.join('\n');
}

/** Minimal sanitization: strip <script>/<iframe> and inline event handlers. */
function sanitize(html: string): string {
  return html
    .replace(/<\s*(script|iframe)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
}

export function documentToHtml(documentId: string, opts?: { readOnly?: boolean; print?: boolean }): string {
  const doc = repo.getDocument(documentId);
  if (!doc) throw new Error('document not found');
  // Only ACCEPTED sections are the document (SYSTEM.md §0.2).
  const sections = repo.listAcceptedSections(documentId);
  let body = sections
    .map(
      (s) =>
        `<section><h2>${escapeHtml(s.heading)}</h2>${sanitize(marked.parse(s.body) as string)}</section>`,
    )
    .join('\n');
  // 구조 문서 항목(plan_items)을 렌더 — sections 만 있으면 제목만 나오는 문제 방지
  const itemsMd = structureItemsToMarkdown(documentId);
  if (itemsMd.trim()) {
    body += `\n<section>${sanitize(marked.parse(itemsMd) as string)}</section>`;
  }
  const excluded = repo.countExcludedSections(documentId);
  const footnote =
    excluded > 0
      ? `<footer class="excluded">검토 대기 ${excluded}개 제외</footer>`
      : '';
  const badge = opts?.readOnly ? '<div class="ro">읽기 전용 공유</div>' : '';
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(doc.title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { max-width: 820px; margin: 0 auto; padding: 3rem 1.25rem 6rem;
         font: 16px/1.7 -apple-system, "Pretendard", "Segoe UI", system-ui, sans-serif;
         color: #17181c; background: #ffffff; }
  @media (prefers-color-scheme: dark) { body { color: #e7e7ea; background: #131315; } }
  h1 { font-size: 2rem; letter-spacing: -0.02em; margin-bottom: 0.25rem; }
  h2 { font-size: 1.25rem; margin-top: 2.4rem; padding-bottom: 0.3rem;
       border-bottom: 1px solid rgba(128,128,128,0.25); }
  section p { margin: 0.6rem 0; }
  code { background: rgba(128,128,128,0.15); padding: 0.1em 0.35em; border-radius: 4px; }
  blockquote { border-left: 3px solid #E03A2B; margin: 1rem 0; padding: 0.2rem 1rem; opacity: 0.85; }
  .ro { position: fixed; top: 0; left: 0; right: 0; text-align: center; font-size: 0.75rem;
        padding: 0.35rem; background: #E03A2B; color: #fff; letter-spacing: 0.05em; }
  .meta { color: #8a8a90; font-size: 0.85rem; margin-bottom: 2rem; }
  .excluded { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid rgba(128,128,128,0.25);
              color: #8a8a90; font-size: 0.8rem; }
  /* PDF(인쇄) 최적화 — 흰 배경 고정, 섹션 페이지 넘김 존중, 공유 배지 숨김 */
  @media print {
    body { color: #17181c; background: #fff; max-width: none; padding: 0; font-size: 12pt; }
    .ro { display: none; }
    section { break-inside: avoid; }
    h2 { break-after: avoid; }
    @page { margin: 18mm 16mm; }
  }
</style>
</head>
<body>
${badge}
<h1>${escapeHtml(doc.title)}</h1>
<div class="meta">${escapeHtml(doc.type)} · v${doc.version}</div>
${body}
${footnote}
${opts?.print ? '<script>window.addEventListener("load", () => setTimeout(() => window.print(), 250));</script>' : ''}
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

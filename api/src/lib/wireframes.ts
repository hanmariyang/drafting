// Derived wireframe render data (§5.1) — deterministic, AI-free. Input: accepted
// (and proposed, flagged) IA pages + their linked feature content + flow steps.
// Content is SEEDED from feature titles/bodies; hotspots (→ PG-nn) come from the
// flow. Same input → same output. The React <WireframeGrid> paints this shape.

import * as repo from '../db/repos.ts';
import { lintProject } from './lint.ts';
import type { PageType, PlanItem, PlanItemMeta } from './types.ts';

export interface WfHotspot {
  toPage: string;
  label: string;
}
export interface WfSeed {
  // union-ish bag; the renderer reads the field for the page_type
  search?: string;
  rows?: Array<{ title: string; meta: string; action: string; hot?: string }>;
  slots?: Array<{ label: string; state: 'on' | 'off' | 'dis' | 'idle' }>;
  detailTitle?: string;
  cta?: string;
  fields?: Array<{ label: string; value: string }>;
  stats?: Array<{ value: string; label: string }>;
  bars?: number[];
  toggles?: Array<{ label: string; on: boolean }>;
  blocks?: string[];
}
export interface Wireframe {
  ref: string;
  itemId: string;
  title: string;
  pageType: PageType;
  status: 'accepted' | 'proposed';
  featureRefs: string[];
  flowRefs: string[];
  hotspot: WfHotspot | null;
  lintWarning: string | null;
  seed: WfSeed;
}

function meta(i: PlanItem): PlanItemMeta {
  try {
    return JSON.parse(i.meta || '{}') as PlanItemMeta;
  } catch {
    return {};
  }
}
function bodyLines(i: PlanItem): string[] {
  return i.body
    .split('\n')
    .map((l) => l.replace(/^[·\-*]\s*/, '').trim())
    .filter(Boolean);
}

/**
 * Build a flat, wireframe-ready list for a project. Pages that are 'rejected' are
 * excluded; accepted + proposed pages are both included (proposed flagged so the
 * UI can dash them — mirrors the IA sitemap proposal).
 */
export function deriveWireframes(projectId: string): Wireframe[] {
  const items = repo.listProjectItems(projectId);
  const byRef = new Map<string, PlanItem>();
  for (const it of items) byRef.set(it.ref_id, it);

  // page ref -> outgoing hotspot (from consecutive page-bearing MAIN steps)
  const outgoing = new Map<string, string>();
  const flowsForPage = new Map<string, Set<string>>();
  const flowItems = items.filter((i) => i.kind === 'flow');
  for (const flow of flowItems) {
    const steps = items
      .filter((i) => i.kind === 'step' && i.parent_id === flow.id)
      .sort((a, b) => a.position - b.position);
    let prevPage: string | null = null;
    for (const st of steps) {
      const m = meta(st);
      if (m.branch) continue; // branch steps don't drive the main hotspot chain
      if (!m.page) continue;
      if (!flowsForPage.has(m.page)) flowsForPage.set(m.page, new Set());
      flowsForPage.get(m.page)!.add(flow.ref_id);
      if (prevPage && prevPage !== m.page && !outgoing.has(prevPage)) {
        outgoing.set(prevPage, m.page);
      }
      prevPage = m.page;
    }
  }

  const reqIds = repo.reqIdsForProject(projectId).map((r) => r.id);
  const violations = lintProject(items, reqIds);
  const pageWarning = new Map<string, string>();
  for (const v of violations) {
    if (v.code === 'W-UNREACHED-PAGE') pageWarning.set(v.refs[0], '이 화면에 도달하는 플로우 없음');
    else if (v.code === 'W-EMPTY-PAGE' && !pageWarning.has(v.refs[0]))
      pageWarning.set(v.refs[0], '연결된 기능 없음');
  }

  const pages = items
    .filter((i) => i.kind === 'page' && i.status !== 'rejected')
    .sort((a, b) => a.position - b.position);

  return pages.map((page) => {
    const m = meta(page);
    const featureRefs = m.links?.features ?? [];
    const features = featureRefs.map((r) => byRef.get(r)).filter((x): x is PlanItem => !!x);
    const toPage = outgoing.get(page.ref_id) ?? null;
    const hotspot: WfHotspot | null = toPage ? { toPage, label: `→ ${toPage}` } : null;
    return {
      ref: page.ref_id,
      itemId: page.id,
      title: page.title,
      pageType: (m.page_type ?? 'GENERIC') as PageType,
      status: page.status === 'accepted' ? 'accepted' : 'proposed',
      featureRefs,
      flowRefs: [...(flowsForPage.get(page.ref_id) ?? [])],
      hotspot,
      lintWarning: pageWarning.get(page.ref_id) ?? null,
      seed: seedFor((m.page_type ?? 'GENERIC') as PageType, page, features, hotspot),
    };
  });
}

function seedFor(type: PageType, page: PlanItem, features: PlanItem[], hotspot: WfHotspot | null): WfSeed {
  const labels = features.map((f) => f.title);
  const lines = features.flatMap((f) => bodyLines(f));
  const cta = hotspot ? '다음 단계로' : '확인';
  switch (type) {
    case 'LIST':
      return {
        search: `${page.title} 검색`,
        rows: (labels.length ? labels : [page.title]).slice(0, 3).map((t, i) => ({
          title: t,
          meta: `${i + 1}번`,
          action: i === 0 && hotspot ? '열기' : '보기',
          hot: i === 0 && hotspot ? hotspot.label : undefined,
        })),
      };
    case 'DETAIL':
      return {
        detailTitle: labels[0] ?? page.title,
        slots: ['옵션 A', '옵션 B', '옵션 C'].map((label, i) => ({
          label,
          state: i === 1 ? 'on' : i === 2 ? 'dis' : 'idle',
        })),
        blocks: lines.slice(0, 2),
        cta: hotspot ? `${cta}` : page.title,
      };
    case 'FORM':
      return {
        fields: (lines.length ? lines : labels).slice(0, 4).map((label, i) => ({
          label,
          value: i === 0 ? page.title : '입력값',
        })),
        cta: hotspot ? '제출' : '저장',
      };
    case 'DASH':
      return {
        stats: (labels.length ? labels : ['지표 A', '지표 B', '지표 C'])
          .slice(0, 3)
          .map((label, i) => ({ value: `${(i + 5) * 12}%`, label })),
        bars: [40, 65, 80, 55, 90],
      };
    case 'SETTINGS':
      return {
        toggles: (lines.length ? lines : labels).slice(0, 3).map((label, i) => ({
          label,
          on: i < 2,
        })),
      };
    default:
      return { blocks: lines.length ? lines : labels.length ? labels : [page.title] };
  }
}

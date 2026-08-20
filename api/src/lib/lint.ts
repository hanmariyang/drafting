// Consistency compiler (§4) — deterministic, AI-free. Pure function over plan
// items so it is exhaustively unit-testable. Only ACCEPTED items are checked.

import type { PlanItem, PlanItemMeta, PlanItemLinks } from './types.ts';

export type LintSeverity = 'E' | 'W';
export interface LintViolation {
  code: string;
  message: string;
  refs: string[]; // ref_ids the violation is about (first = subject)
  severity: LintSeverity;
}

function meta(item: PlanItem): PlanItemMeta {
  try {
    return JSON.parse(item.meta || '{}') as PlanItemMeta;
  } catch {
    return {};
  }
}
function links(item: PlanItem): PlanItemLinks {
  return meta(item).links ?? {};
}
function allLinkRefs(l: PlanItemLinks): string[] {
  return [...(l.reqs ?? []), ...(l.pages ?? []), ...(l.flows ?? []), ...(l.features ?? [])];
}

/**
 * Run rule v1 (6 rules) over a project's plan items. `reqIds` = the valid
 * REQ-nn ids derived from the PRD's accepted sections (§1.2).
 */
export function lintProject(items: PlanItem[], reqIds: string[]): LintViolation[] {
  const out: LintViolation[] = [];
  const reqSet = new Set(reqIds);
  const byRef = new Map<string, PlanItem>();
  for (const it of items) byRef.set(it.ref_id, it);
  const accepted = items.filter((i) => i.status === 'accepted');

  // ── E-DUP-REF: duplicate ref_id within the same document ──────────────────
  const seen = new Map<string, string>(); // `${doc}:${ref}` -> ref
  const dupped = new Set<string>();
  for (const it of accepted) {
    const key = `${it.document_id}:${it.ref_id}`;
    if (seen.has(key)) dupped.add(it.ref_id);
    else seen.set(key, it.ref_id);
  }
  for (const ref of dupped) {
    out.push({
      code: 'E-DUP-REF',
      message: `중복 ref_id "${ref}" — 같은 문서에 같은 번호가 둘 이상 있습니다.`,
      refs: [ref],
      severity: 'E',
    });
  }

  // ── E-BROKEN-REF: a link points at a ref that doesn't exist or is rejected ─
  for (const it of accepted) {
    for (const ref of allLinkRefs(links(it))) {
      let broken = false;
      if (/^REQ-/.test(ref)) {
        broken = !reqSet.has(ref);
      } else {
        const target = byRef.get(ref);
        broken = !target || target.status === 'rejected';
      }
      if (broken) {
        out.push({
          code: 'E-BROKEN-REF',
          message: `${it.ref_id} 이(가) 존재하지 않거나 거절된 ${ref} 를 참조합니다.`,
          refs: [it.ref_id, ref],
          severity: 'E',
        });
      }
    }
  }

  // ── W-ORPHAN-SPEC: accepted feature with zero reqs links ──────────────────
  for (const it of accepted) {
    if (it.kind !== 'feature') continue;
    if ((links(it).reqs ?? []).length === 0) {
      out.push({
        code: 'W-ORPHAN-SPEC',
        message: `${it.ref_id} "${it.title}" 이(가) 어느 요구(REQ)에도 연결되지 않았습니다.`,
        refs: [it.ref_id],
        severity: 'W',
      });
    }
  }

  // ── W-UNREACHED-PAGE: accepted page reached by no accepted step ───────────
  const reachedPages = new Set<string>();
  for (const it of accepted) {
    if (it.kind !== 'step') continue;
    const pg = meta(it).page;
    if (pg) reachedPages.add(pg);
  }
  for (const it of accepted) {
    if (it.kind !== 'page') continue;
    if (!reachedPages.has(it.ref_id)) {
      out.push({
        code: 'W-UNREACHED-PAGE',
        message: `${it.ref_id} "${it.title}" 에 도달하는 플로우 스텝이 없습니다.`,
        refs: [it.ref_id],
        severity: 'W',
      });
    }
  }

  // ── W-EMPTY-PAGE: accepted page with zero features links ──────────────────
  for (const it of accepted) {
    if (it.kind !== 'page') continue;
    if ((links(it).features ?? []).length === 0) {
      out.push({
        code: 'W-EMPTY-PAGE',
        message: `${it.ref_id} "${it.title}" 에 연결된 기능(F)이 없습니다.`,
        refs: [it.ref_id],
        severity: 'W',
      });
    }
  }

  // ── W-NO-FLOW: P0 accepted feature in no flow's links.features ────────────
  const featuresInFlows = new Set<string>();
  for (const it of accepted) {
    if (it.kind !== 'flow') continue;
    for (const f of links(it).features ?? []) featuresInFlows.add(f);
  }
  for (const it of accepted) {
    if (it.kind !== 'feature') continue;
    if (meta(it).priority !== 'P0') continue;
    if (!featuresInFlows.has(it.ref_id)) {
      out.push({
        code: 'W-NO-FLOW',
        message: `P0 기능 ${it.ref_id} "${it.title}" 이(가) 어느 플로우에도 등장하지 않습니다.`,
        refs: [it.ref_id],
        severity: 'W',
      });
    }
  }

  return out;
}

/** Stable de-dupe key for a violation (code + sorted refs) — used for waive/regression. */
export function violationKey(v: { code: string; refs: string[] }): string {
  return `${v.code}::${[...v.refs].sort().join(',')}`;
}

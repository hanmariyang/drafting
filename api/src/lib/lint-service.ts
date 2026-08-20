// Project-level lint orchestration over the DB (§4.2/§4.3). The pure rules live
// in lint.ts; this layer resolves items, turns violations into suggestions
// (proposal regression), honours waives, and computes the handoff gate set.

import * as repo from '../db/repos.ts';
import { lintProject, violationKey, type LintViolation } from './lint.ts';
import type { PlanItem } from './types.ts';

function projectItemsAndReqs(projectId: string): { items: PlanItem[]; reqIds: string[] } {
  const items = repo.listProjectItems(projectId);
  const reqIds = repo.reqIdsForProject(projectId).map((r) => r.id);
  return { items, reqIds };
}

/** All violations for a project. */
export function projectViolations(projectId: string): LintViolation[] {
  const { items, reqIds } = projectItemsAndReqs(projectId);
  return lintProject(items, reqIds);
}

/** Waived violation keys = lint suggestions rejected by the user (§4.3). */
export function waivedKeys(projectId: string): Set<string> {
  const keys = new Set<string>();
  for (const doc of repo.listDocuments(projectId)) {
    for (const s of repo.listLintSuggestions(doc.id, 'rejected')) {
      if (s.quote_before) keys.add(s.quote_before);
    }
  }
  return keys;
}

/** Violations that still block the handoff gate (all minus waived). */
export function effectiveViolations(projectId: string): LintViolation[] {
  const waived = waivedKeys(projectId);
  return projectViolations(projectId).filter((v) => !waived.has(violationKey(v)));
}

export interface LintReport {
  violations: Array<LintViolation & { key: string; waived: boolean }>;
  effectiveCount: number;
  waivedCount: number;
  gatePasses: boolean;
}

export function lintReport(projectId: string): LintReport {
  const waived = waivedKeys(projectId);
  const violations = projectViolations(projectId).map((v) => {
    const key = violationKey(v);
    return { ...v, key, waived: waived.has(key) };
  });
  const effectiveCount = violations.filter((v) => !v.waived).length;
  return {
    violations,
    effectiveCount,
    waivedCount: violations.length - effectiveCount,
    gatePasses: effectiveCount === 0,
  };
}

/** Which document should own a lint suggestion — the doc of its subject ref. */
function ownerDocId(projectId: string, refs: string[]): string | null {
  const items = repo.listProjectItems(projectId);
  for (const ref of refs) {
    const it = items.find((i) => i.ref_id === ref);
    if (it) return it.document_id;
  }
  // fall back to the feature-spec document
  const spec = repo.listDocuments(projectId).find((d) => d.type === 'feature-spec');
  return spec?.id ?? repo.listDocuments(projectId)[0]?.id ?? null;
}

// Code -> the two-choice card copy (초안이 voice, §4.2).
const FIX_COPY: Record<string, string> = {
  'E-BROKEN-REF': '끊긴 참조가 있어요. 대상 항목을 되살리거나 이 항목을 정리하세요.',
  'E-DUP-REF': '번호가 겹쳤어요. 항목을 정리하면 번호가 다시 정렬돼요.',
  'W-ORPHAN-SPEC': '이 기능이 어느 요구에도 연결되지 않았어요. 요구를 잇거나 기능을 정리하세요.',
  'W-UNREACHED-PAGE': '이 화면에 도달하는 플로우가 없어요. 플로우에 넣거나 화면을 정리하세요.',
  'W-EMPTY-PAGE': '이 화면에 연결된 기능이 없어요. 기능을 잇거나 화면을 정리하세요.',
  'W-NO-FLOW': '이 P0 기능이 어느 플로우에도 없어요. 플로우에 넣거나 우선순위를 낮추세요.',
};

/**
 * Regression (§4.2): create a lint suggestion for each current violation that
 * doesn't already have one (dedupe by code+refs → stored in quote_before). Skips
 * waived ones (their rejected suggestion already exists). Returns created rows.
 */
export function suggestLint(projectId: string): number {
  const existing = new Set<string>();
  for (const doc of repo.listDocuments(projectId)) {
    for (const s of repo.listLintSuggestions(doc.id)) {
      if (s.quote_before) existing.add(s.quote_before);
    }
  }
  let created = 0;
  for (const v of projectViolations(projectId)) {
    const key = violationKey(v);
    if (existing.has(key)) continue; // dedupe (open or already-resolved)
    const docId = ownerDocId(projectId, v.refs);
    if (!docId) continue;
    repo.createSuggestion({
      documentId: docId,
      kind: 'lint',
      title: `${v.refs[0]} · ${v.code}`,
      body: FIX_COPY[v.code] ?? v.message,
      quoteBefore: key, // dedupe / waive key
      quoteAfter: v.message,
      source: v.code,
    });
    existing.add(key);
    created++;
  }
  return created;
}

/**
 * Apply the default remediation when a lint suggestion is ACCEPTED (§4.2): the
 * subject item (refs[0]) is rejected, which deterministically clears the
 * violation on the next lint. REQ-only subjects have no item — nothing to do.
 */
export function applyLintFix(projectId: string, subjectRef: string): void {
  const items = repo.listProjectItems(projectId);
  const subject = items.find((i) => i.ref_id === subjectRef);
  if (subject) repo.setItemStatus(subject.id, 'rejected');
}

/** Same, resolved by violation key (code::sortedRefs) — used on suggestion accept. */
export function applyLintFixByKey(projectId: string, key: string): void {
  const v = projectViolations(projectId).find((x) => violationKey(x) === key);
  if (v) applyLintFix(projectId, v.refs[0]);
}

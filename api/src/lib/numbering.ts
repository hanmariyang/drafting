// Server-side ref_id assignment (§1.2). The LLM NEVER produces ref_ids — this
// module is the single source of truth. Rule: max existing number of that kind
// (or of that parent's children) + 1. Deleted numbers are NOT reused because we
// take max, never count. Pure functions — fully unit-tested.

import type { PlanItem, PlanItemKind } from './types.ts';

/** Just the fields the numbering needs — keeps callers/tests light. */
export interface RefRow {
  kind: PlanItemKind;
  ref_id: string;
  parent_id?: string | null;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Highest F-/PG-/FLOW- top-level number among rows of `kind`. 0 if none. */
function maxTopNumber(rows: RefRow[], kind: PlanItemKind, prefix: RegExp): number {
  let max = 0;
  for (const r of rows) {
    if (r.kind !== kind) continue;
    const m = r.ref_id.match(prefix);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

/** Highest child suffix under a given parent ref (feature/step). 0 if none. */
function maxChildNumber(rows: RefRow[], parentRef: string, sep: '-' | '.'): number {
  // Escape regex metacharacters in the parent ref (e.g. the '.' in FLOW-01).
  const esc = parentRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${esc}${sep === '.' ? '\\.' : '-'}(\\d+)$`);
  let max = 0;
  for (const r of rows) {
    const m = r.ref_id.match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

export function nextGroupRef(rows: RefRow[]): string {
  return `F-${pad2(maxTopNumber(rows, 'feature-group', /^F-(\d+)$/) + 1)}`;
}

export function nextFeatureRef(rows: RefRow[], groupRef: string): string {
  return `${groupRef}-${maxChildNumber(rows, groupRef, '-') + 1}`;
}

export function nextPageRef(rows: RefRow[]): string {
  return `PG-${pad2(maxTopNumber(rows, 'page', /^PG-(\d+)$/) + 1)}`;
}

export function nextFlowRef(rows: RefRow[]): string {
  return `FLOW-${pad2(maxTopNumber(rows, 'flow', /^FLOW-(\d+)$/) + 1)}`;
}

export function nextStepRef(rows: RefRow[], flowRef: string): string {
  return `${flowRef}.${maxChildNumber(rows, flowRef, '.') + 1}`;
}

/**
 * Assign the next ref_id for a new item of `kind`. `parentRef` is required for
 * feature (its group's ref) and step (its flow's ref).
 */
export function nextRefId(
  rows: RefRow[],
  kind: PlanItemKind,
  parentRef?: string | null,
): string {
  switch (kind) {
    case 'feature-group':
      return nextGroupRef(rows);
    case 'feature':
      if (!parentRef) throw new Error('feature requires a parent group ref');
      return nextFeatureRef(rows, parentRef);
    case 'page':
      return nextPageRef(rows);
    case 'flow':
      return nextFlowRef(rows);
    case 'step':
      if (!parentRef) throw new Error('step requires a parent flow ref');
      return nextStepRef(rows, parentRef);
    default:
      throw new Error(`unknown plan item kind: ${kind as string}`);
  }
}

/** Narrow a PlanItem[] to the RefRow shape the numbering functions consume. */
export function toRefRows(items: PlanItem[]): RefRow[] {
  return items.map((i) => ({ kind: i.kind, ref_id: i.ref_id, parent_id: i.parent_id }));
}

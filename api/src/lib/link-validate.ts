// Link-ref validation at write time (routes + MCP). Pure over plan items so it
// is unit-testable like lint.ts. Layered with the compile lint: this catches
// typos when the target universe already exists; E-BROKEN-REF remains the
// compile-time integrity net for everything else.
//
// Forward references are legitimate: the authoring chain writes feature-spec
// before IA, so a feature may link PG-nn pages that do not exist yet. Rule:
// if the project has NO candidates of the target kind, skip validation
// (forward authoring); if candidates exist and the ref matches none of them,
// it is a typo — reject with the valid list.

import type { PlanItem, PlanItemLinks } from './types.ts';

export type LinkField = keyof PlanItemLinks; // 'reqs' | 'pages' | 'flows' | 'features'

const KINDS_FOR: Record<Exclude<LinkField, 'reqs'>, ReadonlyArray<PlanItem['kind']>> = {
  pages: ['page'],
  flows: ['flow'],
  features: ['feature', 'feature-group'],
};

/** Valid (linkable) refs for a field — rejected items are excluded, matching E-BROKEN-REF. */
export function validRefsFor(field: LinkField, items: PlanItem[], reqIds: string[]): string[] {
  if (field === 'reqs') return reqIds;
  const kinds = KINDS_FOR[field];
  return items
    .filter((i) => i.status !== 'rejected' && kinds.includes(i.kind))
    .map((i) => i.ref_id)
    .filter(Boolean);
}

export interface LinkRefError {
  field: LinkField;
  ref: string;
  valid: string[];
}

/**
 * Returns the refs that are certainly wrong. Empty target universe → nothing
 * to check against (forward authoring) → no errors for that field.
 */
export function checkLinkRefs(
  linksByField: Partial<Record<LinkField, string[]>>,
  items: PlanItem[],
  reqIds: string[],
): LinkRefError[] {
  const out: LinkRefError[] = [];
  for (const [field, refs] of Object.entries(linksByField) as Array<[LinkField, string[]]>) {
    if (!refs?.length) continue;
    const valid = validRefsFor(field, items, reqIds);
    if (valid.length === 0) continue; // forward reference — lint checks later
    const set = new Set(valid);
    for (const ref of refs) {
      if (!set.has(ref)) out.push({ field, ref, valid });
    }
  }
  return out;
}

/** One-line human message for a write-time rejection. */
export function linkRefErrorMessage(errors: LinkRefError[]): string {
  return errors
    .map((e) => {
      const shown = e.valid.slice(0, 20).join(', ');
      const more = e.valid.length > 20 ? ` 외 ${e.valid.length - 20}개` : '';
      return `알 수 없는 ${e.field} ref "${e.ref}" — 유효한 ref: ${shown}${more}`;
    })
    .join(' / ');
}

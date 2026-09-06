import './setup.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLinkRefs, validRefsFor, linkRefErrorMessage } from '../src/lib/link-validate.ts';
import type { PlanItem, PlanItemKind, PlanItemMeta } from '../src/lib/types.ts';

let seq = 0;
function item(
  kind: PlanItemKind,
  ref: string,
  meta: PlanItemMeta = {},
  status: PlanItem['status'] = 'accepted',
  doc = 'D1',
): PlanItem {
  const ts = String(seq++);
  return {
    id: `i${ts}`,
    document_id: doc,
    parent_id: null,
    kind,
    ref_id: ref,
    position: seq,
    title: ref,
    body: '',
    meta: JSON.stringify(meta),
    status,
    created_at: ts,
    updated_at: ts,
  };
}

const ITEMS = [
  item('feature-group', 'F-01'),
  item('feature', 'F-01-1'),
  item('page', 'PG-01', {}, 'accepted', 'D2'),
  item('page', 'PG-99', {}, 'rejected', 'D2'),
  item('flow', 'FLOW-01', {}, 'proposed', 'D3'),
];
const REQS = ['REQ-01', 'REQ-02'];

test('link-validate · 유효 ref 는 통과한다 (proposed 포함, rejected 제외)', () => {
  assert.equal(checkLinkRefs({ features: ['F-01', 'F-01-1'] }, ITEMS, REQS).length, 0);
  assert.equal(checkLinkRefs({ flows: ['FLOW-01'] }, ITEMS, REQS).length, 0); // proposed 도 링크 가능
  assert.equal(checkLinkRefs({ reqs: ['REQ-02'] }, ITEMS, REQS).length, 0);
  assert.deepEqual(validRefsFor('pages', ITEMS, REQS), ['PG-01']); // rejected PG-99 제외
});

test('link-validate · 후보가 있는데 안 맞으면 오타로 거절한다', () => {
  const errs = checkLinkRefs({ features: ['F-1'], pages: ['PG-02'] }, ITEMS, REQS);
  assert.equal(errs.length, 2);
  assert.equal(errs[0].field, 'features');
  assert.equal(errs[0].ref, 'F-1');
  const msg = linkRefErrorMessage(errs);
  assert.match(msg, /알 수 없는 features ref "F-1"/);
  assert.match(msg, /F-01, F-01-1/); // 유효 목록 안내
});

test('link-validate · rejected 항목을 가리키면 거절한다 (E-BROKEN-REF 와 정합)', () => {
  const errs = checkLinkRefs({ pages: ['PG-99'] }, ITEMS, REQS);
  assert.equal(errs.length, 1);
  assert.equal(errs[0].ref, 'PG-99');
});

test('link-validate · 대상 후보가 하나도 없으면 정방향 작성으로 보고 통과한다', () => {
  const noPages = ITEMS.filter((i) => i.kind !== 'page');
  assert.equal(checkLinkRefs({ pages: ['PG-05'] }, noPages, REQS).length, 0);
  assert.equal(checkLinkRefs({ reqs: ['REQ-01'] }, ITEMS, []).length, 0); // PRD 수락분 없음
});

test('link-validate · REQ 는 PRD 수락분 파생 목록만 유효하다', () => {
  const errs = checkLinkRefs({ reqs: ['REQ-09'] }, ITEMS, REQS);
  assert.equal(errs.length, 1);
  assert.equal(errs[0].field, 'reqs');
});

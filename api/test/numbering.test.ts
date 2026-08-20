import './setup.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextRefId,
  nextGroupRef,
  nextFeatureRef,
  nextPageRef,
  nextFlowRef,
  nextStepRef,
  type RefRow,
} from '../src/lib/numbering.ts';

function row(kind: RefRow['kind'], ref: string): RefRow {
  return { kind, ref_id: ref };
}

test('numbering is per-kind and zero-padded at top level', () => {
  assert.equal(nextGroupRef([]), 'F-01');
  assert.equal(nextPageRef([]), 'PG-01');
  assert.equal(nextFlowRef([]), 'FLOW-01');

  const rows = [
    row('feature-group', 'F-01'),
    row('feature-group', 'F-02'),
    row('page', 'PG-01'),
    row('flow', 'FLOW-01'),
  ];
  assert.equal(nextGroupRef(rows), 'F-03');
  assert.equal(nextPageRef(rows), 'PG-02');
  assert.equal(nextFlowRef(rows), 'FLOW-02');
});

test('feature/step numbering is scoped to the parent ref', () => {
  const rows = [
    row('feature', 'F-01-1'),
    row('feature', 'F-01-2'),
    row('feature', 'F-02-1'),
    row('step', 'FLOW-01.1'),
    row('step', 'FLOW-01.2'),
  ];
  assert.equal(nextFeatureRef(rows, 'F-01'), 'F-01-3');
  assert.equal(nextFeatureRef(rows, 'F-02'), 'F-02-2');
  assert.equal(nextFeatureRef(rows, 'F-03'), 'F-03-1');
  assert.equal(nextStepRef(rows, 'FLOW-01'), 'FLOW-01.3');
  assert.equal(nextStepRef(rows, 'FLOW-02'), 'FLOW-02.1');
});

test('deleted numbers are NOT reused (max+1, never count+1)', () => {
  // F-02 was deleted; the max is still F-03 so the next is F-04
  const rows = [row('feature-group', 'F-01'), row('feature-group', 'F-03')];
  assert.equal(nextGroupRef(rows), 'F-04');

  const feats = [row('feature', 'F-01-1'), row('feature', 'F-01-3')];
  assert.equal(nextFeatureRef(feats, 'F-01'), 'F-01-4');
});

test('nextRefId dispatches and enforces parent presence', () => {
  assert.equal(nextRefId([], 'feature-group'), 'F-01');
  assert.equal(nextRefId([], 'page'), 'PG-01');
  assert.equal(nextRefId([], 'flow'), 'FLOW-01');
  assert.equal(nextRefId([], 'feature', 'F-01'), 'F-01-1');
  assert.equal(nextRefId([], 'step', 'FLOW-01'), 'FLOW-01.1');
  assert.throws(() => nextRefId([], 'feature'));
  assert.throws(() => nextRefId([], 'step'));
});

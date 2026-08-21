import './setup.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './setup.ts';
import * as repo from '../src/db/repos.ts';
import { lintProject, violationKey } from '../src/lib/lint.ts';
import { parseItemsJson, extractJson, streamItemsGeneration, type ItemGenEvent } from '../src/lib/items-gen.ts';
import { deriveWireframes } from '../src/lib/wireframes.ts';
import {
  effectiveViolations,
  suggestLint,
  lintReport,
  applyLintFixByKey,
} from '../src/lib/lint-service.ts';
import { compileHandoff, promptPack, HandoffGateError } from '../src/lib/handoff.ts';
import { seedDeliverables, hubSnapshot } from '../src/routes/deliverables.ts';
import type { PlanItem, PlanItemKind, PlanItemMeta } from '../src/lib/types.ts';

// ── lint fixtures (plain objects — pure function) ─────────────────────────────
let seq = 0;
function item(
  kind: PlanItemKind,
  ref: string,
  meta: PlanItemMeta,
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

test('lint · E-BROKEN-REF fires on missing or rejected link target', () => {
  const items = [
    item('feature', 'F-01-1', { priority: 'P1', links: { reqs: ['REQ-01'], pages: ['PG-99'] } }),
    item('page', 'PG-01', { page_type: 'LIST', links: { features: ['F-01-1'] } }),
  ];
  const v = lintProject(items, ['REQ-01']);
  assert.ok(v.some((x) => x.code === 'E-BROKEN-REF' && x.refs.includes('PG-99')));
});

test('lint · E-DUP-REF fires on duplicate ref in one document', () => {
  const items = [
    item('page', 'PG-01', { page_type: 'LIST', links: { features: ['F-1'] } }),
    item('page', 'PG-01', { page_type: 'LIST', links: { features: ['F-1'] } }),
    item('feature', 'F-1', { priority: 'P1', links: { reqs: ['REQ-01'] } }),
  ];
  const v = lintProject(items, ['REQ-01']);
  assert.ok(v.some((x) => x.code === 'E-DUP-REF' && x.refs.includes('PG-01')));
});

test('lint · W-ORPHAN-SPEC fires on a feature with no reqs', () => {
  const items = [item('feature', 'F-01-1', { priority: 'P2', links: {} })];
  const v = lintProject(items, []);
  assert.ok(v.some((x) => x.code === 'W-ORPHAN-SPEC' && x.refs[0] === 'F-01-1'));
});

test('lint · W-UNREACHED-PAGE + W-EMPTY-PAGE', () => {
  const items = [
    item('page', 'PG-01', { page_type: 'LIST', links: { features: [] } }), // empty + unreached
    item('flow', 'FLOW-01', { links: {} }),
  ];
  const v = lintProject(items, []);
  assert.ok(v.some((x) => x.code === 'W-UNREACHED-PAGE' && x.refs[0] === 'PG-01'));
  assert.ok(v.some((x) => x.code === 'W-EMPTY-PAGE' && x.refs[0] === 'PG-01'));
});

test('lint · W-NO-FLOW fires for a P0 feature absent from all flows', () => {
  const items = [
    item('feature', 'F-01-1', { priority: 'P0', links: { reqs: ['REQ-01'] } }),
    item('flow', 'FLOW-01', { links: { features: ['F-02-1'] } }),
  ];
  const v = lintProject(items, ['REQ-01']);
  assert.ok(v.some((x) => x.code === 'W-NO-FLOW' && x.refs[0] === 'F-01-1'));
});

test('lint · only accepted items are checked', () => {
  const items = [item('feature', 'F-01-1', { priority: 'P2', links: {} }, 'proposed')];
  assert.equal(lintProject(items, []).length, 0);
});

// ── lenient JSON parser (§2) ──────────────────────────────────────────────────
test('parseItemsJson tolerates code fences and trailing prose', () => {
  const withFence = '```json\n{"groups":[]}\n```';
  assert.deepEqual(parseItemsJson(withFence), { groups: [] });
  const withProse = '여기 결과입니다:\n{"pages":[{"title":"홈"}]}\n이상입니다.';
  assert.deepEqual((parseItemsJson(withProse) as { pages: unknown[] }).pages.length, 1);
  assert.equal(extractJson('{"a":1}').trim(), '{"a":1}');
  assert.throws(() => parseItemsJson('not json at all'));
});

// ── items generation e2e (stub) ───────────────────────────────────────────────
async function collect(gen: AsyncGenerator<ItemGenEvent>): Promise<ItemGenEvent[]> {
  const out: ItemGenEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

test('streamItemsGeneration (stub) creates proposed items + suggestions', async () => {
  freshDb();
  const project = repo.createProject('P');
  const prd = repo.createDocument({ projectId: project.id, type: 'prd', title: 'PRD' });
  const spec = repo.createDocument({
    projectId: project.id,
    type: 'feature-spec',
    title: 'SPEC',
    parentDocumentId: prd.id,
  });

  const events = await collect(streamItemsGeneration(spec.id));
  assert.ok(events.some((e) => e.type === 'done'));
  const items = repo.listItems(spec.id);
  assert.ok(items.length >= 6, 'groups + features');
  assert.ok(items.every((i) => i.status === 'proposed'), 'all proposed (§0.1)');
  // server-assigned refs, never from the LLM
  assert.ok(items.some((i) => i.ref_id === 'F-01'));
  assert.ok(items.some((i) => i.ref_id === 'F-01-1'));
  // each item carries a proposal (except steps)
  const open = repo.listSuggestions(spec.id, 'open');
  assert.ok(open.length >= 6);
  assert.ok(open.every((s) => s.target_item_id));
});

// ── seeded demo: hotspots, hub, handoff gate ─────────────────────────────────
test('deriveWireframes maps flow order into page hotspots (§5.1)', () => {
  freshDb();
  const pid = seedDeliverables();
  const wfs = deriveWireframes(pid);
  const pg01 = wfs.find((w) => w.ref === 'PG-01')!;
  assert.equal(pg01.hotspot?.toPage, 'PG-02', 'PG-01 → PG-02 from FLOW-01');
  const pg05 = wfs.find((w) => w.ref === 'PG-05')!;
  assert.equal(pg05.lintWarning, '이 화면에 도달하는 플로우 없음');
  // page content seeded from linked features (deterministic)
  const pg02 = wfs.find((w) => w.ref === 'PG-02')!;
  assert.ok(pg02.featureRefs.includes('F-01-1'));
});

test('hub aggregates the 6 deliverables', () => {
  freshDb();
  const pid = seedDeliverables();
  const hub = hubSnapshot(pid);
  assert.equal(hub.perDoc.prd.accepted, 4);
  assert.ok(hub.perDoc['feature-spec'].accepted >= 6);
  assert.equal(hub.perDoc.ia.accepted, 6);
  assert.equal(hub.derived.wireframes.count, 6);
  // seed intentionally carries 2 warnings (orphan + unreached) → handoff locked
  assert.equal(hub.derived.handoff.locked, true);
  assert.equal(hub.lint.effectiveCount, 2);
});

test('handoff gate blocks until violations are waived (§6/§4.3)', async () => {
  freshDb();
  const pid = seedDeliverables();
  assert.equal(effectiveViolations(pid).length, 2);

  // regression: turn violations into lint suggestions (dedup on re-run)
  const created = suggestLint(pid);
  assert.equal(created, 2);
  assert.equal(suggestLint(pid), 0, 'dedupe by code+refs');

  // compiling now still throws the gate error
  await assert.rejects(compileHandoff(pid), (e) => e instanceof HandoffGateError);

  // waive both (reject the lint suggestions across all docs)
  for (const doc of repo.listDocuments(pid)) {
    for (const s of repo.listLintSuggestions(doc.id, 'open')) repo.resolveSuggestion(s.id, 'rejected');
  }
  assert.equal(effectiveViolations(pid).length, 0);
  assert.equal(lintReport(pid).gatePasses, true);

  // now it compiles into a handoff document
  const { documentId } = await compileHandoff(pid);
  const doc = repo.getDocument(documentId)!;
  assert.equal(doc.type, 'handoff');
  // §1 개요 is a proposal; the deterministic skeleton is accepted
  const sections = repo.listSections(documentId);
  assert.equal(sections[0].status, 'proposed');
  assert.ok(sections.slice(1).every((s) => s.status === 'accepted'));

  // prompt pack carries the "accepted only" header
  const pack = promptPack(pid);
  assert.match(pack, /수락된 항목만 구현하라/);
});

test('accepting a lint suggestion applies the default fix (§4.2)', () => {
  freshDb();
  const pid = seedDeliverables();
  suggestLint(pid);
  const specDoc = repo.listDocuments(pid).find((d) => d.type === 'feature-spec')!;
  const orphan = repo
    .listLintSuggestions(specDoc.id, 'open')
    .find((s) => s.source === 'W-ORPHAN-SPEC');
  assert.ok(orphan, 'orphan lint suggestion exists');
  // applying the fix rejects the subject item → that violation clears
  applyLintFixByKey(pid, orphan!.quote_before);
  const remaining = effectiveViolations(pid);
  assert.ok(!remaining.some((v) => v.code === 'W-ORPHAN-SPEC'), 'orphan cleared');
});

test('violationKey is stable regardless of ref order', () => {
  assert.equal(
    violationKey({ code: 'E-BROKEN-REF', refs: ['F-01', 'PG-02'] }),
    violationKey({ code: 'E-BROKEN-REF', refs: ['PG-02', 'F-01'] }),
  );
});

test('rejected 구조 항목은 restore 로 되살아난다 (본문 보존)', () => {
  freshDb();
  const project = repo.createProject('P');
  const doc = repo.createDocument({ projectId: project.id, type: 'feature-spec', title: 'Spec' });
  const it = repo.createItem({ documentId: doc.id, kind: 'feature-group', title: '퍼스널 캐릭터 시스템', body: '본문', status: 'accepted' });
  repo.setItemStatus(it.id, 'rejected');
  assert.equal(repo.getItem(it.id)!.status, 'rejected');
  // restore endpoint 의 동작 = proposed 로 복귀
  const restored = repo.setItemStatus(it.id, 'proposed');
  assert.equal(restored!.status, 'proposed');
  assert.equal(restored!.body, '본문', '본문 손실 없음');
});

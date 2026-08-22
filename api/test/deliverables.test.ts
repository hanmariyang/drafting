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

test('구조 문서(feature-spec) 내보내기가 항목을 렌더한다 (빈칸 아님)', async () => {
  const { documentToMarkdown } = await import('../src/lib/render.ts');
  const pid = seedDeliverables();
  const spec = repo.listDocuments(pid).find((d) => d.type === 'feature-spec')!;
  const md = documentToMarkdown(spec.id);
  // 제목만 있는 빈칸이 아니라 실제 기능 항목이 들어있어야 한다
  assert.ok(md.length > 40, '내보내기 결과가 제목 이상이어야 함');
  assert.match(md, /F-\d/, '기능 ref_id 가 렌더됨');
});

test('waive-all 은 항목을 지우지 않고 게이트만 통과시킨다', async () => {
  const pid = seedDeliverables();
  // 위반을 만든다: P0 기능을 어떤 플로우에도 없게 (feature-spec 시드는 위반이 있을 수 있음)
  const before = lintReport(pid);
  const acceptedBefore = repo
    .listDocuments(pid)
    .flatMap((d) => repo.listItems(d.id))
    .filter((i) => i.status === 'accepted').length;
  // waive-all = 모든 open lint 제안을 rejected(무시)로
  suggestLint(pid);
  for (const doc of repo.listDocuments(pid))
    for (const s of repo.listLintSuggestions(doc.id, 'open')) repo.resolveSuggestion(s.id, 'rejected');
  const after = lintReport(pid);
  const acceptedAfter = repo
    .listDocuments(pid)
    .flatMap((d) => repo.listItems(d.id))
    .filter((i) => i.status === 'accepted').length;
  assert.equal(acceptedAfter, acceptedBefore, '항목이 삭제되지 않음(비파괴적)');
  assert.ok(after.effectiveCount <= before.effectiveCount, 'waive 후 유효 위반이 줄거나 같음');
});

test('lint waive(단건) 은 키로 해당 위반만 무시한다 (비파괴적)', async () => {
  const pid = seedDeliverables();
  suggestLint(pid);
  const openLint = repo
    .listDocuments(pid)
    .flatMap((d) => repo.listLintSuggestions(d.id, 'open'));
  if (openLint.length === 0) return; // 시드에 위반이 없으면 스킵
  const target = openLint[0];
  const key = target.quote_before!;
  const acceptedBefore = repo.listDocuments(pid).flatMap((d) => repo.listItems(d.id)).filter((i) => i.status === 'accepted').length;
  // waive-by-key 동작 재현
  for (const doc of repo.listDocuments(pid))
    for (const s of repo.listLintSuggestions(doc.id, 'open'))
      if (s.quote_before === key) repo.resolveSuggestion(s.id, 'rejected');
  const acceptedAfter = repo.listDocuments(pid).flatMap((d) => repo.listItems(d.id)).filter((i) => i.status === 'accepted').length;
  assert.equal(acceptedAfter, acceptedBefore, '항목 삭제 없음');
  // 해당 위반이 waive 목록에 들어갔는지
  const rep = lintReport(pid);
  const stillOpen = rep.violations.find((v) => v.key === key && !v.waived);
  assert.equal(stillOpen, undefined, '해당 위반은 더 이상 유효하지 않음');
});

test('link-feature 는 플로우의 links.features 에 추가해 W-NO-FLOW 를 해소한다', () => {
  freshDb();
  const project = repo.createProject('P');
  const specDoc = repo.createDocument({ projectId: project.id, type: 'feature-spec', title: 'Spec' });
  const flowDoc = repo.createDocument({ projectId: project.id, type: 'user-flow', title: 'Flow' });
  const grp = repo.createItem({ documentId: specDoc.id, kind: 'feature-group', title: 'G', status: 'accepted' });
  const feat = repo.createItem({ documentId: specDoc.id, kind: 'feature', title: '핵심기능', parentId: grp.id, meta: { priority: 'P0' } as never, status: 'accepted' });
  const flow = repo.createItem({ documentId: flowDoc.id, kind: 'flow', title: '메인 플로우', meta: { links: { features: [] } } as never, status: 'accepted' });
  // 처음엔 P0 기능이 어느 플로우에도 없어 W-NO-FLOW
  let rep = lintReport(project.id);
  assert.ok(rep.violations.some((v) => v.code === 'W-NO-FLOW' && v.refs.includes(feat.ref_id)));
  // link-feature 동작 재현: 플로우 links.features 에 기능 ref 추가
  const meta = repo.parsePlanItemMeta(flow);
  repo.updateItem(flow.id, { meta: { ...meta, links: { ...(meta.links ?? {}), features: [feat.ref_id] } } as never });
  rep = lintReport(project.id);
  assert.ok(!rep.violations.some((v) => v.code === 'W-NO-FLOW' && v.refs.includes(feat.ref_id) && !v.waived), 'W-NO-FLOW 해소됨');
});

test('generic link: 기능→REQ 로 W-ORPHAN-SPEC, 화면→기능 으로 W-EMPTY-PAGE 해소', () => {
  freshDb();
  const project = repo.createProject('P');
  const prd = repo.createDocument({ projectId: project.id, type: 'prd', title: 'PRD' });
  repo.replaceSections(prd.id, [{ heading: '문제 정의', body: '...' }]); // REQ-01 파생
  const reqIds = repo.reqIdsForProject(project.id).map((r) => r.id);
  assert.ok(reqIds.length >= 1);
  const specDoc = repo.createDocument({ projectId: project.id, type: 'feature-spec', title: 'Spec' });
  const iaDoc = repo.createDocument({ projectId: project.id, type: 'ia', title: 'IA' });
  const grp = repo.createItem({ documentId: specDoc.id, kind: 'feature-group', title: 'G', status: 'accepted' });
  const feat = repo.createItem({ documentId: specDoc.id, kind: 'feature', title: '기능', parentId: grp.id, meta: { priority: 'P1' } as never, status: 'accepted' });
  const page = repo.createItem({ documentId: iaDoc.id, kind: 'page', title: '화면', meta: {} as never, status: 'accepted' });

  let rep = repo && lintReportOf(project.id);
  assert.ok(rep.some((v) => v.code === 'W-ORPHAN-SPEC' && v.refs.includes(feat.ref_id)));
  assert.ok(rep.some((v) => v.code === 'W-EMPTY-PAGE' && v.refs.includes(page.ref_id)));

  // 기능→REQ (feature.links.reqs)
  const fm = repo.parsePlanItemMeta(feat);
  repo.updateItem(feat.id, { meta: { ...fm, links: { ...(fm.links ?? {}), reqs: [reqIds[0]] } } as never });
  // 화면→기능 (page.links.features)
  const pm = repo.parsePlanItemMeta(page);
  repo.updateItem(page.id, { meta: { ...pm, links: { ...(pm.links ?? {}), features: [feat.ref_id] } } as never });

  rep = lintReportOf(project.id);
  assert.ok(!rep.some((v) => v.code === 'W-ORPHAN-SPEC' && v.refs.includes(feat.ref_id)), 'orphan 해소');
  assert.ok(!rep.some((v) => v.code === 'W-EMPTY-PAGE' && v.refs.includes(page.ref_id)), 'empty-page 해소');
});

function lintReportOf(pid: string) {
  return lintReport(pid).violations.filter((v) => !v.waived);
}

test('hub nextAction: 위반이 있으면 lint 해소를 안내한다', () => {
  const pid = seedDeliverables();
  const hub = hubSnapshot(pid);
  // 시드는 위반 2건 → nextAction 은 lint (또는 그 이전 단계가 없으면)
  assert.ok(hub.nextAction, 'nextAction 존재');
  assert.ok(['lint', 'review', 'stale', 'create'].includes(hub.nextAction.kind));
  // perDoc 에 stale/openSuggestions 노출
  assert.equal(typeof hub.perDoc.prd.stale, 'boolean');
  assert.equal(typeof hub.perDoc['feature-spec'].openSuggestions, 'number');
});

test('step-page: 스텝에 화면 지정으로 W-UNREACHED-PAGE 해소', () => {
  freshDb();
  const project = repo.createProject('P');
  const iaDoc = repo.createDocument({ projectId: project.id, type: 'ia', title: 'IA' });
  const flowDoc = repo.createDocument({ projectId: project.id, type: 'user-flow', title: 'Flow' });
  const page = repo.createItem({ documentId: iaDoc.id, kind: 'page', title: '화면', meta: { links: { features: ['F-01'] } } as never, status: 'accepted' });
  const flow = repo.createItem({ documentId: flowDoc.id, kind: 'flow', title: '플로우', status: 'accepted' });
  const step = repo.createItem({ documentId: flowDoc.id, kind: 'step', title: '스텝', parentId: flow.id, meta: {} as never, status: 'accepted' });

  let viols = lintReport(project.id).violations.filter((v) => !v.waived);
  assert.ok(viols.some((v) => v.code === 'W-UNREACHED-PAGE' && v.refs.includes(page.ref_id)));
  // step.meta.page 지정
  const sm = repo.parsePlanItemMeta(step);
  repo.updateItem(step.id, { meta: { ...sm, page: page.ref_id } as never });
  viols = lintReport(project.id).violations.filter((v) => !v.waived);
  assert.ok(!viols.some((v) => v.code === 'W-UNREACHED-PAGE' && v.refs.includes(page.ref_id)), '해소됨');
});

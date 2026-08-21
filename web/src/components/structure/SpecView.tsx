import { useCallback, useEffect, useState } from 'react';
import { api, parseItemMeta, type PlanItem, type LintViolation, type Priority } from '../../lib/api.ts';

interface Props {
  projectId: string;
  items: PlanItem[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onAccept: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  generating: boolean;
  onRegenerate: () => void;
  onChanged?: () => void;
}

const PRIORITY_CYCLE: Priority[] = ['P0', 'P1', 'P2'];

export function SpecView({ projectId, items, selected, onSelect, onAccept, onReject, onChanged }: Props) {
  const [violByRef, setViolByRef] = useState<Map<string, LintViolation>>(new Map());
  const [effective, setEffective] = useState(0);

  const refetchLint = useCallback(() => {
    api
      .lint(projectId)
      .then((r) => {
        const m = new Map<string, LintViolation>();
        for (const v of r.violations) if (!v.waived) m.set(v.refs[0], v);
        setViolByRef(m);
        setEffective(r.effectiveCount);
      })
      .catch(() => {});
  }, [projectId]);

  useEffect(() => {
    refetchLint();
  }, [refetchLint, items]);

  // 우선순위 변경 (P0→P1→P2 순환) — W-NO-FLOW 등 P0 전용 위반을 근본 해소
  async function cyclePriority(f: PlanItem) {
    const m = parseItemMeta(f);
    const cur = (m.priority ?? 'P2') as Priority;
    const next = PRIORITY_CYCLE[(PRIORITY_CYCLE.indexOf(cur) + 1) % PRIORITY_CYCLE.length];
    await api.updateItem(f.id, { meta: { ...m, priority: next } });
    onChanged?.();
    refetchLint();
  }

  // 위반 하나를 무시(비파괴적) — 인라인 배지에서 바로
  async function waiveViolation(v: LintViolation) {
    if (!v.key) return;
    await api.lintWaiveOne(projectId, v.key);
    refetchLint();
  }

  const groups = items.filter((i) => i.kind === 'feature-group' && i.status !== 'rejected');
  const featuresOf = (gid: string) =>
    items.filter((i) => i.kind === 'feature' && i.parent_id === gid && i.status !== 'rejected');

  const allFeatures = items.filter((i) => i.kind === 'feature' && i.status !== 'rejected');
  const p0 = allFeatures.filter((f) => parseItemMeta(f).priority === 'P0').length;
  const p1 = allFeatures.filter((f) => parseItemMeta(f).priority === 'P1').length;
  const accepted = allFeatures.filter((f) => f.status === 'accepted').length;
  const proposed = allFeatures.filter((f) => f.status === 'proposed').length;

  return (
    <div className="editor-inner">
      <div className="eyebrow">SPEC · Feature Specification</div>
      <h1 className="struct-h1">기능명세서</h1>
      <div className="dmeta">항목 트리 · 서버 채번 · 수락한 항목만 문서</div>

      <div className="sumbar">
        <span className="sumchip">
          항목 <b>{allFeatures.length}</b>
        </span>
        <span className="sumchip">
          P0 <b>{p0}</b> · P1 <b>{p1}</b>
        </span>
        <span className="sumchip">
          수락 <b>{accepted}</b>
        </span>
        {proposed > 0 && <span className="sumchip g">제안 {proposed}</span>}
        {effective > 0 && <span className="sumchip am">검사 위반 {effective}</span>}
      </div>

      <div className="colhead">
        <span className="c1">ID</span>
        <span className="c2">항목</span>
        <span className="c3">근거</span>
        <span className="c4">우선</span>
      </div>

      {groups.map((g) => {
        const feats = featuresOf(g.id);
        const pages = new Set<string>();
        for (const f of feats) for (const p of parseItemMeta(f).links?.pages ?? []) pages.add(p);
        const acc = feats.filter((f) => f.status === 'accepted').length;
        const prop = feats.filter((f) => f.status === 'proposed').length;
        const gViol = violByRef.get(g.ref_id);
        return (
          <div key={g.id}>
            <div className="grouprow">
              <span className="gid">{g.ref_id}</span>
              <b>{g.title}</b>
              {[...pages].length > 0 && <span className="pgchip">{[...pages].join('·')}</span>}
              {gViol && <span className="dpill amber">검사 위반</span>}
              <span className="gsum">
                하위 {feats.length} · 수락 {acc} · 제안 {prop}
              </span>
            </div>
            {feats.map((f) => (
              <FeatureRow
                key={f.id}
                feature={f}
                open={selected === f.id || f.status === 'proposed'}
                violation={violByRef.get(f.ref_id) ?? null}
                onToggle={() => onSelect(selected === f.id ? null : f.id)}
                onAccept={() => onAccept(f.id)}
                onReject={() => onReject(f.id)}
                onCyclePriority={() => cyclePriority(f)}
                onWaive={waiveViolation}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function FeatureRow({
  feature,
  open,
  violation,
  onToggle,
  onAccept,
  onReject,
  onCyclePriority,
  onWaive,
}: {
  feature: PlanItem;
  open: boolean;
  violation: LintViolation | null;
  onToggle: () => void;
  onAccept: () => void;
  onReject: () => void;
  onCyclePriority: () => void;
  onWaive: (v: LintViolation) => void;
}) {
  const m = parseItemMeta(feature);
  const proposed = feature.status === 'proposed';
  const critLines = feature.body.split('\n').map((l) => l.replace(/^[·\-*]\s*/, '').trim()).filter(Boolean);

  if (!open) {
    return (
      <button className={`trow lv2 ${proposed ? 'sug' : ''}`} onClick={onToggle}>
        <span className="rid">{feature.ref_id}</span>
        <span className="rt">{feature.title}</span>
        {violation && <span className="dpill amber">{violation.code}</span>}
        <span className="src">{m.source ?? ''}</span>
        <span className="pri-tag">{m.priority ?? ''}</span>
      </button>
    );
  }

  return (
    <div className={`exp ${violation ? 'viol' : ''}`}>
      <div className="xh">
        <span className="rid">{feature.ref_id}</span>
        <b>{feature.title}</b>
        {proposed ? (
          <span className="dpill">제안됨</span>
        ) : violation ? (
          <span className="dpill amber">{violation.code}</span>
        ) : (
          <span className="dpill" style={{ color: 'var(--ink)', borderColor: 'var(--hair)' }}>
            수락됨
          </span>
        )}
        {/* 우선순위 클릭 = P0→P1→P2 순환 (P0 전용 위반 근본 해소) */}
        <button
          className="pri-edit"
          title="우선순위 변경 (P0→P1→P2)"
          onClick={(e) => {
            e.stopPropagation();
            onCyclePriority();
          }}
        >
          {m.priority ?? 'P?'}
        </button>
        <span className="mini">
          <button onClick={onAccept} title="수락">
            ✓
          </button>
          <button className="no" onClick={onReject} title="거절">
            ×
          </button>
        </span>
      </div>
      {violation && (
        <div className="viol-bar">
          <span className="vcode">{violation.code}</span>
          <span className="vmsg">{violation.message}</span>
          <button className="btn sm" onClick={() => onWaive(violation)} title="이 위반만 무시(내용 유지)">
            무시
          </button>
        </div>
      )}
      {critLines.length > 0 && (
        <div className="ac">
          <span className="lb">수용 기준</span>
          {critLines.map((l, i) => (
            <div key={i}>· {l}</div>
          ))}
        </div>
      )}
      <div className="links">
        <span className="lb" style={{ width: 'auto', margin: '0 4px 0 0', display: 'inline' }}>
          연결
        </span>
        {(m.links?.pages ?? []).map((p) => (
          <span key={p} className="pgchip">
            {p}
          </span>
        ))}
        {(m.links?.flows ?? []).map((f) => (
          <span key={f} className="pgchip">
            {f}
          </span>
        ))}
        {(m.links?.reqs ?? []).map((r) => (
          <span key={r} className="pgchip">
            {r}
          </span>
        ))}
      </div>
      {m.source && <div className="quote">근거 · {m.source}</div>}
    </div>
  );
}

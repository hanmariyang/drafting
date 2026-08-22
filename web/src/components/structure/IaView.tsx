import { useEffect, useState } from 'react';
import { api, parseItemMeta, type PlanItem, type LintViolation } from '../../lib/api.ts';

interface Props {
  projectId: string;
  items: PlanItem[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onAccept: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  generating: boolean;
  onRegenerate: () => void;
  onNavPage?: (pgRef: string) => void;
  /** 기능명세 문서의 기능들 (화면→기능 연결, W-EMPTY-PAGE 해소) */
  features?: PlanItem[];
  /** 유저플로우 문서의 스텝·플로우 (도달 플로우 판정 — IA 문서엔 스텝이 없다) */
  flowItems?: PlanItem[];
  onEditLink?: (itemId: string, field: 'reqs' | 'features', ref: string, op: 'add' | 'remove') => Promise<void>;
}

export function IaView({
  projectId,
  items,
  selected,
  onSelect,
  onAccept,
  onReject,
  features = [],
  flowItems = [],
  onEditLink,
}: Props) {
  const [violByRef, setViolByRef] = useState<Map<string, LintViolation>>(new Map());
  const [listMode, setListMode] = useState(false);

  useEffect(() => {
    api
      .lint(projectId)
      .then((r) => {
        const m = new Map<string, LintViolation>();
        for (const v of r.violations) if (!v.waived) m.set(v.refs[0], v);
        setViolByRef(m);
      })
      .catch(() => {});
  }, [projectId, items]);

  const pages = items.filter((i) => i.kind === 'page' && i.status !== 'rejected');
  // 스텝·플로우는 유저플로우 문서에 있으므로 flowItems 로 판정한다(IA 문서의 items 엔 없음).
  const steps = flowItems.filter((i) => i.kind === 'step');
  const flowsForPage = (ref: string) => {
    const set = new Set<string>();
    for (const st of steps) {
      if (parseItemMeta(st).page === ref) {
        const flow = flowItems.find((f) => f.id === st.parent_id);
        if (flow) set.add(flow.ref_id);
      }
    }
    return [...set];
  };
  const sel = pages.find((p) => p.id === selected) ?? null;

  return (
    <div className="editor-inner">
      <div className="eyebrow">IA · Information Architecture</div>
      <h1 className="struct-h1">정보 구조</h1>
      <div className="dmeta">
        사이트맵 = 정본 · 와이어프레임이 이 구조를 그대로 렌더
        <button className="btn sm" style={{ marginLeft: 10 }} onClick={() => setListMode((v) => !v)}>
          {listMode ? '사이트맵' : '리스트 편집'}
        </button>
      </div>

      {listMode ? (
        <div className="ia-list">
          {pages.map((p) => {
            const m = parseItemMeta(p);
            const v = violByRef.get(p.ref_id);
            return (
              <div key={p.id} className={`row ${p.status === 'proposed' ? 'sug' : ''}`}>
                <span className="rid">{p.ref_id}</span>
                <span className="rt">{p.title}</span>
                <span className="typechip">{m.page_type ?? 'GENERIC'}</span>
                {v && <span className="dpill amber">검사 위반</span>}
                {p.status === 'proposed' && (
                  <span className="mini">
                    <button onClick={() => onAccept(p.id)}>✓</button>
                    <button className="no" onClick={() => onReject(p.id)}>
                      ×
                    </button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="map">
          <div className="mnode rootn">
            <span className="mid">APP</span>
            <b>{pages.length ? '사이트맵' : '화면 없음'}</b>
          </div>
          <div className="vline" />
          <div className="hbus" />
          <div className="mrow">
            {pages.map((p) => {
              const m = parseItemMeta(p);
              const v = violByRef.get(p.ref_id);
              const cls =
                p.status === 'proposed' ? 'prop' : v ? 'viol' : selected === p.id ? 'sel' : '';
              return (
                <div className="mcol" key={p.id}>
                  <div className="vline" />
                  <button className={`mnode ${cls}`} onClick={() => onSelect(p.id)}>
                    <span className="mid">{p.ref_id}</span>
                    <b>{p.title}</b>
                    <br />
                    <span className="typechip">{m.page_type ?? 'GENERIC'}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {sel && !listMode && (
        <IaDetail
          page={sel}
          flows={flowsForPage(sel.ref_id)}
          violation={violByRef.get(sel.ref_id) ?? null}
          onAccept={() => onAccept(sel.id)}
          onReject={() => onReject(sel.id)}
          features={features}
          onEditLink={onEditLink}
        />
      )}
    </div>
  );
}

function IaDetail({
  page,
  flows,
  violation,
  onAccept,
  onReject,
  features,
  onEditLink,
}: {
  page: PlanItem;
  flows: string[];
  violation: LintViolation | null;
  onAccept: () => void;
  onReject: () => void;
  features: PlanItem[];
  onEditLink?: (itemId: string, field: 'reqs' | 'features', ref: string, op: 'add' | 'remove') => Promise<void>;
}) {
  const m = parseItemMeta(page);
  const myFeatures = m.links?.features ?? [];
  const availFeatures = features.filter((f) => !myFeatures.includes(f.ref_id));
  return (
    <div className="iadetail">
      <div className="iathumb">
        <div className="th">{page.ref_id} 미리보기</div>
        <div className="tb2">
          <span className="sk bar" />
          <span className="sk block" />
          <span className="sk btnk" />
        </div>
      </div>
      <div className="iameta">
        <h4>
          {page.ref_id} · {page.title} <span className="typechip">{m.page_type ?? 'GENERIC'}</span>
        </h4>
        <div className="mrowline">
          <span className="k">근거 기능</span>
          {myFeatures.map((f) =>
            onEditLink ? (
              <span key={f} className="flowchip">
                {f}
                <button title="연결 해제" onClick={() => onEditLink(page.id, 'features', f, 'remove')}>
                  ×
                </button>
              </span>
            ) : (
              <span key={f} className="pgchip">
                {f}
              </span>
            ),
          )}
          {myFeatures.length === 0 && <span>연결 없음</span>}
          {onEditLink && availFeatures.length > 0 && (
            <select
              className="field"
              style={{ maxWidth: 240, fontSize: 12 }}
              value=""
              onChange={(e) => e.target.value && onEditLink(page.id, 'features', e.target.value, 'add')}
            >
              <option value="">+ 기능 연결…</option>
              {availFeatures.map((f) => (
                <option key={f.id} value={f.ref_id}>
                  {f.ref_id} {f.title}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="mrowline">
          <span className="k">진입 플로우</span>
          {flows.length ? (
            flows.map((f) => (
              <span key={f} className="pgchip">
                {f}
              </span>
            ))
          ) : (
            <span style={{ color: 'var(--warn)' }}>도달 플로우 없음</span>
          )}
        </div>
        <div className="mrowline">
          <span className="k">상태</span>
          <span>
            {page.status === 'proposed' ? '제안됨' : '수락됨'}
            {violation ? ` · ${violation.code}` : ' · 와이어프레임 최신'}
          </span>
        </div>
        {page.status === 'proposed' && (
          <div className="scard-acts" style={{ marginTop: 10 }}>
            <button className="a" onClick={onAccept}>
              수락
            </button>
            <button className="r" onClick={onReject}>
              거절
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

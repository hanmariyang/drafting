import { useEffect, useMemo, useState } from 'react';
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
  /** 페이지 섹션(사이트맵 계층) 지정/해제 */
  onSetSection?: (pageId: string, section: string) => Promise<void>;
}

type Mode = 'map' | 'matrix' | 'list';
type PageType = 'LIST' | 'DETAIL' | 'FORM' | 'DASH' | 'SETTINGS' | 'GENERIC';

const TYPE_SHORT: Record<PageType, string> = {
  LIST: 'LIST',
  DETAIL: 'DETAIL',
  FORM: 'FORM',
  DASH: 'DASH',
  SETTINGS: 'SET',
  GENERIC: 'PAGE',
};

function pageType(p: PlanItem): PageType {
  const t = (parseItemMeta(p).page_type ?? 'GENERIC') as PageType;
  return t in TYPE_SHORT ? t : 'GENERIC';
}

/** page_type 을 실제 미니 레이아웃으로 그린다 (가짜 스켈레톤 대신 성격을 드러냄). */
function PageGlyph({ type }: { type: PageType }) {
  if (type === 'DASH')
    return (
      <div className="iav-glyph dash">
        <span className="g" />
        <span className="g" />
        <span className="g" />
        <span className="g" />
      </div>
    );
  if (type === 'FORM')
    return (
      <div className="iav-glyph form">
        <span className="f">
          <b />
          <i />
        </span>
        <span className="f">
          <b />
          <i />
        </span>
      </div>
    );
  if (type === 'SETTINGS')
    return (
      <div className="iav-glyph settings">
        <span className="r on">
          <b />
          <i />
        </span>
        <span className="r">
          <b />
          <i />
        </span>
        <span className="r on">
          <b />
          <i />
        </span>
      </div>
    );
  if (type === 'DETAIL')
    return (
      <div className="iav-glyph detail">
        <span className="g" />
        <span className="g" />
        <span className="g" />
      </div>
    );
  // LIST / GENERIC
  return (
    <div className="iav-glyph list">
      <span className="g" />
      <span className="g" />
      <span className="g" />
      <span className="g" style={{ width: '58%' }} />
    </div>
  );
}

export function IaView({
  projectId,
  items,
  selected,
  onSelect,
  onAccept,
  onReject,
  generating,
  onRegenerate,
  features = [],
  flowItems = [],
  onEditLink,
  onSetSection,
}: Props) {
  const [violByRef, setViolByRef] = useState<Map<string, LintViolation>>(new Map());
  const [mode, setMode] = useState<Mode>('map');

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

  const pages = useMemo(
    () => items.filter((i) => i.kind === 'page' && i.status !== 'rejected'),
    [items],
  );
  const steps = useMemo(() => flowItems.filter((i) => i.kind === 'step'), [flowItems]);
  const hasFlowDoc = flowItems.some((i) => i.kind === 'flow');

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
  const featuresOf = (p: PlanItem): string[] => parseItemMeta(p).links?.features ?? [];

  // ── completeness (summary before detail) ──────────────────────────────────
  const health = useMemo(() => {
    const violCount = pages.filter((p) => violByRef.has(p.ref_id)).length;
    const unreachable = hasFlowDoc
      ? pages.filter((p) => flowsForPage(p.ref_id).length === 0).length
      : 0;
    const usedFeat = new Set(pages.flatMap((p) => featuresOf(p)));
    const unlinked = features.filter((f) => !usedFeat.has(f.ref_id));
    return { violCount, unreachable, unlinked, placed: features.length - unlinked.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages, violByRef, features, flowItems, hasFlowDoc]);

  const sel = pages.find((p) => p.id === selected) ?? null;

  // ── 섹션 계층(사이트맵 트리) — 등장 순서 보존, 미분류는 맨 뒤 ──────────────
  const sectionOf = (p: PlanItem) => (parseItemMeta(p).section ?? '').trim();
  const grouped = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, PlanItem[]>();
    for (const p of pages) {
      const key = sectionOf(p) || '__none';
      if (!map.has(key)) {
        map.set(key, []);
        order.push(key);
      }
      map.get(key)!.push(p);
    }
    // 미분류(__none)는 항상 맨 뒤로
    order.sort((a, b) => (a === '__none' ? 1 : 0) - (b === '__none' ? 1 : 0));
    const named = order.filter((k) => k !== '__none');
    return { order, map, hasSections: named.length > 0, names: named };
  }, [pages]);

  const renderCard = (p: PlanItem) => {
    const t = pageType(p);
    const v = violByRef.get(p.ref_id);
    const noFeat = featuresOf(p).length === 0;
    const unreachable = hasFlowDoc && flowsForPage(p.ref_id).length === 0;
    const cls =
      p.status === 'proposed' ? 'prop' : v || noFeat || unreachable ? 'viol' : selected === p.id ? 'sel' : '';
    const flag = noFeat ? '근거 기능 없음' : unreachable ? '도달 플로우 없음' : v ? '검사 위반' : '';
    return (
      <button key={p.id} className={`iav-card ${cls}`} onClick={() => onSelect(p.id)} aria-pressed={selected === p.id}>
        <PageGlyph type={t} />
        <span className="cap">
          <span className="rid">{p.ref_id}</span>
          <span className="ttl">{p.title}</span>
          <span className="iav-chip">{TYPE_SHORT[t]}</span>
        </span>
        {p.status === 'proposed' ? (
          <span className="flag prop">＋ 제안됨 — 수락하면 확정</span>
        ) : (
          flag && <span className="flag warn">△ {flag}</span>
        )}
      </button>
    );
  };

  return (
    <div className="editor-inner">
      <div className="eyebrow">IA · Information Architecture</div>
      <h1 className="struct-h1">정보 구조</h1>
      <div className="dmeta">사이트맵 = 정본 · 와이어프레임이 이 구조를 그대로 렌더</div>

      {/* 완결성 헤더 — 전체 건강을 세부보다 먼저 */}
      {pages.length > 0 && (
        <div className="iav-health">
          <span className="iav-stat total">
            <span className="num">{pages.length}</span> 화면
          </span>
          {health.violCount > 0 && (
            <span className="iav-stat warn">
              <span className="dot" />
              <span className="num">{health.violCount}</span> 검사 위반
            </span>
          )}
          {hasFlowDoc && health.unreachable > 0 && (
            <span className="iav-stat warn">
              <span className="dot" />
              <span className="num">{health.unreachable}</span> 도달 플로우 없음
            </span>
          )}
          {features.length > 0 && health.unlinked.length > 0 && (
            <span className="iav-stat warn">
              <span className="dot" />
              <span className="num">{health.unlinked.length}</span> 미연결 기능
            </span>
          )}
          {features.length > 0 && (
            <span className="iav-stat">
              <span className="num">
                {health.placed} / {features.length}
              </span>{' '}
              기능 배치됨
            </span>
          )}
        </div>
      )}

      <div className="iav-tabs" role="tablist">
        <button className={`iav-tab ${mode === 'map' ? 'on' : ''}`} role="tab" aria-selected={mode === 'map'} onClick={() => setMode('map')}>
          사이트맵
        </button>
        <button className={`iav-tab ${mode === 'matrix' ? 'on' : ''}`} role="tab" aria-selected={mode === 'matrix'} onClick={() => setMode('matrix')}>
          커버리지
        </button>
        <button className={`iav-tab ${mode === 'list' ? 'on' : ''}`} role="tab" aria-selected={mode === 'list'} onClick={() => setMode('list')}>
          리스트 편집
        </button>
        <button className="btn sm" style={{ marginLeft: 'auto' }} disabled={generating} onClick={onRegenerate}>
          {generating ? '생성 중…' : '다시 생성'}
        </button>
      </div>

      {pages.length === 0 ? (
        <div className="iav-empty">
          아직 화면이 없어요. <b>다시 생성</b>으로 기능명세에서 화면을 제안받으세요.
        </div>
      ) : mode === 'list' ? (
        <div className="ia-list">
          {pages.map((p) => {
            const t = pageType(p);
            const v = violByRef.get(p.ref_id);
            return (
              <div key={p.id} className={`row ${p.status === 'proposed' ? 'sug' : ''}`}>
                <span className="rid">{p.ref_id}</span>
                <span className="rt">{p.title}</span>
                <span className="typechip">{t}</span>
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
      ) : mode === 'matrix' ? (
        <CoverageMatrix pages={pages} features={features} onPick={(id) => { onSelect(id); setMode('map'); }} />
      ) : (
        <div className="iav-stage">
          {grouped.hasSections ? (
            <div className="iav-tree">
              <div className="iav-approot">
                <span className="mid">APP</span> 사이트맵
              </div>
              {grouped.order.map((key) => (
                <section className="iav-sec" key={key}>
                  <div className="iav-sechd">
                    <span className="branch" aria-hidden />
                    <span className="nm">{key === '__none' ? '미분류' : key}</span>
                    <span className="cnt">{grouped.map.get(key)!.length}</span>
                  </div>
                  <div className="iav-grid">{grouped.map.get(key)!.map(renderCard)}</div>
                </section>
              ))}
            </div>
          ) : (
            <div className="iav-grid">{pages.map(renderCard)}</div>
          )}

          {sel ? (
            <IaInspector
              page={sel}
              type={pageType(sel)}
              flows={flowsForPage(sel.ref_id)}
              hasFlowDoc={hasFlowDoc}
              violation={violByRef.get(sel.ref_id) ?? null}
              features={features}
              sections={grouped.names}
              currentSection={sectionOf(sel)}
              onAccept={() => onAccept(sel.id)}
              onReject={() => onReject(sel.id)}
              onEditLink={onEditLink}
              onSetSection={onSetSection}
            />
          ) : (
            <aside className="iav-insp empty">화면을 선택하면 근거 기능·진입 플로우·상태를 봅니다.</aside>
          )}
        </div>
      )}
    </div>
  );
}

function IaInspector({
  page,
  type,
  flows,
  hasFlowDoc,
  violation,
  features,
  sections,
  currentSection,
  onAccept,
  onReject,
  onEditLink,
  onSetSection,
}: {
  page: PlanItem;
  type: PageType;
  flows: string[];
  hasFlowDoc: boolean;
  violation: LintViolation | null;
  features: PlanItem[];
  sections: string[];
  currentSection: string;
  onAccept: () => void;
  onReject: () => void;
  onEditLink?: (itemId: string, field: 'reqs' | 'features', ref: string, op: 'add' | 'remove') => Promise<void>;
  onSetSection?: (pageId: string, section: string) => Promise<void>;
}) {
  const myFeatures = parseItemMeta(page).links?.features ?? [];
  const avail = features.filter((f) => !myFeatures.includes(f.ref_id));
  const featTitle = (ref: string) => features.find((f) => f.ref_id === ref)?.title ?? '';
  return (
    <aside className="iav-insp">
      <div className="ihd">
        <div className="big">
          <PageGlyph type={type} />
        </div>
        <div className="ht">
          <h4>{page.title}</h4>
          <div className="sub">
            {page.ref_id} · {type}
          </div>
        </div>
      </div>

      <div className="ibody">
      <div className="iav-krow">
        <span className="iav-k">섹션</span>
        {onSetSection ? (
          <>
            <select
              className="iav-addsel"
              value={sections.includes(currentSection) ? currentSection : ''}
              onChange={(e) => onSetSection(page.id, e.target.value)}
            >
              <option value="">(최상위)</option>
              {sections.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <input
              className="iav-secnew"
              placeholder="＋ 새 섹션"
              onKeyDown={(e) => {
                const val = e.currentTarget.value.trim();
                if (e.key === 'Enter' && val) {
                  onSetSection(page.id, val);
                  e.currentTarget.value = '';
                }
              }}
            />
          </>
        ) : (
          <span className="iav-lchip">{currentSection || '최상위'}</span>
        )}
      </div>
      <div className="iav-krow">
        <span className="iav-k">근거 기능</span>
        {myFeatures.map((f) =>
          onEditLink ? (
            <button key={f} className="iav-lchip rm" title={featTitle(f)} onClick={() => onEditLink(page.id, 'features', f, 'remove')}>
              {f} <span aria-hidden>×</span>
            </button>
          ) : (
            <span key={f} className="iav-lchip" title={featTitle(f)}>
              {f}
            </span>
          ),
        )}
        {myFeatures.length === 0 && <span className="iav-none">근거 기능 없음</span>}
        {onEditLink && avail.length > 0 && (
          <select
            className="iav-addsel"
            value=""
            onChange={(e) => e.target.value && onEditLink(page.id, 'features', e.target.value, 'add')}
          >
            <option value="">＋ 기능 연결…</option>
            {avail.map((f) => (
              <option key={f.id} value={f.ref_id}>
                {f.ref_id} {f.title}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="iav-krow">
        <span className="iav-k">진입 플로우</span>
        {flows.length ? (
          flows.map((f) => (
            <span key={f} className="iav-lchip">
              {f}
            </span>
          ))
        ) : hasFlowDoc ? (
          <span className="iav-none warn">도달 플로우 없음</span>
        ) : (
          <span className="iav-none">유저플로우 미작성</span>
        )}
      </div>

      <div className="iav-krow">
        <span className="iav-k">상태</span>
        <span className="iav-status">
          {page.status === 'proposed' ? '제안됨' : '수락됨'}
          {violation ? ` · ${violation.code}` : ' · 와이어프레임 최신'}
        </span>
      </div>

      {page.status === 'proposed' && (
        <div className="iav-iacts">
          <button className="btn ok" onClick={onAccept}>
            수락
          </button>
          <button className="btn" onClick={onReject}>
            거절
          </button>
        </div>
      )}
      </div>
    </aside>
  );
}

function CoverageMatrix({
  pages,
  features,
  onPick,
}: {
  pages: PlanItem[];
  features: PlanItem[];
  onPick: (pageId: string) => void;
}) {
  if (features.length === 0) {
    return <div className="iav-empty">기능명세가 아직 없어요. 기능이 있어야 화면과의 커버리지를 볼 수 있습니다.</div>;
  }
  const has = (page: PlanItem, featRef: string) =>
    (parseItemMeta(page).links?.features ?? []).includes(featRef);
  const colCount = (page: PlanItem) => features.filter((f) => has(page, f.ref_id)).length;
  const rowCount = (featRef: string) => pages.filter((p) => has(p, featRef)).length;

  return (
    <div className="iav-mtxwrap">
      <table className="iav-mtx">
        <thead>
          <tr>
            <th className="corner">기능 ＼ 화면</th>
            {pages.map((p) => (
              <th key={p.id}>
                <button className="colh" onClick={() => onPick(p.id)} title={p.title}>
                  <span className="rid">{p.ref_id}</span>
                  <span className="ct">{p.title}</span>
                </button>
              </th>
            ))}
            <th className="sumh">배치</th>
          </tr>
        </thead>
        <tbody>
          {features.map((f) => {
            const n = rowCount(f.ref_id);
            return (
              <tr key={f.id}>
                <th className="rowh">
                  <span className="rid">{f.ref_id}</span>
                  {f.title}
                </th>
                {pages.map((p) => (
                  <td key={p.id} className="cell">
                    {has(p, f.ref_id) ? <span className="on-c" aria-label="연결됨">●</span> : <span className="off-c" aria-hidden>·</span>}
                  </td>
                ))}
                <td className="cell">{n > 0 ? <span className="num">{n}</span> : <span className="gaptag">⚠ 화면 없음</span>}</td>
              </tr>
            );
          })}
          <tr className="footr">
            <th className="rowh muted">담는 기능</th>
            {pages.map((p) => {
              const n = colCount(p);
              return (
                <td key={p.id} className={`cell ${n === 0 ? 'gapcol' : ''}`}>
                  {n === 0 ? <span className="gaptag">⚠ 0</span> : <span className="num">{n}</span>}
                </td>
              );
            })}
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

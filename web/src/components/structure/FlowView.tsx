import { useState } from 'react';
import { api, parseItemMeta, type PlanItem } from '../../lib/api.ts';

interface Props {
  items: PlanItem[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onAccept: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  generating: boolean;
  onRegenerate: () => void;
  onChanged?: () => void;
  /** IA 문서의 화면들 (스텝→화면 지정, W-UNREACHED-PAGE 해소) */
  pages?: PlanItem[];
  onSetStepPage?: (stepId: string, page: string | null) => Promise<void>;
}

export function FlowView({ items, onAccept, onReject, onChanged, pages = [], onSetStepPage }: Props) {
  const [editSteps, setEditSteps] = useState(false);
  const flows = items.filter((i) => i.kind === 'flow' && i.status !== 'rejected');
  const stepsOf = (fid: string) =>
    items
      .filter((i) => i.kind === 'step' && i.parent_id === fid && i.status !== 'rejected')
      .sort((a, b) => a.position - b.position);

  function exportMermaid() {
    const lines: string[] = ['flowchart LR'];
    for (const flow of flows) {
      const steps = stepsOf(flow.id);
      const main = steps.filter((s) => !parseItemMeta(s).branch);
      const idOf = (s: PlanItem) => s.ref_id.replace(/[.\-]/g, '_');
      main.forEach((s, i) => {
        const m = parseItemMeta(s);
        const label = `${m.page ? m.page + ' ' : ''}${s.title}`;
        const shape =
          m.node === 'start' || m.node === 'end'
            ? `([${label}])`
            : m.node === 'decision'
              ? `{${s.title}}`
              : `[${label}]`;
        lines.push(`  ${idOf(s)}${shape}`);
        if (i > 0) lines.push(`  ${idOf(main[i - 1])} --> ${idOf(s)}`);
      });
      for (const s of steps.filter((x) => parseItemMeta(x).branch)) {
        const m = parseItemMeta(s);
        const from = (m.branch?.from_step ?? '').replace(/[.\-]/g, '_');
        if (from) lines.push(`  ${from} -->|${m.branch?.label ?? '예'}| ${idOf(s)}[${s.title}]`);
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'flows.mmd';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="editor-inner">
      <div className="eyebrow">FLOW · User Flow</div>
      <h1 className="struct-h1">유저 플로우</h1>
      <div className="dmeta">
        노드 = 화면(PG-)·판단(◇)·완료(●) — 편집은 스텝, 보기는 다이어그램
        <button className="btn sm" style={{ marginLeft: 10 }} onClick={() => setEditSteps((v) => !v)}>
          {editSteps ? '다이어그램' : '스텝 편집'}
        </button>
        <button className="btn sm" onClick={exportMermaid}>
          mermaid 내보내기
        </button>
      </div>

      {flows.map((flow) => {
        const steps = stepsOf(flow.id);
        const main = steps.filter((s) => !parseItemMeta(s).branch);
        const branches = steps.filter((s) => parseItemMeta(s).branch);
        const m = parseItemMeta(flow);
        if (editSteps) {
          return (
            <div className="flane" key={flow.id}>
              <div className="fh">
                <span className="rid">{flow.ref_id}</span>
                <b>{flow.title}</b>
                <span className="src">{m.source ?? ''}</span>
              </div>
              <div className="ia-list">
                {steps.map((s) => {
                  const sm = parseItemMeta(s);
                  return (
                    <div className="trow" key={s.id}>
                      <span className="rid">{s.ref_id}</span>
                      <input
                        className="field"
                        style={{ flex: 1, fontSize: 12 }}
                        defaultValue={s.title}
                        onBlur={async (e) => {
                          if (e.target.value.trim() && e.target.value !== s.title) {
                            await api.updateItem(s.id, { title: e.target.value.trim() });
                            onChanged?.();
                          }
                        }}
                      />
                      <span className="typechip">{sm.node ?? 'screen'}</span>
                      {/* 스텝→화면 지정 (W-UNREACHED-PAGE 해소) */}
                      {onSetStepPage && pages.length > 0 ? (
                        <select
                          className="field"
                          style={{ maxWidth: 150, fontSize: 11 }}
                          value={sm.page ?? ''}
                          onChange={(e) => onSetStepPage(s.id, e.target.value || null)}
                        >
                          <option value="">화면 없음</option>
                          {pages.map((pg) => (
                            <option key={pg.id} value={pg.ref_id}>
                              {pg.ref_id} {pg.title}
                            </option>
                          ))}
                        </select>
                      ) : (
                        sm.page && <span className="pgchip">{sm.page}</span>
                      )}
                      <span className="mini">
                        <button
                          className="no"
                          title="스텝 삭제"
                          onClick={async () => {
                            await api.deleteItem(s.id);
                            onChanged?.();
                          }}
                        >
                          ×
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        }
        return (
          <div className="flane" key={flow.id}>
            <div className="fh">
              <span className="rid">{flow.ref_id}</span>
              <b>{flow.title}</b>
              <span className="src">{m.source ?? ''}</span>
              {flow.status === 'proposed' && (
                <span className="mini" style={{ marginLeft: 8 }}>
                  <button onClick={() => onAccept(flow.id)}>✓</button>
                  <button className="no" onClick={() => onReject(flow.id)}>
                    ×
                  </button>
                </span>
              )}
            </div>
            <div className="ftrack">
              {main.map((s, i) => {
                const sm = parseItemMeta(s);
                const prevDecision = i > 0 && parseItemMeta(main[i - 1]).node === 'decision';
                return (
                  <FlowNode key={s.id} step={s} meta={sm} edgeBefore={i > 0} edgeLabel={prevDecision ? '아니오' : undefined} />
                );
              })}
            </div>
            {branches.map((s) => {
              const sm = parseItemMeta(s);
              return (
                <div className="fbranch" key={s.id}>
                  <div className="bend" />
                  <span className="floop">{sm.branch?.label ?? '예'} ·</span>
                  <div className="fnode">
                    <span className="fid">{sm.page ?? ''}</span>
                    <b>{s.title}</b>
                  </div>
                  {sm.note && <span className="floop">→ {sm.note}</span>}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function FlowNode({
  step,
  meta,
  edgeBefore,
  edgeLabel,
}: {
  step: PlanItem;
  meta: ReturnType<typeof parseItemMeta>;
  edgeBefore: boolean;
  edgeLabel?: string;
}) {
  const edge = edgeBefore ? (
    <div className="fedge">{edgeLabel && <span className="elb">{edgeLabel}</span>}</div>
  ) : null;
  if (meta.node === 'decision') {
    return (
      <>
        {edge}
        <div className="fdec">{step.title}</div>
      </>
    );
  }
  const cls = meta.node === 'start' ? 'startn' : meta.node === 'end' ? 'endn' : '';
  const fid = meta.node === 'start' ? '시작' : meta.node === 'end' ? '완료' : meta.page ?? '';
  return (
    <>
      {edge}
      <div className={`fnode ${cls}`}>
        <span className="fid">{fid}</span>
        <b>{step.title}</b>
      </div>
    </>
  );
}

import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';

/**
 * P-01 flow. Shows the parent context that changed and offers:
 *  (A) context-only refresh — child bodies untouched (default)
 *  (C) later — keep the badge
 * Flow (B) — per-section regeneration — is done via each section's ↻ button, so
 * this dialog explains it rather than triggering an automatic overwrite (G-02).
 */
export function ContextRefreshDialog({
  docId,
  onClose,
  onRefreshed,
}: {
  docId: string;
  onClose: () => void;
  onRefreshed: () => void;
}) {
  const [parent, setParent] = useState<{
    available: boolean;
    parentTitle?: string;
    parentType?: string;
    parentVersion?: number;
    sections?: { heading: string; body: string }[];
  } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.parentContext(docId).then(setParent).catch(() => {});
  }, [docId]);

  async function refreshContextOnly() {
    setBusy(true);
    try {
      await api.refreshContext(docId);
      onRefreshed();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>상위 문서가 변경되었습니다</h2>
        <p className="subtle">
          상위 문서{parent?.parentTitle ? ` "${parent.parentTitle}"` : ''}
          {parent?.parentVersion != null ? ` (v${parent.parentVersion})` : ''}가 바뀌어, 이 문서가
          참조하는 컨텍스트가 낡았습니다. 무엇을 하시겠습니까?
        </p>

        {parent?.available && (
          <div className="mini-card" style={{ cursor: 'default', marginTop: '0.5rem' }}>
            <div className="subtle" style={{ marginBottom: '0.3rem' }}>
              최신 상위 컨텍스트 미리보기
            </div>
            {(parent.sections ?? []).map((s, i) => (
              <div key={i} style={{ marginBottom: '0.4rem' }}>
                <b>{s.heading}</b>
                <div className="muted" style={{ fontSize: '0.8rem' }}>
                  {s.body.slice(0, 120)}
                  {s.body.length > 120 ? '…' : ''}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="divider" />
        <div className="rows">
          <button className="btn pri lg" disabled={busy} onClick={refreshContextOnly}>
            (A) 컨텍스트만 갱신 · 이 문서 본문은 그대로 둡니다
          </button>
          <div className="subtle">
            (B) 특정 섹션을 상위 내용에 맞춰 다시 쓰려면, 갱신 후 각 섹션의 <b>재생성</b>을 개별로
            누르세요. 자동으로 덮어쓰지 않습니다.
          </div>
          <button className="btn ghost" onClick={onClose}>
            (C) 나중에 · 배지를 유지합니다
          </button>
        </div>
      </div>
    </div>
  );
}

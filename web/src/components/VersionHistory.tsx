import { useEffect, useState } from 'react';
import { api, type VersionEntry } from '../lib/api.ts';

const EVENT_LABEL: Record<VersionEntry['event_type'], string> = {
  save: '저장',
  context_inherit: '컨텍스트 승계',
  restore: '복원',
};

export function VersionHistory({
  docId,
  onClose,
  onRestored,
}: {
  docId: string;
  onClose: () => void;
  onRestored: () => void;
}) {
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.versions(docId).then(setVersions).catch(() => {});
  }, [docId]);

  async function restore(v: VersionEntry) {
    setBusy(true);
    try {
      await api.restoreVersion(docId, v.id);
      onRestored();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>버전 히스토리</h2>
        <p className="subtle">저장·재생성·컨텍스트 승계 시점의 스냅샷입니다. 특정 버전으로 복원할 수 있습니다.</p>
        {versions.length === 0 ? (
          <div className="center-empty">아직 버전이 없습니다.</div>
        ) : (
          <div className="rows" style={{ marginTop: '0.75rem' }}>
            {versions.map((v) => (
              <div key={v.id} className="row">
                <span className="mono">v{v.version}</span>
                <span className="pill">{EVENT_LABEL[v.event_type]}</span>
                <span className="grow muted" style={{ fontSize: '0.78rem' }}>
                  {new Date(v.created_at).toLocaleString()}
                  {typeof v.meta?.reason === 'string' ? ` · ${v.meta.reason}` : ''}
                </span>
                <button className="btn sm" disabled={busy} onClick={() => restore(v)}>
                  복원
                </button>
              </div>
            ))}
          </div>
        )}
        <div style={{ textAlign: 'right', marginTop: '1rem' }}>
          <button className="btn" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

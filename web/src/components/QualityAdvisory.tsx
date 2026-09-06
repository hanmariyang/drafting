import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';

/**
 * 기획 품질 advisory — 측정 불가 표현·무숫자 목표·빈약 섹션·비범위 부재·
 * 만성 누락(실패 처리·권한·빈 상태·동시성·마이그레이션)을 조용히 짚어준다.
 * 게이트 아님: 브리프 대조와 같은 조언 채널. 노트가 없으면 그리지 않는다.
 */
export function QualityAdvisory({ docId, refreshKey }: { docId: string; refreshKey: string }) {
  const [notes, setNotes] = useState<Array<{ code: string; message: string; section?: string }>>([]);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let live = true;
    api
      .qualityCheck(docId)
      .then((r) => live && setNotes(r.enabled ? (r.notes ?? []) : []))
      .catch(() => live && setNotes([]));
    return () => {
      live = false;
    };
  }, [docId, refreshKey]);

  if (notes.length === 0) return null;

  return (
    <div className="brief-advisory">
      <div className="ba-head">
        <span className="ba-tag">품질 점검</span>
        <span className="ba-text">
          검증 가능성 관점의 짚을 점 {notes.length}개 — 의도한 것이면 그대로 두세요.
        </span>
        <button className="btn ghost sm" onClick={() => setOpen(!open)}>
          {open ? '접기' : '펼치기'}
        </button>
      </div>
      {open && (
        <ul className="ba-list">
          {notes.map((n, i) => (
            <li key={`${n.code}-${i}`}>
              <span className="ba-where">{n.section ?? '문서'}</span>
              <span>{n.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';

/**
 * 브리프 정합성 advisory (설계 노트 §3) — feature 문서가 연결된 브리프에 없는
 * 이름을 참조하면 조용히 알려준다. 게이트·waive 없음: 신규 도입일 수 있으니
 * 판단은 사람이 한다. 브리프가 없으면 아무것도 그리지 않는다.
 */
export function BriefAdvisory({ docId, refreshKey }: { docId: string; refreshKey: string }) {
  const [state, setState] = useState<Awaited<ReturnType<typeof api.briefCheck>> | null>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let live = true;
    api
      .briefCheck(docId)
      .then((r) => live && setState(r))
      .catch(() => live && setState(null));
    return () => {
      live = false;
    };
  }, [docId, refreshKey]);

  if (!state?.enabled) return null;

  if (state.briefEmpty) {
    return (
      <div className="brief-advisory">
        <span className="ba-tag">브리프 대조</span>
        <span className="ba-text">
          연결된 브리프({state.briefTitle})에 수락된 섹션이 아직 없어 이름 대조를 할 수 없습니다.
          브리프를 검수·수락하면 여기서 정합성을 알려드립니다.
        </span>
      </div>
    );
  }

  const notes = state.notes ?? [];
  if (notes.length === 0) return null;

  return (
    <div className="brief-advisory">
      <div className="ba-head">
        <span className="ba-tag">브리프 대조</span>
        <span className="ba-text">
          브리프({state.briefTitle})에 없는 이름 {notes.length}개 — 신규 도입이면 그대로 두고,
          오타면 기존 이름으로 고치세요.
        </span>
        <button className="btn ghost sm" onClick={() => setOpen(!open)}>
          {open ? '접기' : '펼치기'}
        </button>
      </div>
      {open && (
        <ul className="ba-list">
          {notes.map((n) => (
            <li key={n.name}>
              <code>{n.name}</code>
              <span className="ba-where">{n.sections.join(' · ')}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { startFromIdea } from '../lib/newPlan.ts';

/**
 * 새 기획 시트 (진입 재설계 시안 3) — 별도 페이지가 아니라 지금 문맥 위에 뜬다.
 * ⌘N / 스위처 + / "새 기획" 버튼이 연다.
 */
export function NewPlanSheet({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const [idea, setIdea] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function go() {
    if (!idea.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const path = await startFromIdea(idea);
      onClose();
      nav(path);
    } catch (err) {
      setError((err as Error)?.message ?? '생성에 실패했습니다');
      setBusy(false);
    }
  }

  return (
    <div className="sheet-veil" onClick={onClose}>
      <div className="plan-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="eyebrow">New Plan · ⌘N</div>
        <h2>무엇을 만들까요?</h2>
        <input
          ref={inputRef}
          className="field"
          placeholder="아이디어 한 줄. 이름과 범위는 인터뷰에서 정리됩니다."
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && go()}
        />
        {error && <div className="form-error">{error}</div>}
        <div className="plan-sheet-row">
          <button className="btn pri" disabled={!idea.trim() || busy} onClick={go}>
            {busy ? '만드는 중…' : '인터뷰 시작'}
          </button>
          <button className="btn" onClick={onClose}>
            닫기
          </button>
          <span className="hint mono">답이 곧 제안의 근거가 됩니다</span>
        </div>
      </div>
    </div>
  );
}

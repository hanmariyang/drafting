import { useState } from 'react';
import { Choani } from './Choani.tsx';
import type { Suggestion } from '../lib/api.ts';
import { kindLabel, type UseSuggestions } from '../lib/suggestions.ts';

interface Props {
  s: UseSuggestions;
  /** 카드 hover ↔ 본문 하이라이트 왕복: 포커스된 sectionId 를 위로 통지 */
  onFocusSection: (sectionId: string | null) => void;
  /** 본문에서 섹션을 hover/클릭했을 때 내려오는 포커스 sectionId (역방향) */
  focusedSection?: string | null;
  /** 오늘/이 문서 처리 통계 라인 (선택) */
  doneLine?: React.ReactNode;
}

export function SuggestionsPanel({ s, onFocusSection, focusedSection, doneLine }: Props) {
  const { suggestions, accept, reject, rewrite, acceptAll } = s;
  const count = suggestions.length;

  return (
    <>
      <div className="ph">
        제안 <span className="cnt">{count}</span>
        <button className="all" disabled={count === 0} onClick={() => acceptAll()}>
          모두 수락
        </button>
      </div>

      {count === 0 ? (
        <div className="panel-empty">
          <Choani pose="wait" size={72} />
          검토할 제안이 없어요.
          <br />
          <b>문서를 이어 쓰면 다시 물어올게요.</b>
        </div>
      ) : (
        suggestions.map((sg) => (
          <SuggestionCard
            key={sg.id}
            sg={sg}
            focused={!!sg.sectionId && focusedSection === sg.sectionId}
            onAccept={() => accept(sg.id)}
            onReject={() => reject(sg.id)}
            onRewrite={(inst) => rewrite(sg.id, inst)}
            onEnter={() => sg.sectionId && onFocusSection(sg.sectionId)}
            onLeave={() => onFocusSection(null)}
          />
        ))
      )}

      {doneLine && <div className="done-line">{doneLine}</div>}
    </>
  );
}

function SuggestionCard({
  sg,
  focused,
  onAccept,
  onReject,
  onRewrite,
  onEnter,
  onLeave,
}: {
  sg: Suggestion;
  focused: boolean;
  onAccept: () => Promise<void>;
  onReject: () => Promise<void>;
  onRewrite: (instruction: string) => Promise<void>;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const [collapsing, setCollapsing] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const isQuestion = sg.kind === 'question';

  // 처리 시 카드 접힘 모션(180ms) 후 실제 처리
  function withCollapse(fn: () => Promise<void>) {
    setBusy(true);
    setCollapsing(true);
    window.setTimeout(() => {
      fn().catch(() => {
        setCollapsing(false);
        setBusy(false);
      });
    }, 180);
  }

  async function submitRewrite() {
    const inst = instruction.trim();
    if (!inst || busy) return;
    setBusy(true);
    try {
      await onRewrite(inst);
      setInstruction('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`sug-card ${collapsing ? 'collapsing' : ''} ${focused ? 'focus' : ''}`}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className="who">
        <Choani pose="fetch" size={20} animate={false} />
        <b>{sg.title || kindLabel(sg.kind)}</b>
        <span className="why">{sg.source}</span>
      </div>
      {sg.body}
      {(sg.quoteBefore || sg.quoteAfter) && (
        <div className="quote">
          {sg.quoteBefore && <span>&ldquo;{sg.quoteBefore}&rdquo; </span>}
          {sg.quoteAfter && (
            <>
              <span className="arrow">→</span> <span>&ldquo;{sg.quoteAfter}&rdquo;</span>
            </>
          )}
        </div>
      )}
      <div className="sug-acts">
        <button className="btn ok" disabled={busy} onClick={() => withCollapse(onAccept)}>
          {isQuestion ? '답하기' : '수락'}
        </button>
        <button className="btn" disabled={busy} onClick={() => withCollapse(onReject)}>
          {isQuestion ? '넘기기' : '거절'}
        </button>
      </div>
      {!isQuestion && (
        <div className="sug-acts rewrite">
          <input
            placeholder="고쳐쓰기 지시"
            value={instruction}
            disabled={busy}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitRewrite()}
          />
        </div>
      )}
    </div>
  );
}

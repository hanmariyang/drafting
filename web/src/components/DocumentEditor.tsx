import { Choani } from './Choani.tsx';
import {
  useRef,
  useState,
  useEffect,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { api, type DocumentModel } from '../lib/api.ts';
import { toLive, type LiveSection } from '../lib/live.ts';
import { renderMarkdown } from '../lib/md.ts';

interface Props {
  doc: DocumentModel;
  sections: LiveSection[];
  setSections: Dispatch<SetStateAction<LiveSection[]>>;
  streaming: boolean;
  focusSection: string | null; // 패널 카드 hover 시 하이라이트할 섹션
  onFocusSection: (sectionId: string | null) => void; // 본문 hover → 패널 카드 (역방향)
  onRegenerate: (sectionId: string) => void;
  onRename: (title: string) => void;
  onStructuralChange: () => void;
  onSaveState: (s: 'idle' | 'saving' | 'saved') => void;
  error: string;
  onBackToInterview: () => void;
  onStop?: () => void;
}

export function DocumentEditor({
  doc,
  sections,
  setSections,
  streaming,
  focusSection,
  onFocusSection,
  onRegenerate,
  onRename,
  onStructuralChange,
  onSaveState,
  error,
  onBackToInterview,
  onStop,
}: Props) {
  const [title, setTitle] = useState(doc.title);
  const [editing, setEditing] = useState<string | null>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => setTitle(doc.title), [doc.id, doc.title]);

  function editSection(id: string, patch: { heading?: string; body?: string }) {
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    onSaveState('saving');
    clearTimeout(timers.current[id]);
    timers.current[id] = setTimeout(async () => {
      await api.updateSection(id, patch);
      onSaveState('saved');
      onStructuralChange();
      setTimeout(() => onSaveState('idle'), 1500);
    }, 2000);
  }

  async function addSection() {
    const s = await api.addSection(doc.id, '새 섹션', '');
    setSections((prev) => [...prev, { ...s, streaming: false, editable: true }]);
    onStructuralChange();
  }

  // 섹션 순서 이동(↑/↓) — 로컬 재배열 후 서버에 새 순서 저장. 실패 시 되돌린다.
  async function moveSection(id: string, dir: -1 | 1) {
    let reordered: typeof sections | null = null;
    setSections((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[to]] = [next[to], next[idx]];
      reordered = next;
      return next;
    });
    if (!reordered) return;
    onSaveState('saving');
    try {
      await api.reorderSections(doc.id, (reordered as typeof sections).map((s) => s.id));
      onSaveState('saved');
      onStructuralChange();
      setTimeout(() => onSaveState('idle'), 1200);
    } catch {
      // 실패 시 원위치
      setSections((prev) => {
        const idx = prev.findIndex((s) => s.id === id);
        const back = idx - dir;
        if (idx < 0 || back < 0 || back >= prev.length) return prev;
        const next = [...prev];
        [next[idx], next[back]] = [next[back], next[idx]];
        return next;
      });
      onSaveState('idle');
    }
  }

  // 마지막 변경 되돌리기 — 직전 스냅샷 복원. 실패(되돌릴 것 없음)는 조용히 무시.
  async function undoLast() {
    try {
      const res = await api.undo(doc.id);
      setSections(res.sections.map((s) => toLive(s)));
      onStructuralChange();
      onSaveState('saved');
      setTimeout(() => onSaveState('idle'), 1200);
    } catch {
      /* 되돌릴 변경 없음 등 — 무시 */
    }
  }

  async function removeSection(id: string) {
    await api.deleteSection(id);
    setSections((prev) => prev.filter((s) => s.id !== id));
    onStructuralChange();
  }

  const proposedCount = sections.filter((s) => s.status === 'proposed').length;
  const acceptedCount = sections.filter((s) => s.status !== 'proposed' && s.status !== 'rejected').length;

  return (
    <main className="editor">
      <div className="editor-inner">
        <div className="doc-head">
          <div className="eyebrow">
            {doc.type.toUpperCase()} · V{doc.version}
          </div>
          <h2
            contentEditable={!streaming}
            suppressContentEditableWarning
            onInput={(e) => setTitle(e.currentTarget.textContent ?? '')}
            onBlur={() => title.trim() && title !== doc.title && onRename(title.trim())}
          >
            {doc.title}
          </h2>
          <div className="meta">
            <span>
              확정 {acceptedCount}문장{proposedCount > 0 ? ` · 제안 ${proposedCount}건` : ''}
            </span>
            <span className="sep">·</span>
            <button className="btn ghost sm" onClick={onBackToInterview} title="인터뷰로 돌아가기">
              인터뷰
            </button>
            <span className="sep">·</span>
            <button
              className="btn ghost sm"
              disabled={streaming}
              onClick={undoLast}
              title="마지막 변경 되돌리기 (더 깊은 복원은 버전 기록)"
            >
              되돌리기
            </button>
          </div>
        </div>

        {error && (
          <div className="err" style={{ marginBottom: 12 }}>
            {error}
          </div>
        )}

        {streaming && (
          <div className="ch-strip">
            <Choani pose="write" size={34} />
            <span>초안을 쓰는 중이에요. 다 쓰면 전부 제안으로 보여드릴게요.</span>
            {onStop && (
              <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={onStop}>
                중지
              </button>
            )}
          </div>
        )}

        {sections.length === 0 && !streaming && (
          <div className="empty">
            <Choani pose="wait" size={64} />
            <div style={{ marginTop: 10 }}>
              <b>AI 초안 생성</b>을 누르면 여기에 초안이 <b>제안 상태</b>로 채워집니다.
              <br />
              수락한 문장만 문서에 남습니다.
            </div>
          </div>
        )}

        {sections.map((s, i) => (
          <SectionBlock
            key={s.id}
            section={s}
            focused={focusSection === s.id}
            streaming={streaming}
            editing={editing === s.id}
            canMoveUp={i > 0}
            canMoveDown={i < sections.length - 1}
            onMove={(dir) => moveSection(s.id, dir)}
            onEnter={() => s.status === 'proposed' && onFocusSection(s.id)}
            onLeave={() => onFocusSection(null)}
            onToggleEdit={() =>
              setEditing((cur) => (cur === s.id ? null : s.status === 'proposed' ? cur : s.id))
            }
            onEdit={(patch) => editSection(s.id, patch)}
            onRegenerate={() => onRegenerate(s.id)}
            onRemove={() => removeSection(s.id)}
          />
        ))}

        {!streaming && sections.length > 0 && (
          <button className="btn" style={{ marginTop: 12 }} onClick={addSection}>
            + 섹션 추가
          </button>
        )}
      </div>
    </main>
  );
}

function SectionBlock({
  section,
  focused,
  streaming,
  editing,
  canMoveUp,
  canMoveDown,
  onMove,
  onEnter,
  onLeave,
  onToggleEdit,
  onEdit,
  onRegenerate,
  onRemove,
}: {
  section: LiveSection;
  focused: boolean;
  streaming: boolean;
  editing: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (dir: -1 | 1) => void;
  onEnter: () => void;
  onLeave: () => void;
  onToggleEdit: () => void;
  onEdit: (patch: { heading?: string; body?: string }) => void;
  onRegenerate: () => void;
  onRemove: () => void;
}) {
  // status: proposed → sug 하이라이트 / accepted(default) → ink / rejected → 숨김에 준함
  const proposed = section.status === 'proposed';
  const del = section.kindHint === 'delete';
  const cls = ['sec', proposed ? 'proposed' : '', del ? 'del' : '', focused ? 'focus' : ''].join(' ');

  return (
    <div className={cls} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <div className="sec-head">
        {editing ? (
          <input
            value={section.heading}
            disabled={section.streaming}
            onChange={(e) => onEdit({ heading: e.target.value })}
            style={{ flex: 1, border: '1px solid var(--hair)', borderRadius: 6, padding: '4px 8px', fontWeight: 800 }}
          />
        ) : (
          <h3>{section.heading}</h3>
        )}
        {section.streaming ? (
          <span className="pill" style={{ color: 'var(--sug)', borderColor: 'var(--sug-line)' }}>
            {section.body.trim() ? '스트리밍 중…' : '생각 중…'}
          </span>
        ) : (
          <div className="sec-tools">
            <button
              className="btn icon"
              disabled={streaming || !canMoveUp}
              onClick={() => onMove(-1)}
              title="위로"
              aria-label="섹션 위로"
            >
              ↑
            </button>
            <button
              className="btn icon"
              disabled={streaming || !canMoveDown}
              onClick={() => onMove(1)}
              title="아래로"
              aria-label="섹션 아래로"
            >
              ↓
            </button>
            {!proposed && (
              <button className="btn" onClick={onToggleEdit} title="편집 토글">
                {editing ? '완료' : '편집'}
              </button>
            )}
            <button
              className="btn"
              disabled={streaming}
              onClick={onRegenerate}
              title="이 섹션만 재생성 (다른 섹션 불변)"
            >
              재생성
            </button>
            {!proposed && (
              <button className="btn danger" disabled={streaming} onClick={onRemove}>
                삭제
              </button>
            )}
          </div>
        )}
      </div>

      {editing && !proposed ? (
        <div className="sec-edit">
          <textarea
            value={section.body}
            onChange={(e) => onEdit({ body: e.target.value })}
            placeholder="마크다운으로 편집…"
          />
        </div>
      ) : section.streaming && !section.body.trim() ? (
        // 추론형 모델은 본문 전에 오래 '생각'한다 — 빈칸 대신 상태를 보여준다
        <div className="sec-body thinking">모델이 생각하고 있어요… (추론형 모델은 잠시 걸립니다)</div>
      ) : (
        <div
          className={`sec-body ${section.streaming ? 'cursor' : ''}`}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(section.body) }}
        />
      )}
    </div>
  );
}

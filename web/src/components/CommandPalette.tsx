import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, openSuggestionsOf } from '../lib/api.ts';
import { openNewPlan } from '../App.tsx';

interface Item {
  key: string;
  kind: 'action' | 'project' | 'document';
  label: string;
  detail?: string;
  count?: number;
  go: () => void;
}

/**
 * ⌘K 커맨드 팔레트 — 목록 브라우징 대신 타이핑 점프 (iA Writer Quick Search 계보).
 * 프로젝트·문서 전역 + 새 기획/시작 화면/설정 액션.
 */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [items, setItems] = useState<Item[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    let alive = true;
    (async () => {
      const base: Item[] = [
        { key: 'a:new', kind: 'action', label: '새 기획', detail: '⌘N', go: () => { onClose(); openNewPlan(); } },
        { key: 'a:start', kind: 'action', label: '시작 화면', go: () => { onClose(); nav('/'); } },
        { key: 'a:settings', kind: 'action', label: '설정', go: () => { onClose(); nav('/settings'); } },
        { key: 'a:templates', kind: 'action', label: '템플릿 라이브러리', go: () => { onClose(); nav('/templates'); } },
      ];
      if (alive) setItems(base);
      try {
        const projects = await api.listProjects();
        const rich: Item[] = [...base];
        for (const p of projects) {
          rich.push({
            key: `p:${p.id}`, kind: 'project', label: p.name, count: openSuggestionsOf(p),
            go: () => { onClose(); nav(`/projects/${p.id}`); },
          });
        }
        const docLists = await Promise.all(
          projects.map((p) => api.getProject(p.id).then((d) => ({ p, docs: d.documents })).catch(() => ({ p, docs: [] }))),
        );
        for (const { p, docs } of docLists) {
          for (const d of docs) {
            rich.push({
              key: `d:${d.id}`, kind: 'document', label: d.title, detail: p.name, count: openSuggestionsOf(d),
              go: () => { onClose(); nav(`/projects/${p.id}/documents/${d.id}`); },
            });
          }
        }
        if (alive) setItems(rich);
      } catch {
        /* offline — actions only */
      }
    })();
    return () => { alive = false; };
  }, [nav, onClose]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(
      (i) => i.label.toLowerCase().includes(needle) || (i.detail ?? '').toLowerCase().includes(needle),
    );
  }, [items, q]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('.pal-item.on')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); filtered[sel]?.go(); }
    else if (e.key === 'Escape') onClose();
  }

  const KIND_TAG: Record<Item['kind'], string> = { action: 'GO', project: 'PROJ', document: 'DOC' };

  return (
    <div className="sheet-veil pal-veil" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="pal-input"
          placeholder="프로젝트·문서로 점프, 또는 명령…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="pal-list" ref={listRef}>
          {filtered.length === 0 ? (
            <div className="pal-empty">일치하는 항목이 없습니다</div>
          ) : (
            filtered.map((i, idx) => (
              <button
                key={i.key}
                className={`pal-item ${idx === sel ? 'on' : ''}`}
                onMouseEnter={() => setSel(idx)}
                onClick={i.go}
              >
                <span className="t mono">{KIND_TAG[i.kind]}</span>
                <span className="nm">{i.label}</span>
                {i.detail && <span className="dt">{i.detail}</span>}
                {(i.count ?? 0) > 0 && (
                  <span className="gd mono">
                    <i />
                    {i.count}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
        <div className="pal-foot mono">↑↓ 이동 · Enter 열기 · Esc 닫기</div>
      </div>
    </div>
  );
}

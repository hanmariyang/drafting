import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, openSuggestionsOf, type DocumentModel, type DocumentType, type Project } from '../lib/api.ts';
import { openNewPlan } from '../App.tsx';

const TYPE_BADGE: Record<DocumentType, string> = {
  prd: 'PRD',
  'feature-spec': 'SPEC',
  ia: 'IA',
  'user-flow': 'FLOW',
  'design-system': 'DS',
  handoff: 'DEV',
};

interface ChainNode {
  doc: DocumentModel;
  depth: number;
}

/** 부모→자식 계층으로 문서 체인을 평탄화한다. 순환·고아 방어. */
function buildChain(docs: DocumentModel[]): ChainNode[] {
  const byParent = new Map<string | null, DocumentModel[]>();
  for (const d of docs) {
    const key = d.parent_document_id ?? null;
    (byParent.get(key) ?? byParent.set(key, []).get(key)!).push(d);
  }
  const out: ChainNode[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const d of byParent.get(parent) ?? []) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      out.push({ doc: d, depth: Math.min(depth, 2) });
      walk(d.id, depth + 1);
    }
  };
  walk(null, 0);
  // 고아(부모가 목록에 없는) 노드 구제
  for (const d of docs) {
    if (!seen.has(d.id)) {
      seen.add(d.id);
      out.push({ doc: d, depth: 0 });
    }
  }
  return out;
}

interface Props {
  projectId: string;
  projectName: string;
  documents: DocumentModel[];
  activeDocId?: string;
  /** 문서별 열린 제안 수 (병렬 API 있을 때만) */
  suggestionCounts?: Record<string, number>;
}

export function DocChainTree({
  projectId,
  projectName,
  documents,
  activeDocId,
  suggestionCounts = {},
}: Props) {
  const nav = useNavigate();
  const chain = buildChain(documents);

  return (
    <>
      <ProjectSwitcher currentId={projectId} currentName={projectName} />
      <div className="grp">문서 체인</div>
      {chain.length === 0 ? (
        <div className="nd" style={{ color: 'var(--sub)', cursor: 'default' }}>
          문서 없음
        </div>
      ) : (
        chain.map(({ doc, depth }) => {
          const cnt = suggestionCounts[doc.id] ?? openSuggestionsOf(doc);
          const stale = doc.context_stale === 1;
          return (
            <button
              key={doc.id}
              className={`nd ${depth === 1 ? 'child' : ''} ${depth === 2 ? 'gchild' : ''} ${
                doc.id === activeDocId ? 'on' : ''
              }`}
              onClick={() => nav(`/projects/${projectId}/documents/${doc.id}`)}
            >
              <span className="t">{TYPE_BADGE[doc.type]}</span>
              <span className="name">{doc.title}</span>
              {cnt > 0 ? (
                <span className="sug-dot">{cnt}</span>
              ) : stale ? (
                <span className="stale-dot" title="컨텍스트 갱신 필요">
                  !
                </span>
              ) : null}
            </button>
          );
        })
      )}
      <div className="grp">보관</div>
      <button className="nd" onClick={() => nav(`/projects/${projectId}`)}>
        <span className="t">PROJ</span>
        <span className="name">프로젝트 개요</span>
      </button>
    </>
  );
}


/**
 * 프로젝트 스위처 (진입 재설계 시안 2) — 프로젝트 목록 페이지를 대체한다.
 * ▾ 로 전환, + 로 새 기획 시트.
 */
export function ProjectSwitcher({ currentId, currentName }: { currentId: string; currentName: string }) {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Project[] | null>(null);

  // 라우트가 바뀌면 메뉴를 닫고 목록 캐시를 버린다 (같은 라우트 컴포넌트라 state가 살아남음)
  useEffect(() => {
    setOpen(false);
    setItems(null);
  }, [currentId]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && items === null) {
      api.listProjects().then(setItems).catch(() => setItems([]));
    }
  }

  return (
    <div className="switcher">
      <div className="sw-bar">
        <button className="sw-cur" onClick={toggle} title="프로젝트 전환">
          <b>{currentName}</b>
          <span className="car">{open ? '▴' : '▾'}</span>
        </button>
        <button className="sw-plus" onClick={openNewPlan} title="새 기획 (⌘N)">
          +
        </button>
      </div>
      {open && (
        <div className="sw-menu">
          {items === null ? (
            <div className="sw-empty">불러오는 중…</div>
          ) : (
            items.map((p) => {
              const cnt = openSuggestionsOf(p);
              return (
                <button
                  key={p.id}
                  className={`sw-item ${p.id === currentId ? 'on' : ''}`}
                  onClick={() => {
                    setOpen(false);
                    nav(`/projects/${p.id}`);
                  }}
                >
                  <span className="nm">{p.name}</span>
                  {cnt > 0 && (
                    <span className="gd">
                      <i />
                      {cnt}
                    </span>
                  )}
                </button>
              );
            })
          )}
          <button
            className="sw-item alt"
            onClick={() => {
              setOpen(false);
              nav('/');
            }}
          >
            <span className="nm">시작 화면</span>
          </button>
        </div>
      )}
    </div>
  );
}

export { TYPE_BADGE };

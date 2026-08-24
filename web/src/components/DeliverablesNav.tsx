import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, openSuggestionsOf, type DocumentModel, type DocumentType } from '../lib/api.ts';
import { ProjectSwitcher } from './DocChainTree.tsx';

export type NavKey = 'INT' | 'PRD' | 'SPEC' | 'IA' | 'FLOW' | 'DS' | 'WF' | 'DEV' | 'HUB';

interface NodeDef {
  key: NavKey;
  type: DocumentType;
  label: string;
  dim?: boolean;
}
const DELIVERABLES: NodeDef[] = [
  { key: 'INT', type: 'prd', label: '아이디어 인터뷰', dim: true },
  { key: 'PRD', type: 'prd', label: '제품 요구사항' },
  { key: 'SPEC', type: 'feature-spec', label: '기능명세서' },
  { key: 'IA', type: 'ia', label: '정보 구조' },
  { key: 'FLOW', type: 'user-flow', label: '유저 플로우' },
  { key: 'DS', type: 'design-system', label: '디자인 시스템' },
];

/** parent-of relationship for lazily creating a missing structure document. */
function parentFor(type: DocumentType, byType: Partial<Record<DocumentType, DocumentModel>>): string | null {
  if (type === 'feature-spec') return byType.prd?.id ?? null;
  if (type === 'ia') return byType['feature-spec']?.id ?? byType.prd?.id ?? null;
  if (type === 'user-flow')
    return byType.ia?.id ?? byType['feature-spec']?.id ?? byType.prd?.id ?? null;
  if (type === 'design-system')
    return byType['user-flow']?.id ?? byType.ia?.id ?? byType.prd?.id ?? null;
  return null;
}
const TITLE: Record<DocumentType, string> = {
  prd: '제품 요구사항',
  'feature-spec': '기능명세서',
  ia: '정보 구조',
  'user-flow': '유저 플로우',
  'design-system': '디자인 시스템',
  handoff: '개발 지시서',
};

interface Props {
  projectId: string;
  projectName: string;
  documents: DocumentModel[];
  active: NavKey;
  /** override 제안 수 for the currently-open doc (live count). */
  activeCount?: number;
}

/**
 * Re-organized nav (시안 · §7): 산출물 그룹(INT·PRD·SPEC·IA·FLOW) + 파생 그룹
 * (WF·DEV) + 하단 산출물 허브 링크. Structure docs are created on first click.
 */
export function DeliverablesNav({ projectId, projectName, documents, active, activeCount }: Props) {
  const nav = useNavigate();
  const [locked, setLocked] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const byType: Partial<Record<DocumentType, DocumentModel>> = {};
  for (const d of documents) if (!byType[d.type]) byType[d.type] = d;

  useEffect(() => {
    api
      .lint(projectId)
      .then((r) => setLocked(r.effectiveCount))
      .catch(() => setLocked(null));
  }, [projectId, documents.length]);

  async function openType(def: NodeDef) {
    if (busy) return;
    let doc = byType[def.type];
    if (!doc) {
      setBusy(true);
      try {
        doc = await api.createDocument(projectId, {
          type: def.type,
          title: TITLE[def.type],
          parentDocumentId: parentFor(def.type, byType),
        });
      } finally {
        setBusy(false);
      }
    }
    nav(`/projects/${projectId}/documents/${doc.id}`);
  }

  function countFor(def: NodeDef): number {
    const doc = byType[def.type];
    if (!doc) return 0;
    if (active === def.key && activeCount != null) return activeCount;
    return openSuggestionsOf(doc);
  }

  return (
    <div className="dnav">
      <ProjectSwitcher currentId={projectId} currentName={projectName} />

      <div className="grp">산출물</div>
      {DELIVERABLES.map((def) => {
        const cnt = def.key === 'INT' ? 0 : countFor(def);
        const exists = !!byType[def.type];
        return (
          <button
            key={def.key}
            className={`node ${active === def.key ? 'on' : ''} ${def.dim ? 'dim' : ''}`}
            onClick={() => openType(def)}
          >
            <span className="tb">{def.key}</span>
            <span className="nm">{def.label}</span>
            {cnt > 0 ? (
              <span className="gd">
                <i />
                {cnt}
              </span>
            ) : exists || def.key === 'INT' ? (
              <span className="ok">✓</span>
            ) : null}
          </button>
        );
      })}

      <div className="grp">파생</div>
      <button
        className={`node ${active === 'WF' ? 'on' : ''}`}
        onClick={() => nav(`/projects/${projectId}/wireframes`)}
      >
        <span className="tb der">WF</span>
        <span className="nm">와이어프레임</span>
        <span className="auto">자동</span>
      </button>
      <button
        className={`node ${active === 'DEV' ? 'on' : ''}`}
        onClick={() => nav(`/projects/${projectId}/handoff`)}
      >
        <span className="tb der">DEV</span>
        <span className="nm">개발 지시서</span>
        {locked && locked > 0 ? (
          <span className="lock">검사 {locked}건</span>
        ) : (
          <span className="auto">준비</span>
        )}
      </button>

      <div className="navsp" />
      <button
        className={`hubln ${active === 'HUB' ? 'on' : ''}`}
        onClick={() => nav(`/projects/${projectId}`)}
      >
        ◧ 산출물 허브
      </button>
    </div>
  );
}

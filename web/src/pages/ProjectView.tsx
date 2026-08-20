import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api, type DocumentModel, type DocumentType } from '../lib/api.ts';
import { AppShell } from '../components/AppShell.tsx';
import { DocChainTree, TYPE_BADGE } from '../components/DocChainTree.tsx';

const TYPE_LABEL: Record<DocumentType, string> = {
  prd: 'PRD',
  'feature-spec': '기능명세',
  ia: 'IA',
  'user-flow': '유저플로우',
};

export function ProjectView() {
  const { pid } = useParams();
  const nav = useNavigate();
  const [project, setProject] = useState<{ name: string; documents: DocumentModel[] } | null>(null);
  const [type, setType] = useState<DocumentType>('prd');
  const [title, setTitle] = useState('');
  const [parent, setParent] = useState<string>('');

  const load = useCallback(async () => {
    if (!pid) return;
    setProject(await api.getProject(pid));
  }, [pid]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function createDoc() {
    if (!pid || !title.trim()) return;
    const doc = await api.createDocument(pid, {
      type,
      title: title.trim(),
      parentDocumentId: parent || null,
    });
    nav(`/projects/${pid}/documents/${doc.id}`);
  }

  if (!project) {
    return (
      <AppShell crumb={<span>불러오는 중…</span>}>
        <main className="editor">
          <div className="editor-inner center-empty">불러오는 중…</div>
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell
      crumb={
        <>
          <Link to="/">프로젝트</Link>
          <span className="sep">/</span>
          <b className="name">{project.name}</b>
        </>
      }
      tbarRight={
        <>
          <Link className="btn" to="/settings">
            설정
          </Link>
          <span className="cmdk">⌘K</span>
        </>
      }
      nav={
        <DocChainTree
          projectId={pid!}
          projectName={project.name}
          documents={project.documents}
        />
      }
      tagline="상위 문서가 바뀌면 하위 항목은 다시 제안 상태로 돌아옵니다"
      statusLeft={<span>문서 {project.documents.length}건</span>}
    >
      <main className="editor">
        <div className="editor-inner">
          <div className="doc-head">
            <div className="eyebrow">프로젝트</div>
            <h2>{project.name}</h2>
            <div className="meta">문서 체인 · {project.documents.length}건</div>
          </div>

          <h3 style={{ fontSize: 15, fontWeight: 800, margin: '0 0 8px' }}>새 문서</h3>
          <div className="new-row" style={{ maxWidth: 720, flexWrap: 'wrap' }}>
            <select
              className="field"
              style={{ maxWidth: 150 }}
              value={type}
              onChange={(e) => setType(e.target.value as DocumentType)}
            >
              <option value="prd">PRD</option>
              <option value="feature-spec">기능명세서</option>
              <option value="ia">IA (v2)</option>
              <option value="user-flow">유저플로우 (v2)</option>
            </select>
            <input
              className="field"
              style={{ maxWidth: 240 }}
              placeholder="문서 제목"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createDoc()}
            />
            <select
              className="field"
              style={{ maxWidth: 200 }}
              value={parent}
              onChange={(e) => setParent(e.target.value)}
            >
              <option value="">상위 문서 없음</option>
              {project.documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {TYPE_LABEL[d.type]}: {d.title}
                </option>
              ))}
            </select>
            <button className="btn pri" disabled={!title.trim()} onClick={createDoc}>
              문서 생성
            </button>
          </div>

          <div className="divider" />

          <h3 style={{ fontSize: 15, fontWeight: 800, margin: '0 0 8px' }}>문서</h3>
          {project.documents.length === 0 ? (
            <div className="center-empty">문서가 없습니다. 위에서 첫 문서를 만드세요.</div>
          ) : (
            <div style={{ maxWidth: 720, border: '1px solid var(--hair)', borderRadius: 'var(--r-card)', overflow: 'hidden' }}>
              {project.documents.map((d) => (
                <div
                  key={d.id}
                  className="spec-row"
                  style={{ cursor: 'pointer' }}
                  onClick={() => nav(`/projects/${pid}/documents/${d.id}`)}
                >
                  <span className="id">{TYPE_BADGE[d.type]}</span>
                  <span className="txt">{d.title}</span>
                  {d.context_stale === 1 && (
                    <span className="pill-proposed" title="컨텍스트 갱신 필요">
                      갱신 필요
                    </span>
                  )}
                  <span className="cnt mono">v{d.version}</span>
                  <span className="tag">{d.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </AppShell>
  );
}

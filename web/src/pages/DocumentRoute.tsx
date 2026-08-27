import { useEffect, useState } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { api, type DocumentModel } from '../lib/api.ts';
import { DocumentWorkspace } from './DocumentWorkspace.tsx';
import { StructureWorkspace } from './StructureWorkspace.tsx';
import { DesignSystemWorkspace } from './DesignSystemWorkspace.tsx';
import { AppShell } from '../components/AppShell.tsx';

const STRUCTURE = new Set(['feature-spec', 'ia', 'user-flow']);

/**
 * Dispatch a document to the right workspace by type: PRD → prose section editor
 * (existing), SPEC/IA/FLOW → structure item editor, handoff → the DEV page.
 */
export function DocumentRoute() {
  const { pid, did } = useParams();
  const [doc, setDoc] = useState<DocumentModel | null>(null);
  const [sectionCount, setSectionCount] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    setDoc(null);
    setError('');
    api
      .getDocument(did!)
      .then((d) => {
        if (!live) return;
        setDoc(d.document);
        setSectionCount(d.sections.length);
      })
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [did]);

  if (error) {
    return (
      <AppShell crumb={<span>오류</span>}>
        <main className="editor">
          <div className="center-empty err">{error}</div>
        </main>
      </AppShell>
    );
  }
  if (!doc) {
    return (
      <AppShell crumb={<span>불러오는 중…</span>}>
        <main className="editor">
          <div className="center-empty">불러오는 중…</div>
        </main>
      </AppShell>
    );
  }
  if (doc.type === 'handoff') return <Navigate to={`/projects/${pid}/handoff`} replace />;
  if (doc.type === 'design-system') return <DesignSystemWorkspace key={doc.id} doc={doc} />;
  // #91: 구조 타입이라도 산문 섹션으로 작성된 문서(외부 MCP 등)는 섹션 편집기로 —
  // StructureWorkspace 는 plan_items 기반이라 섹션 내용이 있는 문서가 빈 화면으로 보였다.
  if (STRUCTURE.has(doc.type) && sectionCount === 0) return <StructureWorkspace key={doc.id} doc={doc} />;
  if (STRUCTURE.has(doc.type)) return <DocumentWorkspace key={doc.id} />;
  return <DocumentWorkspace />;
}

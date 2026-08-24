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
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    setDoc(null);
    setError('');
    api
      .getDocument(did!)
      .then((d) => live && setDoc(d.document))
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
  if (STRUCTURE.has(doc.type)) return <StructureWorkspace key={doc.id} doc={doc} />;
  return <DocumentWorkspace />;
}

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  api,
  streamDraft,
  streamRegenerate,
  type DocumentModel,
  type InterviewSession,
  type InterviewTemplate,
  type Project,
  type DocumentType,
} from '../lib/api.ts';
import { toLive, type LiveSection } from '../lib/live.ts';
import { useMeta } from '../App.tsx';
import { useSuggestions } from '../lib/suggestions.ts';
import { rememberLastDoc } from '../lib/newPlan.ts';
import { AppShell } from '../components/AppShell.tsx';
import { DocChainTree } from '../components/DocChainTree.tsx';
import { InterviewPanel } from '../components/InterviewPanel.tsx';
import { DocumentEditor } from '../components/DocumentEditor.tsx';
import { SuggestionsPanel } from '../components/SuggestionsPanel.tsx';
import { VersionHistory } from '../components/VersionHistory.tsx';
import { SharePanel } from '../components/SharePanel.tsx';
import { ContextRefreshDialog } from '../components/ContextRefreshDialog.tsx';

const TYPE_LABEL: Record<DocumentType, string> = {
  prd: 'PRD',
  'feature-spec': '기능명세',
  ia: 'IA',
  'user-flow': '유저플로우',
};

export function DocumentWorkspace() {
  const { pid, did } = useParams();
  const docId = did!;
  const { meta } = useMeta();

  const [doc, setDoc] = useState<DocumentModel | null>(null);
  const [sections, setSections] = useState<LiveSection[]>([]);
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [template, setTemplate] = useState<InterviewTemplate | null>(null);
  const [parentAvailable, setParentAvailable] = useState(false);
  const [project, setProject] = useState<{ name: string; documents: DocumentModel[] } | null>(null);

  const [streaming, setStreaming] = useState(false);
  const [mode, setMode] = useState<'interview' | 'editor'>('editor');
  const [error, setError] = useState('');
  const [modal, setModal] = useState<'versions' | 'share' | 'context' | null>(null);
  const [focusSection, setFocusSection] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const esRef = useRef<EventSource | null>(null);

  const refreshDocMeta = useCallback(async () => {
    const data = await api.getDocument(docId);
    setDoc(data.document);
    setParentAvailable(data.parentContextAvailable);
  }, [docId]);

  // 제안 처리 후: 섹션 상태(proposed→accepted)까지 다시 읽어 "마르는" 전환을 보인다.
  // CSS transition(.sec.proposed .sec-body, 200ms)이 색이 잉크로 걷히는 모션을 담당.
  const refreshAfterSuggestion = useCallback(async () => {
    const data = await api.getDocument(docId);
    setDoc(data.document);
    setParentAvailable(data.parentContextAvailable);
    setSections((prev) => {
      const live = data.sections.map((s) => toLive(s));
      // 스트리밍 중 섹션 로컬 상태는 보존
      const streamingIds = new Set(prev.filter((s) => s.streaming).map((s) => s.id));
      return streamingIds.size ? prev : live;
    });
  }, [docId]);

  const sug = useSuggestions(docId, refreshAfterSuggestion);

  const loadAll = useCallback(async () => {
    const data = await api.getDocument(docId);
    setDoc(data.document);
    setSections(data.sections.map((s) => toLive(s)));
    setParentAvailable(data.parentContextAvailable);
    // 섹션이 하나도 없으면 인터뷰부터 (기존 플로우 유지)
    setMode(data.sections.length === 0 ? 'interview' : 'editor');
    const iv = await api.startInterview(docId); // idempotent
    setSession(iv.session);
    setTemplate(iv.template);
    if (pid) api.getProject(pid).then(setProject).catch(() => {});
  }, [docId, pid]);

  useEffect(() => {
    loadAll().catch((e) => setError((e as Error).message));
    return () => esRef.current?.close();
  }, [loadAll]);

  // 복원 착지(시안 2)용: 마지막으로 연 문서를 기억한다
  useEffect(() => {
    if (doc && project && pid) {
      rememberLastDoc({
        pid,
        did: doc.id,
        docTitle: doc.title,
        projectName: project.name,
        ts: new Date().toISOString(),
      });
    }
  }, [doc, project, pid]);

  function generate() {
    if (!session) return;
    setError('');
    api.completeInterview(session.id).catch(() => {});
    setStreaming(true);
    setSections([]);
    setMode('editor');
    esRef.current?.close();
    esRef.current = streamDraft(docId, {
      onSectionStart: (d) =>
        setSections((prev) => [
          ...prev,
          { id: d.sectionId, heading: d.heading, body: '', streaming: true, editable: false },
        ]),
      onToken: (d) =>
        setSections((prev) =>
          prev.map((s) => (s.id === d.sectionId ? { ...s, body: s.body + d.delta } : s)),
        ),
      onSectionEnd: (d) =>
        setSections((prev) =>
          prev.map((s) => (s.id === d.sectionId ? { ...s, streaming: false, editable: true } : s)),
        ),
      onDone: () => {
        setStreaming(false);
        refreshDocMeta();
        sug.reload();
      },
      onError: (msg) => {
        setStreaming(false);
        setError(msg || '초안 생성 실패 · 설정에서 AI 키를 확인하세요.');
      },
    });
  }

  function regenerate(sectionId: string) {
    setError('');
    setStreaming(true);
    setSections((prev) =>
      prev.map((s) =>
        s.id === sectionId ? { ...s, body: '', streaming: true, editable: false } : s,
      ),
    );
    esRef.current?.close();
    esRef.current = streamRegenerate(sectionId, {
      onToken: (d) =>
        setSections((prev) =>
          prev.map((s) => (s.id === d.sectionId ? { ...s, body: s.body + d.delta } : s)),
        ),
      onSectionEnd: (d) =>
        setSections((prev) =>
          prev.map((s) => (s.id === d.sectionId ? { ...s, streaming: false, editable: true } : s)),
        ),
      onDone: () => {
        setStreaming(false);
        refreshDocMeta();
        sug.reload();
      },
      onError: (msg) => {
        setStreaming(false);
        setError(msg || '재생성 실패');
      },
    });
  }

  async function rename(title: string) {
    const updated = await api.renameDocument(docId, title);
    setDoc(updated);
  }

  if (!doc) {
    return (
      <AppShell crumb={<span>불러오는 중…</span>}>
        <main className="editor">
          <div className="editor-inner center-empty">
            {error ? <span className="err">{error}</span> : '불러오는 중…'}
          </div>
        </main>
      </AppShell>
    );
  }

  const stale = doc.context_stale === 1 && parentAvailable;
  const openCount = sug.suggestions.length;
  const crumb = (
    <>
      <Link to="/">프로젝트</Link>
      <span className="sep">/</span>
      <Link to={`/projects/${pid}`}>{project?.name ?? '프로젝트'}</Link>
      <span className="sep">/</span>
      <b className="name">{TYPE_LABEL[doc.type]}</b>
    </>
  );

  const tbarRight = (
    <>
      {stale && (
        <span className="sug-count" onClick={() => setModal('context')} title="컨텍스트 갱신 필요">
          <i />갱신 필요
        </span>
      )}
      <span className={`sug-count ${openCount ? '' : 'zero'}`} onClick={() => sug.reload()}>
        <i />제안 {openCount}
      </span>
      <button className="btn" onClick={() => setModal('versions')}>
        버전
      </button>
      <button className="btn" onClick={() => setModal('share')}>
        공유
      </button>
      <a
        className="btn pri"
        href={`/api/documents/${docId}/export.md`}
        title="수락된 것만 내보내집니다"
      >
        내보내기
      </a>
      <span className="cmdk">⌘K</span>
    </>
  );

  const nav = project ? (
    <DocChainTree
      projectId={pid!}
      projectName={project.name}
      documents={project.documents}
      activeDocId={docId}
      suggestionCounts={sug.supported ? { [docId]: openCount } : {}}
    />
  ) : undefined;

  const tagline =
    openCount > 0
      ? `제안 ${openCount} · 수락 전에는 내보내기에 포함되지 않습니다`
      : '수락하지 않은 문장은 문서에 없습니다';

  const statusRight = (
    <>
      <span>오프라인 OK</span>
      {meta?.aiStub && <span>STUB AI</span>}
      <span>v{doc.version}</span>
    </>
  );

  // 인터뷰 모드 (초안 생성 전) — panel 없음
  if (mode === 'interview') {
    return (
      <AppShell
        crumb={crumb}
        tbarRight={tbarRight}
        nav={nav}
        tagline="인터뷰 답변이 이후 제안 카드의 근거가 됩니다"
        statusLeft={<span>인터뷰</span>}
        statusRight={statusRight}
      >
        <main className="interview-screen">
          <div className="interview-inner">
            <div className="doc-head">
              <div className="eyebrow">{TYPE_LABEL[doc.type]} · 인터뷰</div>
              <h2 style={{ fontSize: 22 }}>{doc.title}</h2>
              <div className="meta">답변한 뒤 AI 초안을 제안으로 받습니다</div>
            </div>
            {error && <div className="err" style={{ marginBottom: 12 }}>{error}</div>}
            {session && template ? (
              <InterviewPanel
                template={template}
                session={session}
                streaming={streaming}
                onSaveAnswer={async (a) => {
                  const updated = await api.answer(session.id, a);
                  setSession(updated);
                }}
                onGenerate={generate}
              />
            ) : (
              <div className="muted">인터뷰 템플릿을 불러오는 중…</div>
            )}
          </div>
        </main>
      </AppShell>
    );
  }

  // 에디터 모드 (문서 + 제안 패널)
  const doneLine = sug.supported ? undefined : (
    <span>제안 API 준비 중 · 초안은 편집기에서 직접 수정할 수 있습니다</span>
  );

  return (
    <AppShell
      crumb={crumb}
      tbarRight={tbarRight}
      nav={nav}
      panel={
        <SuggestionsPanel
          s={sug}
          onFocusSection={setFocusSection}
          focusedSection={focusSection}
          doneLine={doneLine}
        />
      }
      tagline={tagline}
      statusLeft={
        <span className="save">
          {saveState === 'saving'
            ? '저장 중…'
            : saveState === 'saved'
              ? '로컬 저장됨 · 방금'
              : '로컬 저장됨'}
        </span>
      }
      statusRight={statusRight}
    >
      <DocumentEditor
        doc={doc}
        sections={sections}
        setSections={setSections}
        streaming={streaming}
        focusSection={focusSection}
        onFocusSection={setFocusSection}
        onRegenerate={regenerate}
        onRename={rename}
        onStructuralChange={refreshDocMeta}
        onSaveState={setSaveState}
        error={error}
        onBackToInterview={() => setMode('interview')}
      />

      {modal === 'versions' && (
        <VersionHistory docId={docId} onClose={() => setModal(null)} onRestored={loadAll} />
      )}
      {modal === 'share' && <SharePanel docId={docId} onClose={() => setModal(null)} />}
      {modal === 'context' && (
        <ContextRefreshDialog
          docId={docId}
          onClose={() => setModal(null)}
          onRefreshed={() => {
            refreshDocMeta();
            sug.reload();
          }}
        />
      )}
    </AppShell>
  );
}

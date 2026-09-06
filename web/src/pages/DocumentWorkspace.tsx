import { useEffect, useRef, useState, useCallback } from 'react';
import { useFocusRefetch } from '../lib/useFocusRefetch.ts';
import { useParams, Link } from 'react-router-dom';
import {
  api,
  streamDraft,
  streamRegenerate,
  type DocumentModel,
  type InterviewSession,
  type InterviewTemplate,
  type DocumentType,
} from '../lib/api.ts';
import { toLive, type LiveSection } from '../lib/live.ts';
import { useMeta } from '../App.tsx';
import { useSuggestions } from '../lib/suggestions.ts';
import { rememberLastDoc } from '../lib/newPlan.ts';
import { AppShell } from '../components/AppShell.tsx';
import { DeliverablesNav } from '../components/DeliverablesNav.tsx';
import { InterviewPanel } from '../components/InterviewPanel.tsx';
import { DocumentEditor } from '../components/DocumentEditor.tsx';
import { SuggestionsPanel } from '../components/SuggestionsPanel.tsx';
import { VersionHistory } from '../components/VersionHistory.tsx';
import { SharePanel } from '../components/SharePanel.tsx';
import { ContextRefreshDialog } from '../components/ContextRefreshDialog.tsx';
import { Choani } from '../components/Choani.tsx';
import { BriefExtractBar } from '../components/BriefExtractBar.tsx';
import { BriefAdvisory } from '../components/BriefAdvisory.tsx';
import { QualityAdvisory } from '../components/QualityAdvisory.tsx';

const TYPE_LABEL: Record<DocumentType, string> = {
  prd: 'PRD',
  'feature-spec': '기능명세',
  ia: 'IA',
  'user-flow': '유저플로우',
  'design-system': '디자인 시스템',
  handoff: '개발 지시서',
  feature: '작은 기능 기획',
  brief: '프로젝트 브리프',
};

/** 생성 실패 메시지가 CLI 차단·인증 계열인지 — 키 등록으로 복구 가능한 경우. */
function isAuthBlockError(msg: string): boolean {
  return /Claude Code|구독|subscription|API 키|API key|로그인|log ?in|authenticat|인증|key 모드|BYOK/i.test(
    msg || '',
  );
}

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
  // 생성 실패가 CLI 차단·인증 계열인지 — true 면 복구 배너(설정 링크 + 다시 생성)를 띄운다.
  // 인터뷰 답변은 서버에 보존돼 있어 키 등록 후 재생성으로 손실 없이 복구된다.
  const [genBlocked, setGenBlocked] = useState(false);
  // 완료 세리머니(초안이 done 포즈) — 저빈도, 자동 소멸
  const [ceremony, setCeremony] = useState(false);
  const ceremonyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function celebrate() {
    setCeremony(true);
    if (ceremonyTimer.current) clearTimeout(ceremonyTimer.current);
    ceremonyTimer.current = setTimeout(() => setCeremony(false), 2600);
  }
  // 카운슬 비평 — 진행 표시는 버튼에, 결과 한 줄은 태그라인 자리에(임시)
  const [councilBusy, setCouncilBusy] = useState(false);
  const [councilMsg, setCouncilMsg] = useState('');
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

  useFocusRefetch(() => {
    if (pid) api.getProject(pid).then(setProject).catch(() => {});
  });

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
    setGenBlocked(false);
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
        // 추론형 모델이 예산 부족으로 본문을 못 낸 경우 감지 — 조용한 빈칸 방지
        setSections((prev) => {
          const empty = prev.filter((s) => !s.body.trim()).length;
          if (empty > 0 && empty >= prev.length / 2) {
            setError(
              `생성된 본문이 비어 있어요(${empty}/${prev.length} 섹션). 추론형 모델은 토큰 예산이 작으면 본문을 못 냅니다 — 설정에서 max tokens 를 늘리거나 다른 모델로 시도하세요.`,
            );
          } else if (prev.length > 0) {
            // 성공적으로 초안이 채워졌을 때만 완료 세리머니(저빈도, 자동 소멸)
            celebrate();
          }
          return prev;
        });
      },
      onError: (msg) => {
        setStreaming(false);
        setError(msg || '초안 생성 실패 · 설정에서 AI 키를 확인하세요.');
        setGenBlocked(isAuthBlockError(msg));
      },
    });
  }

  // 생성 중지 — SSE 를 닫고 현재까지 받은 섹션을 편집 가능 상태로 남긴다.
  function stopGeneration() {
    esRef.current?.close();
    esRef.current = null;
    setStreaming(false);
    setSections((prev) => prev.map((s) => ({ ...s, streaming: false, editable: true })));
    refreshDocMeta();
    sug.reload();
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

  // 브리프 추출이 끝나면 제안 섹션이 새로 생겼으므로 문서·제안을 다시 읽는다.
  const afterExtract = useCallback(() => {
    loadAll().catch((e) => setError((e as Error).message));
    sug.reload();
  }, [loadAll, sug]);

  // 3관점 비평을 받아 제안 패널에 카드로 쌓는다. 문서는 건드리지 않는다.
  async function runCouncil() {
    if (councilBusy) return;
    setCouncilBusy(true);
    setCouncilMsg('');
    try {
      const r = await api.council(docId);
      await sug.reload();
      setCouncilMsg(
        r.created > 0
          ? `카운슬 비평 ${r.created}개를 제안으로 받았어요.`
          : '카운슬이 짚을 게 없다고 했어요.',
      );
    } catch (e) {
      setCouncilMsg(`카운슬 비평 실패 · ${(e as Error).message}`);
    } finally {
      setCouncilBusy(false);
      window.setTimeout(() => setCouncilMsg(''), 6000);
    }
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
      {mode === 'editor' &&
        (doc.type === 'prd' || doc.type === 'feature') &&
        meta?.councilEnabled !== false && (
          <button
            className="btn"
            disabled={councilBusy || streaming}
            onClick={runCouncil}
            title="엔지니어·디자이너·회의론자 3관점 비평을 제안으로 받습니다"
          >
            {councilBusy ? '비평 받는 중…' : '카운슬'}
          </button>
        )}
      <button className="btn" onClick={() => setModal('versions')}>
        버전
      </button>
      <button className="btn" onClick={() => setModal('share')}>
        공유
      </button>
      {doc?.type === 'feature' && (
        <a
          className="btn"
          href={`/api/documents/${docId}/feature/prompt-pack`}
          title="수락된 기획 + 브리프 맥락을 코딩 에이전트용 발주 마크다운으로"
        >
          구현 발주
        </a>
      )}
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
    <DeliverablesNav
      projectId={pid!}
      projectName={project.name}
      documents={project.documents}
      active={doc.type === 'feature' || doc.type === 'brief' ? 'NONE' : 'PRD'}
      activeCount={openCount}
    />
  ) : undefined;

  const tagline =
    councilMsg ||
    (openCount > 0
      ? `제안 ${openCount} · 수락 전에는 내보내기에 포함되지 않습니다`
      : '수락하지 않은 문장은 문서에 없습니다');

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
            {doc.type === 'brief' && (
              <BriefExtractBar docId={docId} onExtracted={afterExtract} />
            )}
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
                onFollowups={async () => {
                  const r = await api.followups(docId);
                  setSession(r.session);
                  return r.questions.length;
                }}
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
      {genBlocked && (
        <div className="gen-block-banner">
          <div>
            <b>AI 생성이 막혔어요.</b> 이 계정은 Claude Code 접근이 막혀 있을 수 있어요(조직 차단).
            <span className="muted"> 인터뷰 답변은 그대로 보존돼 있어, 키를 등록하면 다시 채워집니다.</span>
          </div>
          <div className="acts">
            <Link className="btn" to="/settings">
              설정에서 키 등록
            </Link>
            <button className="btn pri" disabled={streaming} onClick={generate}>
              다시 생성
            </button>
          </div>
        </div>
      )}
      <DocumentEditor
        doc={doc}
        headExtra={
          doc.type === 'brief' ? (
            <BriefExtractBar docId={docId} onExtracted={afterExtract} />
          ) : doc.type === 'feature' ? (
            <>
              <BriefAdvisory
                docId={docId}
                refreshKey={`${doc.version}-${sections.length}-${streaming}`}
              />
              <QualityAdvisory
                docId={docId}
                refreshKey={`${doc.version}-${sections.length}-${streaming}`}
              />
            </>
          ) : doc.type === 'prd' ? (
            <QualityAdvisory
              docId={docId}
              refreshKey={`${doc.version}-${sections.length}-${streaming}`}
            />
          ) : undefined
        }
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
        onStop={stopGeneration}
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
      {ceremony && (
        <div className="ceremony" role="status" aria-live="polite">
          <Choani pose="done" size={40} />
          <span>초안이 준비됐어요. 마음에 드는 문장만 수락하세요.</span>
        </div>
      )}
    </AppShell>
  );
}

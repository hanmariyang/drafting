import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  api,
  streamItems,
  type DocumentModel,
  type PlanItem,
  type Suggestion,
} from '../lib/api.ts';
import { AppShell } from '../components/AppShell.tsx';
import { DeliverablesNav, type NavKey } from '../components/DeliverablesNav.tsx';
import { Choani } from '../components/Choani.tsx';
import { SpecView } from '../components/structure/SpecView.tsx';
import { IaView } from '../components/structure/IaView.tsx';
import { FlowView } from '../components/structure/FlowView.tsx';

const NAVKEY: Record<string, NavKey> = { 'feature-spec': 'SPEC', ia: 'IA', 'user-flow': 'FLOW' };
const EYEBROW: Record<string, string> = {
  'feature-spec': 'SPEC · Feature Specification',
  ia: 'IA · Information Architecture',
  'user-flow': 'FLOW · User Flow',
};
const TITLE: Record<string, string> = {
  'feature-spec': '기능명세서',
  ia: '정보 구조',
  'user-flow': '유저 플로우',
};

export function StructureWorkspace({ doc: initialDoc }: { doc: DocumentModel }) {
  const { pid } = useParams();
  const nav = useNavigate();
  const docId = initialDoc.id;
  const type = initialDoc.type;

  const [doc, setDoc] = useState<DocumentModel>(initialDoc);
  const [items, setItems] = useState<PlanItem[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [project, setProject] = useState<{ name: string; documents: DocumentModel[] } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState('');
  const esRef = useRef<EventSource | null>(null);

  // 링크 편집(위반 근본 해소)을 위해 다른 문서의 참조 대상을 함께 로드한다.
  //  - feature-spec: 유저플로우 문서의 플로우(W-NO-FLOW) + 프로젝트 REQ 목록(W-ORPHAN-SPEC)
  //  - ia: 기능명세 문서의 기능(W-EMPTY-PAGE)
  const [flows, setFlows] = useState<PlanItem[]>([]);
  const [reqs, setReqs] = useState<Array<{ id: string; heading: string }>>([]);
  const [features, setFeatures] = useState<PlanItem[]>([]);
  const [pages, setPages] = useState<PlanItem[]>([]);
  const [flowItems, setFlowItems] = useState<PlanItem[]>([]);

  const loadCrossRefs = useCallback(
    async (docs: DocumentModel[]) => {
      if (type === 'feature-spec') {
        const flowDoc = docs.find((d) => d.type === 'user-flow');
        const its = flowDoc ? await api.items(flowDoc.id).then((r) => r.items).catch(() => []) : [];
        setFlows(its.filter((i) => i.kind === 'flow' && i.status !== 'rejected'));
        if (pid) api.projectReqs(pid).then((r) => setReqs(r.reqs)).catch(() => {});
      } else if (type === 'ia') {
        const specDoc = docs.find((d) => d.type === 'feature-spec');
        const its = specDoc ? await api.items(specDoc.id).then((r) => r.items).catch(() => []) : [];
        setFeatures(its.filter((i) => i.kind === 'feature' && i.status !== 'rejected'));
        // 도달 플로우 표시는 유저플로우 문서의 스텝(step.page)으로 판정 — IA 문서엔 스텝이 없다.
        const flowDoc = docs.find((d) => d.type === 'user-flow');
        const fits = flowDoc ? await api.items(flowDoc.id).then((r) => r.items).catch(() => []) : [];
        setFlowItems(fits.filter((i) => i.status !== 'rejected'));
      } else if (type === 'user-flow') {
        const iaDoc = docs.find((d) => d.type === 'ia');
        const its = iaDoc ? await api.items(iaDoc.id).then((r) => r.items).catch(() => []) : [];
        setPages(its.filter((i) => i.kind === 'page' && i.status !== 'rejected'));
      }
    },
    [type, pid],
  );

  const reload = useCallback(async () => {
    const [it, sg] = await Promise.all([
      api.items(docId).then((r) => r.items),
      api.suggestions(docId, 'open').then((r) => (Array.isArray(r) ? r : r.suggestions)).catch(() => []),
    ]);
    setItems(it);
    setSuggestions(sg as Suggestion[]);
  }, [docId]);

  const loadAll = useCallback(async () => {
    setDoc((await api.getDocument(docId)).document);
    await reload();
    if (pid)
      api
        .getProject(pid)
        .then((p) => {
          setProject(p);
          loadCrossRefs(p.documents);
        })
        .catch(() => {});
  }, [docId, pid, reload, loadCrossRefs]);

  useEffect(() => {
    loadAll().catch((e) => setError((e as Error).message));
    return () => esRef.current?.close();
  }, [loadAll]);

  function generate() {
    setError('');
    setGenerating(true);
    setItems([]);
    esRef.current?.close();
    esRef.current = streamItems(docId, {
      onItem: (item) => setItems((prev) => [...prev, item]),
      onDone: () => {
        setGenerating(false);
        reload();
      },
      onError: (msg) => {
        setGenerating(false);
        setError(msg || '생성 실패 · 설정에서 AI 키/CLI 를 확인하세요.');
      },
    });
  }

  async function acceptItem(id: string) {
    await api.acceptItem(id);
    await reload();
  }
  async function rejectItem(id: string) {
    await api.rejectItem(id);
    await reload();
  }
  async function restoreItem(id: string) {
    await api.restoreItem(id);
    await reload();
  }
  async function acceptSug(id: string) {
    await api.acceptSuggestion(id);
    await reload();
  }
  async function rejectSug(id: string) {
    await api.rejectSuggestion(id);
    await reload();
  }
  async function runLint() {
    if (!pid) return;
    await api.lintSuggest(pid);
    await reload();
  }
  async function waiveAll() {
    if (!pid) return;
    await api.lintWaiveAll(pid);
    await reload();
  }
  async function linkFeature(flowId: string, featureRef: string) {
    await api.linkFeatureToFlow(flowId, featureRef);
    if (project) await loadCrossRefs(project.documents);
    await reload();
  }
  async function unlinkFeature(flowId: string, featureRef: string) {
    await api.unlinkFeatureFromFlow(flowId, featureRef);
    if (project) await loadCrossRefs(project.documents);
    await reload();
  }
  // 범용 링크 편집 (기능→REQ, 화면→기능) — subject 항목의 links.<field>
  async function editLink(itemId: string, field: 'reqs' | 'features', ref: string, op: 'add' | 'remove') {
    await api.editLink(itemId, field, ref, op);
    if (project) await loadCrossRefs(project.documents);
    await reload();
  }
  // 스텝에 화면(page) 지정/해제 — W-UNREACHED-PAGE 근본 해소
  async function setStepPage(stepId: string, page: string | null) {
    await api.setStepPage(stepId, page);
    if (project) await loadCrossRefs(project.documents);
    await reload();
  }

  const openCount = suggestions.length;
  const empty = items.length === 0 && !generating;

  const tbarRight = (
    <>
      <span className={`sug-count ${openCount ? '' : 'zero'}`}>
        <i />제안 {openCount}
      </span>
      <button className="btn" onClick={runLint}>
        정합성 검사
      </button>
      <button className="btn" title="모든 위반을 무시(내용은 그대로 유지). 게이트만 통과합니다." onClick={waiveAll}>
        위반 모두 무시
      </button>
      <a className="btn" href={`/api/documents/${docId}/export.md`}>
        MD
      </a>
      <a
        className="btn"
        href={`/api/documents/${docId}/export.html?print=1`}
        target="_blank"
        rel="noreferrer"
        title="브라우저 인쇄 대화상자에서 'PDF로 저장'"
      >
        PDF
      </a>
      <span className="cmdk">⌘K</span>
    </>
  );

  const body = (() => {
    if (empty) {
      return (
        <div className="editor-inner">
          <div className="eyebrow">{EYEBROW[type]}</div>
          <h1 className="struct-h1">{TITLE[type]}</h1>
          <div className="dmeta">아직 항목이 없습니다. 상위 문서에서 구조를 제안받으세요.</div>
          <div className="empty" style={{ marginTop: 18 }}>
            <Choani pose="write" size={64} />
            <div style={{ marginTop: 10 }}>
              <b>{TITLE[type]}</b> 를 초안으로 제안받습니다. 번호는 서버가 매기고, 모든 항목은 수락 전까지 제안 상태입니다.
            </div>
            <button className="btn pri lg" style={{ marginTop: 14 }} onClick={generate}>
              구조 제안받기
            </button>
          </div>
          {error && <div className="err" style={{ marginTop: 12 }}>{error}</div>}
        </div>
      );
    }
    const common = {
      items,
      selected,
      onSelect: setSelected,
      onAccept: acceptItem,
      onReject: rejectItem,
      generating,
      onRegenerate: generate,
      onChanged: reload,
    };
    if (type === 'feature-spec')
      return (
        <SpecView
          {...common}
          projectId={pid!}
          flows={flows}
          reqs={reqs}
          onLinkFeature={linkFeature}
          onUnlinkFeature={unlinkFeature}
          onEditLink={editLink}
        />
      );
    if (type === 'ia')
      return (
        <IaView
          {...common}
          projectId={pid!}
          features={features}
          flowItems={flowItems}
          onEditLink={editLink}
          onNavPage={(pgRef) => nav(`/projects/${pid}/wireframes?focus=${pgRef}`)}
        />
      );
    return <FlowView {...common} pages={pages} onSetStepPage={setStepPage} />;
  })();

  return (
    <AppShell
      crumb={
        <>
          <b className="name">{project?.name ?? '프로젝트'}</b>
          <span className="sep">/</span>
          <span>{TITLE[type]}</span>
        </>
      }
      tbarRight={tbarRight}
      nav={
        project ? (
          <DeliverablesNav
            projectId={pid!}
            projectName={project.name}
            documents={project.documents}
            active={NAVKEY[type]}
            activeCount={openCount}
          />
        ) : undefined
      }
      panel={
        <StructurePanel
          suggestions={suggestions}
          onAccept={acceptSug}
          onReject={rejectSug}
          onSuggestLint={runLint}
        />
      }
      tagline={
        openCount > 0
          ? `제안 ${openCount} · 수락 전에는 내보내기에 포함되지 않습니다`
          : '수락하지 않은 항목은 문서에 없습니다'
      }
      statusLeft={<span>{doc.status === 'streaming' ? '생성 중…' : `항목 ${items.length}`}</span>}
      statusRight={<span>v{doc.version}</span>}
    >
      <main className="ed structure-ed">
        {body}
        {!empty && <RejectedItemsBar items={items} onRestore={restoreItem} />}
      </main>
    </AppShell>
  );
}

// ── 제외(rejected)된 항목 복구 — 정합성 '모두 수락' 등으로 사라진 항목을 되살린다 ──
function RejectedItemsBar({
  items,
  onRestore,
}: {
  items: PlanItem[];
  onRestore: (id: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const rejected = items.filter((i) => i.status === 'rejected');
  if (rejected.length === 0) return null;

  async function restore(id: string) {
    setBusy(id);
    try {
      await onRestore(id);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rejected-bar">
      <button className="rejected-head" onClick={() => setOpen((o) => !o)}>
        <span>제외된 항목 {rejected.length}개</span>
        <span className="muted">{open ? '접기' : '펼쳐서 되살리기'}</span>
      </button>
      {open && (
        <div className="rejected-list">
          {rejected.map((it) => (
            <div key={it.id} className="rejected-row">
              <span className="rid">{it.ref_id}</span>
              <span className="rtitle">{it.title}</span>
              <button className="btn sm" disabled={busy === it.id} onClick={() => restore(it.id)}>
                되살리기
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── proposal + lint panel (시안 2 우측) ────────────────────────────────────────
function StructurePanel({
  suggestions,
  onAccept,
  onReject,
  onSuggestLint,
}: {
  suggestions: Suggestion[];
  onAccept: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onSuggestLint: () => Promise<void>;
}) {
  const count = suggestions.length;
  return (
    <>
      <div className="ph">
        제안 <span className="cnt">{count}</span>
      </div>
      {count === 0 ? (
        <div className="panel-empty">
          <Choani pose="wait" size={72} />
          검토할 제안이 없어요.
          <br />
          <button className="btn sm" style={{ marginTop: 10 }} onClick={onSuggestLint}>
            정합성 검사 실행
          </button>
        </div>
      ) : (
        suggestions.map((sg) =>
          sg.kind === 'lint' ? (
            <div key={sg.id} className="scard compile">
              <div className="sh">
                <Choani pose="fetch" size={20} animate={false} />
                <b>{sg.title}</b>
                <span className="lintcode">{sg.source}</span>
              </div>
              <p>{sg.body}</p>
              <div className="scard-acts">
                <button className="a" onClick={() => onAccept(sg.id)}>
                  수정 적용
                </button>
                <button className="r" onClick={() => onReject(sg.id)}>
                  무시
                </button>
              </div>
            </div>
          ) : (
            <div key={sg.id} className="scard">
              <div className="sh">
                <Choani pose="fetch" size={20} animate={false} />
                <b>{sg.title}</b>
                <span className="ssrc">근거 {sg.source}</span>
              </div>
              <p>{sg.body}</p>
              <div className="scard-acts">
                <button className="a" onClick={() => onAccept(sg.id)}>
                  수락
                </button>
                <button className="r" onClick={() => onReject(sg.id)}>
                  거절
                </button>
              </div>
            </div>
          ),
        )
      )}
    </>
  );
}

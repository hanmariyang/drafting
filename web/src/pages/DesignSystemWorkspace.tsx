import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  api,
  type DocumentModel,
  type InterviewTemplate,
  type InterviewSession,
  type DesignSystemRecord,
} from '../lib/api.ts';
import { AppShell } from '../components/AppShell.tsx';
import { DeliverablesNav } from '../components/DeliverablesNav.tsx';
import { InterviewPanel } from '../components/InterviewPanel.tsx';
import { Choani } from '../components/Choani.tsx';

/** 디자인 시스템 문서 — 인터뷰로 설계 → AI 제안(StyleGuide+근거+스타일 타일) → 수락. */
export function DesignSystemWorkspace({ doc }: { doc: DocumentModel }) {
  const { pid } = useParams();
  const [project, setProject] = useState<{ name: string; documents: DocumentModel[] } | null>(null);
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [template, setTemplate] = useState<InterviewTemplate | null>(null);
  const [record, setRecord] = useState<DesignSystemRecord | null>(null);
  const [mode, setMode] = useState<'interview' | 'result'>('interview');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const iv = await api.startInterview(doc.id);
    setSession(iv.session);
    setTemplate(iv.template);
    if (pid) {
      api.getProject(pid).then(setProject).catch(() => {});
      const ds = await api.designSystem(pid).catch(() => ({ record: null }));
      if (ds.record) {
        setRecord(ds.record);
        setMode('result');
      }
    }
  }, [doc.id, pid]);

  useEffect(() => {
    load().catch((e) => setErr((e as Error).message));
  }, [load]);

  async function generate() {
    if (!session) return;
    setBusy(true);
    setErr('');
    try {
      await api.completeInterview(session.id).catch(() => {});
      const r = await api.generateDesignSystem(doc.id);
      setRecord(r.record);
      setMode('result');
    } catch (e) {
      setErr((e as Error).message || '디자인 시스템 생성에 실패했어요');
    } finally {
      setBusy(false);
    }
  }
  async function accept() {
    const r = await api.acceptDesignSystem(doc.id);
    setRecord(r.record);
  }

  const g = record?.guide;

  return (
    <AppShell
      crumb={
        <>
          <b className="name">{project?.name ?? '프로젝트'}</b>
          <span className="sep">/</span>
          <span>디자인 시스템</span>
        </>
      }
      nav={
        project ? (
          <DeliverablesNav projectId={pid!} projectName={project.name} documents={project.documents} active="DS" />
        ) : undefined
      }
      tagline="인터뷰로 디자인 시스템을 설계 · 수락하면 와이어프레임·시안이 이 시스템으로 렌더"
    >
      {mode === 'interview' ? (
        <main className="interview-screen">
          <div className="interview-inner">
            <div className="eyebrow">디자인 시스템 · 인터뷰</div>
            <h1 className="struct-h1">디자인 시스템 설계</h1>
            <div className="dmeta">색·타이포·간격·형태·컴포넌트·톤을 인터뷰로. 답 후 AI 가 시스템을 제안합니다.</div>
            {err && <div className="genwarn">{err}</div>}
            {session && template ? (
              <InterviewPanel
                template={template}
                session={session}
                streaming={busy}
                onSaveAnswer={async (a) => {
                  const updated = await api.answer(session.id, a);
                  setSession(updated);
                }}
                onGenerate={generate}
              />
            ) : (
              <div className="empty" style={{ marginTop: 18 }}>
                <Choani pose="think" size={56} /> 불러오는 중…
              </div>
            )}
          </div>
        </main>
      ) : (
        <main className="ed wfwrap">
          <div className="eyebrow">디자인 시스템 · {record?.status === 'accepted' ? '수락됨' : '제안됨'}</div>
          <h1 className="struct-h1">디자인 시스템</h1>
          <div className="dmeta">
            {record?.status === 'accepted'
              ? '이 시스템이 와이어프레임·시안을 구동합니다.'
              : '제안된 시스템입니다. 수락하면 와이어프레임·시안에 반영됩니다.'}
          </div>

          {err && <div className="genwarn">{err}</div>}

          <div className="ds-stage">
            <div className="ds-tile">
              {record && (
                <iframe className="ds-frame" srcDoc={record.styleTileHtml} sandbox="" title="디자인 시스템 스타일 타일" />
              )}
            </div>
            <aside className="ds-side">
              <div className="ds-rationale">
                <span className="k">설계 근거</span>
                <p>{record?.rationale}</p>
              </div>
              {g && (
                <div className="ds-tokens">
                  <span className="k">토큰</span>
                  <ul>
                    <li>강조 <code>{g.accent}</code></li>
                    <li>모드 <b>{g.mode}</b></li>
                    <li>밀도 <b>{g.density}</b> · 서체 <b>{g.font}</b></li>
                    <li>모서리 <b>{g.radius}px</b></li>
                  </ul>
                </div>
              )}
              <div className="ds-acts">
                {record?.status !== 'accepted' && (
                  <button className="btn ok" onClick={accept}>
                    수락 · 시스템으로 채택
                  </button>
                )}
                <button className="btn" disabled={busy} onClick={generate}>
                  {busy ? '생성 중…' : '재생성'}
                </button>
                <button className="btn ghost" onClick={() => setMode('interview')}>
                  인터뷰 다시
                </button>
              </div>
            </aside>
          </div>
        </main>
      )}
    </AppShell>
  );
}

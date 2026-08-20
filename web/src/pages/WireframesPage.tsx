import { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api, type DocumentModel, type Wireframe } from '../lib/api.ts';
import { AppShell } from '../components/AppShell.tsx';
import { DeliverablesNav } from '../components/DeliverablesNav.tsx';
import { Choani } from '../components/Choani.tsx';

export function WireframesPage() {
  const { pid } = useParams();
  const [params] = useSearchParams();
  const [project, setProject] = useState<{ name: string; documents: DocumentModel[] } | null>(null);
  const [wfs, setWfs] = useState<Wireframe[]>([]);
  const [interactive, setInteractive] = useState(false);

  const load = useCallback(async () => {
    if (!pid) return;
    const [p, w] = await Promise.all([api.getProject(pid), api.wireframes(pid)]);
    setProject(p);
    setWfs(w.wireframes);
  }, [pid]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  useEffect(() => {
    const focus = params.get('focus');
    if (focus) goTo(focus);
  }, [params, wfs.length]);

  function goTo(ref: string) {
    const el = document.getElementById(`wf-${ref}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('wf-flash');
      window.setTimeout(() => el.classList.remove('wf-flash'), 900);
    }
  }

  return (
    <AppShell
      crumb={
        <>
          <b className="name">{project?.name ?? '프로젝트'}</b>
          <span className="sep">/</span>
          <span>와이어프레임</span>
        </>
      }
      tbarRight={
        <>
          <button
            className={`btn ${interactive ? 'ok' : ''}`}
            onClick={() => setInteractive((v) => !v)}
          >
            {interactive ? '인터랙티브 켜짐' : '인터랙티브 열기'}
          </button>
          <span className="cmdk">⌘K</span>
        </>
      }
      nav={
        project ? (
          <DeliverablesNav
            projectId={pid!}
            projectName={project.name}
            documents={project.documents}
            active="WF"
          />
        ) : undefined
      }
      tagline="콘텐츠는 명세(F-)에서 · 이동(핫스팟)은 플로우(FLOW-)에서 · AI 미사용"
    >
      <main className="ed wfwrap">
        <div className="eyebrow">WF · Wireframes — Derived Prototype</div>
        <h1 className="struct-h1">와이어프레임</h1>
        <div className="dmeta">IA 수락분 {wfs.length}화면 자동 렌더 · 결정적 (AI·비용 0)</div>

        {wfs.length === 0 ? (
          <div className="empty" style={{ marginTop: 18 }}>
            <Choani pose="think" size={64} />
            <div style={{ marginTop: 10 }}>
              IA 화면을 수락하면 여기에 <b>자동으로 렌더</b>됩니다.
            </div>
          </div>
        ) : (
          <div className="pgrid">
            {wfs.map((wf) => (
              <WfProto key={wf.ref} wf={wf} interactive={interactive} onHotspot={goTo} />
            ))}
          </div>
        )}
      </main>
    </AppShell>
  );
}

function WfProto({
  wf,
  interactive,
  onHotspot,
}: {
  wf: Wireframe;
  interactive: boolean;
  onHotspot: (ref: string) => void;
}) {
  const hot = wf.hotspot ? (
    <span
      className="hot"
      style={{ cursor: interactive ? 'pointer' : 'default' }}
      onClick={(e) => {
        e.stopPropagation();
        if (interactive && wf.hotspot) onHotspot(wf.hotspot.toPage);
      }}
    >
      {wf.hotspot.label}
    </span>
  ) : null;

  return (
    <div className="proto" id={`wf-${wf.ref}`}>
      <div className="phead">
        <b>{wf.ref}</b> {wf.title} <span className="typechip">{wf.pageType}</span>
        {wf.status === 'proposed' && (
          <span className="dpill" style={{ marginLeft: 'auto' }}>
            제안됨
          </span>
        )}
      </div>
      <div className="papp">
        <Body wf={wf} hot={hot} />
        <div className={`pstate ${wf.lintWarning ? 'warn' : ''}`}>
          {wf.lintWarning
            ? `검사 위반 · ${wf.lintWarning}`
            : `근거 ${wf.featureRefs.join('·') || '—'}${wf.flowRefs.length ? ' · 진입 ' + wf.flowRefs.join('·') : ''}`}
        </div>
      </div>
    </div>
  );
}

function Body({ wf, hot }: { wf: Wireframe; hot: React.ReactNode }) {
  const s = wf.seed;
  switch (wf.pageType) {
    case 'LIST':
      return (
        <>
          <div className="pnav">
            {wf.title}
            <span className="navr">목록</span>
          </div>
          <div className="pbody">
            <div className="pinput">{s.search ?? '검색'}</div>
            <div className="plist">
              {(s.rows ?? []).map((r, i) => (
                <div className="plirow" key={i}>
                  <b>{r.title}</b>
                  <span className="m">{r.meta}</span>
                  <span className="sp" />
                  <span className="pbtn sm">
                    {r.action}
                    {r.hot && hot}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      );
    case 'DETAIL':
      return (
        <>
          <div className="pnav">
            <span className="back">‹</span>
            {s.detailTitle ?? wf.title}
          </div>
          <div className="pbody">
            <div className="slotwrap">
              {(s.slots ?? []).map((sl, i) => (
                <span key={i} className={`slot ${sl.state === 'idle' ? '' : sl.state}`}>
                  {sl.label}
                </span>
              ))}
            </div>
            {(s.blocks ?? []).map((b, i) => (
              <div className="pinput" key={i}>
                {b}
              </div>
            ))}
            <div className="pbtn">
              {s.cta ?? '확인'}
              {hot}
            </div>
          </div>
        </>
      );
    case 'FORM':
      return (
        <>
          <div className="pnav">
            <span className="back">‹</span>
            {wf.title}
          </div>
          <div className="pbody">
            {(s.fields ?? []).map((f, i) => (
              <div className="ffield" key={i}>
                <span className="lb2">{f.label}</span>
                <div className="pinput">{f.value}</div>
              </div>
            ))}
            <div className="pbtn">
              {s.cta ?? '저장'}
              {hot}
            </div>
          </div>
        </>
      );
    case 'DASH':
      return (
        <>
          <div className="pnav">
            {wf.title}
            <span className="navr">이번 주</span>
          </div>
          <div className="pbody">
            <div className="statrow">
              {(s.stats ?? []).map((st, i) => (
                <div className="stat" key={i}>
                  <div className="sv">{st.value}</div>
                  <div className="sl">{st.label}</div>
                </div>
              ))}
            </div>
            <div className="chart">
              {(s.bars ?? []).map((h, i) => (
                <i key={i} style={{ height: `${h}%` }} />
              ))}
            </div>
          </div>
        </>
      );
    case 'SETTINGS':
      return (
        <>
          <div className="pnav">
            <span className="back">‹</span>
            {wf.title}
          </div>
          <div className="pbody">
            {(s.toggles ?? []).map((t, i) => (
              <div className="tgl" key={i}>
                {t.label}
                <span className="sp" />
                <span className={`sw ${t.on ? '' : 'off'}`} />
              </div>
            ))}
          </div>
        </>
      );
    default:
      return (
        <>
          <div className="pnav">{wf.title}</div>
          <div className="pbody">
            {(s.blocks ?? [wf.title]).map((b, i) => (
              <div className="sk block" key={i}>
                <span style={{ fontSize: 10, color: 'var(--sub)', padding: '4px 8px', display: 'block' }}>
                  {b}
                </span>
              </div>
            ))}
            <div className="pbtn">
              열기
              {hot}
            </div>
          </div>
        </>
      );
  }
}

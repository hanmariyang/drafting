import { useEffect, useState, useCallback, type CSSProperties } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api, type DocumentModel, type Wireframe, type StyleGuide } from '../lib/api.ts';
import { AppShell } from '../components/AppShell.tsx';
import { DeliverablesNav } from '../components/DeliverablesNav.tsx';
import { Choani } from '../components/Choani.tsx';

const PRESET_LABEL: Record<string, string> = {
  clean: 'Clean', warm: 'Warm', mono: 'Mono', vivid: 'Vivid', dark: 'Dark',
};
const DENSITY_LABEL: Record<string, string> = { compact: '조밀', cozy: '보통', spacious: '여유' };

export function WireframesPage() {
  const { pid } = useParams();
  const [params] = useSearchParams();
  const [project, setProject] = useState<{ name: string; documents: DocumentModel[] } | null>(null);
  const [wfs, setWfs] = useState<Wireframe[]>([]);
  const [interactive, setInteractive] = useState(false);
  const [guide, setGuide] = useState<StyleGuide | null>(null);
  const [rnd, setRnd] = useState<{ fontStack: string; gap: number } | null>(null);
  const [presets, setPresets] = useState<string[]>([]);
  const [mstatus, setMstatus] = useState<Record<string, 'proposed' | 'accepted'>>({});

  const load = useCallback(async () => {
    if (!pid) return;
    const [p, w, sg, ms] = await Promise.all([
      api.getProject(pid),
      api.wireframes(pid),
      api.styleGuide(pid),
      api.mockups(pid),
    ]);
    setProject(p);
    setWfs(w.wireframes);
    setGuide(sg.guide);
    setRnd(sg.render);
    setPresets(sg.presets);
    const m: Record<string, 'proposed' | 'accepted'> = {};
    for (const x of ms.mockups) m[x.pageRef] = x.status;
    setMstatus(m);
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

  async function patchGuide(patch: Partial<StyleGuide>) {
    if (!pid) return;
    const r = await api.saveStyleGuide(pid, patch);
    setGuide(r.guide);
    setRnd(r.render);
  }

  const setStatus = (ref: string, status: 'proposed' | 'accepted' | undefined) =>
    setMstatus((prev) => {
      const next = { ...prev };
      if (status) next[ref] = status;
      else delete next[ref];
      return next;
    });

  const themeVars: CSSProperties =
    guide && rnd
      ? ({
          '--wf-accent': guide.accent,
          '--wf-bg': guide.bg,
          '--wf-surface': guide.surface,
          '--wf-ink': guide.ink,
          '--wf-sub': guide.sub,
          '--wf-line': guide.line,
          '--wf-radius': `${guide.radius}px`,
          '--wf-font': rnd.fontStack,
          '--wf-gap': `${rnd.gap}px`,
        } as CSSProperties)
      : {};

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
          <button className={`btn ${interactive ? 'ok' : ''}`} onClick={() => setInteractive((v) => !v)}>
            {interactive ? '인터랙티브 켜짐' : '인터랙티브 열기'}
          </button>
          <span className="cmdk">⌘K</span>
        </>
      }
      nav={
        project ? (
          <DeliverablesNav projectId={pid!} projectName={project.name} documents={project.documents} active="WF" />
        ) : undefined
      }
      tagline="테마는 와이어프레임·시안 공용 · 시안(AI)은 옵트인 · 결정적 와이어프레임은 무료"
    >
      <main className="ed wfwrap" style={themeVars}>
        <div className="eyebrow">WF · Wireframes → 시안</div>
        <h1 className="struct-h1">와이어프레임</h1>
        <div className="dmeta">IA 수락분 {wfs.length}화면 · 결정적 와이어프레임(무료) + 테마 적용 · AI 시안은 화면별 옵트인</div>

        {guide && (
          <div className="wf-theme">
            <span className="tk">테마</span>
            <div className="tpresets">
              {presets.map((p) => (
                <button
                  key={p}
                  className={`tchip ${guide.preset === p ? 'on' : ''}`}
                  onClick={() => patchGuide({ preset: p })}
                >
                  {PRESET_LABEL[p] ?? p}
                </button>
              ))}
            </div>
            <label className="tacc" title="강조색">
              <input type="color" value={guide.accent} onChange={(e) => patchGuide({ accent: e.target.value })} />
            </label>
            <div className="tseg">
              {(['compact', 'cozy', 'spacious'] as const).map((d) => (
                <button key={d} className={guide.density === d ? 'on' : ''} onClick={() => patchGuide({ density: d })}>
                  {DENSITY_LABEL[d]}
                </button>
              ))}
            </div>
          </div>
        )}

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
              <WfProto
                key={wf.ref}
                pid={pid!}
                wf={wf}
                interactive={interactive}
                onHotspot={goTo}
                mockStatus={mstatus[wf.ref]}
                onStatus={setStatus}
              />
            ))}
          </div>
        )}
      </main>
    </AppShell>
  );
}

function WfProto({
  pid,
  wf,
  interactive,
  onHotspot,
  mockStatus,
  onStatus,
}: {
  pid: string;
  wf: Wireframe;
  interactive: boolean;
  onHotspot: (ref: string) => void;
  mockStatus?: 'proposed' | 'accepted';
  onStatus: (ref: string, status: 'proposed' | 'accepted' | undefined) => void;
}) {
  const [view, setView] = useState<'wire' | 'mock'>(mockStatus ? 'mock' : 'wire');
  const [html, setHtml] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (view === 'mock' && mockStatus && html === null) {
      api.mockup(pid, wf.ref).then((m) => setHtml(m.html)).catch(() => {});
    }
  }, [view, mockStatus, html, pid, wf.ref]);

  async function generate() {
    setBusy(true);
    setErr(null);
    setView('mock');
    try {
      const m = await api.generateMockup(wf.itemId);
      setHtml(m.html);
      onStatus(wf.ref, 'proposed');
    } catch (e) {
      setErr((e as Error).message || '시안 생성에 실패했어요');
    } finally {
      setBusy(false);
    }
  }
  async function accept() {
    await api.acceptMockup(wf.itemId);
    onStatus(wf.ref, 'accepted');
  }
  async function reject() {
    await api.rejectMockup(wf.itemId);
    setHtml(null);
    onStatus(wf.ref, undefined);
    setView('wire');
  }

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
        <span className="sp" style={{ flex: 1 }} />
        <div className="wf-toggle">
          <button className={view === 'wire' ? 'on' : ''} onClick={() => setView('wire')}>
            와이어
          </button>
          <button className={view === 'mock' ? 'on' : ''} onClick={() => setView('mock')}>
            시안{mockStatus === 'accepted' ? ' ✓' : ''}
          </button>
        </div>
      </div>

      {view === 'wire' ? (
        <div className="papp themed">
          <Body wf={wf} hot={hot} />
          <div className={`pstate ${wf.lintWarning ? 'warn' : ''}`}>
            {wf.lintWarning
              ? `검사 위반 · ${wf.lintWarning}`
              : `근거 ${wf.featureRefs.join('·') || '—'}${wf.flowRefs.length ? ' · 진입 ' + wf.flowRefs.join('·') : ''}`}
          </div>
        </div>
      ) : busy ? (
        <div className="mockgen">
          <Choani pose="fetch" size={44} />
          <p>
            <b>시안 생성 중…</b>
          </p>
          <span className="mnote">AI 가 이 화면을 테마에 맞춰 디자인합니다 · 최대 1분 정도 걸릴 수 있어요</span>
        </div>
      ) : err ? (
        <div className="mockgen">
          <p className="mockerr">시안 생성에 실패했어요</p>
          <span className="mnote">{err}</span>
          <button className="btn ok" onClick={generate}>
            다시 시도
          </button>
          <span className="mnote">설정(⌘,)의 AI 엔진에서 CLI 로그인 또는 API 키 상태를 확인하세요</span>
        </div>
      ) : html ? (
        <div className="mockwrap">
          <iframe className="mockframe" srcDoc={html} sandbox="" title={`${wf.ref} 시안`} loading="lazy" />
          <div className="mockacts">
            <span className={`mstat ${mockStatus === 'accepted' ? 'ok' : ''}`}>
              {mockStatus === 'accepted' ? '시안 수락됨' : '제안된 시안'}
            </span>
            <span className="sp" style={{ flex: 1 }} />
            {mockStatus !== 'accepted' && (
              <button className="btn ok sm" disabled={busy} onClick={accept}>
                수락
              </button>
            )}
            <button className="btn sm" disabled={busy} onClick={generate}>
              재생성
            </button>
            <button className="btn sm" disabled={busy} onClick={reject}>
              삭제
            </button>
          </div>
        </div>
      ) : (
        <div className="mockgen">
          <Choani pose="fetch" size={40} animate={false} />
          <p>
            이 화면의 <b>고해상도 시안</b>을 테마에 맞춰 생성합니다.
          </p>
          <button className="btn ok" onClick={generate}>
            시안 생성
          </button>
          <span className="mnote">AI 사용 · 구조는 와이어프레임 탭에서 무료로 확인</span>
        </div>
      )}
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
                <span style={{ fontSize: 10, color: 'var(--sub)', padding: '4px 8px', display: 'block' }}>{b}</span>
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

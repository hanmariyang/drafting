import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, type DocumentModel, type HubSnapshot, type DocRollup } from '../lib/api.ts';
import { AppShell } from '../components/AppShell.tsx';
import { DeliverablesNav } from '../components/DeliverablesNav.tsx';
import { Choani } from '../components/Choani.tsx';

const CARD_META: Array<{ key: keyof HubSnapshot['perDoc']; badge: string; title: string }> = [
  { key: 'prd', badge: 'PRD', title: '제품 요구사항' },
  { key: 'feature-spec', badge: 'SPEC', title: '기능명세서' },
  { key: 'ia', badge: 'IA', title: '정보 구조' },
  { key: 'user-flow', badge: 'FLOW', title: '유저 플로우' },
];

function Bar({ roll }: { roll: DocRollup }) {
  const total = Math.max(roll.total, 1);
  const segs = Array.from({ length: total }, (_, i) => {
    if (i < roll.accepted) return 'acc';
    if (i < roll.accepted + roll.proposed) return 'prop';
    return '';
  });
  return (
    <div className="hbar">
      {segs.map((c, i) => (
        <i key={i} className={c} />
      ))}
    </div>
  );
}

export function Hub() {
  const { pid } = useParams();
  const nav = useNavigate();
  const [project, setProject] = useState<{ name: string; documents: DocumentModel[] } | null>(null);
  const [hub, setHub] = useState<HubSnapshot | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!pid) return;
    const [p, h] = await Promise.all([api.getProject(pid), api.hub(pid).catch(() => null)]);
    setProject(p);
    setHub(h);
  }, [pid]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function reviewViolations() {
    if (!pid || busy) return;
    setBusy(true);
    try {
      await api.lintSuggest(pid);
      const specId = hub?.perDoc['feature-spec']?.documentId;
      if (specId) nav(`/projects/${pid}/documents/${specId}`);
      else await load();
    } finally {
      setBusy(false);
    }
  }

  if (!project) {
    return (
      <AppShell crumb={<span>불러오는 중…</span>}>
        <main className="hub-main">
          <div className="center-empty">불러오는 중…</div>
        </main>
      </AppShell>
    );
  }

  const lint = hub?.lint;
  const handoff = hub?.derived.handoff;

  return (
    <AppShell
      crumb={
        <>
          <b className="name">{project.name}</b>
          <span className="sep">/</span>
          <span>산출물 허브</span>
        </>
      }
      tbarRight={<span className="cmdk">⌘K</span>}
      nav={
        <DeliverablesNav
          projectId={pid!}
          projectName={project.name}
          documents={project.documents}
          active="HUB"
        />
      }
      tagline="수락된 것만 문서 · 파생물은 수락분에서 자동 갱신"
    >
      <main className="hub-main">
        <div className="eyebrow">Deliverables</div>
        <h1 className="hub-h1">산출물 6종</h1>
        <div className="hub-sub">수락된 것만 문서 · 파생물은 수락분에서 자동 갱신</div>

        <div className="hubgrid">
          {CARD_META.map((c) => {
            const roll = hub?.perDoc[c.key];
            return (
              <button
                key={c.key}
                className="hcard"
                onClick={() => roll?.documentId && nav(`/projects/${pid}/documents/${roll.documentId}`)}
              >
                <div className="ht">
                  <span className="tb">{c.badge}</span>
                  <b>{c.title}</b>
                </div>
                {roll ? <Bar roll={roll} /> : <div className="hbar" />}
                <div className="hfoot">
                  <span>
                    수락 {roll?.accepted ?? 0}
                    {roll && roll.proposed > 0 && (
                      <>
                        {' · '}
                        <b style={{ color: 'var(--sug)' }}>제안 {roll.proposed}</b>
                      </>
                    )}
                  </span>
                  <span className="sp" />
                  <span className="st">{roll?.documentId ? '' : '미생성'}</span>
                </div>
              </button>
            );
          })}

          {/* WF card */}
          <button className="hcard" onClick={() => nav(`/projects/${pid}/wireframes`)}>
            <div className="ht">
              <span className="tb der">WF</span>
              <b>와이어프레임</b>
            </div>
            <div className="hfoot" style={{ marginTop: 2 }}>
              <span>
                IA 수락분에서 <b>자동 렌더</b>
              </span>
              <span className="sp" />
              <span className="st">화면 {hub?.derived.wireframes.count ?? 0}</span>
            </div>
            <div className="wfrow">
              <span className="sk block" />
              <span className="sk block" />
              <span className="sk block" />
            </div>
          </button>

          {/* DEV card */}
          <button
            className={`hcard ${handoff?.locked ? 'locked' : ''}`}
            onClick={() => nav(`/projects/${pid}/handoff`)}
          >
            <div className="ht">
              <span className="tb der">DEV</span>
              <b>개발 지시서</b>
            </div>
            <div className="hfoot" style={{ marginTop: 2 }}>
              {handoff?.locked ? (
                <span style={{ color: 'var(--warn)' }}>정합성 검사 {handoff.blocking}건 위반</span>
              ) : (
                <span>{handoff?.compiled ? '컴파일됨' : '검사 통과 · 생성 가능'}</span>
              )}
              <span className="sp" />
              <span className="st">{handoff?.locked ? '잠김' : '준비'}</span>
            </div>
          </button>
        </div>

        {lint && lint.effectiveCount > 0 && (
          <div className="gate">
            <Choani pose="fetch" size={34} />
            <b>검사 {lint.effectiveCount}건 위반</b>
            <span>
              {lint.violations
                .filter((v) => !v.waived)
                .slice(0, 2)
                .map((v) => `${v.refs[0]} ${v.code}`)
                .join(' · ')}{' '}
              — 수정안을 물어왔어요.
            </span>
            <button className="go" disabled={busy} onClick={reviewViolations}>
              제안 {lint.effectiveCount}건 보기
            </button>
          </div>
        )}
      </main>
    </AppShell>
  );
}

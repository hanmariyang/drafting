import { useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api, openSuggestionsOf, type Project } from '../lib/api.ts';
import { startFromIdea, getLastDoc, getOpenMode, type LastDoc } from '../lib/newPlan.ts';
import { AppShell } from '../components/AppShell.tsx';
import { AppName } from '../components/AppName.tsx';
import { Choani } from '../components/Choani.tsx';
import { useMeta } from '../App.tsx';

/**
 * 시작 화면 (진입 재설계 시안 1) — "홈"이 아니다.
 * 첫 행동 = 아이디어 한 줄 → 인터뷰. 프로젝트 이름을 묻지 않는다.
 * 온보딩은 위저드 대신 제안이 대기 중인 예시 기획서로.
 * 설정에서 "마지막 문서로 열기"를 켜면 이 화면 대신 복원 착지한다 (시안 2).
 */
export function StartScreen() {
  const { meta } = useMeta();
  const nav = useNavigate();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [idea, setIdea] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [last, setLast] = useState<LastDoc | null>(null);
  const redirected = useRef(false);

  useEffect(() => {
    // 복원 착지 모드: 마지막 문서가 있으면 시작 화면을 건너뛴다
    const lastDoc = getLastDoc();
    setLast(lastDoc);
    if (!redirected.current && getOpenMode() === 'resume' && lastDoc) {
      redirected.current = true;
      nav(`/projects/${lastDoc.pid}/documents/${lastDoc.did}`, { replace: true });
      return;
    }
    api
      .listProjects()
      .then(setProjects)
      .catch(() => setProjects([]));
  }, [nav]);

  async function go() {
    if (!idea.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      nav(await startFromIdea(idea));
    } catch (err) {
      setError((err as Error)?.message ?? '생성에 실패했습니다');
      setBusy(false);
    }
  }

  async function openSample() {
    try {
      const { project, documentId } = await api.createSample();
      nav(documentId ? `/projects/${project.id}/documents/${documentId}` : `/projects/${project.id}`);
    } catch (err) {
      setError((err as Error)?.message ?? '예시 생성에 실패했습니다');
    }
  }

  const list = projects ?? [];
  const hasProjects = list.length > 0;
  const sampleExists = list.some((p) => p.name.startsWith('예시:'));
  const totalOpen = list.reduce((n, p) => n + openSuggestionsOf(p), 0);

  return (
    <AppShell
      crumb={<AppName />}
      tbarRight={
        <>
          {totalOpen > 0 && (
            <span className="sug-count">
              <i />제안 {totalOpen}
            </span>
          )}
          <Link className="btn" to="/settings">
            설정
          </Link>
          <span className="cmdk">⌘K</span>
        </>
      }
      tagline="수락하지 않은 문장은 문서에 없습니다"
      statusLeft={hasProjects ? <span>{list.length}개 프로젝트</span> : <span>첫 실행</span>}
      statusRight={
        <>
          {meta?.aiStub && <span>STUB AI</span>}
          <span>v{meta?.version ?? '…'}</span>
        </>
      }
    >
      <main className="start">
        <div className="start-in">
          <Choani pose="greet" size={92} className="start-ch" />
          <h1>무엇을 만들까요?</h1>
          <p className="start-phil">
            한 줄이면 제가 인터뷰를 열게요. AI가 쓴 모든 것은 제안으로 들어오고,
            <br />
            <b>수락해야만 문서가 됩니다.</b> 이름과 범위는 인터뷰에서 정리돼요.
          </p>

          <div className="idea-box">
            <input
              className="idea-input"
              placeholder="예: 회의실 예약이 매번 겹쳐서 정리하는 도구가 필요해요"
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && go()}
              autoFocus
            />
            <button className="btn pri idea-go" disabled={!idea.trim() || busy} onClick={go}>
              {busy ? '만드는 중…' : '인터뷰 시작'}
            </button>
          </div>
          {error && <div className="form-error">{error}</div>}

          <div className="start-import">
            <label className="btn ghost sm">
              프로젝트 가져오기 (.drafting)
              <input
                type="file"
                accept=".drafting,application/json"
                style={{ display: 'none' }}
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try {
                    const bundle = JSON.parse(await f.text());
                    const { projectId } = await api.importProject(bundle);
                    nav(`/projects/${projectId}`);
                  } catch (err) {
                    setError('가져오기 실패 · 올바른 .drafting 파일인지 확인하세요');
                  }
                }}
              />
            </label>
          </div>

          {last && (
            <button
              className="start-card resume"
              onClick={() => nav(`/projects/${last.pid}/documents/${last.did}`)}
            >
              <span className="k mono">이어서</span>
              <span className="t">
                <b>{last.projectName}</b>
                <span>{last.docTitle}</span>
              </span>
              <span className="open mono">열기</span>
            </button>
          )}

          {!sampleExists && (
            <button className="start-card sample" onClick={openSample}>
              <span className="sdot" />
              <span className="t">
                <b>예시 기획서: 주간 리포트 봇</b>
                <span>제안 3건이 검토를 기다리는 샘플 · 수락과 거절을 여기서 연습하세요</span>
              </span>
              <span className="open mono">둘러보기</span>
            </button>
          )}

          {hasProjects && (
            <div className="start-projects">
              <div className="grp-line mono">기획 프로젝트</div>
              {list.map((p) => {
                const open = openSuggestionsOf(p);
                return (
                  <button
                    key={p.id}
                    className="start-row"
                    onClick={() => nav(`/projects/${p.id}`)}
                  >
                    <span className="nm">{p.name}</span>
                    {p.description && p.description !== p.name && (
                      <span className="ds">{p.description}</span>
                    )}
                    <span className="sp" />
                    {open > 0 && (
                      <span className="gd mono">
                        <i />
                        {open}
                      </span>
                    )}
                    <span className="dc mono">문서 {p.documentCount ?? 0}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </AppShell>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { startFromIdea, startFeaturePlan, startProjectBrief } from '../lib/newPlan.ts';
import { api, type Project, type DocumentModel } from '../lib/api.ts';

type Kind = 'product' | 'feature';
const NEW_PROJECT = '';

/**
 * 새 기획 시트 (진입 재설계 시안 3) — 별도 페이지가 아니라 지금 문맥 위에 뜬다.
 * ⌘N / 스위처 + / "새 기획" 버튼이 연다.
 *
 * 두 갈래다. 제품 기획(그린필드 6종 체인)과 작은 기능 기획(이미 있는 제품에
 * 기능 하나 · 체인 밖 단독 문서). 후자는 프로젝트 브리프를 맥락으로 붙일 수 있다.
 */
export function NewPlanSheet({ kind: initialKind = 'product', onClose }: { kind?: Kind; onClose: () => void }) {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const currentPid = pathname.match(/^\/projects\/([^/]+)/)?.[1] ?? '';

  const [kind, setKind] = useState<Kind>(initialKind);
  const [idea, setIdea] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // 작은 기능 기획: 어느 프로젝트에 붙일지 + 그 프로젝트의 브리프
  const [projects, setProjects] = useState<Project[]>([]);
  const [targetPid, setTargetPid] = useState<string>(currentPid);
  const [briefs, setBriefs] = useState<DocumentModel[]>([]);
  const [useBrief, setUseBrief] = useState(true);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (kind !== 'feature') return;
    api.listProjects().then(setProjects).catch(() => setProjects([]));
  }, [kind]);

  // 대상 프로젝트가 정해지면 그 안의 브리프 문서를 찾는다.
  useEffect(() => {
    if (kind !== 'feature' || !targetPid) {
      setBriefs([]);
      return;
    }
    let live = true;
    api
      .getProject(targetPid)
      .then((p) => live && setBriefs(p.documents.filter((d) => d.type === 'brief')))
      .catch(() => live && setBriefs([]));
    return () => {
      live = false;
    };
  }, [kind, targetPid]);

  async function run(make: () => Promise<string>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const path = await make();
      onClose();
      nav(path);
    } catch (err) {
      setError((err as Error)?.message ?? '생성에 실패했습니다');
      setBusy(false);
    }
  }

  const canGo = idea.trim().length > 0;
  function go() {
    if (!canGo) return;
    if (kind === 'product') return void run(() => startFromIdea(idea));
    return void run(() =>
      startFeaturePlan(idea, {
        projectId: targetPid || undefined,
        briefDocumentId: useBrief ? (briefs[0]?.id ?? null) : null,
      }),
    );
  }

  return (
    <div className="sheet-veil" onClick={onClose}>
      <div className="plan-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="eyebrow">New Plan · ⌘N</div>
        <h2>{kind === 'product' ? '무엇을 만들까요?' : '어떤 기능을 더할까요?'}</h2>

        <div className="kind-pick" role="tablist">
          <button
            role="tab"
            aria-selected={kind === 'product'}
            className={`btn sm ${kind === 'product' ? 'pri' : ''}`}
            onClick={() => setKind('product')}
          >
            제품 기획
          </button>
          <button
            role="tab"
            aria-selected={kind === 'feature'}
            className={`btn sm ${kind === 'feature' ? 'pri' : ''}`}
            onClick={() => setKind('feature')}
          >
            작은 기능 기획
          </button>
        </div>

        <input
          ref={inputRef}
          className="field"
          placeholder={
            kind === 'product'
              ? '아이디어 한 줄. 이름과 범위는 인터뷰에서 정리됩니다.'
              : '기능 한 줄. 예: 공유 링크가 언제 열렸는지 보이게'
          }
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && go()}
        />

        {kind === 'feature' && (
          <div className="feat-opts">
            <label className="fo-row">
              <span className="k">프로젝트</span>
              <select
                className="field"
                value={targetPid}
                onChange={(e) => setTargetPid(e.target.value)}
              >
                <option value={NEW_PROJECT}>새 프로젝트로 만들기</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            {briefs.length > 0 ? (
              <label className="fo-check">
                <input
                  type="checkbox"
                  checked={useBrief}
                  onChange={(e) => setUseBrief(e.target.checked)}
                />
                <span>
                  프로젝트 브리프를 맥락으로 연결 — <b>{briefs[0].title}</b>
                </span>
              </label>
            ) : (
              <div className="fo-note">
                <span className="hint">
                  브리프가 없으면 범용 기능 기획이 됩니다. 브리프를 먼저 만들면 실제 스택·모듈
                  이름으로 씁니다.
                </span>
                <button
                  className="btn sm"
                  disabled={busy}
                  onClick={() =>
                    run(() => startProjectBrief(idea, { projectId: targetPid || undefined }))
                  }
                >
                  브리프 먼저 만들기
                </button>
              </div>
            )}
          </div>
        )}

        {error && <div className="form-error">{error}</div>}
        <div className="plan-sheet-row">
          <button className="btn pri" disabled={!canGo || busy} onClick={go}>
            {busy ? '만드는 중…' : '인터뷰 시작'}
          </button>
          <button className="btn" onClick={onClose}>
            닫기
          </button>
          <span className="hint mono">답이 곧 제안의 근거가 됩니다</span>
        </div>
      </div>
    </div>
  );
}

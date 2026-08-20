import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  api,
  type DocumentModel,
  type LintReport,
  type Section,
  type Suggestion,
} from '../lib/api.ts';
import { AppShell } from '../components/AppShell.tsx';
import { DeliverablesNav } from '../components/DeliverablesNav.tsx';
import { Choani } from '../components/Choani.tsx';

const RULES: Array<[string, string]> = [
  ['E-BROKEN-REF', '참조 무결성 (기능→요구, 스텝→화면)'],
  ['E-DUP-REF', '중복 번호 없음'],
  ['W-ORPHAN-SPEC', '고아 기능 없음'],
  ['W-UNREACHED-PAGE', '미도달 화면 없음'],
  ['W-EMPTY-PAGE', '빈 화면 없음'],
  ['W-NO-FLOW', 'P0 기능 플로우 연결'],
];

export function HandoffPage() {
  const { pid } = useParams();
  const [project, setProject] = useState<{ name: string; documents: DocumentModel[] } | null>(null);
  const [lint, setLint] = useState<LintReport | null>(null);
  const [handoffId, setHandoffId] = useState<string | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [shareUrl, setShareUrl] = useState('');

  const load = useCallback(async () => {
    if (!pid) return;
    const [p, hub] = await Promise.all([api.getProject(pid), api.hub(pid)]);
    setProject(p);
    setLint(hub.lint);
    const hid = hub.derived.handoff.documentId;
    setHandoffId(hid);
    if (hid) {
      const doc = await api.getDocument(hid);
      setSections(doc.sections);
      const sg = await api.suggestions(hid, 'open').then((r) => (Array.isArray(r) ? r : r.suggestions)).catch(() => []);
      setSuggestions(sg as Suggestion[]);
    } else {
      setSections([]);
      setSuggestions([]);
    }
  }, [pid]);

  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, [load]);

  async function compile() {
    if (!pid || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.compileHandoff(pid);
      await load();
    } catch (e) {
      setError((e as Error).message || '검사 위반이 남아 있어요.');
    } finally {
      setBusy(false);
    }
  }

  async function acceptOverview(id: string) {
    await api.acceptSuggestion(id);
    await load();
  }

  async function makeShare() {
    if (!handoffId) return;
    const link = await api.createShare(handoffId, null);
    setShareUrl(link.url);
  }

  const gatePasses = lint?.gatePasses ?? false;

  function ruleStatus(code: string) {
    const eff = lint?.violations.filter((v) => v.code === code && !v.waived).length ?? 0;
    const waived = lint?.violations.filter((v) => v.code === code && v.waived).length ?? 0;
    if (eff > 0) return { ok: false, text: `위반 ${eff}` };
    if (waived > 0) return { ok: true, text: `통과 · 무시 ${waived}` };
    return { ok: true, text: '통과' };
  }

  const panel = (
    <>
      <div className="ph">제안 {suggestions.length}</div>
      {suggestions.length === 0 ? (
        <div className="panel-empty">
          <Choani pose="wait" size={72} />
          {handoffId ? '지시서가 확정되었어요.' : '검사를 통과하면 지시서를 컴파일할 수 있어요.'}
        </div>
      ) : (
        suggestions.map((sg) => (
          <div className="scard" key={sg.id}>
            <div className="sh">
              <Choani pose="fetch" size={20} animate={false} />
              <b>{sg.title}</b>
              <span className="ssrc">{sg.source}</span>
            </div>
            <p>{sg.body}</p>
            <div className="scard-acts">
              <button className="a" onClick={() => acceptOverview(sg.id)}>
                수락
              </button>
            </div>
          </div>
        ))
      )}
    </>
  );

  return (
    <AppShell
      crumb={
        <>
          <b className="name">{project?.name ?? '프로젝트'}</b>
          <span className="sep">/</span>
          <span>개발 지시서</span>
        </>
      }
      tbarRight={
        <>
          {handoffId && (
            <a className="btn pri" href={api.promptPackHref(pid!)}>
              프롬프트 팩 내보내기
            </a>
          )}
          <span className="cmdk">⌘K</span>
        </>
      }
      nav={
        project ? (
          <DeliverablesNav
            projectId={pid!}
            projectName={project.name}
            documents={project.documents}
            active="DEV"
          />
        ) : undefined
      }
      panel={handoffId ? panel : undefined}
      tagline="수락하지 않은 항목은 지시서에 없습니다"
    >
      <main className="ed">
        <div className="editor-inner">
          <div className="eyebrow">DEV · Handoff — Compiled</div>
          <h1 className="struct-h1">개발 지시서</h1>
          <div className="dmeta">수락분 전체에서 컴파일 · 검사 통과가 생성 조건</div>

          {RULES.map(([code, label]) => {
            const st = ruleStatus(code);
            return (
              <div className="check" key={code}>
                <span className="cid">{code}</span>
                <span className="rt">{label}</span>
                <span className={st.ok ? 'cok' : 'cwarn'}>{st.text}</span>
              </div>
            );
          })}

          {error && <div className="err" style={{ marginTop: 12 }}>{error}</div>}

          {!handoffId && (
            <div className="hoact" style={{ marginTop: 18 }}>
              <button className="btn pri lg" disabled={!gatePasses || busy} onClick={compile}>
                {gatePasses ? '지시서 생성' : '검사 위반 해소 필요'}
              </button>
              {!gatePasses && (
                <span className="hint">위반을 수정하거나 무시(waive)하면 생성됩니다</span>
              )}
            </div>
          )}

          {handoffId &&
            sections.map((s) => (
              <div className={`hosec ${s.status === 'proposed' ? 'proposed' : ''}`} key={s.id}>
                <div className="hohead">{s.heading}</div>
                <div className="hobody">{s.body}</div>
              </div>
            ))}

          {handoffId && (
            <div className="hoact" style={{ marginTop: 16 }}>
              <a className="btn pri" href={api.promptPackHref(pid!)}>
                Claude Code로 발주
              </a>
              <a className="btn" href={`/api/documents/${handoffId}/export.md`}>
                Markdown
              </a>
              <button className="btn" onClick={makeShare}>
                공유 링크
              </button>
              <button className="btn" onClick={compile} disabled={busy}>
                재컴파일
              </button>
              <span className="hint">수락하지 않은 항목은 지시서에 없습니다</span>
            </div>
          )}

          {shareUrl && (
            <div className="mini-card" style={{ marginTop: 10 }}>
              <span className="mono">공유 링크: </span>
              <a className="mono" href={shareUrl} target="_blank" rel="noreferrer">
                {shareUrl}
              </a>
            </div>
          )}
        </div>
      </main>
    </AppShell>
  );
}

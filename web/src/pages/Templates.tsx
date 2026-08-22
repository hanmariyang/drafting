import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type InterviewTemplate, type DocumentType } from '../lib/api.ts';
import { AppShell } from '../components/AppShell.tsx';
import { AppName } from '../components/AppName.tsx';

const DOC_TYPES: DocumentType[] = ['prd', 'feature-spec', 'ia', 'user-flow'];
const SOURCE_LABEL: Record<string, string> = { file: '기본', custom: '커스텀', override: '수정됨' };

function blankTemplate(): InterviewTemplate {
  return {
    id: '',
    docType: 'prd',
    name: '',
    description: '',
    questions: [{ id: 'q1', prompt: '', hint: '', example: '' }],
    sections: ['개요'],
    draftGuidance: '명확한 기획 문서를 작성한다. 한국어로 작성한다.',
    source: 'custom',
  };
}

export function Templates() {
  const [list, setList] = useState<InterviewTemplate[]>([]);
  const [draft, setDraft] = useState<InterviewTemplate | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [msg, setMsg] = useState('');

  async function load() {
    setList(await api.templates());
  }
  useEffect(() => {
    load().catch(() => {});
  }, []);

  function edit(t: InterviewTemplate) {
    setDraft(JSON.parse(JSON.stringify(t)));
    setIsNew(false);
    setMsg('');
  }
  function newTemplate() {
    setDraft(blankTemplate());
    setIsNew(true);
    setMsg('');
  }

  function patch(p: Partial<InterviewTemplate>) {
    setDraft((d) => (d ? { ...d, ...p } : d));
  }

  async function save() {
    if (!draft) return;
    setMsg('저장 중…');
    try {
      const saved = await api.saveTemplate(draft);
      setMsg('저장됨 · 다음 인터뷰부터 적용됩니다');
      await load();
      setDraft(saved);
      setIsNew(false);
    } catch (e) {
      setMsg(`실패 · ${(e as Error).message}`);
    }
  }

  async function revert() {
    if (!draft) return;
    if (!confirm('이 템플릿의 커스텀 내용을 지웁니다. (기본 템플릿이 있으면 기본으로 복귀)')) return;
    try {
      const r = await api.deleteTemplate(draft.id);
      await load();
      setDraft(r.reverted ?? null);
      setMsg('되돌렸습니다');
    } catch (e) {
      setMsg(`실패 · ${(e as Error).message}`);
    }
  }

  return (
    <AppShell
      crumb={
        <>
          <Link to="/">
            <AppName />
          </Link>
          <span className="sep">/</span>
          <b>템플릿 라이브러리</b>
        </>
      }
      tbarRight={<span className="cmdk">⌘K</span>}
      tagline="인터뷰 질문·섹션·지침을 문서 유형별로 커스터마이즈 — 파일은 건드리지 않고 앱에 저장됩니다"
    >
      <main className="settings">
        <div className="tpl-wrap">
          <aside className="tpl-list">
            <div className="tpl-list-head">
              <b>템플릿</b>
              <button className="btn sm" onClick={newTemplate}>
                + 새로
              </button>
            </div>
            {list.map((t) => (
              <button
                key={t.id}
                className={`tpl-row ${draft?.id === t.id && !isNew ? 'active' : ''}`}
                onClick={() => edit(t)}
              >
                <span className="tpl-name">{t.name}</span>
                <span className="tpl-meta">
                  {t.docType} · 질문 {t.questions.length}
                </span>
                {t.source && t.source !== 'file' && (
                  <span className="tpl-src">{SOURCE_LABEL[t.source]}</span>
                )}
              </button>
            ))}
          </aside>

          <section className="tpl-edit">
            {!draft ? (
              <div className="muted" style={{ padding: 24 }}>
                왼쪽에서 템플릿을 고르거나 <b>+ 새로</b> 를 눌러 만드세요.
              </div>
            ) : (
              <>
                <div className="tpl-form-head">
                  <h3>{isNew ? '새 템플릿' : draft.name || draft.id}</h3>
                  {draft.source && draft.source !== 'file' && !isNew && (
                    <button className="btn sm danger" onClick={revert}>
                      기본으로 되돌리기
                    </button>
                  )}
                </div>

                <label className="lbl">ID {isNew ? '(소문자·숫자·하이픈)' : ''}</label>
                <input
                  className="field"
                  value={draft.id}
                  disabled={!isNew}
                  placeholder="예: prd-lean"
                  onChange={(e) => patch({ id: e.target.value })}
                />

                <div className="tpl-2col">
                  <div>
                    <label className="lbl">이름</label>
                    <input className="field" value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
                  </div>
                  <div>
                    <label className="lbl">문서 유형</label>
                    <select
                      className="field"
                      value={draft.docType}
                      onChange={(e) => patch({ docType: e.target.value as DocumentType })}
                    >
                      {DOC_TYPES.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <label className="lbl">설명</label>
                <input
                  className="field"
                  value={draft.description}
                  onChange={(e) => patch({ description: e.target.value })}
                />

                <label className="lbl">생성 지침 (system prompt)</label>
                <textarea
                  className="field"
                  rows={3}
                  style={{ resize: 'vertical' }}
                  value={draft.draftGuidance}
                  onChange={(e) => patch({ draftGuidance: e.target.value })}
                />

                <label className="lbl">섹션 (초안이 만들 순서)</label>
                {draft.sections.map((s, i) => (
                  <div key={i} className="tpl-inline">
                    <input
                      className="field"
                      value={s}
                      onChange={(e) => {
                        const next = [...draft.sections];
                        next[i] = e.target.value;
                        patch({ sections: next });
                      }}
                    />
                    <button
                      className="btn sm"
                      onClick={() => patch({ sections: draft.sections.filter((_, j) => j !== i) })}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button className="btn sm" onClick={() => patch({ sections: [...draft.sections, '새 섹션'] })}>
                  + 섹션
                </button>

                <label className="lbl" style={{ marginTop: 14 }}>
                  인터뷰 질문
                </label>
                {draft.questions.map((q, i) => (
                  <div key={i} className="tpl-q">
                    <div className="tpl-inline">
                      <input
                        className="field"
                        style={{ maxWidth: 90 }}
                        placeholder="id"
                        value={q.id}
                        onChange={(e) => {
                          const next = [...draft.questions];
                          next[i] = { ...q, id: e.target.value };
                          patch({ questions: next });
                        }}
                      />
                      <input
                        className="field"
                        placeholder="질문"
                        value={q.prompt}
                        onChange={(e) => {
                          const next = [...draft.questions];
                          next[i] = { ...q, prompt: e.target.value };
                          patch({ questions: next });
                        }}
                      />
                      <button
                        className="btn sm"
                        onClick={() => patch({ questions: draft.questions.filter((_, j) => j !== i) })}
                      >
                        ×
                      </button>
                    </div>
                    <div className="tpl-inline">
                      <input
                        className="field"
                        placeholder="힌트(선택)"
                        value={q.hint ?? ''}
                        onChange={(e) => {
                          const next = [...draft.questions];
                          next[i] = { ...q, hint: e.target.value };
                          patch({ questions: next });
                        }}
                      />
                      <input
                        className="field"
                        placeholder="예시(선택)"
                        value={q.example ?? ''}
                        onChange={(e) => {
                          const next = [...draft.questions];
                          next[i] = { ...q, example: e.target.value };
                          patch({ questions: next });
                        }}
                      />
                    </div>
                  </div>
                ))}
                <button
                  className="btn sm"
                  onClick={() =>
                    patch({ questions: [...draft.questions, { id: `q${draft.questions.length + 1}`, prompt: '' }] })
                  }
                >
                  + 질문
                </button>

                <div className="tpl-save">
                  <button className="btn pri" onClick={save}>
                    저장
                  </button>
                  {msg && <span className={msg.startsWith('실패') ? 'err' : 'ok'}>{msg}</span>}
                </div>
              </>
            )}
          </section>
        </div>
      </main>
    </AppShell>
  );
}

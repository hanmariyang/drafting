import { useEffect, useRef, useState } from 'react';
import type { InterviewTemplate, InterviewSession } from '../lib/api.ts';

interface Props {
  template: InterviewTemplate;
  session: InterviewSession;
  onSaveAnswer: (a: { questionId: string; question: string; answer: string; currentIndex: number }) => void;
  onGenerate: () => void;
  /** 보강 질문 요청 — 새로 붙은 질문 수를 돌려준다. */
  onFollowups?: () => Promise<number>;
  streaming: boolean;
}

/** 화면이 다루는 질문 하나 — 템플릿 질문과 보강 질문을 같은 모양으로 본다. */
interface PanelQuestion {
  id: string;
  prompt: string;
  hint?: string;
  example?: string;
  /** 보강 질문이면 true (배지 하나로만 구분) */
  extra: boolean;
  /** 보강 질문이 나온 이유 (어느 답변이 왜 얕은지) */
  reason?: string;
}

export function InterviewPanel({
  template,
  session,
  onSaveAnswer,
  onGenerate,
  onFollowups,
  streaming,
}: Props) {
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(session.answers.map((a) => [a.questionId, a.answer])),
  );
  const [index, setIndex] = useState(session.current_index ?? 0);
  const [fuBusy, setFuBusy] = useState(false);
  const [fuMsg, setFuMsg] = useState('');
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // reset when switching document/session
  useEffect(() => {
    setAnswers(Object.fromEntries(session.answers.map((a) => [a.questionId, a.answer])));
    setIndex(session.current_index ?? 0);
    setFuMsg('');
  }, [session.id]);

  // 보강 질문은 템플릿 질문 뒤에 이어 붙고, 같은 답변 UI 를 쓴다.
  const base: PanelQuestion[] = template.questions.map((q) => ({ ...q, extra: false }));
  const extras: PanelQuestion[] = (session.extra_questions ?? []).map((q) => ({
    id: q.id,
    prompt: q.prompt,
    hint: q.hint,
    extra: true,
    reason: q.reason,
  }));
  const questions = [...base, ...extras];
  const q = questions[Math.min(index, questions.length - 1)];
  const answeredCount = questions.filter((qq) => (answers[qq.id] ?? '').trim()).length;
  const progress = Math.round((answeredCount / questions.length) * 100);
  const baseAnswered = base.every((qq) => (answers[qq.id] ?? '').trim());

  function change(val: string) {
    setAnswers((a) => ({ ...a, [q.id]: val }));
    clearTimeout(timers.current[q.id]);
    timers.current[q.id] = setTimeout(() => {
      onSaveAnswer({ questionId: q.id, question: q.prompt, answer: val, currentIndex: index });
    }, 500);
  }

  function go(next: number) {
    // flush current answer immediately on navigation
    onSaveAnswer({ questionId: q.id, question: q.prompt, answer: answers[q.id] ?? '', currentIndex: next });
    setIndex(Math.max(0, Math.min(questions.length - 1, next)));
  }

  async function requestFollowups() {
    if (!onFollowups || fuBusy) return;
    setFuBusy(true);
    setFuMsg('');
    try {
      const added = await onFollowups();
      if (added === 0) setFuMsg('보강할 게 없어요. 지금 답변으로 초안을 만들 수 있어요.');
      else setIndex(base.length); // 첫 보강 질문으로 이동
    } catch (e) {
      setFuMsg(`보강 질문을 받지 못했어요 · ${(e as Error).message}`);
    } finally {
      setFuBusy(false);
    }
  }

  return (
    <div className="interview">
      <div className="q-progress">
        <i style={{ width: `${progress}%` }} />
      </div>
      <div className="q-meta">
        {template.name} · {answeredCount}/{questions.length} 답변
      </div>

      <div className="q-card">
        <div className="q">
          Q{index + 1}. {q.prompt}
          {q.extra && <span className="q-badge">보강</span>}
        </div>
        <textarea
          className="field"
          autoFocus
          value={answers[q.id] ?? ''}
          onChange={(e) => change(e.target.value)}
          placeholder={q.example ? `예: ${q.example}` : '답변을 입력하세요'}
        />
        {(q.hint || q.example || q.reason) && (
          <div className="q-hint">
            {q.reason && (
              <div>
                <b>왜 묻나요</b> · {q.reason}
              </div>
            )}
            {q.hint && (
              <div>
                <b>힌트</b> · {q.hint}
              </div>
            )}
            {q.example && (
              <div>
                <b>예시</b> · {q.example}
              </div>
            )}
          </div>
        )}
        <div className="q-nav">
          <button className="btn" disabled={index === 0} onClick={() => go(index - 1)}>
            이전
          </button>
          {index < questions.length - 1 ? (
            <button className="btn pri" onClick={() => go(index + 1)}>
              다음
            </button>
          ) : (
            <span className="ok" style={{ alignSelf: 'center' }}>
              마지막 질문
            </span>
          )}
        </div>
      </div>

      <div className="q-list">
        {questions.map((qq, i) => (
          <button
            key={qq.id}
            className={`q-list-item ${i === index ? 'active' : ''} ${
              (answers[qq.id] ?? '').trim() ? 'answered' : ''
            }`}
            onClick={() => go(i)}
          >
            <span className="dot" /> Q{i + 1}. {qq.prompt.slice(0, 30)}
            {qq.prompt.length > 30 ? '…' : ''}
            {qq.extra && <span className="q-badge">보강</span>}
          </button>
        ))}
      </div>

      {onFollowups && (
        <button
          className="btn"
          style={{ width: '100%' }}
          disabled={fuBusy || streaming || !baseAnswered}
          onClick={requestFollowups}
          title="답변이 얕은 곳만 골라 보강 질문을 받습니다"
        >
          {fuBusy ? '보강 질문 받는 중…' : '보강 질문 받기'}
        </button>
      )}
      {onFollowups && !baseAnswered && (
        <div className="q-meta" style={{ marginTop: 8 }}>
          모든 질문에 답한 뒤 보강 질문을 받을 수 있습니다.
        </div>
      )}
      {fuMsg && (
        <div className="q-meta" style={{ marginTop: 8 }}>
          {fuMsg}
        </div>
      )}

      <button
        className="btn pri lg interview-cta"
        style={{ width: '100%' }}
        disabled={streaming || answeredCount === 0}
        onClick={onGenerate}
      >
        {streaming ? '초안 생성 중…' : 'AI 초안 생성'}
      </button>
      {answeredCount === 0 && (
        <div className="q-meta" style={{ marginTop: 8 }}>
          최소 1개 답변 후 생성할 수 있습니다.
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import type { InterviewTemplate, InterviewSession } from '../lib/api.ts';

interface Props {
  template: InterviewTemplate;
  session: InterviewSession;
  onSaveAnswer: (a: { questionId: string; question: string; answer: string; currentIndex: number }) => void;
  onGenerate: () => void;
  streaming: boolean;
}

export function InterviewPanel({ template, session, onSaveAnswer, onGenerate, streaming }: Props) {
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(session.answers.map((a) => [a.questionId, a.answer])),
  );
  const [index, setIndex] = useState(session.current_index ?? 0);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // reset when switching document/session
  useEffect(() => {
    setAnswers(Object.fromEntries(session.answers.map((a) => [a.questionId, a.answer])));
    setIndex(session.current_index ?? 0);
  }, [session.id]);

  const questions = template.questions;
  const q = questions[Math.min(index, questions.length - 1)];
  const answeredCount = questions.filter((qq) => (answers[qq.id] ?? '').trim()).length;
  const progress = Math.round((answeredCount / questions.length) * 100);

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
        </div>
        <textarea
          className="field"
          autoFocus
          value={answers[q.id] ?? ''}
          onChange={(e) => change(e.target.value)}
          placeholder={q.example ? `예: ${q.example}` : '답변을 입력하세요'}
        />
        {(q.hint || q.example) && (
          <div className="q-hint">
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
          </button>
        ))}
      </div>

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

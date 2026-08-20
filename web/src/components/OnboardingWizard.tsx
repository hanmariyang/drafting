import { useEffect, useState } from 'react';
import { api, type KeyInfo, type ProviderId } from '../lib/api.ts';
import { useMeta } from '../App.tsx';
import { AppName } from './AppName.tsx';

const PROVIDERS: { id: ProviderId; name: string; placeholder: string; hint: string }[] = [
  { id: 'anthropic', name: 'Anthropic', placeholder: 'sk-ant-…', hint: 'console.anthropic.com' },
  { id: 'openai', name: 'OpenAI', placeholder: 'sk-…', hint: 'platform.openai.com' },
  { id: 'openrouter', name: 'OpenRouter', placeholder: 'sk-or-…', hint: 'openrouter.ai/keys' },
];

/**
 * First-run BYOK setup (SPEC-21). Blocking — cannot be skipped. Requires at
 * least one working provider key (or stub mode) before the app is usable.
 */
export function OnboardingWizard({ onDone }: { onDone: () => Promise<void> }) {
  const { meta } = useMeta();
  const [step, setStep] = useState(0);
  const [keys, setKeys] = useState<KeyInfo[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.keys().then(setKeys).catch(() => {});
  }, []);

  const anyConfigured = keys.some((k) => k.configured) || !!meta?.aiStub;

  async function saveAndTest(p: ProviderId) {
    const key = (drafts[p] ?? '').trim();
    if (!key) return;
    setBusy(true);
    setStatus((s) => ({ ...s, [p]: '저장 중…' }));
    try {
      await api.saveKey(p, key);
      const res = await api.testKey(p);
      setStatus((s) => ({ ...s, [p]: res.ok ? '연결 성공' : `실패 · ${res.detail ?? ''}` }));
      setKeys(await api.keys());
      setDrafts((d) => ({ ...d, [p]: '' }));
    } catch (e) {
      setStatus((s) => ({ ...s, [p]: `실패 · ${(e as Error).message}` }));
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    await api.completeOnboarding();
    await onDone();
  }

  return (
    <div className="overlay">
      <div className="dialog">
        <div className="wizard-step">
          <span className={`wizard-dot ${step === 0 ? 'active' : ''}`} />
          <span className={`wizard-dot ${step === 1 ? 'active' : ''}`} />
        </div>

        {step === 0 && (
          <>
            <h2>
              <AppName />에 오신 것을 환영합니다
            </h2>
            <p className="subtle">
              AI가 쓴 모든 것은 <b style={{ color: 'var(--sug)' }}>제안</b>으로 들어오고, 수락해야만
              문서가 됩니다. 당신이 편집장입니다.
            </p>
            <div className="mini-card">
              <p className="subtle" style={{ margin: 0 }}>
                <b>BYOK(Bring Your Own Key)</b> 방식입니다. 당신의 AI 제공자 키를 직접 등록하면 모든
                AI 호출은 당신의 키로만 이뤄집니다. 키는 이 서버에 <b>암호화되어 저장</b>되며 평문으로
                노출되지 않습니다.
              </p>
            </div>
            <p className="subtle" style={{ marginTop: 12 }}>
              다음 단계에서 최소 한 곳의 키를 등록하세요. (Anthropic · OpenAI · OpenRouter)
            </p>
            {meta?.aiStub && (
              <p className="ok">STUB 모드가 켜져 있어 키 없이도 진행할 수 있습니다(오프라인 데모용).</p>
            )}
            <div className="foot-actions">
              <button className="btn pri lg" onClick={() => setStep(1)}>
                시작하기
              </button>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h2>AI 키 등록</h2>
            <p className="subtle">등록 후 각 키의 연결을 테스트합니다. 건너뛸 수 없습니다.</p>
            {PROVIDERS.map((p) => {
              const configured = keys.find((k) => k.provider === p.id)?.configured;
              return (
                <div key={p.id} style={{ marginTop: '1rem' }}>
                  <label className="lbl">
                    {p.name} {configured && <span className="ok">· 등록됨</span>}
                    <span className="muted"> · {p.hint}</span>
                  </label>
                  <div className="h-row">
                    <input
                      className="field"
                      type="password"
                      placeholder={p.placeholder}
                      value={drafts[p.id] ?? ''}
                      onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                    />
                    <button
                      className="btn"
                      disabled={busy || !(drafts[p.id] ?? '').trim()}
                      onClick={() => saveAndTest(p.id)}
                    >
                      저장·테스트
                    </button>
                  </div>
                  {status[p.id] && (
                    <div className={status[p.id] === '연결 성공' ? 'ok' : 'err'}>{status[p.id]}</div>
                  )}
                </div>
              );
            })}
            <div className="divider" />
            <div className="h-row" style={{ justifyContent: 'space-between' }}>
              <button className="btn ghost" onClick={() => setStep(0)}>
                뒤로
              </button>
              <button className="btn pri lg" disabled={!anyConfigured || busy} onClick={finish}>
                {anyConfigured ? '완료하고 시작' : '키를 1개 이상 등록하세요'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

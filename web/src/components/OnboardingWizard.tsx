import { useEffect, useState } from 'react';
import { api, type KeyInfo, type ProviderId } from '../lib/api.ts';
import { useMeta } from '../App.tsx';
import { AppName } from './AppName.tsx';
import { Choani } from './Choani.tsx';

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
  const [cliNotice, setCliNotice] = useState('');

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

  // CLI(구독) 감지 시: 키 없이 바로 시작. 다만 CLI 가 설치·로그인돼 있어도
  // 조직이 Claude Code 접근을 막았을 수 있으므로, 여기서 실제 생성 권한을
  // 검증한 뒤에만 진행한다. 막혀 있으면 BYOK 스텝으로 유도한다.
  async function startWithCli() {
    setBusy(true);
    setCliNotice('Claude Code 생성 권한 확인 중…');
    try {
      const res = await api.testCli();
      if (!res.ok) {
        setCliNotice('');
        setStep(1);
        setStatus((s) => ({
          ...s,
          _cli: res.blocked
            ? `이 계정은 Claude Code 접근이 막혀 있어요 (조직 차단 가능). API 키를 등록하거나 개인 구독 계정으로 로그인하세요. · ${res.detail ?? ''}`
            : `Claude Code 로 생성할 수 없어요. API 키를 등록하세요. · ${res.detail ?? ''}`,
        }));
        return;
      }
      await api.setAiMode('cli');
      await api.completeOnboarding();
      await onDone();
    } catch (e) {
      setCliNotice('');
      setStep(1);
      setStatus((s) => ({ ...s, _cli: `확인 실패 · ${(e as Error).message}` }));
    } finally {
      setBusy(false);
    }
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
            <div style={{ textAlign: 'center', marginBottom: 6 }}>
              <Choani pose="greet" size={72} />
            </div>
            <h2>
              <AppName />에 오신 것을 환영합니다
            </h2>
            <p className="subtle">
              AI가 쓴 모든 것은 <b style={{ color: 'var(--sug)' }}>제안</b>으로 들어오고, 수락해야만
              문서가 됩니다. 당신이 편집장입니다.
            </p>
            {meta?.cliAvailable ? (
              <div className="mini-card">
                <p className="subtle" style={{ margin: 0 }}>
                  <b>Claude Code 를 찾았어요.</b> 구독 로그인으로 생성하니 API 키가 필요 없습니다.
                  {meta.cliBin && (
                    <span className="muted"> ({meta.cliBin})</span>
                  )}
                </p>
              </div>
            ) : (
              <div className="mini-card">
                <p className="subtle" style={{ margin: 0 }}>
                  <b>BYOK(Bring Your Own Key)</b> 방식으로 시작합니다. 키는 이 서버에{' '}
                  <b>암호화되어 저장</b>되며 평문으로 노출되지 않습니다. (Claude Code CLI 가 있는
                  환경에서는 키 없이 시작할 수 있어요.)
                </p>
              </div>
            )}
            {meta?.aiStub && (
              <p className="ok">STUB 모드가 켜져 있어 키 없이도 진행할 수 있습니다(오프라인 데모용).</p>
            )}
            <div className="foot-actions">
              {meta?.cliAvailable ? (
                <>
                  <button className="btn" disabled={busy} onClick={() => setStep(1)}>
                    API 키로 쓸래요
                  </button>
                  <button className="btn pri lg" disabled={busy} onClick={startWithCli}>
                    키 없이 시작하기
                  </button>
                </>
              ) : (
                <button className="btn pri lg" onClick={() => setStep(1)}>
                  시작하기
                </button>
              )}
              {cliNotice && (
                <p className="subtle" style={{ width: '100%', marginTop: 8 }}>
                  {cliNotice}
                </p>
              )}
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h2>AI 키 등록</h2>
            <p className="subtle">등록 후 각 키의 연결을 테스트합니다. 건너뛸 수 없습니다.</p>
            {status._cli && <div className="err" style={{ marginBottom: 4 }}>{status._cli}</div>}
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

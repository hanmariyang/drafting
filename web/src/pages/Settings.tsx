import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  type KeyInfo,
  type ProviderId,
  type ProviderModels,
  type DocumentType,
} from '../lib/api.ts';
import { useMeta } from '../App.tsx';
import { AppShell } from '../components/AppShell.tsx';
import { AppName } from '../components/AppName.tsx';
import { getOpenMode, setOpenMode, type OpenMode } from '../lib/newPlan.ts';

const PROVIDERS: ProviderId[] = ['anthropic', 'openai', 'openrouter'];
const DOC_TYPES: DocumentType[] = ['prd', 'feature-spec', 'ia', 'user-flow'];
const DOC_LABEL: Record<DocumentType, string> = {
  prd: 'PRD',
  'feature-spec': '기능명세',
  ia: 'IA',
  'user-flow': '유저플로우',
  handoff: '지시서',
};

export function Settings() {
  const { reload, meta } = useMeta();
  const [keys, setKeys] = useState<KeyInfo[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, string>>({});
  const [models, setModels] = useState<ProviderModels>({});
  const [savedMsg, setSavedMsg] = useState('');
  const [openMode, setOpenModeState] = useState<OpenMode>(getOpenMode());
  const [cliStatus, setCliStatus] = useState('');

  async function loadKeys() {
    setKeys(await api.keys());
  }
  useEffect(() => {
    loadKeys().catch(() => {});
    api.settings().then((s) => setModels(s.providerModels ?? {})).catch(() => {});
  }, []);

  async function saveKey(p: ProviderId) {
    const key = (drafts[p] ?? '').trim();
    if (!key) return;
    setStatus((s) => ({ ...s, [p]: '저장 중…' }));
    await api.saveKey(p, key);
    setDrafts((d) => ({ ...d, [p]: '' }));
    await loadKeys();
    await reload();
    const res = await api.testKey(p);
    setStatus((s) => ({ ...s, [p]: res.ok ? '연결 성공' : `실패 · ${res.detail ?? ''}` }));
  }
  async function test(p: ProviderId) {
    setStatus((s) => ({ ...s, [p]: '테스트 중…' }));
    const res = await api.testKey(p);
    setStatus((s) => ({ ...s, [p]: res.ok ? '연결 성공' : `실패 · ${res.detail ?? ''}` }));
  }
  async function remove(p: ProviderId) {
    await api.deleteKey(p);
    await loadKeys();
    await reload();
  }

  function setModel(dt: DocumentType | 'default', field: string, value: string) {
    setModels((m) => ({
      ...m,
      [dt]: {
        ...(m as Record<string, Record<string, unknown>>)[dt],
        [field]: field === 'maxTokens' ? Number(value) || undefined : value || undefined,
      },
    }));
  }
  async function saveModels() {
    await api.saveModels(models);
    setSavedMsg('저장됨');
    setTimeout(() => setSavedMsg(''), 1500);
  }

  const isOk = (v: string) => v === '연결 성공';

  return (
    <AppShell
      crumb={
        <>
          <Link to="/">
            <AppName />
          </Link>
          <span className="sep">/</span>
          <b>설정</b>
        </>
      }
      tbarRight={<span className="cmdk">⌘K</span>}
      tagline="키는 서버에 암호화되어 저장됩니다 · 평문은 저장되지 않습니다"
      statusRight={<span>v{meta?.version ?? '…'}</span>}
    >
      <main className="settings">
        <div className="settings-inner">
          <div className="eyebrow" style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.16em', color: 'var(--sub)', marginBottom: 8, textTransform: 'uppercase' }}>
            설정
          </div>
          <h1>설정</h1>

          <h3>AI 엔진</h3>
          <p className="subtle">
            Claude Code(구독)는 API 키 없이 로컬 CLI 로 생성합니다. docker 등 CLI 가 없는
            환경에서는 API 키(BYOK)를 사용하세요.
          </p>
          <div className="rows">
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <label className="opt">
                <input
                  type="radio"
                  name="aiMode"
                  checked={meta?.aiMode === 'cli'}
                  disabled={!meta?.cliAvailable}
                  onChange={async () => {
                    await api.setAiMode('cli');
                    await reload();
                  }}
                />
                Claude Code (구독{meta?.cliAvailable ? '' : ' · CLI 미감지'})
              </label>
              <label className="opt">
                <input
                  type="radio"
                  name="aiMode"
                  checked={meta?.aiMode === 'byok'}
                  onChange={async () => {
                    await api.setAiMode('byok');
                    await reload();
                  }}
                />
                API 키 (BYOK)
              </label>
              <button
                className="btn"
                onClick={async () => {
                  setCliStatus('테스트 중…');
                  const r = await api.testCli();
                  setCliStatus(r.ok ? `연결 성공 · ${r.detail ?? ''}` : `실패 · ${r.detail ?? ''}`);
                }}
              >
                CLI 테스트
              </button>
              {cliStatus && <span className="muted" style={{ fontSize: 12 }}>{cliStatus}</span>}
            </div>
          </div>

          <h3>실행 시 착지</h3>
          <p className="subtle">앱을 열 때 어디에 착지할지 정합니다.</p>
          <div className="rows">
            <div className="row">
              <label className="opt">
                <input
                  type="radio"
                  name="openMode"
                  checked={openMode === 'start'}
                  onChange={() => {
                    setOpenMode('start');
                    setOpenModeState('start');
                  }}
                />
                시작 화면 (기본)
              </label>
              <label className="opt">
                <input
                  type="radio"
                  name="openMode"
                  checked={openMode === 'resume'}
                  onChange={() => {
                    setOpenMode('resume');
                    setOpenModeState('resume');
                  }}
                />
                마지막 문서로 이어서
              </label>
            </div>
          </div>

          <h3>AI 제공자 키 (BYOK)</h3>
          <p className="subtle">
            키는 서버에 AES-256-GCM으로 암호화되어 저장됩니다. 평문은 저장되지 않습니다.
          </p>
          <div className="rows">
            {PROVIDERS.map((p) => {
              const info = keys.find((k) => k.provider === p);
              return (
                <div key={p} className="row" style={{ flexWrap: 'wrap' }}>
                  <b style={{ width: 100 }}>{p}</b>
                  {info?.configured ? (
                    <span className="ok">등록됨 ····{info.last4}</span>
                  ) : (
                    <span className="muted">미등록</span>
                  )}
                  <input
                    className="field grow"
                    type="password"
                    placeholder="새 키 입력 (교체 시)"
                    value={drafts[p] ?? ''}
                    onChange={(e) => setDrafts((d) => ({ ...d, [p]: e.target.value }))}
                  />
                  <button className="btn" disabled={!(drafts[p] ?? '').trim()} onClick={() => saveKey(p)}>
                    저장
                  </button>
                  <button className="btn" disabled={!info?.configured} onClick={() => test(p)}>
                    테스트
                  </button>
                  <button className="btn danger" disabled={!info?.configured} onClick={() => remove(p)}>
                    삭제
                  </button>
                  {status[p] && (
                    <span className={isOk(status[p]) ? 'ok' : 'err'} style={{ width: '100%' }}>
                      {status[p]}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="divider" />

          <h3>문서 유형별 모델 · 토큰 예산 (SPEC-19)</h3>
          <p className="subtle">비워두면 기본값을 사용합니다. 다음 AI 호출부터 적용됩니다.</p>
          <div className="rows">
            {(['default', ...DOC_TYPES] as (DocumentType | 'default')[]).map((dt) => {
              const entry = (models as Record<string, Record<string, unknown>>)[dt] ?? {};
              return (
                <div key={dt} className="row" style={{ flexWrap: 'wrap' }}>
                  <b style={{ width: 100 }}>{dt === 'default' ? '기본값' : DOC_LABEL[dt]}</b>
                  <select
                    className="field"
                    style={{ maxWidth: 150 }}
                    value={(entry.provider as string) ?? ''}
                    onChange={(e) => setModel(dt, 'provider', e.target.value)}
                  >
                    <option value="">(기본 제공자)</option>
                    {PROVIDERS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <input
                    className="field grow"
                    placeholder="모델 id (예: anthropic/claude-3.5-sonnet)"
                    value={(entry.model as string) ?? ''}
                    onChange={(e) => setModel(dt, 'model', e.target.value)}
                  />
                  <input
                    className="field"
                    style={{ maxWidth: 130 }}
                    type="number"
                    placeholder="max tokens"
                    value={(entry.maxTokens as number) ?? ''}
                    onChange={(e) => setModel(dt, 'maxTokens', e.target.value)}
                  />
                </div>
              );
            })}
          </div>
          <div className="new-row" style={{ marginTop: 12, maxWidth: 300 }}>
            <button className="btn pri" onClick={saveModels}>
              모델 설정 저장
            </button>
            {savedMsg && <span className="ok" style={{ alignSelf: 'center' }}>{savedMsg}</span>}
          </div>
        </div>
      </main>
    </AppShell>
  );
}

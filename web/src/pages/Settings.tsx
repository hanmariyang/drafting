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
  'design-system': '디자인 시스템',
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
  const [binPath, setBinPath] = useState('');
  const [binMsg, setBinMsg] = useState('');
  const [gwUrl, setGwUrl] = useState('');
  const [gwHeaders, setGwHeaders] = useState('');
  const [gwMsg, setGwMsg] = useState('');
  const [gwModels, setGwModels] = useState<string[]>([]);
  const [restoreMsg, setRestoreMsg] = useState('');

  async function loadKeys() {
    setKeys(await api.keys());
  }
  useEffect(() => {
    loadKeys().catch(() => {});
    api.settings().then((s) => setModels(s.providerModels ?? {})).catch(() => {});
  }, []);
  useEffect(() => {
    setBinPath(meta?.agentBinPath ?? '');
  }, [meta?.agentBinPath]);
  useEffect(() => {
    setGwUrl(meta?.openaiBaseUrl ?? '');
    if (meta?.openaiBaseUrl) {
      api.openaiModels().then((r) => setGwModels(r.models ?? [])).catch(() => {});
    }
  }, [meta?.openaiBaseUrl]);

  // "Name: value" 한 줄씩 → 헤더 객체
  function parseHeaders(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of text.split('\n')) {
      const i = line.indexOf(':');
      if (i <= 0) continue;
      const name = line.slice(0, i).trim();
      const val = line.slice(i + 1).trim();
      if (name && val) out[name] = val;
    }
    return out;
  }
  async function saveGateway() {
    setGwMsg('저장·감지 중…');
    try {
      const headers = parseHeaders(gwHeaders);
      const res = await api.saveOpenaiEndpoint(gwUrl.trim(), headers);
      await reload();
      if (res.baseUrl) setGwUrl(res.baseUrl); // /v1 자동 감지 결과 반영
      setGwModels(res.models ?? []);
      if (!gwUrl.trim()) setGwMsg('게이트웨이 해제됨 · 표준 OpenAI 사용');
      else if (res.detected === 'no-key')
        setGwMsg('저장됨 · openai 키를 먼저 등록하면 경로 자동 감지·모델 목록을 불러옵니다');
      else if (res.models?.length)
        setGwMsg(`저장됨 · 경로 자동 감지(${res.detected}) · 모델 ${res.models.length}개 불러옴`);
      else setGwMsg('저장됨 · 모델 목록을 못 불러왔습니다(키·주소 확인)');
    } catch (e) {
      setGwMsg(`실패 · ${(e as Error).message}`);
    }
    setTimeout(() => setGwMsg(''), 4000);
  }

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

  async function onRestoreFile(file: File) {
    if (!confirm('복원하면 현재 워크스페이스가 이 백업으로 완전히 교체됩니다. 계속할까요?')) return;
    setRestoreMsg('복원 중…');
    try {
      const base64: string = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
        r.onerror = () => reject(new Error('파일을 읽지 못했습니다'));
        r.readAsDataURL(file);
      });
      await api.restore(base64);
      setRestoreMsg('복원 완료 · 새로고침합니다…');
      setTimeout(() => window.location.assign('/'), 900);
    } catch (e) {
      setRestoreMsg(`실패 · ${(e as Error).message}`);
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

          <div className="rows" style={{ marginBottom: 14 }}>
            <div className="row">
              <Link className="btn" to="/templates">
                템플릿 라이브러리 편집
              </Link>
              <span className="muted" style={{ fontSize: 12 }}>
                인터뷰 질문·섹션·지침을 문서 유형별로 커스터마이즈
              </span>
            </div>
          </div>

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
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              <span className="muted" style={{ fontSize: 12, width: '100%' }}>
                {meta?.cliBin
                  ? `감지된 CLI: ${meta.cliBin}`
                  : 'CLI 미감지 · nvm/fnm 등 비표준 경로면 아래에 claude 전체 경로를 직접 지정하세요'}
              </span>
              <input
                className="input"
                style={{ flex: 1, minWidth: 260, fontFamily: 'var(--mono, monospace)', fontSize: 12 }}
                placeholder="예: /Users/you/.nvm/versions/node/v22.14.0/bin/claude"
                value={binPath}
                onChange={(e) => setBinPath(e.target.value)}
              />
              <button
                className="btn"
                onClick={async () => {
                  setBinMsg('저장 중…');
                  const r = await api.setAgentBin(binPath.trim());
                  await reload();
                  setBinMsg(r.cliAvailable ? `적용됨 · ${r.cliBin ?? ''}` : '경로에서 claude 를 찾지 못했습니다');
                }}
              >
                경로 적용
              </button>
              {binPath && (
                <button
                  className="btn ghost"
                  onClick={async () => {
                    setBinPath('');
                    await api.setAgentBin('');
                    await reload();
                    setBinMsg('해제됨 · 자동 탐색으로 복귀');
                  }}
                >
                  해제
                </button>
              )}
              {binMsg && <span className="muted" style={{ fontSize: 12, width: '100%' }}>{binMsg}</span>}
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

          <h3>OpenAI 호환 게이트웨이 (선택)</h3>
          <p className="subtle">
            LiteLLM·Azure·사내 프록시 등 OpenAI 호환 엔드포인트를 쓰려면 base URL 을 넣으세요.
            비워두면 표준 OpenAI 를 사용합니다. 키는 위 <b>openai</b> 칸에 게이트웨이 키를 등록하고,
            아래 모델 칸에 게이트웨이가 제공하는 모델 id 를 지정하세요.
          </p>
          <div className="rows">
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <b style={{ width: 100 }}>base URL</b>
              <input
                className="field grow"
                placeholder="예: https://gateway.example.com/v1 (비우면 표준 OpenAI)"
                value={gwUrl}
                onChange={(e) => setGwUrl(e.target.value)}
              />
              <button className="btn pri" onClick={saveGateway}>
                저장
              </button>
              {gwMsg && (
                <span className={gwMsg.startsWith('실패') ? 'err' : 'ok'} style={{ width: '100%' }}>
                  {gwMsg}
                </span>
              )}
            </div>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <b style={{ width: 100 }}>추가 헤더</b>
              <textarea
                className="field grow"
                rows={2}
                style={{ resize: 'vertical', fontFamily: 'var(--mono)', fontSize: 12 }}
                placeholder="선택 · 한 줄에 하나: 예) X-My-Header: value (표준 Bearer 는 자동 전송)"
                value={gwHeaders}
                onChange={(e) => setGwHeaders(e.target.value)}
              />
            </div>
            {gwModels.length > 0 && (
              <div className="row">
                <span className="muted" style={{ fontSize: 12 }}>
                  이 게이트웨이 모델 {gwModels.length}개: {gwModels.join(', ')} · 아래 모델 칸에서
                  드롭다운으로 고르세요.
                </span>
              </div>
            )}
          </div>
          {gwModels.length > 0 && (
            <datalist id="gw-models">
              {gwModels.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          )}

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
                    list={gwModels.length ? 'gw-models' : undefined}
                    placeholder={
                      gwModels.length
                        ? '게이트웨이 모델에서 선택'
                        : '모델 id (예: anthropic/claude-sonnet-4.6)'
                    }
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

          <div className="divider" />

          <h3>워크스페이스 백업 · 복원</h3>
          <p className="subtle">
            전체 데이터(프로젝트·문서·제안·설정)를 한 파일로 내려받고, 다른 기기로 옮기거나 위험한
            작업 전에 대비하세요. <b>복원은 현재 워크스페이스를 통째로 교체</b>합니다.
          </p>
          <div className="rows">
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <a className="btn" href={api.backupHref} download>
                백업 내려받기
              </a>
              <label className="btn" style={{ cursor: 'pointer' }}>
                복원(파일 선택)
                <input
                  type="file"
                  accept=".sqlite,application/octet-stream"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onRestoreFile(f);
                    e.target.value = '';
                  }}
                />
              </label>
              {restoreMsg && (
                <span className={restoreMsg.startsWith('실패') ? 'err' : 'ok'} style={{ width: '100%' }}>
                  {restoreMsg}
                </span>
              )}
            </div>
          </div>
        </div>
      </main>
    </AppShell>
  );
}

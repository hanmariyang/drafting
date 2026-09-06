import { useState } from 'react';
import { api } from '../lib/api.ts';

/**
 * 프로젝트 브리프 전용 입력 (설계 노트 §1) — 로컬에 클론된 레포 폴더 경로를 받아
 * README·매니페스트·디렉터리 구조·엔트리 파일만 읽고 6개 섹션을 제안으로 만든다.
 * 실패하면 이유를 그대로 보여준다 — 섹션을 직접 쓰는 길이 늘 열려 있다.
 */
export function BriefExtractBar({ docId, onExtracted }: { docId: string; onExtracted: () => void }) {
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [read, setRead] = useState('');

  async function run() {
    if (!path.trim() || busy) return;
    setBusy(true);
    setError('');
    setRead('');
    try {
      const out = await api.extractBrief(docId, path.trim());
      setRead(`${out.root} · ${out.read}`);
      onExtracted();
    } catch (e) {
      setError((e as Error).message || '추출에 실패했습니다');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="brief-extract">
      <div className="be-head">
        <b>레포 폴더에서 추출</b>
        <span className="hint">
          이미 클론해 둔 폴더의 경로. README · 매니페스트 · 디렉터리 구조 · 엔트리 파일만 읽습니다.
        </span>
      </div>
      <div className="be-row">
        <input
          className="field mono"
          placeholder="/Users/me/code/my-project"
          value={path}
          spellCheck={false}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()}
        />
        <button className="btn pri" disabled={!path.trim() || busy} onClick={run}>
          {busy ? '읽는 중…' : '추출'}
        </button>
      </div>
      {read && <div className="be-read mono">읽은 것: {read}</div>}
      {error && <div className="form-error">{error}</div>}
    </div>
  );
}

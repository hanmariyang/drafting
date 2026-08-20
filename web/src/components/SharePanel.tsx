import { useEffect, useState } from 'react';
import { api, type ShareLink } from '../lib/api.ts';

const EXPIRY_OPTS: { label: string; hours: number | null }[] = [
  { label: '만료 없음', hours: null },
  { label: '1시간', hours: 1 },
  { label: '24시간', hours: 24 },
  { label: '7일', hours: 168 },
];

export function SharePanel({ docId, onClose }: { docId: string; onClose: () => void }) {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [hours, setHours] = useState<number | null>(null);
  const [copied, setCopied] = useState('');

  async function load() {
    setLinks(await api.listShares(docId));
  }
  useEffect(() => {
    load().catch(() => {});
  }, [docId]);

  async function create() {
    await api.createShare(docId, hours);
    await load();
  }
  async function revoke(id: string) {
    await api.revokeShare(id);
    await load();
  }
  function copy(url: string) {
    const full = location.origin + url;
    navigator.clipboard?.writeText(full).then(() => {
      setCopied(url);
      setTimeout(() => setCopied(''), 1200);
    });
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>공유 링크</h2>
        <p className="subtle">읽기 전용 HTML 링크입니다. 로그인 없이 열람할 수 있고, 편집은 불가능합니다.</p>

        <div className="toolbar">
          <select className="field" style={{ maxWidth: 160 }} value={String(hours)} onChange={(e) => setHours(e.target.value === 'null' ? null : Number(e.target.value))}>
            {EXPIRY_OPTS.map((o) => (
              <option key={o.label} value={String(o.hours)}>
                {o.label}
              </option>
            ))}
          </select>
          <button className="btn pri" onClick={create}>
            링크 생성
          </button>
        </div>

        {links.length === 0 ? (
          <div className="center-empty">아직 공유 링크가 없습니다.</div>
        ) : (
          <div className="rows">
            {links.map((l) => (
              <div key={l.id} className="row" style={{ flexWrap: 'wrap' }}>
                <a className="grow mono" href={l.url} target="_blank" rel="noreferrer">
                  {l.url}
                </a>
                {l.revoked === 1 ? (
                  <span className="err">취소됨</span>
                ) : l.expired ? (
                  <span className="err">만료됨</span>
                ) : (
                  <span className="ok">활성</span>
                )}
                <button className="btn sm" onClick={() => copy(l.url)}>
                  {copied === l.url ? '복사됨' : '복사'}
                </button>
                {l.revoked !== 1 && (
                  <button className="btn sm danger" onClick={() => revoke(l.id)}>
                    취소
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        <div style={{ textAlign: 'right', marginTop: '1rem' }}>
          <button className="btn" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

import { useState, type ReactNode } from 'react';

interface Props {
  /** breadcrumb 내용 (tbar 좌측) */
  crumb: ReactNode;
  /** tbar 우측 액션 (제안 pill·버전·공유·내보내기·⌘K 등) — 화면이 채운다 */
  tbarRight?: ReactNode;
  /** 좌측 nav (체인 트리). 없으면 nav 숨김 (홈·설정·인터뷰). */
  nav?: ReactNode;
  /** 우측 제안 패널. 없으면 2컬럼. */
  panel?: ReactNode;
  /** statusbar 좌측 두 번째 슬롯 = 제품 태그라인 (SYSTEM §2) */
  tagline?: ReactNode;
  /** statusbar 좌측 첫 슬롯 (저장 상태 등) */
  statusLeft?: ReactNode;
  /** statusbar 우측 (오프라인·모델·버전) */
  statusRight?: ReactNode;
  children: ReactNode;
}

const DEFAULT_TAGLINE = '수락하지 않은 문장은 문서에 없습니다';

export function AppShell({
  crumb,
  tbarRight,
  nav,
  panel,
  tagline,
  statusLeft,
  statusRight,
  children,
}: Props) {
  const [navOpen, setNavOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  const hasNav = !!nav;
  const hasPanel = !!panel;

  return (
    <div className="app">
      <header className="tbar">
        <span className="lights">
          <i />
          <i />
          <i />
        </span>
        {hasNav && (
          <button
            className="btn ghost sm nav-toggle"
            onClick={() => setNavOpen((v) => !v)}
            title="탐색 열기"
          >
            트리
          </button>
        )}
        <span className="crumb">{crumb}</span>
        <span className="right">
          {tbarRight}
          {hasPanel && (
            <button
              className="btn ghost panel-toggle"
              onClick={() => setPanelOpen((v) => !v)}
              title="제안 패널 열기"
            >
              제안
            </button>
          )}
        </span>
      </header>

      <div className={`shell ${hasPanel ? '' : 'no-panel'} ${hasNav ? '' : 'no-nav'}`}>
        {hasNav && (
          <>
            <nav className={`nav ${navOpen ? 'open' : ''}`} onClick={() => setNavOpen(false)}>
              {nav}
            </nav>
            {navOpen && <div className="panel-scrim" onClick={() => setNavOpen(false)} />}
          </>
        )}

        {children}

        {hasPanel && (
          <>
            <aside className={`panel ${panelOpen ? 'open' : ''}`}>{panel}</aside>
            {panelOpen && <div className="panel-scrim" onClick={() => setPanelOpen(false)} />}
          </>
        )}
      </div>

      <footer className="statusbar">
        {statusLeft}
        <span className="sg">{tagline ?? DEFAULT_TAGLINE}</span>
        <span className="r">{statusRight}</span>
      </footer>
    </div>
  );
}

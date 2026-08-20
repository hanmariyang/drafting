/**
 * 로고 — 제품명 Drafting.
 * 이 컴포넌트 한 곳만 고치면 앱 전역 제품명이 바뀐다.
 * (이모지 금지 규칙 준수: 글리프 마크는 이니셜 텍스트 캡슐)
 */
const NAME = 'Drafting';
const MARK = 'D'; // 마크 이니셜

export function AppName({ mark = true, className = '' }: { mark?: boolean; className?: string }) {
  return (
    <span className={`app-name ${className}`}>
      {mark && <span className="mark">{MARK}</span>}
      {NAME}
    </span>
  );
}

export const APP_NAME = NAME;

/**
 * 로고 — 제품명 Drafting + 심볼 초안이(Choani).
 * 이 컴포넌트 한 곳만 고치면 앱 전역 제품명·마크가 바뀐다.
 */
import { Choani } from './Choani.tsx';

const NAME = 'Drafting';

export function AppName({ mark = true, className = '' }: { mark?: boolean; className?: string }) {
  return (
    <span className={`app-name ${className}`}>
      {mark && <Choani pose="base" size={20} animate={false} className="logo-ch" />}
      {NAME}
    </span>
  );
}

export const APP_NAME = NAME;

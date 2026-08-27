// #92 — 외부 프로세스(Grouping MCP 등)가 같은 DB 에 쓴 변경을 앱이 따라잡도록,
// 창 포커스/가시성 회복 시 재조회한다(3초 디바운스).
import { useEffect, useRef } from 'react';

export function useFocusRefetch(fn: () => void, minGapMs = 3000): void {
  const last = useRef(0);
  useEffect(() => {
    const h = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - last.current < minGapMs) return;
      last.current = now;
      fn();
    };
    window.addEventListener('focus', h);
    document.addEventListener('visibilitychange', h);
    return () => {
      window.removeEventListener('focus', h);
      document.removeEventListener('visibilitychange', h);
    };
  }, [fn, minGapMs]);
}

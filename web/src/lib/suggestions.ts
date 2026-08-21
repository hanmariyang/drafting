import { useState, useCallback, useEffect } from 'react';
import { api, normalizeSuggestion, type Suggestion } from './api.ts';

const KIND_LABEL: Record<Suggestion['kind'], string> = {
  add: '추가 제안',
  revise: '보강 제안',
  delete: '삭제 제안',
  question: '누락 질문',
  stale: '재검토',
  lint: '정합성',
};

export function kindLabel(k: Suggestion['kind']): string {
  return KIND_LABEL[k] ?? '제안';
}

export interface UseSuggestions {
  suggestions: Suggestion[];
  loading: boolean;
  supported: boolean; // 병렬 API 미배포면 false — UI 는 조용히 비활성
  reload: () => Promise<void>;
  accept: (id: string) => Promise<void>;
  reject: (id: string) => Promise<void>;
  rewrite: (id: string, instruction: string) => Promise<void>;
  acceptAll: () => Promise<void>;
}

/**
 * 제안 큐 상태. 신규 병렬 API 를 방어적으로 다룬다 — 엔드포인트가 아직 없거나
 * 404 면 supported=false 로 두고 UI 는 빈 큐로 그린다(회귀 없음).
 */
export function useSuggestions(docId: string | null, onDocChanged: () => void): UseSuggestions {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [supported, setSupported] = useState(true);

  const reload = useCallback(async () => {
    if (!docId) return;
    setLoading(true);
    try {
      const res = await api.suggestions(docId, 'open');
      const list = Array.isArray(res) ? res : Array.isArray(res?.suggestions) ? res.suggestions : [];
      setSuggestions(list.map(normalizeSuggestion));
      setSupported(true);
    } catch {
      // 병렬 API 미배포/404 — 조용히 빈 큐로
      setSuggestions([]);
      setSupported(false);
    } finally {
      setLoading(false);
    }
  }, [docId]);

  useEffect(() => {
    reload().catch(() => {});
  }, [reload]);

  const drop = (id: string) => setSuggestions((prev) => prev.filter((s) => s.id !== id));

  const accept = useCallback(
    async (id: string) => {
      await api.acceptSuggestion(id);
      drop(id);
      onDocChanged();
    },
    [onDocChanged],
  );

  const reject = useCallback(
    async (id: string) => {
      await api.rejectSuggestion(id);
      drop(id);
      onDocChanged();
    },
    [onDocChanged],
  );

  const rewrite = useCallback(
    async (id: string, instruction: string) => {
      const next = await api.rewriteSuggestion(id, instruction);
      // rewrite → 새 제안으로 회신. 기존 카드를 새 제안으로 교체.
      setSuggestions((prev) => prev.map((s) => (s.id === id ? next ?? s : s)));
      onDocChanged();
    },
    [onDocChanged],
  );

  const acceptAll = useCallback(async () => {
    if (!docId) return;
    await api.acceptAllSuggestions(docId);
    setSuggestions([]);
    onDocChanged();
  }, [docId, onDocChanged]);

  return { suggestions, loading, supported, reload, accept, reject, rewrite, acceptAll };
}

import type { Section, SectionStatus } from './api.ts';

/** Client-side section with streaming/editable flags for the single-screen UX. */
export interface LiveSection {
  id: string;
  heading: string;
  body: string;
  streaming: boolean; // currently receiving tokens -> read-only
  editable: boolean; // section_end reached -> immediately editable (P-02)
  /** 신규 병렬 API. 없으면 accepted 로 취급(회귀 없음). proposed = sug 하이라이트. */
  status?: SectionStatus;
  /** delete 제안 힌트 (취소선 표시). 서버 계약 밖의 클라 힌트라 선택적. */
  kindHint?: 'delete';
}

export function toLive(s: Section, editable = true): LiveSection {
  return {
    id: s.id,
    heading: s.heading,
    body: s.body,
    streaming: false,
    editable,
    status: s.status ?? 'accepted',
  };
}

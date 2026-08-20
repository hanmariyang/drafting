// Deterministic demo data (§2 stub, §sample seed) — the "회의실 예약" example.
// Content only, NO ref_ids: the server numbers items in this exact order, so the
// refs it assigns (F-01, F-01-1, PG-01, FLOW-01, FLOW-01.1 …) match the cross-
// links written below. Same input → same output (AI·cost 0).

import type { Priority, PageType, PlanItemLinks } from './types.ts';

export interface GenFeature {
  title: string;
  body: string;
  priority: Priority;
  source: string;
  links: PlanItemLinks;
}
export interface GenGroup {
  title: string;
  features: GenFeature[];
}
export interface GenPage {
  title: string;
  page_type: PageType;
  source?: string;
  links: PlanItemLinks;
}
export interface GenStep {
  title: string;
  page?: string | null;
  node?: 'start' | 'screen' | 'decision' | 'end';
  branch?: { label: string; from_step?: string } | null;
  note?: string;
}
export interface GenFlow {
  title: string;
  source: string;
  links: PlanItemLinks;
  steps: GenStep[];
}

export interface SpecData {
  groups: GenGroup[];
}
export interface IaData {
  pages: GenPage[];
}
export interface FlowData {
  flows: GenFlow[];
}

// PRD sections seed → REQ-01..REQ-04 (§1.2 derivation order).
export const PRD_SECTIONS: Array<{ heading: string; body: string }> = [
  {
    heading: '문제 정의',
    body: '회의실 예약이 캘린더·메신저·구두로 흩어져 겹침과 노쇼가 잦다. 회의가 늘어져 다음 팀이 못 들어간다.',
  },
  {
    heading: '목표',
    body: '겹침 없는 즉시 예약과 종료 10분 전 알림·자동 반납으로 회의실 회전율을 높인다.',
  },
  {
    heading: '자동 반납',
    body: '연장하지 않으면 종료 시각에 자동으로 반납되고, 노쇼는 5분 후 자동 해제된다.',
  },
  {
    heading: '운영 가시성',
    body: '관리자는 이용률·노쇼·자동 반납 추이를 주간으로 본다. 대시보드 UI 신규 개발은 비범위.',
  },
];

export const SPEC_FIXTURE: SpecData = {
  groups: [
    {
      title: '회의실 예약 생성',
      features: [
        {
          title: '시간대 선택 후 즉시 예약 확정',
          body: '· 시간대 선택 즉시 확정\n· 확정 시 내 예약(PG-04)에 기록',
          priority: 'P0',
          source: 'REQ-01',
          links: { reqs: ['REQ-01'], pages: ['PG-02', 'PG-03'], flows: ['FLOW-01'] },
        },
        {
          title: '겹침 검사 후 대안 시간 3개 제시',
          body: '· 겹침 감지 시 대안 3개 제시\n· 재선택 후 겹침 재판정',
          priority: 'P0',
          source: 'Q2',
          links: { reqs: ['REQ-01'], pages: ['PG-02'], flows: ['FLOW-01'] },
        },
        {
          title: '종료 10분 전 알림, 미연장 시 자동 반납',
          body: '· 종료 10분 전 알림 발송, 수신 채널은 PG-06에서 설정\n· 연장 없이 종료 시각 도달 → 자동 반납 + PG-04에 기록',
          priority: 'P1',
          source: 'Q3',
          links: { reqs: ['REQ-03'], pages: ['PG-06', 'PG-04'], flows: ['FLOW-02'] },
        },
      ],
    },
    {
      title: '노쇼 처리',
      features: [
        {
          title: '시작 5분 내 체크인 없으면 예약 해제',
          body: '· 시작 5분 내 체크인 없으면 자동 해제\n· 해제 이력은 PG-04에 표시',
          priority: 'P1',
          source: 'REQ-02',
          links: { reqs: ['REQ-02'], pages: ['PG-04'], flows: ['FLOW-03'] },
        },
        {
          title: '반복 노쇼 사용자 주간 리포트',
          body: '· 반복 노쇼 사용자를 주간으로 집계',
          priority: 'P2',
          source: 'PRD §4',
          links: { reqs: ['REQ-02'], pages: ['PG-04'] },
        },
      ],
    },
    {
      title: '관리자 통계',
      features: [
        {
          // Intentionally orphaned (no reqs link) → seeds a W-ORPHAN-SPEC in the demo.
          title: '이용률·노쇼·자동반납 집계',
          body: '· 이용률·노쇼·자동 반납을 주간 집계해 PG-05에 표시',
          priority: 'P2',
          source: 'PRD §4',
          links: { pages: ['PG-05'] },
        },
      ],
    },
  ],
};

export const IA_FIXTURE: IaData = {
  pages: [
    { title: '예약 홈', page_type: 'LIST', links: { features: ['F-01-1'] } },
    { title: '회의실 상세', page_type: 'DETAIL', links: { features: ['F-01-1', 'F-01-2'] } },
    { title: '예약 확인', page_type: 'FORM', links: { features: ['F-01-1'] } },
    { title: '내 예약', page_type: 'LIST', links: { features: ['F-01-3', 'F-02-1', 'F-02-2'] } },
    // Reached by no flow step → seeds a W-UNREACHED-PAGE in the demo.
    { title: '관리자 통계', page_type: 'DASH', links: { features: ['F-03-1'] } },
    { title: '알림 설정', page_type: 'SETTINGS', links: { features: ['F-01-3'] } },
  ],
};

export const FLOW_FIXTURE: FlowData = {
  flows: [
    {
      title: '예약 생성',
      source: 'F-01 · 해피 패스 + 겹침 분기',
      links: { features: ['F-01', 'F-01-1', 'F-01-2'] },
      steps: [
        { title: '예약 필요', node: 'start', page: null },
        { title: '예약 홈', node: 'screen', page: 'PG-01' },
        { title: '시간대 선택', node: 'screen', page: 'PG-02' },
        { title: '겹침?', node: 'decision', page: null },
        { title: '예약 확정', node: 'screen', page: 'PG-03' },
        { title: '예약됨', node: 'end', page: null },
        {
          title: '대안 3개 재선택',
          node: 'screen',
          page: 'PG-02',
          branch: { label: '예', from_step: 'FLOW-01.4' },
          note: '겹침? 재판정 (F-01-2)',
        },
      ],
    },
    {
      title: '자동 반납',
      source: 'F-01-3',
      links: { features: ['F-01-3'] },
      steps: [
        { title: '종료 10분 전', node: 'start', page: null },
        { title: '알림 수신', node: 'screen', page: 'PG-06' },
        { title: '연장?', node: 'decision', page: null },
        { title: '자동 반납 기록', node: 'screen', page: 'PG-04' },
        { title: '반납됨', node: 'end', page: null },
        {
          title: '시간 연장',
          node: 'screen',
          page: 'PG-02',
          branch: { label: '예', from_step: 'FLOW-02.3' },
          note: '예약 연장 후 종료',
        },
      ],
    },
    {
      title: '노쇼 처리',
      source: 'F-02',
      links: { features: ['F-02', 'F-02-1'] },
      steps: [
        { title: '시작 5분 경과', node: 'start', page: null },
        { title: '체크인?', node: 'decision', page: null },
        { title: '예약 해제 기록', node: 'screen', page: 'PG-04' },
        { title: '해제됨', node: 'end', page: null },
      ],
    },
  ],
};

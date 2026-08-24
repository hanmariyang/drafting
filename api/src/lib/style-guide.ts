// 프로젝트 StyleGuide(테마) — C/B/A 세 레이어의 공용 스타일 소스.
// 저장은 프로젝트별 settings 키(style_guide:<pid>), 스키마 변경 없음.

import * as repo from '../db/repos.ts';

export type Density = 'compact' | 'cozy' | 'spacious';
export type FontKey = 'sans' | 'serif' | 'rounded' | 'mono';
export type Mode = 'light' | 'dark';

export interface StyleGuide {
  preset: string;
  accent: string;
  bg: string;
  surface: string;
  ink: string;
  sub: string;
  line: string;
  radius: number;
  density: Density;
  font: FontKey;
  mode: Mode;
}

// 뚜렷이 구분되는 프리셋 — C 의 스타일 선택지.
export const PRESETS: Record<string, StyleGuide> = {
  clean: { preset: 'clean', accent: '#4f46e5', bg: '#f6f7f9', surface: '#ffffff', ink: '#1b1c1e', sub: '#6f7076', line: '#e6e7ea', radius: 10, density: 'cozy', font: 'sans', mode: 'light' },
  warm: { preset: 'warm', accent: '#c2603f', bg: '#faf6f0', surface: '#fffdfa', ink: '#2a231c', sub: '#8a7d6d', line: '#ece3d6', radius: 8, density: 'spacious', font: 'serif', mode: 'light' },
  mono: { preset: 'mono', accent: '#1b1c1e', bg: '#fafafa', surface: '#ffffff', ink: '#111214', sub: '#70727a', line: '#e4e4e6', radius: 4, density: 'compact', font: 'mono', mode: 'light' },
  vivid: { preset: 'vivid', accent: '#7c3aed', bg: '#f6f4ff', surface: '#ffffff', ink: '#211a34', sub: '#7b7391', line: '#e8e2f7', radius: 16, density: 'cozy', font: 'rounded', mode: 'light' },
  dark: { preset: 'dark', accent: '#22d3ee', bg: '#0f1115', surface: '#171a21', ink: '#e7e9ee', sub: '#9aa0aa', line: '#272b34', radius: 10, density: 'cozy', font: 'sans', mode: 'dark' },
};

export const DEFAULT_GUIDE: StyleGuide = PRESETS.clean;

const FONT_STACK: Record<FontKey, string> = {
  sans: "'Pretendard', -apple-system, system-ui, sans-serif",
  serif: "'Iowan Old Style', 'Apple SD Gothic Neo', Georgia, serif",
  rounded: "'SF Pro Rounded', 'Pretendard', system-ui, sans-serif",
  mono: "ui-monospace, 'SF Mono', Menlo, monospace",
};
const DENSITY_GAP: Record<Density, number> = { compact: 8, cozy: 12, spacious: 18 };

const key = (pid: string) => `style_guide:${pid}`;

export function getStyleGuide(projectId: string): StyleGuide {
  const saved = repo.getSetting<Partial<StyleGuide>>(key(projectId));
  if (!saved) return DEFAULT_GUIDE;
  const base = PRESETS[saved.preset ?? 'clean'] ?? DEFAULT_GUIDE;
  return { ...base, ...saved };
}

export function saveStyleGuide(projectId: string, patch: Partial<StyleGuide>): StyleGuide {
  const current = getStyleGuide(projectId);
  // 프리셋 전환이면 그 프리셋을 베이스로(값 리셋), 아니면 현재 값 유지 위에 부분 덮어쓰기.
  const base =
    patch.preset && patch.preset !== current.preset ? PRESETS[patch.preset] ?? current : current;
  const next: StyleGuide = { ...base, ...patch };
  repo.setSetting(key(projectId), next);
  return next;
}

/** 프론트 렌더용 파생값(폰트 스택·간격) — CSS 변수로 내려보낸다. */
export function guideRender(g: StyleGuide) {
  return { fontStack: FONT_STACK[g.font], gap: DENSITY_GAP[g.density] };
}

/** AI 시안 프롬프트에 넣을 압축 스타일 설명 — 생성물이 테마와 일관되게. */
export function guidePromptText(g: StyleGuide): string {
  return [
    `배경 ${g.bg}, 표면(카드) ${g.surface}, 본문 텍스트 ${g.ink}, 보조 텍스트 ${g.sub}, 경계선 ${g.line}, 강조(accent) ${g.accent}.`,
    `모서리 반경 ${g.radius}px, 밀도 ${g.density}(간격 ${DENSITY_GAP[g.density]}px 기준), 서체 계열 ${g.font}, 모드 ${g.mode}.`,
    `강조색은 주요 버튼·활성 상태에만 절제해서 쓰고, 나머지는 표면·경계선·텍스트로 차분하게.`,
  ].join(' ');
}

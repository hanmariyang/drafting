// 디자인 시스템 생성 — 인터뷰 답변 → 풍부한 DesignSystem(색 역할+상태색, 타입 스케일,
// 여백 체계, 형태, 접근성 필드, 라이트+다크 세트) + 설계 근거 + 스타일 타일.
// AI_STUB/오프라인이면 답변 키워드 결정적 매핑. 아니면 provider 로 JSON 제안(결정적 위에 덮어씀).
// 스타일 타일은 시스템에서 결정적으로 렌더 — 항상 토큰과 일치.

import { config } from './config.ts';
import { resolveProvider } from '../providers/index.ts';
import { getModelConfig } from './ai.ts';
import { PRESETS, DEFAULT_GUIDE, saveStyleGuide, type StyleGuide, type Density, type FontKey } from './style-guide.ts';
import * as repo from '../db/repos.ts';

type Mode = 'light' | 'dark';
export interface ColorSet {
  bg: string; surface: string; surfaceAlt: string; ink: string; sub: string; line: string; accent: string; accentText: string;
}
export interface DesignSystem {
  color: { primary: Mode; light: ColorSet; dark: ColorSet | null; state: { success: string; warning: string; danger: string; info: string } };
  type: { family: FontKey; scale: { display: number; title: number; body: number; caption: number }; weightBold: number };
  space: { unit: number; density: Density; scale: number[] };
  shape: { radiusCard: number; radiusBtn: number; radiusPill: number; border: number; shadow: 'none' | 'soft' | 'strong' };
  a11y: { highContrast: boolean; colorblindSafe: boolean; notes: string };
}
export interface DesignSystemRecord {
  system: DesignSystem;
  guide: StyleGuide; // 와이어프레임·시안(B/A) 구동용 파생 서브셋
  rationale: string;
  styleTileHtml: string;
  status: 'proposed' | 'accepted';
}

const key = (pid: string) => `design_system:${pid}`;
const candKey = (pid: string) => `design_system_candidates:${pid}`;
const HEX_RE = /#[0-9a-fA-F]{6}\b/;

export function getDesignSystem(projectId: string): DesignSystemRecord | null {
  return repo.getSetting<DesignSystemRecord>(key(projectId));
}
function answersOf(documentId: string): Record<string, string> {
  const s = repo.getSessionByDocument(documentId);
  const out: Record<string, string> = {};
  for (const a of s?.answers ?? []) out[a.questionId] = a.answer;
  return out;
}
const mix = (a: string, b: string, t: number): string => {
  const h = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const [r1, g1, b1] = h(a), [r2, g2, b2] = h(b);
  const m = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
  return `#${m(r1, r2)}${m(g1, g2)}${m(b1, b2)}`;
};

/** 답변 → 풍부한 DesignSystem (결정적). stub/오프라인·폴백·탐색 공용. */
export function buildSystem(ans: Record<string, string>, presetOverride?: string): DesignSystem {
  const all = Object.values(ans).join(' ');
  const has = (...ks: string[]) => ks.some((k) => all.includes(k));

  let preset = presetOverride ?? 'clean';
  if (!presetOverride) {
    if (has('활기', '경쾌', '친근', '발랄', '재미', '귀여')) preset = 'vivid';
    else if (has('클래식', '우아', '따뜻', '감성', '편안')) preset = 'warm';
    else if (has('미니멀', '기능', '단정', '실용', '툴')) preset = 'mono';
  }
  const base = PRESETS[preset] ?? DEFAULT_GUIDE;

  // 강조색
  let accent = base.accent;
  const hex = all.match(HEX_RE)?.[0];
  if (hex) accent = hex;
  else if (has('그린', '초록', '녹색')) accent = '#0e7b62';
  else if (has('블루', '파랑', '남색')) accent = '#2563eb';
  else if (has('퍼플', '보라')) accent = '#7c3aed';
  else if (has('오렌지', '주황', '테라코타')) accent = '#c2603f';

  const light: ColorSet = {
    bg: base.bg, surface: base.surface, surfaceAlt: mix(base.bg, base.surface, 0.5),
    ink: base.ink, sub: base.sub, line: base.line, accent, accentText: '#ffffff',
  };
  const darkP = PRESETS.dark;
  const dark: ColorSet = {
    bg: darkP.bg, surface: darkP.surface, surfaceAlt: mix(darkP.bg, darkP.surface, 0.5),
    ink: darkP.ink, sub: darkP.sub, line: darkP.line, accent, accentText: '#0b0d10',
  };
  const wantsDark = has('다크', '어두', 'dark', '야간');
  const wantsBoth = has('둘 다', '둘다', '라이트', 'light', '양쪽', '모두');
  const hasDark = wantsDark || wantsBoth;
  const primary: Mode = wantsDark && !wantsBoth ? 'dark' : 'light';

  // 접근성
  const highContrast = has('고대비', '대비 높', '대비높', '고 대비');
  const colorblindSafe = has('색맹', '색약', '색만', '색상만', '색으로만');
  const a11yNotes = ans.accessibility && ans.accessibility.trim() && !/^없음$/.test(ans.accessibility.trim()) ? ans.accessibility.trim() : '';
  if (highContrast) { light.ink = '#0a0b0c'; light.sub = mix(light.sub, light.ink, 0.35); light.line = mix(light.line, light.ink, 0.25); }

  // 상태색 — 빨강 회피 시 danger 를 앰버-브라운으로
  const avoidRed = has('빨강 피', '빨강은 피', '레드 피', '빨간색 피');
  const state = {
    success: '#1b7f4b', warning: '#8a6a1f', danger: avoidRed ? '#b45309' : '#c0392b', info: '#2563eb',
  };

  // 타이포
  // ⚠️ "산세리프"가 "세리프"에 걸리지 않게 sans 를 먼저 판정.
  const family: FontKey =
    has('산세리프', '산 세리프', 'sans', '고딕', '산스', '모던') ? 'sans'
      : has('세리프', '명조', '바탕') ? 'serif'
        : has('라운드', '둥근 서체', '동글') ? 'rounded'
          : has('모노', '고정폭') ? 'mono'
            : 'sans';
  const density: Density = has('촘촘', '밀집', '조밀', '많이') ? 'compact' : has('여유', '넓', '시원') ? 'spacious' : base.density;
  const scale = density === 'compact'
    ? { display: 26, title: 18, body: 13, caption: 11 }
    : density === 'spacious'
      ? { display: 34, title: 24, body: 15, caption: 13 }
      : { display: 30, title: 20, body: 14, caption: 12 };

  // 형태
  let radiusCard = base.radius;
  if (has('각진', '샤프', '직각', '딱딱')) radiusCard = Math.min(radiusCard, 4);
  else if (has('둥근', '부드럽', '라운드')) radiusCard = Math.max(radiusCard, 14);
  const shadow: 'none' | 'soft' | 'strong' = has('그림자 없', '플랫', '납작') ? 'none' : has('입체', '그림자 강', '떠 있') ? 'strong' : 'soft';

  return {
    color: { primary, light, dark: hasDark ? dark : null, state },
    type: { family, scale, weightBold: 800 },
    space: { unit: 4, density, scale: [4, 8, 12, 16, 24, 32] },
    shape: { radiusCard, radiusBtn: Math.max(4, Math.round(radiusCard * 0.7)), radiusPill: 999, border: 1, shadow },
    a11y: { highContrast, colorblindSafe, notes: a11yNotes },
  };
}

/** 시스템 → StyleGuide (B/A 구동용). primary 모드 색을 쓴다. */
export function deriveGuide(sys: DesignSystem): StyleGuide {
  const c = sys.color[sys.color.primary] ?? sys.color.light;
  return {
    preset: 'custom', accent: c.accent, bg: c.bg, surface: c.surface, ink: c.ink, sub: c.sub, line: c.line,
    radius: sys.shape.radiusCard, density: sys.space.density, font: sys.type.family, mode: sys.color.primary,
  };
}

function rationaleFor(ans: Record<string, string>, sys: DesignSystem): string {
  const modeTxt = sys.color.dark ? (sys.color.primary === 'dark' ? '다크 기본 + 라이트 세트' : '라이트 기본 + 다크 세트') : `${sys.color.primary} 단일`;
  return (
    `성격(“${ans.personality ?? '—'}”)에서 강조색 ${sys.color.light.accent} 를 주요 액션에만 절제해서 씁니다. ` +
    `색은 배경·표면·본문·보조·경계·강조의 역할 체계 + 상태색(성공/경고/위험/정보)까지 정의(${modeTxt}). ` +
    `서체 ${sys.type.family}, 타입 스케일 ${sys.type.scale.display}/${sys.type.scale.title}/${sys.type.scale.body}/${sys.type.scale.caption}px, ` +
    `여백 4px 그리드(${sys.space.density}), 모서리 ${sys.shape.radiusCard}px, 그림자 ${sys.shape.shadow}. ` +
    (sys.a11y.highContrast || sys.a11y.colorblindSafe || sys.a11y.notes
      ? `접근성: ${[sys.a11y.highContrast ? '고대비' : '', sys.a11y.colorblindSafe ? '색맹 안전(상태는 색+글리프)' : '', sys.a11y.notes].filter(Boolean).join(' · ')}.`
      : '')
  );
}

function buildMessages(ans: Record<string, string>) {
  const answerBlock = Object.entries(ans).map(([k, v]) => `- ${k}: ${v}`).join('\n');
  const system =
    `너는 시니어 디자인 시스템 설계자다. 아래 인터뷰 답변으로 이 제품의 디자인 시스템 토큰을 설계한다.\n` +
    `오직 JSON 하나만 출력(코드펜스·설명 없이). 스키마:\n` +
    `{"colorLight":{"bg","surface","surfaceAlt","ink","sub","line","accent","accentText"},` +
    `"colorDark":{...같은 키...}|null,"primaryMode":"light|dark",` +
    `"state":{"success","warning","danger","info"},` +
    `"font":"sans|serif|rounded|mono","scale":{"display","title","body","caption"(px정수)},` +
    `"density":"compact|cozy|spacious","radiusCard":정수,"shadow":"none|soft|strong",` +
    `"highContrast":bool,"colorblindSafe":bool,"a11yNotes":"문자열",` +
    `"rationale":"설계 근거 3~4문장(한국어)"}\n` +
    `모든 색은 #RRGGBB. accent 는 주요 액션·활성에만. 답변의 HEX·금지색·다크 요구·접근성 요구를 반드시 반영. ` +
    `라이트+다크 둘 다 요구되면 colorDark 를 채워라.`;
  const user = `인터뷰 답변:\n${answerBlock}\n\n위 스키마대로 JSON 을 출력하라.`;
  return [{ role: 'system' as const, content: system }, { role: 'user' as const, content: user }];
}
function extractJson(text: string): unknown {
  let t = text.trim().replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```$/, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  return JSON.parse(t);
}
const okHex = (v: unknown): v is string => typeof v === 'string' && HEX_RE.test(v);
function mergeAiSystem(sys: DesignSystem, j: Record<string, unknown>): DesignSystem {
  const cs = (o: unknown, base: ColorSet): ColorSet => {
    const x = (o ?? {}) as Record<string, string>;
    const p = (k: keyof ColorSet) => (okHex(x[k]) ? x[k] : base[k]);
    return { bg: p('bg'), surface: p('surface'), surfaceAlt: p('surfaceAlt'), ink: p('ink'), sub: p('sub'), line: p('line'), accent: p('accent'), accentText: p('accentText') };
  };
  const st = (j.state ?? {}) as Record<string, string>;
  const sc = (j.scale ?? {}) as Record<string, number>;
  return {
    color: {
      primary: j.primaryMode === 'dark' ? 'dark' : 'light',
      light: cs(j.colorLight, sys.color.light),
      dark: j.colorDark ? cs(j.colorDark, sys.color.dark ?? sys.color.light) : sys.color.dark,
      state: {
        success: okHex(st.success) ? st.success : sys.color.state.success,
        warning: okHex(st.warning) ? st.warning : sys.color.state.warning,
        danger: okHex(st.danger) ? st.danger : sys.color.state.danger,
        info: okHex(st.info) ? st.info : sys.color.state.info,
      },
    },
    type: {
      family: (['sans', 'serif', 'rounded', 'mono'] as const).includes(j.font as FontKey) ? (j.font as FontKey) : sys.type.family,
      scale: {
        display: typeof sc.display === 'number' ? sc.display : sys.type.scale.display,
        title: typeof sc.title === 'number' ? sc.title : sys.type.scale.title,
        body: typeof sc.body === 'number' ? sc.body : sys.type.scale.body,
        caption: typeof sc.caption === 'number' ? sc.caption : sys.type.scale.caption,
      },
      weightBold: sys.type.weightBold,
    },
    space: { ...sys.space, density: (['compact', 'cozy', 'spacious'] as const).includes(j.density as Density) ? (j.density as Density) : sys.space.density },
    shape: {
      ...sys.shape,
      radiusCard: typeof j.radiusCard === 'number' ? Math.max(0, Math.min(24, j.radiusCard)) : sys.shape.radiusCard,
      radiusBtn: typeof j.radiusCard === 'number' ? Math.max(4, Math.round((j.radiusCard as number) * 0.7)) : sys.shape.radiusBtn,
      shadow: (['none', 'soft', 'strong'] as const).includes(j.shadow as never) ? (j.shadow as 'none' | 'soft' | 'strong') : sys.shape.shadow,
    },
    a11y: {
      highContrast: typeof j.highContrast === 'boolean' ? j.highContrast : sys.a11y.highContrast,
      colorblindSafe: typeof j.colorblindSafe === 'boolean' ? j.colorblindSafe : sys.a11y.colorblindSafe,
      notes: typeof j.a11yNotes === 'string' ? j.a11yNotes : sys.a11y.notes,
    },
  };
}

function recordFrom(ans: Record<string, string>, sys: DesignSystem, aiRationale?: string): DesignSystemRecord {
  const rationale = aiRationale?.trim() || rationaleFor(ans, sys);
  return { system: sys, guide: deriveGuide(sys), rationale, styleTileHtml: styleTileHtml(sys), status: 'proposed' };
}

export async function generateDesignSystem(documentId: string): Promise<DesignSystemRecord> {
  const doc = repo.getDocument(documentId);
  if (!doc) throw new Error('document not found');
  const ans = answersOf(documentId);
  let sys = buildSystem(ans);
  let aiRationale: string | undefined;

  if (!(config.aiStub || config.managedTier)) {
    try {
      const cfg = getModelConfig('design-system');
      const provider = resolveProvider(cfg.provider);
      let text = '';
      for await (const d of provider.streamChat({ model: cfg.model, maxTokens: Math.max(cfg.maxTokens, 2500), messages: buildMessages(ans) })) text += d;
      const j = extractJson(text) as Record<string, unknown>;
      sys = mergeAiSystem(sys, j);
      if (typeof j.rationale === 'string') aiRationale = j.rationale;
    } catch { /* 결정적 결과 유지 */ }
  }
  const rec = recordFrom(ans, sys, aiRationale);
  repo.setSetting(key(doc.project_id), rec);
  return rec;
}

// ── P2: 방향 탐색 — 성격만 다른 3방향안(강조색·상태색·모드 유지) ──────────────
export function exploreDesignSystems(documentId: string): DesignSystemRecord[] {
  const doc = repo.getDocument(documentId);
  if (!doc) throw new Error('document not found');
  const ans = answersOf(documentId);
  const primary = buildSystem(ans); // 답변 그대로 = 균형안
  const acc = primary.color.light.accent;
  // 강조색·상태색·모드·접근성은 3안 공통 유지, 성격(프리셋)만 다르게.
  const norm = (s: DesignSystem): DesignSystem => {
    s.color.light.accent = acc;
    if (s.color.dark) s.color.dark.accent = acc;
    s.color.state = primary.color.state;
    s.color.primary = primary.color.primary;
    s.color.dark = primary.color.dark;
    s.a11y = primary.a11y;
    return s;
  };
  const recs = [
    recordFrom(ans, primary, '균형 — 강조색 유지, 중립적 균형.'),
    recordFrom(ans, norm(buildSystem(ans, 'warm')), '부드러움 — 강조색 유지, 여유·둥근 모서리·따뜻한 표면.'),
    recordFrom(ans, norm(buildSystem(ans, 'mono')), '선명함 — 강조색 유지, 촘촘·각진.'),
  ];
  repo.setSetting(candKey(doc.project_id), recs);
  return recs;
}
export function selectDesignSystemCandidate(documentId: string, index: number): DesignSystemRecord {
  const doc = repo.getDocument(documentId);
  if (!doc) throw new Error('document not found');
  const recs = repo.getSetting<DesignSystemRecord[]>(candKey(doc.project_id)) ?? [];
  const rec = recs[index];
  if (!rec) throw new Error('candidate not found');
  const chosen: DesignSystemRecord = { ...rec, status: 'proposed' };
  repo.setSetting(key(doc.project_id), chosen);
  return chosen;
}

export function acceptDesignSystem(documentId: string): DesignSystemRecord {
  const doc = repo.getDocument(documentId);
  if (!doc) throw new Error('document not found');
  const rec = getDesignSystem(doc.project_id);
  if (!rec) throw new Error('no design system to accept');
  saveStyleGuide(doc.project_id, rec.guide);
  const next: DesignSystemRecord = { ...rec, status: 'accepted' };
  repo.setSetting(key(doc.project_id), next);
  return next;
}

/** 스타일 타일 — 시스템을 색 역할·상태색·타입 스케일·여백·컴포넌트(미디어 그리드 포함)로 결정적 렌더. */
export function styleTileHtml(s: DesignSystem): string {
  const c = s.color[s.color.primary] ?? s.color.light;
  const font = s.type.family === 'serif' ? 'Georgia, serif' : s.type.family === 'mono' ? 'ui-monospace, Menlo, monospace' : '-apple-system, system-ui, sans-serif';
  const sh = s.shape.shadow === 'none' ? 'none' : s.shape.shadow === 'strong' ? '0 6px 20px rgba(0,0,0,.14)' : '0 1px 3px rgba(0,0,0,.07)';
  const roles: Array<[string, string]> = [['bg', c.bg], ['surface', c.surface], ['ink', c.ink], ['sub', c.sub], ['line', c.line], ['accent', c.accent]];
  const states: Array<[string, string, string]> = [['성공', s.color.state.success, '✓'], ['경고', s.color.state.warning, '⚠'], ['위험', s.color.state.danger, '✕'], ['정보', s.color.state.info, 'ℹ']];
  const swatch = (n: string, col: string) => `<div class="sw"><span class="chip" style="background:${col}"></span><b>${n}</b><code>${col}</code></div>`;
  const stateBadge = ([n, col, g]: [string, string, string]) => `<span class="badge" style="color:${col};border-color:${col}"><i style="background:${col}"></i>${g} ${n}</span>`;
  const spaceBar = (v: number) => `<div class="spx"><span style="width:${v}px"></span><code>${v}</code></div>`;
  const thumb = (on: boolean) => `<div class="thumb${on ? ' on' : ''}"><div class="thumb-img"></div><div class="thumb-cap">시안 ${on ? '●' : '○'}</div></div>`;
  const darkStrip = s.color.dark
    ? `<h4>다크 세트</h4><div class="darkstrip" style="background:${s.color.dark.bg}">${['bg', 'surface', 'ink', 'sub', 'line', 'accent'].map((k) => `<span style="background:${(s.color.dark as ColorSet)[k as keyof ColorSet]}"></span>`).join('')}<b style="color:${s.color.dark.ink}">Aa 가나다</b></div>`
    : '';
  const a11yLine = (s.a11y.highContrast || s.a11y.colorblindSafe || s.a11y.notes)
    ? `<h4>접근성</h4><p class="a11y">${[s.a11y.highContrast ? '고대비' : '', s.a11y.colorblindSafe ? '색맹 안전 — 상태는 색+글리프(●✓⚠)로' : '', s.a11y.notes].filter(Boolean).join(' · ')}</p>`
    : '';

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  :root{--ac:${c.accent};--act:${c.accentText};--bg:${c.bg};--sf:${c.surface};--sf2:${c.surfaceAlt};--ink:${c.ink};--sub:${c.sub};--ln:${c.line};--rc:${s.shape.radiusCard}px;--rb:${s.shape.radiusBtn}px;--sh:${sh}}
  *{box-sizing:border-box;margin:0}body{background:var(--bg);color:var(--ink);font-family:${font};padding:22px;line-height:1.5}
  h4{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--sub);margin:22px 0 9px;font-weight:700}h4:first-child{margin-top:0}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px}
  .sw{background:var(--sf);border:1px solid var(--ln);border-radius:var(--rc);padding:9px}.sw .chip{height:30px;border-radius:calc(var(--rc) - 2px);border:1px solid var(--ln);display:block;margin-bottom:6px}.sw b{font-size:12px}.sw code{font-size:10px;color:var(--sub);display:block}
  .badges{display:flex;flex-wrap:wrap;gap:8px}.badge{display:inline-flex;align-items:center;gap:6px;border:1px solid;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:600}.badge i{width:8px;height:8px;border-radius:50%;display:block}
  .type .row{display:flex;align-items:baseline;gap:10px;border-bottom:1px solid var(--ln);padding:7px 0}.type .row code{font-size:10px;color:var(--sub);width:64px;flex:none}
  .d{font-size:${s.type.scale.display}px;font-weight:${s.type.weightBold}}.t{font-size:${s.type.scale.title}px;font-weight:700}.b{font-size:${s.type.scale.body}px}.cap{font-size:${s.type.scale.caption}px;color:var(--sub)}
  .space{display:flex;flex-direction:column;gap:5px}.spx{display:flex;align-items:center;gap:8px}.spx span{height:12px;background:var(--ac);opacity:.8;border-radius:3px;display:block}.spx code{font-size:10px;color:var(--sub);font-family:ui-monospace,monospace}
  .comp{display:flex;flex-wrap:wrap;gap:9px;align-items:center}
  .btn{border:0;border-radius:var(--rb);padding:9px 15px;font-size:13px;font-weight:700;font-family:inherit;box-shadow:var(--sh)}
  .btn.p{background:var(--ac);color:var(--act)}.btn.s{background:var(--sf);color:var(--ink);border:1px solid var(--ln)}.btn.g{background:transparent;color:var(--ac)}
  .input{background:var(--sf);border:1px solid var(--ln);border-radius:var(--rb);padding:9px 12px;color:var(--sub);font-size:13px;min-width:160px}
  .chip2{border:1px solid var(--ln);border-radius:999px;padding:4px 12px;font-size:12px;color:var(--sub)}.chip2.on{background:var(--ac);color:var(--act);border-color:var(--ac)}
  .sw2{width:42px;height:24px;border-radius:999px;background:var(--ac);position:relative}.sw2::after{content:'';position:absolute;top:3px;right:3px;width:18px;height:18px;border-radius:50%;background:#fff}
  .card{background:var(--sf);border:1px solid var(--ln);border-radius:var(--rc);padding:13px;box-shadow:var(--sh);min-width:170px}.card b{font-size:14px}.card p{font-size:12px;color:var(--sub);margin-top:4px}
  .media{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
  .thumb{background:var(--sf);border:1px solid var(--ln);border-radius:var(--rc);overflow:hidden}.thumb.on{border-color:var(--ac);box-shadow:0 0 0 2px var(--ac)}
  .thumb-img{height:56px;background:linear-gradient(135deg,var(--sf2),color-mix(in srgb,var(--ac) 22%,var(--sf)))}.thumb-cap{font-size:10px;color:var(--sub);padding:5px 7px}
  .darkstrip{display:flex;align-items:center;gap:6px;border-radius:var(--rc);padding:10px}.darkstrip span{width:26px;height:26px;border-radius:6px;display:block}.darkstrip b{margin-left:auto;font-size:14px}
  .a11y{font-size:12px;color:var(--sub);background:var(--sf2);border:1px solid var(--ln);border-radius:var(--rc);padding:8px 11px}
  </style></head><body>
  <h4>색 시스템 (역할)</h4><div class="grid">${roles.map(([n, col]) => swatch(n, col)).join('')}</div>
  <h4>상태색</h4><div class="badges">${states.map(stateBadge).join('')}</div>
  ${darkStrip}
  <h4>타입 스케일</h4><div class="type">
    <div class="row"><code>display</code><span class="d">화면 제목 Aa</span></div>
    <div class="row"><code>title</code><span class="t">섹션 제목 가나다</span></div>
    <div class="row"><code>body</code><span class="b">본문은 이 크기·서체로 읽힙니다. 색은 역할 체계로.</span></div>
    <div class="row"><code>caption</code><span class="cap">캡션 · 보조 정보</span></div>
  </div>
  <h4>여백 체계 (4px 그리드)</h4><div class="space">${s.space.scale.map(spaceBar).join('')}</div>
  <h4>컴포넌트</h4><div class="comp"><button class="btn p">주요 액션</button><button class="btn s">보조</button><button class="btn g">텍스트</button><span class="chip2 on">활성</span><span class="chip2">기본</span><span class="sw2"></span></div>
  <div class="comp" style="margin-top:9px"><div class="card"><b>카드</b><p>표면·경계·라운드·그림자(${s.shape.shadow}).</p></div><div class="input">입력 필드</div></div>
  <h4>미디어 · 시안 그리드 (여러 안 비교)</h4><div class="media">${thumb(true)}${thumb(false)}${thumb(false)}${thumb(false)}</div>
  ${a11yLine}
  </body></html>`;
}

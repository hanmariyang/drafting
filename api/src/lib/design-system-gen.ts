// 디자인 시스템 생성 — 인터뷰 답변 → DesignSystem(StyleGuide + 근거) 제안 + 스타일 타일.
// AI_STUB/오프라인이면 답변 키워드 결정적 매핑. 아니면 provider 로 토큰·근거 JSON 제안.
// 스타일 타일(미리보기)은 토큰에서 결정적으로 렌더 — 항상 토큰과 일치.

import { config } from './config.ts';
import { resolveProvider } from '../providers/index.ts';
import { getModelConfig } from './ai.ts';
import { PRESETS, DEFAULT_GUIDE, saveStyleGuide, type StyleGuide, type Density, type FontKey } from './style-guide.ts';
import * as repo from '../db/repos.ts';

export interface DesignSystemRecord {
  guide: StyleGuide;
  rationale: string;
  styleTileHtml: string;
  status: 'proposed' | 'accepted';
}

const key = (pid: string) => `design_system:${pid}`;

export function getDesignSystem(projectId: string): DesignSystemRecord | null {
  return repo.getSetting<DesignSystemRecord>(key(projectId));
}

function answersOf(documentId: string): Record<string, string> {
  const s = repo.getSessionByDocument(documentId);
  const out: Record<string, string> = {};
  for (const a of s?.answers ?? []) out[a.questionId] = a.answer;
  return out;
}

const HEX_RE = /#[0-9a-fA-F]{6}\b/;

/** 답변 키워드 → StyleGuide (결정적). stub/오프라인·폴백 공용. */
export function guideFromAnswers(ans: Record<string, string>): { guide: StyleGuide; rationale: string } {
  const all = Object.values(ans).join(' ');
  const has = (...ks: string[]) => ks.some((k) => all.includes(k));

  // 베이스 프리셋 — 성격에서
  let preset = 'clean';
  if (has('활기', '경쾌', '친근', '발랄', '재미', '귀여')) preset = 'vivid';
  else if (has('클래식', '우아', '따뜻', '감성', '편안')) preset = 'warm';
  else if (has('미니멀', '기능', '단정', '실용', '툴')) preset = 'mono';
  const base = PRESETS[preset] ?? DEFAULT_GUIDE;
  const guide: StyleGuide = { ...base };

  // 모드
  if (has('다크', '어두', 'dark', '야간')) guide.mode = 'dark';
  if (guide.mode === 'dark' && preset !== 'dark') Object.assign(guide, PRESETS.dark, { preset });

  // 강조색 — HEX 있으면 우선
  const hex = all.match(HEX_RE)?.[0];
  if (hex) guide.accent = hex;
  else if (has('그린', '초록', '녹색')) guide.accent = '#0e7b62';
  else if (has('블루', '파랑', '남색')) guide.accent = '#2563eb';
  else if (has('퍼플', '보라')) guide.accent = '#7c3aed';
  else if (has('오렌지', '주황', '테라코타')) guide.accent = '#c2603f';

  // 타이포
  const font: FontKey = has('세리프', '명조') ? 'serif' : has('라운드', '둥근 서체', '동글') ? 'rounded' : has('모노', '고정폭') ? 'mono' : 'sans';
  guide.font = font;

  // 밀도
  const density: Density = has('촘촘', '밀집', '조밀', '많이') ? 'compact' : has('여유', '넓', '시원') ? 'spacious' : guide.density;
  guide.density = density;

  // 형태(라운드)
  if (has('각진', '샤프', '직각', '딱딱')) guide.radius = Math.min(guide.radius, 4);
  else if (has('둥근', '부드럽', '라운드')) guide.radius = Math.max(guide.radius, 14);

  const rationale =
    `성격(“${ans.personality ?? '—'}”)에서 **${preset}** 계열을 베이스로 잡고, ` +
    `${hex ? `지정하신 강조색 ${hex}` : `느낌에 맞는 강조색 ${guide.accent}`}을 주요 액션에만 절제해서 씁니다. ` +
    `서체는 ${font === 'serif' ? '클래식 세리프' : font === 'rounded' ? '친근한 라운드' : font === 'mono' ? '기능적 모노' : '모던 산세리프'}, ` +
    `밀도는 ${density === 'compact' ? '촘촘하게' : density === 'spacious' ? '여유 있게' : '보통'}, ` +
    `모서리 반경 ${guide.radius}px${guide.mode === 'dark' ? ', 다크 모드' : ''}. ` +
    `색은 단일 강조색이 아니라 배경·표면·본문·보조·경계·강조·상태의 역할 체계로 구성했습니다.`;
  return { guide, rationale };
}

function buildMessages(ans: Record<string, string>) {
  const answerBlock = Object.entries(ans).map(([k, v]) => `- ${k}: ${v}`).join('\n');
  const system =
    `너는 시니어 프로덕트 디자이너다. 아래 인터뷰 답변으로 이 제품의 디자인 시스템 토큰을 설계한다.\n` +
    `오직 JSON 하나만 출력(코드펜스·설명 없이). 형태:\n` +
    `{"accent":"#RRGGBB","mode":"light|dark","density":"compact|cozy|spacious","font":"sans|serif|rounded|mono","radius":정수(0~20),"rationale":"선택 근거 2~3문장(한국어)"}\n` +
    `accent 는 주요 액션·활성 상태에만 쓰는 절제된 강조색. 답변에 HEX·금지색이 있으면 반드시 반영.`;
  const user = `인터뷰 답변:\n${answerBlock}\n\n위 계약대로 JSON 을 출력하라.`;
  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ];
}

function extractJson(text: string): unknown {
  let t = text.trim().replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```$/, '').trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  return JSON.parse(t);
}

export async function generateDesignSystem(documentId: string): Promise<DesignSystemRecord> {
  const doc = repo.getDocument(documentId);
  if (!doc) throw new Error('document not found');
  const ans = answersOf(documentId);

  // 결정적 베이스(항상 확보) — AI 는 이 위에 부분 덮어쓰기.
  let { guide, rationale } = guideFromAnswers(ans);

  if (!(config.aiStub || config.managedTier)) {
    try {
      const cfg = getModelConfig('design-system');
      const provider = resolveProvider(cfg.provider);
      let text = '';
      for await (const d of provider.streamChat({ model: cfg.model, maxTokens: Math.max(cfg.maxTokens, 1500), messages: buildMessages(ans) })) text += d;
      const j = extractJson(text) as Partial<StyleGuide> & { rationale?: string };
      // 유효 값만 병합 (프리셋 색 역할은 유지, 토큰만 조정)
      const base = j.mode === 'dark' ? PRESETS.dark : guide;
      guide = {
        ...base,
        accent: HEX_RE.test(j.accent ?? '') ? (j.accent as string) : guide.accent,
        mode: j.mode === 'dark' || j.mode === 'light' ? j.mode : guide.mode,
        density: (['compact', 'cozy', 'spacious'] as const).includes(j.density as Density) ? (j.density as Density) : guide.density,
        font: (['sans', 'serif', 'rounded', 'mono'] as const).includes(j.font as FontKey) ? (j.font as FontKey) : guide.font,
        radius: typeof j.radius === 'number' ? Math.max(0, Math.min(20, j.radius)) : guide.radius,
        preset: 'custom',
      };
      if (typeof j.rationale === 'string' && j.rationale.trim()) rationale = j.rationale.trim();
    } catch {
      // 실패 시 결정적 결과 유지
    }
  }

  const rec: DesignSystemRecord = { guide, rationale, styleTileHtml: styleTileHtml(guide), status: 'proposed' };
  repo.setSetting(key(doc.project_id), rec);
  return rec;
}

export function acceptDesignSystem(documentId: string): DesignSystemRecord {
  const doc = repo.getDocument(documentId);
  if (!doc) throw new Error('document not found');
  const rec = getDesignSystem(doc.project_id);
  if (!rec) throw new Error('no design system to accept');
  saveStyleGuide(doc.project_id, rec.guide); // 프로젝트 StyleGuide 로 반영 → 와이어프레임·시안 구동
  const next: DesignSystemRecord = { ...rec, status: 'accepted' };
  repo.setSetting(key(doc.project_id), next);
  return next;
}

/** 스타일 타일 — 토큰을 색 역할·타입·컴포넌트 샘플로 결정적 렌더(미리보기). */
export function styleTileHtml(g: StyleGuide): string {
  const font = g.font === 'serif' ? 'Georgia, serif' : g.font === 'mono' ? 'ui-monospace, Menlo, monospace' : '-apple-system, system-ui, sans-serif';
  const roles: Array<[string, string]> = [
    ['배경 bg', g.bg], ['표면 surface', g.surface], ['본문 ink', g.ink], ['보조 sub', g.sub], ['경계 line', g.line], ['강조 accent', g.accent],
  ];
  const swatches = roles.map(([n, c]) =>
    `<div class="sw"><span class="chip" style="background:${c}"></span><b>${n}</b><code>${c}</code></div>`).join('');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  :root{--ac:${g.accent};--bg:${g.bg};--sf:${g.surface};--ink:${g.ink};--sub:${g.sub};--ln:${g.line};--r:${g.radius}px}
  *{box-sizing:border-box;margin:0}body{background:var(--bg);color:var(--ink);font-family:${font};padding:24px;line-height:1.5}
  h4{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--sub);margin:24px 0 10px;font-weight:700}
  h4:first-child{margin-top:0}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
  .sw{background:var(--sf);border:1px solid var(--ln);border-radius:var(--r);padding:10px;display:flex;flex-direction:column;gap:6px}
  .sw .chip{height:34px;border-radius:calc(var(--r) - 2px);border:1px solid var(--ln)}
  .sw b{font-size:12px}.sw code{font-size:10px;color:var(--sub)}
  .type .d{font-size:30px;font-weight:800;letter-spacing:-.01em}.type .b{font-size:15px;max-width:52ch;color:var(--ink)}.type .c{font-size:12px;color:var(--sub)}
  .comp{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
  .btn{border:0;border-radius:var(--r);padding:10px 16px;font-size:14px;font-weight:700;font-family:inherit}
  .btn.p{background:var(--ac);color:#fff}.btn.s{background:var(--sf);color:var(--ink);border:1px solid var(--ln)}
  .card{background:var(--sf);border:1px solid var(--ln);border-radius:var(--r);padding:14px;min-width:180px}
  .card b{font-size:14px}.card p{font-size:12px;color:var(--sub);margin-top:4px}
  .input{background:var(--sf);border:1px solid var(--ln);border-radius:var(--r);padding:10px 12px;color:var(--sub);font-size:13px;min-width:180px}
  .chip2{border:1px solid var(--ln);border-radius:99px;padding:4px 12px;font-size:12px;color:var(--sub)}
  .chip2.on{background:var(--ac);color:#fff;border-color:var(--ac)}
  .sw2{width:44px;height:24px;border-radius:99px;background:var(--ac);position:relative}.sw2::after{content:'';position:absolute;top:3px;right:3px;width:18px;height:18px;border-radius:50%;background:#fff}
  </style></head><body>
  <h4>색 시스템 (역할)</h4><div class="grid">${swatches}</div>
  <h4>타이포그래피</h4><div class="type"><div class="d">화면 제목 Aa 가나다</div><div class="b">본문은 이 서체와 크기로 읽힙니다. 색은 단일 강조색이 아니라 역할 체계로 구성됩니다.</div><div class="c">캡션 · 보조 정보</div></div>
  <h4>컴포넌트</h4><div class="comp"><button class="btn p">주요 액션</button><button class="btn s">보조</button><span class="chip2 on">활성</span><span class="chip2">기본</span><span class="sw2"></span></div>
  <div class="comp" style="margin-top:10px"><div class="card"><b>카드</b><p>표면·경계·라운드가 이렇게 적용됩니다.</p></div><div class="input">입력 필드</div></div>
  </body></html>`;
}

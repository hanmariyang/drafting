// AI 고해상도 시안 생성 — 페이지(IA) 1개 + StyleGuide → 자기완결 HTML 화면.
// AI_STUB 이면 테마 반영 결정적 HTML(테스트·오프라인). 아니면 provider 로 생성.

import { config } from './config.ts';
import { resolveProvider } from '../providers/index.ts';
import { getModelConfig } from './ai.ts';
import { getStyleGuide, guidePromptText, type StyleGuide } from './style-guide.ts';
import * as repo from '../db/repos.ts';
import type { PlanItem, PlanItemMeta, PageType } from './types.ts';

function meta(i: PlanItem): PlanItemMeta {
  try {
    return JSON.parse(i.meta || '{}') as PlanItemMeta;
  } catch {
    return {};
  }
}
function bodyLines(i: PlanItem): string[] {
  return i.body.split('\n').map((l) => l.replace(/^[·\-*]\s*/, '').trim()).filter(Boolean);
}

/** ```html 펜스·잡텍스트 제거 후 <html…>/<!doctype…>~</html> 만 뽑는다. */
export function extractHtml(text: string): string {
  let t = text.trim().replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```$/, '').trim();
  let lower = t.toLowerCase();
  // 서두 텍스트 제거 — doctype/html 중 '가장 이른' 마커부터. (max 아님: doctype 를 버리면 안 됨)
  const starts = [lower.indexOf('<!doctype'), lower.indexOf('<html')].filter((i) => i >= 0);
  const start = starts.length ? Math.min(...starts) : -1;
  if (start > 0) {
    t = t.slice(start);
    lower = t.toLowerCase(); // slice 후 인덱스 재계산 (스테일 방지)
  }
  const end = lower.lastIndexOf('</html>');
  if (end >= 0) t = t.slice(0, end + 7);
  return t;
}

function buildMessages(page: PlanItem, features: PlanItem[], g: StyleGuide) {
  const type = (meta(page).page_type ?? 'GENERIC') as PageType;
  const featureBlock = features.length
    ? features.map((f) => `- ${f.title}${f.body ? `: ${bodyLines(f).slice(0, 4).join(' / ')}` : ''}`).join('\n')
    : '- (연결된 기능 없음 — 화면 목적에 맞는 합리적 기본 요소)';
  const system =
    `너는 시니어 프로덕트 디자이너다. 아래 화면 1개에 대한 **고해상도 시안**을 만든다.\n` +
    `출력은 오직 자기완결 HTML 문서 하나 — 인라인 <style> 만 사용, 외부 리소스·이미지 URL·JS 금지. ` +
    `코드펜스·설명 문장 없이 <!doctype html> 로 시작한다.\n` +
    `모바일 앱 화면(폭 390px 기준, body 는 화면 배경, 중앙에 390px 프레임). 한국어 실제 콘텐츠로 채운다(로렘 금지).\n` +
    `디자인 토큰(반드시 준수): ${guidePromptText(g)}\n` +
    `화면 성격 = ${type}. 상단 앱바 + 성격에 맞는 본문(목록/상세/폼/대시보드/설정 등) + 주요 액션 버튼(accent).`;
  const user =
    `화면: "${page.title}" (${type})\n담아야 할 기능/요소:\n${featureBlock}\n\n위 토큰과 성격대로 시안 HTML 을 출력하라.`;
  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ];
}

export async function generateMockupHtml(projectId: string, page: PlanItem): Promise<string> {
  const g = getStyleGuide(projectId);
  const featureRefs = meta(page).links?.features ?? [];
  const items = repo.listProjectItems(projectId);
  const byRef = new Map(items.map((i) => [i.ref_id, i]));
  const features = featureRefs.map((r) => byRef.get(r)).filter((x): x is PlanItem => !!x);

  if (config.aiStub || config.managedTier) return stubMockupHtml(page, features, g);

  const cfg = getModelConfig('ia');
  const provider = resolveProvider(cfg.provider);
  const messages = buildMessages(page, features, g);
  // 무거운 화면(기능 많음)은 시안 HTML 이 길다 → 넉넉한 토큰(잘림 방지).
  const maxTokens = Math.max(cfg.maxTokens, 16000);
  const run = async (): Promise<string> => {
    let text = '';
    for await (const delta of provider.streamChat({ model: cfg.model, maxTokens, messages })) text += delta;
    return extractHtml(text);
  };
  let html = await run();
  // 미완성(닫는 </html> 없음·너무 짧음) = 토큰 소진/스톨로 잘린 것 → 1회 재시도.
  if (!isCompleteHtml(html)) html = await run();
  if (!html.toLowerCase().includes('<html') && !html.toLowerCase().includes('<!doctype')) {
    // 모델이 조각만 줬으면 최소 래핑
    return `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
  }
  return html;
}

/** 시안 HTML 이 온전한가 — 닫는 </html> 가 있고 최소 길이 이상. */
export function isCompleteHtml(html: string): boolean {
  const lc = html.toLowerCase();
  return lc.includes('</html>') && html.trim().length > 400;
}

/** 결정적 테마 시안 — stub/offline. 실제 시안의 느낌을 토큰으로 재현. */
export function stubMockupHtml(page: PlanItem, features: PlanItem[], g: StyleGuide): string {
  const type = (meta(page).page_type ?? 'GENERIC') as PageType;
  const labels = features.map((f) => f.title);
  const lines = features.flatMap((f) => bodyLines(f));
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
  const gapPx = g.density === 'compact' ? 10 : g.density === 'spacious' ? 20 : 14;
  const font =
    g.font === 'serif' ? 'Georgia, serif' : g.font === 'mono' ? 'ui-monospace, Menlo, monospace' : "-apple-system, system-ui, sans-serif";

  const body = (() => {
    switch (type) {
      case 'LIST':
        return `<div class="input">🔍 ${esc(page.title)} 검색</div>` +
          (labels.length ? labels : [page.title]).slice(0, 4).map((t, i) =>
            `<div class="card row"><div class="av">${i + 1}</div><div class="rt"><b>${esc(t)}</b><span>${esc(lines[i] ?? '항목 설명')}</span></div><span class="chev">›</span></div>`).join('');
      case 'DETAIL':
        return `<div class="hero"></div><h2>${esc(labels[0] ?? page.title)}</h2>` +
          `<div class="chips">${['개요', '상세', '리뷰'].map((c, i) => `<span class="chip${i === 0 ? ' on' : ''}">${c}</span>`).join('')}</div>` +
          lines.slice(0, 3).map((b) => `<p>${esc(b)}</p>`).join('') +
          `<button class="cta">다음 단계로</button>`;
      case 'FORM':
        return (lines.length ? lines : labels).slice(0, 4).map((f) =>
          `<label class="field"><span>${esc(f)}</span><div class="input"> </div></label>`).join('') +
          `<button class="cta">제출</button>`;
      case 'DASH':
        return `<div class="stats">${(labels.length ? labels : ['활성 사용자', '전환율', '매출']).slice(0, 3).map((l, i) =>
          `<div class="stat"><b>${(i + 4) * 13}%</b><span>${esc(l)}</span></div>`).join('')}</div>` +
          `<div class="card"><div class="chart">${[42, 66, 80, 54, 92, 70].map((h) => `<i style="height:${h}%"></i>`).join('')}</div></div>`;
      case 'SETTINGS':
        return (lines.length ? lines : labels).slice(0, 4).map((t, i) =>
          `<div class="card tgl"><span>${esc(t)}</span><span class="sw${i < 2 ? ' on' : ''}"></span></div>`).join('');
      default:
        return (lines.length ? lines : labels.length ? labels : [page.title]).map((b) => `<div class="card"><p>${esc(b)}</p></div>`).join('') +
          `<button class="cta">열기</button>`;
    }
  })();

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  :root{--ac:${g.accent};--bg:${g.bg};--sf:${g.surface};--ink:${g.ink};--sub:${g.sub};--ln:${g.line};--r:${g.radius}px;--gap:${gapPx}px}
  *{box-sizing:border-box;margin:0}body{background:var(--bg);font-family:${font};color:var(--ink);display:flex;justify-content:center;padding:16px}
  .frame{width:390px;background:var(--bg);display:flex;flex-direction:column;gap:var(--gap)}
  .bar{display:flex;align-items:center;gap:10px;padding:14px 4px 4px;font-weight:700;font-size:17px}
  .bar .sp{flex:1}.bar .dot{width:26px;height:26px;border-radius:50%;background:var(--ln)}
  .card{background:var(--sf);border:1px solid var(--ln);border-radius:var(--r);padding:14px}
  .row{display:flex;align-items:center;gap:12px}.av{width:38px;height:38px;border-radius:calc(var(--r) - 2px);background:color-mix(in srgb,var(--ac) 16%,var(--sf));color:var(--ac);display:flex;align-items:center;justify-content:center;font-weight:800;flex-shrink:0}
  .rt{display:flex;flex-direction:column;min-width:0}.rt b{font-size:14px}.rt span{font-size:12px;color:var(--sub)}.chev{margin-left:auto;color:var(--sub);font-size:20px}
  .input{background:var(--sf);border:1px solid var(--ln);border-radius:var(--r);padding:11px 13px;color:var(--sub);font-size:13px;min-height:20px}
  .hero{height:150px;background:linear-gradient(135deg,color-mix(in srgb,var(--ac) 22%,var(--sf)),var(--sf));border-radius:var(--r);border:1px solid var(--ln)}
  h2{font-size:20px;margin:2px 0}.chips{display:flex;gap:8px}.chip{font-size:12px;color:var(--sub);border:1px solid var(--ln);border-radius:99px;padding:4px 12px}.chip.on{background:var(--ac);color:#fff;border-color:var(--ac)}
  p{font-size:13px;line-height:1.6;color:var(--sub)}
  .field{display:flex;flex-direction:column;gap:6px}.field span{font-size:12px;color:var(--sub);font-weight:600}.field .input{min-height:42px}
  .cta{background:var(--ac);color:#fff;border:0;border-radius:var(--r);padding:14px;font-size:15px;font-weight:700;margin-top:4px}
  .stats{display:flex;gap:var(--gap)}.stat{flex:1;background:var(--sf);border:1px solid var(--ln);border-radius:var(--r);padding:14px}.stat b{font-size:22px;color:var(--ac)}.stat span{display:block;font-size:11px;color:var(--sub);margin-top:3px}
  .chart{display:flex;align-items:flex-end;gap:8px;height:120px}.chart i{flex:1;background:var(--ac);opacity:.85;border-radius:4px 4px 0 0}
  .tgl{display:flex;align-items:center}.tgl span:first-child{font-size:14px}.sw{margin-left:auto;width:42px;height:24px;border-radius:99px;background:var(--ln);position:relative}.sw.on{background:var(--ac)}.sw::after{content:'';position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:.2s}.sw.on::after{left:21px}
  </style></head><body><div class="frame"><div class="bar">${type === 'DETAIL' || type === 'FORM' || type === 'SETTINGS' ? '<span>‹</span>' : ''}<span>${esc(page.title)}</span><span class="sp"></span><span class="dot"></span></div>${body}</div></body></html>`;
}

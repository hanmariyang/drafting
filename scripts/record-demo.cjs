// docs/demo.gif 재생성 — 실제 Drafting UI 를 조작하며 PRD 스트리밍을 프레임 캡처 → GIF 인코딩.
// 요구: npm i -D playwright gifenc pngjs && npx playwright install chromium
// 실행:
//   1) npm run build
//   2) DATABASE_PATH=/tmp/demo.sqlite AI_STUB=1 PORT=8477 HOST=127.0.0.1 node api/dist/index.js &
//   3) node scripts/record-demo.cjs      → docs/demo.gif
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');
const fs = require('fs');

const URL = process.env.DEMO_URL || 'http://127.0.0.1:8477/';
const W = 1080, H = 660, DELAY = 130;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  // 첫 실행 온보딩 위저드가 클릭을 가로채므로 서버측으로 완료 처리 후 리로드(AI_STUB 이라 provider 준비됨)
  await page.request.post(URL + 'api/settings/onboarding/complete');
  await page.reload({ waitUntil: 'networkidle' });

  // 시작 화면 → 아이디어 입력 → 인터뷰
  await page.fill('.idea-input', '회의실 예약이 매번 겹쳐서 정리하는 도구가 필요해요');
  await page.click('.idea-go');
  await page.waitForSelector('textarea.field', { timeout: 20000 });
  await page.fill('textarea.field', '팀이 회의실을 겹쳐 예약해 매번 조율에 시간을 씁니다.');
  await page.waitForTimeout(500);

  const frames = [];
  const clip = { x: 0, y: 0, width: W, height: H };
  const shoot = async () => { try { frames.push(await page.screenshot({ clip })); } catch (e) {} };

  // 생성 클릭 → 스트리밍 캡처(~9s)
  await page.click('button:has-text("AI 초안 생성")');
  const t0 = Date.now();
  let mid = false;
  while (Date.now() - t0 < 9000) {
    await shoot();
    if (!mid && Date.now() - t0 > 3000) { mid = true; try { await page.screenshot({ path: '/tmp/demo_mid.png' }); } catch (e) {} }
    await page.waitForTimeout(DELAY);
  }
  // 첫 제안 수락(잉크로 마름) 몇 프레임 더
  try { const acc = page.locator('button:has-text("수락")').first(); if (await acc.count()) await acc.click({ timeout: 2000 }); } catch (e) {}
  for (let i = 0; i < 9; i++) { await shoot(); await page.waitForTimeout(DELAY); }

  await browser.close();
  console.log('captured frames:', frames.length);
  if (!frames.length) { console.error('no frames'); process.exit(1); }

  // 프레임 → GIF (프레임별 256색 양자화)
  const enc = GIFEncoder();
  let w, h;
  for (const buf of frames) {
    const png = PNG.sync.read(buf);
    w = png.width; h = png.height;
    const rgba = new Uint8Array(png.data);
    const palette = quantize(rgba, 256);
    const index = applyPalette(rgba, palette);
    enc.writeFrame(index, w, h, { palette, delay: DELAY });
  }
  enc.finish();
  const out = Buffer.from(enc.bytes());
  fs.writeFileSync('docs/demo.gif', out);
  console.log('wrote docs/demo.gif', (out.length / 1024 / 1024).toFixed(2) + 'MB', w + 'x' + h);
})().catch((e) => { console.error(e); process.exit(1); });

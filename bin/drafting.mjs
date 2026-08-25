#!/usr/bin/env node
/*
 * drafting — 터미널에서 데몬을 띄우고 브라우저를 연다.
 * 서버가 "터미널 프로세스" 컨텍스트로 돌기 때문에:
 *   · 구독(CLI): 이 터미널의 claude 로그인/키체인을 그대로 사용 → GUI 앱과 달리 막히지 않는다.
 *   · BYOK(env): ANTHROPIC_API_KEY / OPENAI_API_KEY / OPENROUTER_API_KEY / LITELLM_API_KEY 자동 인식(마법사 불필요).
 * 사용: drafting serve [--port 8477] [--no-open]
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const args = process.argv.slice(2);
const cmd = args[0] && !args[0].startsWith('-') ? args[0] : 'serve';
if (cmd === 'help' || cmd === '--help' || (cmd !== 'serve')) {
  console.log('사용법: drafting serve [--port 8477] [--no-open]');
  process.exit(cmd === 'help' || cmd === '--help' ? 0 : 1);
}
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const noOpen = args.includes('--no-open');

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..'); // 설치본 루트 — db/schema.sql·web/dist·api/templates 해석 기준
const entry = join(pkgRoot, 'api', 'dist', 'index.js');
if (!existsSync(entry)) {
  console.error(`빌드 산출물이 없습니다: ${entry}\n먼저 'npm run build' 하세요.`);
  process.exit(1);
}
const port = flag('--port', process.env.PORT || '8477');
const dataDir = process.env.DRAFTING_HOME || join(homedir(), '.drafting');
mkdirSync(dataDir, { recursive: true });

// APP_ENCRYPTION_KEY 자동 생성·보관 (사용자가 관리하지 않게). env 로 주면 그걸 우선.
let encKey = process.env.APP_ENCRYPTION_KEY;
if (!encKey) {
  const p = join(dataDir, '.enckey');
  if (existsSync(p)) encKey = readFileSync(p, 'utf8').trim();
  else { encKey = randomBytes(32).toString('base64'); writeFileSync(p, encKey, { mode: 0o600 }); }
}

const env = {
  ...process.env,
  DRAFTING_ROOT: process.env.DRAFTING_ROOT || pkgRoot,
  PORT: port,
  HOST: process.env.HOST || '127.0.0.1',
  DATABASE_PATH: process.env.DATABASE_PATH || join(dataDir, 'drafting.sqlite'),
  APP_ENCRYPTION_KEY: encKey,
};
const url = `http://127.0.0.1:${port}`;
const envKeys = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'LITELLM_API_KEY'].filter((k) => process.env[k]);
console.log('\n  Drafting — 터미널 모드');
console.log(`  · 데이터   ${env.DATABASE_PATH}`);
console.log(`  · 구독(CLI) 이 터미널의 claude 로그인/키체인 사용`);
console.log(`  · BYOK(env) ${envKeys.length ? envKeys.join(', ') : '없음 (설정에서 등록하거나 env 로 주입)'}`);
console.log(`  · 주소     ${url}\n`);

const child = spawn(process.execPath, [entry], { env, stdio: 'inherit' });

if (!noOpen) {
  const openBrowser = (u) => {
    const c = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const a = process.platform === 'win32' ? ['/c', 'start', '', u] : [u];
    spawn(c, a, { stdio: 'ignore', detached: true }).unref();
  };
  const t0 = Date.now();
  const poll = setInterval(async () => {
    try {
      const r = await fetch(`${url}/api/health`);
      if (r.ok) { clearInterval(poll); openBrowser(url); }
    } catch { /* not up yet */ }
    if (Date.now() - t0 > 15000) clearInterval(poll);
  }, 400);
}
child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));

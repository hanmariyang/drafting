import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Find the repo root by walking up until we see db/schema.sql. Works whether the
 * code runs from api/src/lib (dev/tests, .ts) or api/dist/lib (prod build, .js).
 */
function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'db', 'schema.sql'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // fallback: assume three levels up from api/src|dist/lib
  return path.resolve(start, '..', '..', '..');
}

export const REPO_ROOT = process.env.DRAFTING_ROOT ?? findRepoRoot(__dirname);

function bool(v: string | undefined): boolean {
  return v === '1' || v === 'true' || v === 'yes';
}

/** 앱 버전은 루트 package.json 의 단일 소스에서 읽는다 (하드코딩 금지 — 릴리스마다 어긋남). */
function readVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? '0.0.0.0',
  databasePath:
    process.env.DATABASE_PATH ?? path.join(REPO_ROOT, 'data', 'drafting.sqlite'),
  encryptionKey: process.env.APP_ENCRYPTION_KEY ?? '',
  managedTier: bool(process.env.MANAGED_TIER),
  aiStub: bool(process.env.AI_STUB),
  schemaPath: path.join(REPO_ROOT, 'db', 'schema.sql'),
  templatesDir: path.join(REPO_ROOT, 'api', 'templates'),
  webDist: path.join(REPO_ROOT, 'web', 'dist'),
  version: readVersion(),
  // OpenAI 호환 게이트웨이(LiteLLM·Azure·사내 프록시 등) base URL 오버라이드.
  // 비워두면 표준 OpenAI. 회사 게이트웨이 주소는 여기(env/설정)에만 두고 코드엔 넣지 않는다.
  openaiBaseUrl: (process.env.OPENAI_BASE_URL ?? process.env.LITELLM_BASE_URL ?? '').trim(),
};

export type AppConfig = typeof config;

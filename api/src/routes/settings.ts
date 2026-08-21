import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as repo from '../db/repos.ts';
import { parse } from './helpers.ts';
import { config } from '../lib/config.ts';
import { aiMode } from '../providers/index.ts';
import { cliAvailable, resolveCliBin, resetCliBinCache, verifyCliAccess } from '../providers/cli.ts';

const PROVIDERS = ['anthropic', 'openai', 'openrouter'] as const;

const modelEntry = z.object({
  provider: z.enum(PROVIDERS).optional(),
  model: z.string().optional(),
  maxTokens: z.number().int().positive().optional(),
});

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  // meta: version, onboarding, feature flags (SPEC-22)
  app.get('/api/meta', async () => {
    const keys = repo.listKeyMeta();
    return {
      version: config.version,
      managedTier: config.managedTier,
      aiStub: config.aiStub,
      onboardingComplete: repo.getSetting<boolean>('onboarding_complete') ?? false,
      keysConfigured: keys.map((k) => k.provider),
      aiMode: aiMode(),
      cliAvailable: cliAvailable(),
      cliBin: resolveCliBin(),
      openaiBaseUrl: repo.getSetting<string>('openai_base_url') || config.openaiBaseUrl || '',
      // In v1 there is no update server; the client shows the running version.
      // A real deployment can point this at a release feed.
      latestVersion: repo.getSetting<string>('latest_version') ?? config.version,
    };
  });

  app.get('/api/settings', async () => {
    return {
      providerModels: repo.getSetting('provider_models') ?? { default: {} },
      onboardingComplete: repo.getSetting<boolean>('onboarding_complete') ?? false,
    };
  });

  // per-doc-type model + token budget (SPEC-19)
  app.put('/api/settings/models', async (req) => {
    const body = parse(
      z.object({
        default: modelEntry.optional(),
        prd: modelEntry.optional(),
        'feature-spec': modelEntry.optional(),
        ia: modelEntry.optional(),
        'user-flow': modelEntry.optional(),
      }),
      req.body,
    );
    const current = (repo.getSetting<Record<string, unknown>>('provider_models') ?? {}) as Record<
      string,
      unknown
    >;
    const merged = { ...current, ...body };
    repo.setSetting('provider_models', merged);
    return merged;
  });

  // OpenAI 호환 게이트웨이(LiteLLM·Azure·사내 프록시) 엔드포인트 설정.
  // base 를 비우면 표준 OpenAI. 회사 게이트웨이 주소·키는 여기(런타임 설정)에만 둔다.
  app.put('/api/settings/openai-endpoint', async (req) => {
    const body = parse(
      z.object({
        baseUrl: z.string().optional(),
        headers: z.record(z.string()).optional(),
      }),
      req.body ?? {},
    );
    repo.setSetting('openai_base_url', (body.baseUrl ?? '').trim());
    if (body.headers) repo.setSetting('openai_headers', body.headers);
    return {
      baseUrl: repo.getSetting<string>('openai_base_url') ?? '',
      headers: repo.getSetting<Record<string, string>>('openai_headers') ?? {},
    };
  });

  // 엔진 모드: CLI(구독) vs BYOK(API 키)
  app.put('/api/settings/ai-mode', async (req) => {
    const body = parse(z.object({ mode: z.enum(['cli', 'byok']) }), req.body);
    repo.setSetting('ai_mode', body.mode);
    return { aiMode: body.mode };
  });

  // 실제 생성 권한까지 검증 — 조직이 Claude Code 접근을 막은 계정을 온보딩에서 미리 잡는다.
  app.post('/api/settings/cli/test', async () => {
    resetCliBinCache();
    return verifyCliAccess();
  });

  app.post('/api/settings/onboarding/complete', async () => {
    repo.setSetting('onboarding_complete', true);
    return { ok: true };
  });

  // allow re-opening the wizard (test/dev convenience)
  app.post('/api/settings/onboarding/reset', async () => {
    repo.setSetting('onboarding_complete', false);
    return { ok: true };
  });
}

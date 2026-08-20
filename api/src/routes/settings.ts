import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as repo from '../db/repos.ts';
import { parse } from './helpers.ts';
import { config } from '../lib/config.ts';

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

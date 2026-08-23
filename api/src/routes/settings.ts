import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as repo from '../db/repos.ts';
import { parse } from './helpers.ts';
import { config } from '../lib/config.ts';
import { aiMode } from '../providers/index.ts';
import { cliAvailable, resolveCliBin, resetCliBinCache, verifyCliAccess } from '../providers/cli.ts';
import { getDecryptedKey } from '../db/repos.ts';
import { probeGateway } from '../lib/gateway.ts';

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
      agentBinPath: repo.getSetting<string>('agent_bin_path') ?? '',
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
    if (body.headers) repo.setSetting('openai_headers', body.headers);
    const raw = (body.baseUrl ?? '').trim();
    if (!raw) {
      repo.setSetting('openai_base_url', '');
      return { baseUrl: '', models: [], detected: 'cleared' as const };
    }
    // /v1 자동 감지 + 모델 목록 조회 (키가 있으면). 사용자는 호스트만 붙이면 된다.
    const headers = repo.getSetting<Record<string, string>>('openai_headers') ?? {};
    const key = getDecryptedKey('openai');
    let stored = raw.replace(/\/+$/, '');
    let models: string[] = [];
    let detected: 'v1' | 'root' | 'as-is' | 'no-key' = key ? 'as-is' : 'no-key';
    if (key) {
      const probe = await probeGateway(raw, key, headers);
      if (probe) {
        stored = probe.chatBase;
        models = probe.models;
        detected = stored.endsWith('/v1') ? 'v1' : 'root';
      }
    }
    repo.setSetting('openai_base_url', stored);
    return { baseUrl: stored, models, detected };
  });

  // 저장된 게이트웨이 base + openai 키로 모델 목록 재조회 (드롭다운 새로고침·마운트용)
  app.get('/api/settings/openai-models', async () => {
    const base = repo.getSetting<string>('openai_base_url') || config.openaiBaseUrl || '';
    const key = getDecryptedKey('openai');
    if (!base || !key) return { models: [], baseUrl: base };
    const headers = repo.getSetting<Record<string, string>>('openai_headers') ?? {};
    const probe = await probeGateway(base, key, headers);
    return { models: probe?.models ?? [], baseUrl: probe?.chatBase ?? base };
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

  // CLI 바이너리 경로 수동 지정(자동 탐색이 실패하는 비표준 설치용). 빈 문자열이면 해제.
  app.put('/api/settings/agent-bin', async (req) => {
    const body = parse(z.object({ path: z.string() }), req.body);
    repo.setSetting('agent_bin_path', body.path.trim());
    resetCliBinCache();
    return { cliBin: resolveCliBin(), cliAvailable: cliAvailable() };
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

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as repo from '../db/repos.ts';
import { HttpError, parse } from './helpers.ts';
import { resolveProvider } from '../providers/index.ts';
import { getModelConfig } from '../lib/ai.ts';
import { probeGateway } from '../lib/gateway.ts';
import { config } from '../lib/config.ts';
import type { ProviderId } from '../lib/types.ts';

const PROVIDERS = ['anthropic', 'openai', 'openrouter'] as const;

export async function keyRoutes(app: FastifyInstance): Promise<void> {
  // masked list — never returns key material (G-01)
  app.get('/api/keys', async () => {
    const configured = repo.listKeyMeta();
    return PROVIDERS.map((p) => {
      const meta = configured.find((k) => k.provider === p);
      return {
        provider: p,
        configured: !!meta,
        label: meta?.label ?? '',
        last4: meta?.last4 ?? '',
        updatedAt: meta?.updated_at ?? null,
      };
    });
  });

  app.put('/api/keys/:provider', async (req) => {
    const provider = validProvider(req.params);
    const body = parse(
      z.object({ key: z.string().min(8), label: z.string().optional() }),
      req.body,
    );
    const meta = repo.upsertApiKey(provider, body.key.trim(), body.label ?? '');
    return { provider: meta.provider, configured: true, last4: meta.last4 };
  });

  app.delete('/api/keys/:provider', async (req) => {
    const provider = validProvider(req.params);
    repo.deleteApiKey(provider);
    return { ok: true };
  });

  // test call (SPEC-18) — uses stored key (or stub/managed per env)
  app.post('/api/keys/:provider/test', async (req) => {
    const provider = validProvider(req.params);
    const body = parse(z.object({ model: z.string().optional() }), req.body ?? {});
    let ai;
    try {
      ai = resolveProvider(provider, { forceByok: true }); // 키 테스트는 항상 BYOK 경로
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    // 테스트 모델 선정: 명시값 > (openai 게이트웨이면) 게이트웨이가 실제 제공하는 모델 > 설정 기본값.
    // 게이트웨이는 gpt-4o-mini 등 기본 모델 권한이 없어 401 이 나므로, 실 모델로 테스트한다.
    let model = body.model;
    if (!model && (provider === 'openai' || provider === 'openrouter')) {
      const base = repo.getSetting<string>('openai_base_url') || config.openaiBaseUrl || '';
      if (base) {
        const key = repo.getDecryptedKey(provider);
        const headers = repo.getSetting<Record<string, string>>('openai_headers') ?? {};
        const probe = key ? await probeGateway(base, key, headers) : null;
        const configured = getModelConfig('prd').model;
        model = probe?.models?.includes(configured) ? configured : probe?.models?.[0];
      }
    }
    model = model ?? getModelConfig('prd').model;
    const result = await ai.testConnection(model);
    return { provider, model, ...result };
  });
}

function validProvider(params: unknown): ProviderId {
  const { provider } = params as { provider: string };
  if (!(PROVIDERS as readonly string[]).includes(provider)) {
    throw new HttpError(400, `unknown provider: ${provider}`);
  }
  return provider as ProviderId;
}

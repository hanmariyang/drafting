import { config } from '../lib/config.ts';
import { getDecryptedKey } from '../db/repos.ts';
import type { AIProvider } from './types.ts';
import type { ProviderId } from '../lib/types.ts';
import { AnthropicProvider } from './byok/anthropic.ts';
import { OpenAIProvider, OpenRouterProvider } from './byok/openai-compat.ts';
import { StubProvider } from './stub.ts';
import { ManagedProvider } from './managed.ts';
import { CliProvider, cliAvailable } from './cli.ts';
import { getSetting } from '../db/repos.ts';

export class ProviderKeyError extends Error {
  provider: ProviderId;
  constructor(provider: ProviderId) {
    super(`No API key configured for provider "${provider}". Add one in Settings.`);
    this.name = 'ProviderKeyError';
    this.provider = provider;
  }
}

export { type AIProvider } from './types.ts';

/**
 * Resolve an AIProvider for a given provider id. This is the ONLY place a
 * concrete provider is constructed — all AI calls funnel through here (G-07).
 *   - MANAGED_TIER=true  -> ManagedProvider (v2, interface only)
 *   - AI_STUB=1          -> StubProvider (offline, deterministic)
 *   - otherwise          -> BYOK provider using the decrypted key
 */
/** 엔진 모드: 'cli'(Claude Code 구독, 기본) | 'byok'(API 키). 미설정 시 CLI 감지로 결정. */
export function aiMode(): 'cli' | 'byok' {
  const saved = getSetting<string>('ai_mode');
  if (saved === 'cli' || saved === 'byok') return saved;
  return cliAvailable() ? 'cli' : 'byok';
}

export function resolveProvider(providerId: ProviderId, opts?: { forceByok?: boolean }): AIProvider {
  if (config.managedTier) return new ManagedProvider();
  if (config.aiStub) return new StubProvider();
  if (!opts?.forceByok && aiMode() === 'cli') return new CliProvider();

  const key = getDecryptedKey(providerId);
  if (!key) throw new ProviderKeyError(providerId);

  switch (providerId) {
    case 'anthropic':
      return new AnthropicProvider(key);
    case 'openai': {
      // OpenAI 호환 게이트웨이(LiteLLM 등) 지원: 인앱 설정 > env > 표준 OpenAI 순.
      const base = getSetting<string>('openai_base_url') || config.openaiBaseUrl || undefined;
      const headers = getSetting<Record<string, string>>('openai_headers') || undefined;
      return new OpenAIProvider(key, base, headers);
    }
    case 'openrouter': {
      // 게이트웨이 base 를 설정하면 openrouter 슬롯도 그 게이트웨이로 라우팅(키를 여기 넣은 경우).
      // 안 하면 표준 openrouter.ai.
      const base = getSetting<string>('openai_base_url') || config.openaiBaseUrl || undefined;
      const headers = getSetting<Record<string, string>>('openai_headers') || undefined;
      return new OpenRouterProvider(key, base, headers);
    }
    default:
      throw new Error(`Unknown provider: ${providerId as string}`);
  }
}

/** True if we can produce SOME provider (stub, managed, or a stored key). */
export function hasUsableProvider(providerId: ProviderId): boolean {
  if (config.managedTier || config.aiStub) return true;
  if (aiMode() === 'cli') return cliAvailable();
  return getDecryptedKey(providerId) !== null;
}

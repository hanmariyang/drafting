import { config } from '../lib/config.ts';
import { getDecryptedKey } from '../db/repos.ts';
import type { AIProvider } from './types.ts';
import type { ProviderId } from '../lib/types.ts';
import { AnthropicProvider } from './byok/anthropic.ts';
import { OpenAIProvider, OpenRouterProvider } from './byok/openai-compat.ts';
import { StubProvider } from './stub.ts';
import { ManagedProvider } from './managed.ts';

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
export function resolveProvider(providerId: ProviderId): AIProvider {
  if (config.managedTier) return new ManagedProvider();
  if (config.aiStub) return new StubProvider();

  const key = getDecryptedKey(providerId);
  if (!key) throw new ProviderKeyError(providerId);

  switch (providerId) {
    case 'anthropic':
      return new AnthropicProvider(key);
    case 'openai':
      return new OpenAIProvider(key);
    case 'openrouter':
      return new OpenRouterProvider(key);
    default:
      throw new Error(`Unknown provider: ${providerId as string}`);
  }
}

/** True if we can produce SOME provider (stub, managed, or a stored key). */
export function hasUsableProvider(providerId: ProviderId): boolean {
  if (config.managedTier || config.aiStub) return true;
  return getDecryptedKey(providerId) !== null;
}

import type { AIProvider, StreamParams, TestResult } from './types.ts';

/**
 * v2 managed-tier provider (P-03 / §5). Interface only in v1: the constructor
 * and shape are defined so the factory can switch to it when MANAGED_TIER=true,
 * but the implementation is intentionally not shipped. This keeps the AI-call
 * abstraction ready for the managed cloud tier without pulling it into v1 scope.
 */
export class ManagedProvider implements AIProvider {
  readonly id = 'managed';
  private base: string | undefined;
  private key: string | undefined;
  constructor(base = process.env.MANAGED_API_BASE, key = process.env.MANAGED_API_KEY) {
    this.base = base;
    this.key = key;
  }

  // eslint-disable-next-line require-yield
  async *streamChat(_params: StreamParams): AsyncIterable<string> {
    throw new Error(
      'ManagedProvider is not implemented in v1. Set MANAGED_TIER=false and use BYOK keys.',
    );
  }

  async testConnection(_model: string): Promise<TestResult> {
    return { ok: false, detail: 'managed tier not implemented in v1' };
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamParams {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface TestResult {
  ok: boolean;
  detail?: string;
}

/**
 * Every AI interaction goes through this interface. Route/logic code MUST NOT
 * call a provider HTTP API directly (G-07). Two concrete families exist:
 *   - BYOKProvider  (v1) — uses the user's own decrypted key
 *   - ManagedProvider (v2) — routes through a managed backend (interface only)
 */
export interface AIProvider {
  readonly id: string;
  /** Yields text deltas as they stream in. */
  streamChat(params: StreamParams): AsyncIterable<string>;
  /** Lightweight connectivity/credential check. */
  testConnection(model: string): Promise<TestResult>;
}

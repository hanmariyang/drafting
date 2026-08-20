// Typed client for the Drafting API. Same-origin in prod; vite proxies in dev.

export type DocumentType = 'prd' | 'feature-spec' | 'ia' | 'user-flow';
export type ProviderId = 'anthropic' | 'openai' | 'openrouter';

export interface Project {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  documentCount?: number;
  // 신규 (병렬 API) — snake/camel 방어. normalizeProject 로 openSuggestions 로 통일.
  openSuggestions?: number;
  open_suggestions?: number;
}

/** openSuggestions 카운트를 snake/camel 어느 쪽이 오든 통일한다 (방어적). */
export function openSuggestionsOf(p: {
  openSuggestions?: number;
  open_suggestions?: number;
}): number {
  return p.openSuggestions ?? p.open_suggestions ?? 0;
}

export interface DocumentModel {
  id: string;
  project_id: string;
  type: DocumentType;
  title: string;
  status: 'draft' | 'streaming' | 'ready';
  parent_document_id: string | null;
  version: number;
  context_stale: number;
  context_source_version: number | null;
  context_pending_version: number | null;
  created_at: string;
  updated_at: string;
  // 신규 (병렬 API) — 문서 목록의 열린 제안 수. snake/camel 방어.
  openSuggestions?: number;
  open_suggestions?: number;
}

export type SectionStatus = 'proposed' | 'accepted' | 'rejected';

export interface Section {
  id: string;
  document_id: string;
  position: number;
  heading: string;
  body: string;
  status?: SectionStatus; // 신규 (병렬 API) — 없으면 accepted 로 취급
}

// ── 제안 (신규 병렬 API, 계약 고정) ──────────────────────────────
export type SuggestionKind = 'add' | 'revise' | 'delete' | 'question' | 'stale';

export interface Suggestion {
  id: string;
  sectionId?: string;
  kind: SuggestionKind;
  title: string;
  body: string;
  quoteBefore?: string;
  quoteAfter?: string;
  source: string;
  status: string;
}

export interface InterviewAnswer {
  questionId: string;
  question: string;
  answer: string;
}

export interface InterviewSession {
  id: string;
  document_id: string;
  template_id: string;
  status: 'active' | 'complete';
  current_index: number;
  answers: InterviewAnswer[];
}

export interface TemplateQuestion {
  id: string;
  prompt: string;
  hint?: string;
  example?: string;
}

export interface InterviewTemplate {
  id: string;
  docType: DocumentType;
  name: string;
  description: string;
  questions: TemplateQuestion[];
  sections: string[];
  draftGuidance: string;
}

export interface KeyInfo {
  provider: ProviderId;
  configured: boolean;
  label: string;
  last4: string;
  updatedAt: string | null;
}

export interface Meta {
  version: string;
  managedTier: boolean;
  aiStub: boolean;
  onboardingComplete: boolean;
  keysConfigured: ProviderId[];
  latestVersion: string;
}

export interface VersionEntry {
  id: string;
  version: number;
  event_type: 'save' | 'context_inherit' | 'restore';
  meta: Record<string, unknown>;
  note: string;
  created_at: string;
}

export interface ShareLink {
  id: string;
  token: string;
  url: string;
  expires_at: string | null;
  revoked: number;
  expired?: boolean;
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
  if (init?.body != null) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const ct = res.headers.get('content-type') ?? '';
  return (ct.includes('application/json') ? await res.json() : await res.text()) as T;
}

export const api = {
  meta: () => req<Meta>('/api/meta'),

  // projects
  listProjects: () => req<Project[]>('/api/projects'),
  createProject: (name: string, description = '') =>
    req<Project>('/api/projects', { method: 'POST', body: JSON.stringify({ name, description }) }),
  getProject: (id: string) =>
    req<Project & { documents: DocumentModel[] }>(`/api/projects/${id}`),
  deleteProject: (id: string) => req(`/api/projects/${id}`, { method: 'DELETE' }),
  createSample: () =>
    req<{ project: Project; documentId: string | null; created: boolean }>('/api/sample', {
      method: 'POST',
    }),
  graph: (id: string) =>
    req<{ nodes: GraphNode[]; edges: { from: string; to: string }[] }>(
      `/api/projects/${id}/graph`,
    ),

  // documents
  createDocument: (
    pid: string,
    body: { type: DocumentType; title: string; parentDocumentId?: string | null },
  ) =>
    req<DocumentModel>(`/api/projects/${pid}/documents`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getDocument: (id: string) =>
    req<{
      document: DocumentModel;
      sections: Section[];
      session: InterviewSession | null;
      parentContextAvailable: boolean;
    }>(`/api/documents/${id}`),
  renameDocument: (id: string, title: string) =>
    req<DocumentModel>(`/api/documents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    }),
  deleteDocument: (id: string) => req(`/api/documents/${id}`, { method: 'DELETE' }),

  // sections
  addSection: (docId: string, heading: string, body = '') =>
    req<Section>(`/api/documents/${docId}/sections`, {
      method: 'POST',
      body: JSON.stringify({ heading, body }),
    }),
  updateSection: (id: string, patch: { heading?: string; body?: string }) =>
    req<Section>(`/api/sections/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteSection: (id: string) => req(`/api/sections/${id}`, { method: 'DELETE' }),
  reorderSections: (docId: string, orderedIds: string[]) =>
    req<Section[]>(`/api/documents/${docId}/sections/reorder`, {
      method: 'POST',
      body: JSON.stringify({ orderedIds }),
    }),

  // context chain (P-01)
  parentContext: (id: string) =>
    req<{
      available: boolean;
      parentTitle?: string;
      parentType?: string;
      parentVersion?: number;
      sections?: { heading: string; body: string }[];
    }>(`/api/documents/${id}/context/parent`),
  refreshContext: (id: string) =>
    req<DocumentModel>(`/api/documents/${id}/context/refresh`, {
      method: 'POST',
      body: JSON.stringify({ mode: 'context-only' }),
    }),

  // versions (SPEC-12)
  versions: (id: string) => req<VersionEntry[]>(`/api/documents/${id}/versions`),
  restoreVersion: (docId: string, versionId: string) =>
    req<{ document: DocumentModel; sections: Section[] }>(
      `/api/documents/${docId}/versions/${versionId}/restore`,
      { method: 'POST' },
    ),

  // interview
  templates: () => req<InterviewTemplate[]>('/api/templates'),
  startInterview: (docId: string) =>
    req<{ session: InterviewSession; template: InterviewTemplate }>(
      `/api/documents/${docId}/interview`,
      { method: 'POST' },
    ),
  getInterview: (docId: string) =>
    req<{ session: InterviewSession | null; template: InterviewTemplate | null }>(
      `/api/documents/${docId}/interview`,
    ),
  answer: (
    sessionId: string,
    payload: { questionId: string; question: string; answer: string; currentIndex?: number },
  ) =>
    req<InterviewSession>(`/api/interview/${sessionId}/answer`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  completeInterview: (sessionId: string) =>
    req(`/api/interview/${sessionId}/complete`, { method: 'POST' }),

  // keys (SPEC-18)
  keys: () => req<KeyInfo[]>('/api/keys'),
  saveKey: (provider: ProviderId, key: string, label = '') =>
    req(`/api/keys/${provider}`, { method: 'PUT', body: JSON.stringify({ key, label }) }),
  deleteKey: (provider: ProviderId) => req(`/api/keys/${provider}`, { method: 'DELETE' }),
  testKey: (provider: ProviderId, model?: string) =>
    req<{ provider: string; ok: boolean; detail?: string }>(`/api/keys/${provider}/test`, {
      method: 'POST',
      body: JSON.stringify({ model }),
    }),

  // settings
  settings: () =>
    req<{ providerModels: ProviderModels; onboardingComplete: boolean }>('/api/settings'),
  saveModels: (models: ProviderModels) =>
    req(`/api/settings/models`, { method: 'PUT', body: JSON.stringify(models) }),
  completeOnboarding: () => req('/api/settings/onboarding/complete', { method: 'POST' }),

  // suggestions (신규 병렬 API — 계약 고정, 방어적 처리)
  suggestions: (docId: string, status = 'open') =>
    req<{ suggestions: Suggestion[] }>(
      `/api/documents/${docId}/suggestions?status=${encodeURIComponent(status)}`,
    ),
  acceptSuggestion: (id: string) => req(`/api/suggestions/${id}/accept`, { method: 'POST' }),
  rejectSuggestion: (id: string) => req(`/api/suggestions/${id}/reject`, { method: 'POST' }),
  rewriteSuggestion: (id: string, instruction: string) =>
    req<Suggestion>(`/api/suggestions/${id}/rewrite`, {
      method: 'POST',
      body: JSON.stringify({ instruction }),
    }),
  acceptAllSuggestions: (docId: string) =>
    req(`/api/documents/${docId}/accept-all`, { method: 'POST' }),

  // shares (SPEC-14)
  createShare: (docId: string, expiresInHours: number | null) =>
    req<ShareLink>(`/api/documents/${docId}/shares`, {
      method: 'POST',
      body: JSON.stringify({ expiresInHours }),
    }),
  listShares: (docId: string) => req<ShareLink[]>(`/api/documents/${docId}/shares`),
  revokeShare: (id: string) => req(`/api/shares/${id}/revoke`, { method: 'POST' }),
};

export interface GraphNode {
  id: string;
  type: DocumentType;
  title: string;
  status: string;
  contextStale: boolean;
}

export type ModelEntry = { provider?: ProviderId; model?: string; maxTokens?: number };
export type ProviderModels = {
  default?: ModelEntry;
  prd?: ModelEntry;
  'feature-spec'?: ModelEntry;
  ia?: ModelEntry;
  'user-flow'?: ModelEntry;
};

// ── SSE draft streaming ──────────────────────────────────────────────────────
export interface DraftHandlers {
  onSectionStart?: (d: { sectionId: string; heading: string; index: number; total: number }) => void;
  onToken?: (d: { sectionId: string; delta: string }) => void;
  onSectionEnd?: (d: { sectionId: string }) => void;
  onDone?: () => void;
  onError?: (msg: string) => void;
}

function streamSse(url: string, h: DraftHandlers): EventSource {
  const es = new EventSource(url);
  es.addEventListener('section_start', (e) => h.onSectionStart?.(JSON.parse((e as MessageEvent).data)));
  es.addEventListener('token', (e) => h.onToken?.(JSON.parse((e as MessageEvent).data)));
  es.addEventListener('section_end', (e) => h.onSectionEnd?.(JSON.parse((e as MessageEvent).data)));
  es.addEventListener('done', () => {
    h.onDone?.();
    es.close();
  });
  es.addEventListener('error', (e) => {
    const data = (e as MessageEvent).data;
    if (data) {
      try {
        h.onError?.(JSON.parse(data).message);
      } catch {
        h.onError?.('stream error');
      }
    }
    es.close();
  });
  return es;
}

export const streamDraft = (docId: string, h: DraftHandlers) =>
  streamSse(`/api/documents/${docId}/draft/stream`, h);

export const streamRegenerate = (sectionId: string, h: DraftHandlers) =>
  streamSse(`/api/sections/${sectionId}/regenerate/stream`, h);

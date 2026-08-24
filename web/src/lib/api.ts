// Typed client for the Drafting API. Same-origin in prod; vite proxies in dev.

export type DocumentType = 'prd' | 'feature-spec' | 'ia' | 'user-flow' | 'handoff';
export type ProviderId = 'anthropic' | 'openai' | 'openrouter';

// ── plan items (structure docs) ──────────────────────────────────────────────
export type PlanItemKind = 'feature-group' | 'feature' | 'page' | 'flow' | 'step';
export type PlanItemStatus = 'proposed' | 'accepted' | 'rejected';
export type Priority = 'P0' | 'P1' | 'P2';
export type PageType = 'LIST' | 'DETAIL' | 'FORM' | 'DASH' | 'SETTINGS' | 'GENERIC';
export interface PlanItemLinks {
  reqs?: string[];
  pages?: string[];
  flows?: string[];
  features?: string[];
}
export interface PlanItemMeta {
  priority?: Priority;
  page_type?: PageType;
  /** page-only: 사이트맵 계층 그룹(섹션) */
  section?: string;
  source?: string;
  links?: PlanItemLinks;
  page?: string | null;
  branch?: { label: string; from_step?: string } | null;
  note?: string;
  node?: 'start' | 'screen' | 'decision' | 'end';
}
export interface PlanItem {
  id: string;
  document_id: string;
  parent_id: string | null;
  kind: PlanItemKind;
  ref_id: string;
  position: number;
  title: string;
  body: string;
  meta: string; // JSON — parse with parseItemMeta
  status: PlanItemStatus;
}
export function parseItemMeta(i: PlanItem): PlanItemMeta {
  try {
    return JSON.parse(i.meta || '{}') as PlanItemMeta;
  } catch {
    return {};
  }
}

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
export type SuggestionKind = 'add' | 'revise' | 'delete' | 'question' | 'stale' | 'lint';

export interface Suggestion {
  id: string;
  // 백엔드는 snake_case 원행을 그대로 반환한다 (기존 계약). camel 별칭은 방어적.
  sectionId?: string;
  section_id?: string | null;
  target_item_id?: string | null;
  kind: SuggestionKind;
  title: string;
  body: string;
  quoteBefore?: string;
  quoteAfter?: string;
  quote_before?: string;
  quote_after?: string;
  source: string;
  status: string;
}

/** 백엔드 snake_case 원행 → 카드가 읽는 camel 별칭 채움 (hover 포커스·인용 비교에 필요). */
export function normalizeSuggestion(s: Suggestion): Suggestion {
  return {
    ...s,
    sectionId: s.sectionId ?? s.section_id ?? undefined,
    quoteBefore: s.quoteBefore ?? s.quote_before ?? undefined,
    quoteAfter: s.quoteAfter ?? s.quote_after ?? undefined,
  };
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
  source?: 'file' | 'custom' | 'override';
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
  aiMode: 'cli' | 'byok';
  cliAvailable: boolean;
  cliBin: string | null;
  agentBinPath?: string;
  openaiBaseUrl?: string;
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
  undo: (docId: string) =>
    req<{ document: DocumentModel; sections: Section[] }>(`/api/documents/${docId}/undo`, {
      method: 'POST',
    }),

  // interview
  templates: () => req<InterviewTemplate[]>('/api/templates'),
  saveTemplate: (t: InterviewTemplate) =>
    req<InterviewTemplate>(`/api/templates/${t.id}`, { method: 'PUT', body: JSON.stringify(t) }),
  deleteTemplate: (id: string) =>
    req<{ ok: boolean; reverted: InterviewTemplate | null }>(`/api/templates/${id}`, {
      method: 'DELETE',
    }),
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

  // engine mode (CLI vs BYOK)
  setAiMode: (mode: 'cli' | 'byok') =>
    req<{ aiMode: string }>('/api/settings/ai-mode', {
      method: 'PUT',
      body: JSON.stringify({ mode }),
    }),
  // OpenAI 호환 게이트웨이(LiteLLM 등) 엔드포인트 설정 — /v1 자동 감지 + 모델 목록 회신
  saveOpenaiEndpoint: (baseUrl: string, headers?: Record<string, string>) =>
    req<{ baseUrl: string; models: string[]; detected: string }>('/api/settings/openai-endpoint', {
      method: 'PUT',
      body: JSON.stringify({ baseUrl, headers }),
    }),
  // 저장된 게이트웨이에서 모델 목록 재조회 (드롭다운)
  openaiModels: () =>
    req<{ models: string[]; baseUrl: string }>('/api/settings/openai-models'),
  testCli: () =>
    req<{ ok: boolean; blocked?: boolean; detail?: string }>('/api/settings/cli/test', {
      method: 'POST',
    }),
  // CLI 경로 수동 지정(자동 탐색 실패 시). 빈 문자열이면 해제 → 자동 탐색 복귀.
  setAgentBin: (path: string) =>
    req<{ cliBin: string | null; cliAvailable: boolean }>('/api/settings/agent-bin', {
      method: 'PUT',
      body: JSON.stringify({ path }),
    }),

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

  // 워크스페이스 백업/복원 (전체 DB)
  backupHref: '/api/backup',
  restore: (base64: string) =>
    req<{ ok: boolean }>('/api/restore', { method: 'POST', body: JSON.stringify({ data: base64 }) }),

  // suggestions (신규 병렬 API — 계약 고정, 방어적 처리)
  suggestions: (docId: string, status = 'open') =>
    req<{ suggestions: Suggestion[] }>(
      `/api/documents/${docId}/suggestions?status=${encodeURIComponent(status)}`,
    ),
  acceptSuggestion: (id: string) => req(`/api/suggestions/${id}/accept`, { method: 'POST' }),
  rejectSuggestion: (id: string) => req(`/api/suggestions/${id}/reject`, { method: 'POST' }),
  // 응답은 { suggestion, section } 래퍼 — suggestion 만 꺼내 camel 정규화해 반환
  rewriteSuggestion: (id: string, instruction: string) =>
    req<{ suggestion: Suggestion }>(`/api/suggestions/${id}/rewrite`, {
      method: 'POST',
      body: JSON.stringify({ instruction }),
    }).then((r) => normalizeSuggestion(r.suggestion)),
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

  // ── plan items (structure docs — SPEC/IA/FLOW) ─────────────────────────────
  items: (docId: string) => req<{ items: PlanItem[] }>(`/api/documents/${docId}/items`),
  createItem: (
    docId: string,
    body: {
      kind: PlanItemKind;
      title: string;
      body?: string;
      meta?: PlanItemMeta;
      parentId?: string | null;
      status?: PlanItemStatus;
    },
  ) =>
    req<PlanItem>(`/api/documents/${docId}/items`, { method: 'POST', body: JSON.stringify(body) }),
  updateItem: (id: string, patch: { title?: string; body?: string; meta?: PlanItemMeta; position?: number }) =>
    req<PlanItem>(`/api/items/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteItem: (id: string) => req(`/api/items/${id}`, { method: 'DELETE' }),
  acceptItem: (id: string) => req<PlanItem>(`/api/items/${id}/accept`, { method: 'POST' }),
  rejectItem: (id: string) => req<PlanItem>(`/api/items/${id}/reject`, { method: 'POST' }),
  restoreItem: (id: string) => req<PlanItem>(`/api/items/${id}/restore`, { method: 'POST' }),
  // 범용 링크 편집 — 항목의 links.<field> 배열에 ref 추가/제거 (링크 위반 근본 해소)
  editLink: (itemId: string, field: 'reqs' | 'pages' | 'flows' | 'features', ref: string, op: 'add' | 'remove') =>
    req<PlanItem>(`/api/items/${itemId}/link`, {
      method: 'POST',
      body: JSON.stringify({ field, ref, op }),
    }),
  // 스텝의 화면(page) 지정/해제 — W-UNREACHED-PAGE 근본 해소
  setStepPage: (stepId: string, page: string | null) =>
    req<PlanItem>(`/api/items/${stepId}/step-page`, {
      method: 'POST',
      body: JSON.stringify({ page }),
    }),
  // 페이지의 섹션(사이트맵 계층) 지정/해제 — 빈 문자열이면 최상위로
  setSection: (pageId: string, section: string) =>
    req<PlanItem>(`/api/items/${pageId}/section`, {
      method: 'POST',
      body: JSON.stringify({ section }),
    }),
  projectReqs: (pid: string) =>
    req<{ reqs: Array<{ id: string; heading: string; sectionId: string }> }>(`/api/projects/${pid}/reqs`),
  // 플로우 ↔ 기능 연결 (W-NO-FLOW 근본 해소)
  linkFeatureToFlow: (flowId: string, featureRef: string) =>
    req<PlanItem>(`/api/items/${flowId}/link-feature`, {
      method: 'POST',
      body: JSON.stringify({ featureRef }),
    }),
  unlinkFeatureFromFlow: (flowId: string, featureRef: string) =>
    req<PlanItem>(`/api/items/${flowId}/unlink-feature`, {
      method: 'POST',
      body: JSON.stringify({ featureRef }),
    }),

  // ── project deliverables ───────────────────────────────────────────────────
  lint: (pid: string) => req<LintReport>(`/api/projects/${pid}/lint`),
  lintSuggest: (pid: string) =>
    req<{ created: number; report: LintReport }>(`/api/projects/${pid}/lint/suggest`, {
      method: 'POST',
    }),
  // 모든 위반을 비파괴적으로 무시(waive) — 항목·본문 보존, 게이트만 통과
  lintWaiveAll: (pid: string) =>
    req<{ waived: number; report: LintReport }>(`/api/projects/${pid}/lint/waive-all`, {
      method: 'POST',
    }),
  // 위반 하나를 키로 무시 (인라인 배지에서)
  lintWaiveOne: (pid: string, key: string) =>
    req<{ waived: boolean; report: LintReport }>(`/api/projects/${pid}/lint/waive`, {
      method: 'POST',
      body: JSON.stringify({ key }),
    }),
  wireframes: (pid: string) => req<{ wireframes: Wireframe[] }>(`/api/projects/${pid}/wireframes`),
  // StyleGuide(테마) — 와이어프레임/시안 공용 스타일
  styleGuide: (pid: string) =>
    req<{ guide: StyleGuide; render: { fontStack: string; gap: number }; presets: string[] }>(
      `/api/projects/${pid}/style-guide`,
    ),
  saveStyleGuide: (pid: string, patch: Partial<StyleGuide>) =>
    req<{ guide: StyleGuide; render: { fontStack: string; gap: number } }>(`/api/projects/${pid}/style-guide`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  // AI 시안(mockup) — 페이지당 자기완결 HTML, 제안 문법
  mockups: (pid: string) =>
    req<{ mockups: Array<{ pageRef: string; status: 'proposed' | 'accepted'; styleKey: string | null }> }>(
      `/api/projects/${pid}/mockups`,
    ),
  mockup: (pid: string, ref: string) =>
    req<MockupData>(`/api/projects/${pid}/mockups/${ref}`),
  generateMockup: (itemId: string) => req<MockupData>(`/api/items/${itemId}/mockup`, { method: 'POST' }),
  acceptMockup: (itemId: string) =>
    req<{ pageRef: string; status: string }>(`/api/items/${itemId}/mockup/accept`, { method: 'POST' }),
  rejectMockup: (itemId: string) => req<{ ok: boolean }>(`/api/items/${itemId}/mockup/reject`, { method: 'POST' }),
  compileHandoff: (pid: string) =>
    req<{ documentId: string; report: LintReport }>(`/api/projects/${pid}/handoff`, {
      method: 'POST',
    }),
  promptPackHref: (pid: string) => `/api/projects/${pid}/handoff/prompt-pack`,
  hub: (pid: string) => req<HubSnapshot>(`/api/projects/${pid}/hub`),
  sampleDeliverables: () =>
    req<{ projectId: string; created: boolean }>('/api/sample/deliverables', { method: 'POST' }),
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

// ── deliverables types ────────────────────────────────────────────────────────
export interface LintViolation {
  code: string;
  message: string;
  refs: string[];
  severity: 'E' | 'W';
  key?: string;
  waived?: boolean;
}
export interface LintReport {
  violations: LintViolation[];
  effectiveCount: number;
  waivedCount: number;
  gatePasses: boolean;
}
export interface WfSeed {
  search?: string;
  rows?: Array<{ title: string; meta: string; action: string; hot?: string }>;
  slots?: Array<{ label: string; state: 'on' | 'off' | 'dis' | 'idle' }>;
  detailTitle?: string;
  cta?: string;
  fields?: Array<{ label: string; value: string }>;
  stats?: Array<{ value: string; label: string }>;
  bars?: number[];
  toggles?: Array<{ label: string; on: boolean }>;
  blocks?: string[];
}
export interface Wireframe {
  ref: string;
  itemId: string;
  title: string;
  pageType: PageType;
  status: 'accepted' | 'proposed';
  featureRefs: string[];
  flowRefs: string[];
  hotspot: { toPage: string; label: string } | null;
  lintWarning: string | null;
  seed: WfSeed;
}
export interface StyleGuide {
  preset: string;
  accent: string;
  bg: string;
  surface: string;
  ink: string;
  sub: string;
  line: string;
  radius: number;
  density: 'compact' | 'cozy' | 'spacious';
  font: 'sans' | 'serif' | 'rounded' | 'mono';
  mode: 'light' | 'dark';
}
export interface MockupData {
  pageRef: string;
  status: 'proposed' | 'accepted';
  styleKey: string | null;
  html: string;
}
export interface DocRollup {
  accepted: number;
  proposed: number;
  total: number;
  documentId: string | null;
  stale?: boolean;
  openSuggestions?: number;
  status?: string | null;
}
export interface HubNextAction {
  kind: 'create' | 'review' | 'stale' | 'lint' | 'handoff' | 'done';
  label: string;
  detail: string;
  documentId: string | null;
  target: 'document' | 'handoff' | 'none';
}
export interface HubSnapshot {
  perDoc: Record<'prd' | 'feature-spec' | 'ia' | 'user-flow', DocRollup>;
  lint: LintReport;
  nextAction?: HubNextAction;
  derived: {
    wireframes: { count: number };
    handoff: { compiled: boolean; documentId: string | null; locked: boolean; blocking: number };
  };
}

// ── SSE structure-item generation ─────────────────────────────────────────────
export interface ItemStreamHandlers {
  onItem?: (item: PlanItem) => void;
  onDone?: (count: number) => void;
  onError?: (msg: string) => void;
}
export function streamItems(docId: string, h: ItemStreamHandlers): EventSource {
  const es = new EventSource(`/api/documents/${docId}/items/generate/stream`);
  es.addEventListener('item', (e) => h.onItem?.(JSON.parse((e as MessageEvent).data).item));
  es.addEventListener('done', (e) => {
    try {
      h.onDone?.(JSON.parse((e as MessageEvent).data).count ?? 0);
    } catch {
      h.onDone?.(0);
    }
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

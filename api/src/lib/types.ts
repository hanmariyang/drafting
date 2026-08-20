export type DocumentType = 'prd' | 'feature-spec' | 'ia' | 'user-flow';
export type DocumentStatus = 'draft' | 'streaming' | 'ready';
export type ProviderId = 'anthropic' | 'openai' | 'openrouter';
export type VersionEvent = 'save' | 'context_inherit' | 'restore';

// AI proposal model (SYSTEM.md §0). Sections are 'proposed' until accepted.
export type SectionStatus = 'proposed' | 'accepted' | 'rejected';
export type SuggestionKind = 'add' | 'revise' | 'delete' | 'question' | 'stale';
export type SuggestionStatus = 'open' | 'accepted' | 'rejected' | 'dismissed';

export interface Project {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface Document {
  id: string;
  project_id: string;
  type: DocumentType;
  title: string;
  status: DocumentStatus;
  parent_document_id: string | null;
  version: number;
  context_stale: number;
  context_source_version: number | null;
  context_pending_version: number | null;
  created_at: string;
  updated_at: string;
}

export interface Section {
  id: string;
  document_id: string;
  position: number;
  heading: string;
  body: string;
  status: SectionStatus;
  created_at: string;
  updated_at: string;
}

export interface Suggestion {
  id: string;
  document_id: string;
  section_id: string | null;
  kind: SuggestionKind;
  title: string;
  body: string;
  quote_before: string;
  quote_after: string;
  source: string;
  status: SuggestionStatus;
  created_at: string;
  resolved_at: string | null;
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
  created_at: string;
  updated_at: string;
}

export interface DocumentSnapshot {
  title: string;
  sections: Array<{ heading: string; body: string; position: number }>;
}

// ── interview templates (external, file/DB-loaded — G-06) ──────────────────
export interface TemplateQuestion {
  id: string;
  prompt: string;
  hint?: string;
  example?: string;
}

export interface InterviewTemplate {
  id: string; // stable id, == document type by convention
  docType: DocumentType;
  name: string;
  description: string;
  questions: TemplateQuestion[];
  /** default section headings the draft should produce, in order */
  sections: string[];
  /** system prompt fragment describing this document's purpose */
  draftGuidance: string;
}

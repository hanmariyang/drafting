-- PlanForge schema (SQLite / node:sqlite). Applied idempotently on boot.
-- Data model: Project · Document · Section · InterviewSession (+ supporting tables).

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Documents form a chain: PRD -> feature-spec -> ia -> user-flow (parent_document_id).
CREATE TABLE IF NOT EXISTS documents (
  id                      TEXT PRIMARY KEY,
  project_id              TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type                    TEXT NOT NULL,                       -- prd | feature-spec | ia | user-flow
  title                   TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'draft',       -- draft | streaming | ready
  parent_document_id      TEXT REFERENCES documents(id) ON DELETE SET NULL,
  version                 INTEGER NOT NULL DEFAULT 0,          -- bumps on save/regenerate/restore
  context_stale           INTEGER NOT NULL DEFAULT 0,          -- 1 = parent changed, needs refresh (P-01)
  context_source_version  INTEGER,                             -- parent version last inherited
  context_pending_version INTEGER,                             -- parent version awaiting inheritance
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id);
CREATE INDEX IF NOT EXISTS idx_documents_parent  ON documents(parent_document_id);

CREATE TABLE IF NOT EXISTS sections (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  heading     TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  -- AI-authored content is always a PROPOSAL until accepted (SYSTEM.md §0.1).
  -- Only 'accepted' sections are documents / appear in exports & shares (§0.2).
  status      TEXT NOT NULL DEFAULT 'proposed',  -- proposed | accepted | rejected
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sections_document ON sections(document_id);

-- AI suggestions (proposals). Every proposal carries a source/basis (§0.3) and
-- is handled 3 ways: accept / reject / rewrite (§0.4). A suggestion may target a
-- section, or the whole document (section_id NULL — e.g. a "missing" question).
CREATE TABLE IF NOT EXISTS suggestions (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  section_id  TEXT REFERENCES sections(id) ON DELETE CASCADE,   -- nullable = document-level
  kind        TEXT NOT NULL,          -- add | revise | delete | question | stale
  title       TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',   -- human explanation
  quote_before TEXT NOT NULL DEFAULT '',  -- current text (revise/delete)
  quote_after  TEXT NOT NULL DEFAULT '',  -- proposed text (add/revise)
  source      TEXT NOT NULL DEFAULT '',   -- basis: "Q3" | "PRD §2" | "사용자 지시: …"
  status      TEXT NOT NULL DEFAULT 'open',  -- open | accepted | rejected | dismissed
  created_at  TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_suggestions_document ON suggestions(document_id);
CREATE INDEX IF NOT EXISTS idx_suggestions_section  ON suggestions(section_id);
CREATE INDEX IF NOT EXISTS idx_suggestions_status   ON suggestions(document_id, status);

CREATE TABLE IF NOT EXISTS interview_sessions (
  id            TEXT PRIMARY KEY,
  document_id   TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  template_id   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',   -- active | complete
  current_index INTEGER NOT NULL DEFAULT 0,
  answers       TEXT NOT NULL DEFAULT '[]',       -- JSON [{questionId, question, answer}]
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_document ON interview_sessions(document_id);

-- BYOK keys — stored ENCRYPTED only (AES-256-GCM). Never plaintext (G-01).
CREATE TABLE IF NOT EXISTS api_keys (
  id         TEXT PRIMARY KEY,
  provider   TEXT NOT NULL UNIQUE,   -- anthropic | openai | openrouter
  label      TEXT NOT NULL DEFAULT '',
  ciphertext TEXT NOT NULL,          -- base64
  iv         TEXT NOT NULL,          -- base64
  auth_tag   TEXT NOT NULL,          -- base64
  last4      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS document_versions (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  event_type  TEXT NOT NULL,          -- save | context_inherit | restore
  snapshot    TEXT NOT NULL,          -- JSON {title, sections:[{heading,body,position}]}
  meta        TEXT NOT NULL DEFAULT '{}',
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_versions_document ON document_versions(document_id);

CREATE TABLE IF NOT EXISTS share_links (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  expires_at  TEXT,                   -- ISO 8601, NULL = never
  revoked     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_share_token ON share_links(token);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,           -- JSON
  updated_at TEXT NOT NULL
);

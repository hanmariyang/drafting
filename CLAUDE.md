# Drafting — Repository Guide

> Self-hosted AI planning workspace. One idea line starts an interview; PRD, feature spec and IA follow — every AI sentence arrives as a suggestion, and only what you accept becomes the document. MIT.

## Overview

- **Grammar first**: AI output is always `proposed`; accepting a suggestion is the only way text becomes the document. Exports/share links contain accepted sections only. Every suggestion carries a `source` (interview answer, parent doc clause, or a user rewrite instruction).
- **Document chain**: `interview → PRD → feature-spec → IA / user-flow`. Children inherit parent context; upstream edits mark children stale and re-propose — never overwrite (G-02).
- **Entry structure**: no home dashboard. Start screen (idea line → interview) when needed, restore-to-last-document landing (Settings), project switcher in the nav, ⌘N new-plan sheet.

## Architecture

Single repo: `api/` (Fastify, Node ≥ 22, `node:sqlite`, SSE streaming) + `web/` (Vite + React) + `db/schema.sql` (idempotent) + `docs/` (GitHub Pages landing) + `design/SYSTEM.md` (design-system canon — every screen follows it).

All AI calls go through `api/src/providers/` (`resolveProvider` is the single gate). `AI_STUB=1` gives a deterministic offline provider for tests/demo.

## Development

```bash
npm install
npm run dev          # api :8080 + web :5173 (vite proxies /api, /s)
npm test             # api node:test suite — contract-enforcing
npm run build && npm start
# or: docker compose up -d   → http://localhost:8477
```

## Conventions & cautions

- **Never store BYOK keys in plaintext** — AES-256-GCM via `APP_ENCRYPTION_KEY`; a test enforces it. Keep that test.
- **Never auto-overwrite child documents** on parent change — stale flag + re-proposal only.
- Design tokens live in `web/src/styles/tokens.css` (1:1 with `design/SYSTEM.md`); no hex hardcoding in component CSS. Suggestion green is a state color, not decoration. No emoji icons, no left accent bars.
- Product name renders from the web `AppName` component — change it in one place.
- No secrets, tokens, or user-specific paths in the repo — configuration is env-only (`.env.example`).

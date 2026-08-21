import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as repo from '../db/repos.ts';
import { HttpError, parse } from './helpers.ts';
import { rewriteSection } from '../lib/ai.ts';
import { applyLintFixByKey } from '../lib/lint-service.ts';
import type { Suggestion } from '../lib/types.ts';

const SUG_STATUSES = ['open', 'accepted', 'rejected', 'dismissed'] as const;

export async function suggestionRoutes(app: FastifyInstance): Promise<void> {
  // ── document proposal queue (green dots / review panel) ──────────────────────
  app.get('/api/documents/:id/suggestions', async (req) => {
    const { id } = req.params as { id: string };
    if (!repo.getDocument(id)) throw new HttpError(404, 'document not found');
    const q = parse(
      z.object({ status: z.enum(SUG_STATUSES).optional() }),
      (req.query as unknown) ?? {},
    );
    return repo.listSuggestions(id, q.status);
  });

  // ── accept a suggestion (SYSTEM.md §0.4 — 1st option) ────────────────────────
  // Section becomes 'accepted'. For a 'revise', the proposed text (quote_after)
  // is already the section body; accept just confirms it.
  app.post('/api/suggestions/:id/accept', async (req) => {
    const { id } = req.params as { id: string };
    const sug = repo.getSuggestion(id);
    if (!sug) throw new HttpError(404, 'suggestion not found');
    applyAccept(sug);
    const resolved = repo.resolveSuggestion(id, 'accepted');
    return {
      suggestion: resolved,
      section: sug.section_id ? repo.getSection(sug.section_id) : null,
    };
  });

  // ── reject a suggestion (SYSTEM.md §0.4 — 2nd option) ────────────────────────
  // add    -> section 'rejected' (body kept, excluded from export)
  // revise -> restore the ORIGINAL text (quote_before), section back to accepted
  app.post('/api/suggestions/:id/reject', async (req) => {
    const { id } = req.params as { id: string };
    const sug = repo.getSuggestion(id);
    if (!sug) throw new HttpError(404, 'suggestion not found');
    applyReject(sug);
    const resolved = repo.resolveSuggestion(id, 'rejected');
    return {
      suggestion: resolved,
      section: sug.section_id ? repo.getSection(sug.section_id) : null,
    };
  });

  // ── rewrite from a user instruction (SYSTEM.md §0.4 — 3rd option) ─────────────
  // Runs the provider (stub-capable), replaces the section with a fresh proposal,
  // resolves this suggestion as 'dismissed', and returns the NEW suggestion.
  app.post('/api/suggestions/:id/rewrite', async (req) => {
    const { id } = req.params as { id: string };
    const sug = repo.getSuggestion(id);
    if (!sug) throw new HttpError(404, 'suggestion not found');
    if (!sug.section_id) {
      throw new HttpError(400, 'this suggestion is not tied to a section and cannot be rewritten');
    }
    const body = parse(z.object({ instruction: z.string().min(1) }), req.body);
    const result = await rewriteSection(sug.section_id, body.instruction);
    if (!result) throw new HttpError(404, 'section not found');
    repo.resolveSuggestion(id, 'dismissed');
    return { suggestion: result.suggestion, section: result.section };
  });

  // ── accept all open suggestions in a document ────────────────────────────────
  app.post('/api/documents/:id/accept-all', async (req) => {
    const { id } = req.params as { id: string };
    const doc = repo.getDocument(id);
    if (!doc) throw new HttpError(404, 'document not found');
    const open = repo.listSuggestions(id, 'open');
    // 파괴적 제안(lint 정리 = 대상 항목 제외, delete = 섹션 제외)은 일괄 수락에서
    // 제외한다 — 정합성 지적을 '모두 수락'하면 지적된 항목이 통째로 사라지는 사고 방지.
    // 파괴적 제안은 카드에서 개별적으로만 수락할 수 있다.
    const safe = open.filter((s) => s.kind !== 'lint' && s.kind !== 'delete');
    for (const sug of safe) {
      applyAccept(sug);
      repo.resolveSuggestion(sug.id, 'accepted');
    }
    // Accepting all resolves a stale document (context is now reviewed).
    if (doc.context_stale === 1 && repo.countOpenSuggestions(id) === 0) {
      repo.refreshContext(id);
    }
    return {
      accepted: safe.length,
      skippedDestructive: open.length - safe.length,
      sections: repo.listSections(id),
      openRemaining: repo.countOpenSuggestions(id),
    };
  });
}

function applyAccept(sug: Suggestion): void {
  // lint suggestion accepted -> apply the code's default remediation (§4.2)
  if (sug.kind === 'lint') {
    const doc = repo.getDocument(sug.document_id);
    if (doc && sug.quote_before) applyLintFixByKey(doc.project_id, sug.quote_before);
    return;
  }
  // structure-doc item proposal accepted -> the item becomes the document (§1.3)
  if (sug.target_item_id) {
    repo.setItemStatus(sug.target_item_id, 'accepted');
    return;
  }
  if (!sug.section_id) return; // document-level (e.g. question/stale) — nothing to flip
  const section = repo.getSection(sug.section_id);
  if (!section) return;
  if (sug.kind === 'delete') {
    // a delete proposal, once accepted, excludes the section from the document
    repo.setSectionStatus(section.id, 'rejected');
    return;
  }
  // add / revise / question / stale -> the (proposed) body becomes the document
  repo.setSectionStatus(section.id, 'accepted');
}

function applyReject(sug: Suggestion): void {
  // lint suggestion rejected = waive (§4.3) — nothing to mutate; the rejected
  // status itself records the waive (read by lint-service.waivedKeys).
  if (sug.kind === 'lint') return;
  // structure-doc item proposal rejected -> the item is excluded from the document
  if (sug.target_item_id) {
    repo.setItemStatus(sug.target_item_id, 'rejected');
    return;
  }
  if (!sug.section_id) return;
  const section = repo.getSection(sug.section_id);
  if (!section) return;
  if (sug.kind === 'revise' && sug.quote_before) {
    // keep the original text (SYSTEM.md §0.4): revert body, re-accept the section
    repo.updateSection(section.id, { body: sug.quote_before });
    repo.setSectionStatus(section.id, 'accepted');
    return;
  }
  if (sug.kind === 'add') {
    // reject an added section: body kept but excluded from export
    repo.setSectionStatus(section.id, 'rejected');
    return;
  }
  // delete/question/stale rejected -> leave the section as-is
}

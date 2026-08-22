import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as repo from '../db/repos.ts';
import { HttpError, parse, sseStream } from './helpers.ts';
import { listTemplates, getTemplate, getTemplateForType } from '../lib/templates.ts';
import { streamDocumentDraft, streamSectionRegeneration } from '../lib/ai.ts';
import type { DraftEvent } from '../lib/ai.ts';

export async function interviewRoutes(app: FastifyInstance): Promise<void> {
  // ── templates (SPEC-01/02) ──────────────────────────────────────────────────
  app.get('/api/templates', async () => listTemplates());
  app.get('/api/templates/:id', async (req) => {
    const { id } = req.params as { id: string };
    const t = getTemplate(id);
    if (!t) throw new HttpError(404, 'template not found');
    return t;
  });

  // ── interview session (SPEC-03 autosave/resume) ─────────────────────────────
  app.get('/api/documents/:id/interview', async (req) => {
    const { id } = req.params as { id: string };
    const doc = repo.getDocument(id);
    if (!doc) throw new HttpError(404, 'document not found');
    const session = repo.getSessionByDocument(id);
    const template = getTemplateForType(doc.type);
    return { session, template };
  });

  // create (or return existing) session for a document
  app.post('/api/documents/:id/interview', async (req) => {
    const { id } = req.params as { id: string };
    const doc = repo.getDocument(id);
    if (!doc) throw new HttpError(404, 'document not found');
    const template = getTemplateForType(doc.type);
    if (!template) throw new HttpError(400, `no interview template for type ${doc.type}`);
    let session = repo.getSessionByDocument(id);
    if (!session) session = repo.createSession(id, template.id);
    return { session, template };
  });

  // autosave a single answer + progress index (SPEC-03)
  app.post('/api/interview/:sid/answer', async (req) => {
    const { sid } = req.params as { sid: string };
    const session = repo.getSession(sid);
    if (!session) throw new HttpError(404, 'session not found');
    const body = parse(
      z.object({
        questionId: z.string(),
        question: z.string(),
        answer: z.string(),
        currentIndex: z.number().int().nonnegative().optional(),
      }),
      req.body,
    );
    const answers = [...session.answers];
    const existing = answers.findIndex((a) => a.questionId === body.questionId);
    const entry = { questionId: body.questionId, question: body.question, answer: body.answer };
    if (existing >= 0) answers[existing] = entry;
    else answers.push(entry);
    return repo.updateSession(sid, {
      answers,
      current_index: body.currentIndex ?? session.current_index,
    });
  });

  app.post('/api/interview/:sid/complete', async (req) => {
    const { sid } = req.params as { sid: string };
    const session = repo.getSession(sid);
    if (!session) throw new HttpError(404, 'session not found');
    return repo.updateSession(sid, { status: 'complete' });
  });

  // ── draft streaming (SPEC-06, SSE) ──────────────────────────────────────────
  // GET so it works with EventSource. Streams the whole document draft.
  app.get('/api/documents/:id/draft/stream', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!repo.getDocument(id)) throw new HttpError(404, 'document not found');
    await pipeDraft((signal) => streamDocumentDraft(id, signal), req, reply);
  });

  // regenerate a single section (SPEC-07, SSE)
  app.get('/api/sections/:sid/regenerate/stream', async (req, reply) => {
    const { sid } = req.params as { sid: string };
    if (!repo.getSection(sid)) throw new HttpError(404, 'section not found');
    await pipeDraft((signal) => streamSectionRegeneration(sid, signal), req, reply);
  });
}

async function pipeDraft(
  makeGen: (signal: AbortSignal) => AsyncGenerator<DraftEvent>,
  req: Parameters<typeof sseStream>[0],
  reply: Parameters<typeof sseStream>[1],
): Promise<void> {
  const sse = sseStream(req, reply);
  // 클라이언트가 '중지'로 연결을 끊으면 signal 이 abort 되어 provider 호출까지 멈춘다(토큰 절약).
  const gen = makeGen(sse.signal);
  try {
    for await (const evt of gen) {
      const { type, ...rest } = evt;
      sse.send(type, rest);
      if (evt.type === 'done' || evt.type === 'error') break;
    }
  } catch (e) {
    sse.send('error', { message: (e as Error).message });
  } finally {
    sse.end();
  }
}

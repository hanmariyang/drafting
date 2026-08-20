import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './lib/config.ts';
import { getDb } from './db/index.ts';
import { getMasterKey } from './lib/crypto.ts';
import { loadTemplates } from './lib/templates.ts';
import { HttpError } from './routes/helpers.ts';
import { projectRoutes } from './routes/projects.ts';
import { documentRoutes } from './routes/documents.ts';
import { interviewRoutes } from './routes/interview.ts';
import { suggestionRoutes } from './routes/suggestions.ts';
import { keyRoutes } from './routes/keys.ts';
import { settingsRoutes } from './routes/settings.ts';
import { shareRoutes } from './routes/share.ts';

export async function buildServer() {
  // fail fast on infra: db schema applied, master key resolvable, templates loaded
  getDb();
  getMasterKey();
  loadTemplates();

  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
  await app.register(cors, { origin: true });

  // Tolerate empty bodies on POST/PUT/DELETE that carry an application/json
  // content-type but no payload (browsers set the header even with no body).
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body, done) => {
      const text = (body as string).trim();
      if (!text) return done(null, undefined);
      try {
        done(null, JSON.parse(text));
      } catch (err) {
        (err as { statusCode?: number }).statusCode = 400;
        done(err as Error, undefined);
      }
    },
  );

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) {
      reply.code(err.status).send({ error: err.message });
      return;
    }
    app.log.error(err);
    reply.code(500).send({ error: (err as Error)?.message ?? 'internal error' });
  });

  await app.register(projectRoutes);
  await app.register(documentRoutes);
  await app.register(interviewRoutes);
  await app.register(suggestionRoutes);
  await app.register(keyRoutes);
  await app.register(settingsRoutes);
  await app.register(shareRoutes);

  app.get('/api/health', async () => ({ ok: true, version: config.version }));

  // serve the built SPA in production (dev uses the vite server)
  if (fs.existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: config.webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api') || req.url.startsWith('/s/')) {
        reply.code(404).send({ error: 'not found' });
        return;
      }
      reply.type('text/html').send(fs.readFileSync(path.join(config.webDist, 'index.html')));
    });
  }

  return app;
}

// only start when run directly (tests import buildServer without listening)
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const app = await buildServer();
  try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info(`Drafting listening on http://${config.host}:${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

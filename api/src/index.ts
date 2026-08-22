import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
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
import { deliverableRoutes } from './routes/deliverables.ts';
import { keyRoutes } from './routes/keys.ts';
import { settingsRoutes } from './routes/settings.ts';
import { shareRoutes } from './routes/share.ts';
import { backupRoutes } from './routes/backup.ts';

export async function buildServer() {
  // fail fast on infra: db schema applied, master key resolvable, templates loaded
  getDb();
  getMasterKey();
  loadTemplates();

  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
  // 보안: 기본은 same-origin(교차 오리진 차단) — 무인증 로컬 API 를 악성 페이지의
  // CSRF·데이터 유출(/api/backup 등)로부터 보호. 리버스 프록시 구성은 env 로 허용 오리진 지정.
  await app.register(cors, {
    origin: config.allowOrigins.length ? config.allowOrigins : false,
  });

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
  await app.register(deliverableRoutes);
  await app.register(keyRoutes);
  await app.register(settingsRoutes);
  await app.register(shareRoutes);
  await app.register(backupRoutes);

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
const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
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

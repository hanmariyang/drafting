import type { FastifyInstance } from 'fastify';
import * as repo from '../db/repos.ts';
import { documentToHtml } from '../lib/render.ts';
import { isExpired } from './documents.ts';

// Public, read-only share view (SPEC-14). No auth — bearer is the token itself.
export async function shareRoutes(app: FastifyInstance): Promise<void> {
  app.get('/s/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const link = repo.getShareByToken(token);
    reply.header('Content-Type', 'text/html; charset=utf-8');

    if (!link || link.revoked === 1) {
      reply.code(404);
      return notice('링크를 찾을 수 없습니다', '이 공유 링크는 존재하지 않거나 취소되었습니다.');
    }
    if (isExpired(link.expires_at)) {
      reply.code(410);
      return notice('만료된 링크', '이 공유 링크는 만료되었습니다. 문서 소유자에게 새 링크를 요청하세요.');
    }
    const doc = repo.getDocument(link.document_id);
    if (!doc) {
      reply.code(404);
      return notice('문서 없음', '공유된 문서가 삭제되었습니다.');
    }
    return documentToHtml(doc.id, { readOnly: true });
  });
}

function notice(title: string, message: string): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  :root { color-scheme: light dark; }
  body { display: grid; place-items: center; min-height: 100vh; margin: 0;
    font: 16px/1.6 -apple-system, "Pretendard", system-ui, sans-serif; background: #131315; color: #e7e7ea; }
  .card { text-align: center; padding: 2rem; }
  h1 { font-size: 1.4rem; margin-bottom: 0.5rem; }
  p { color: #9a9aa0; }
</style></head>
<body><div class="card"><h1>${title}</h1><p>${message}</p></div></body></html>`;
}

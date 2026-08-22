import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, parse } from './helpers.ts';
import { backupBytes, restoreFromBytes } from '../db/index.ts';

/**
 * 워크스페이스 백업/복원 (v0.5 데이터 안전). 전체 DB 파일을 스냅샷으로 내려받고,
 * 검증 후 통째로 복원한다. 복원은 파괴적이므로 프론트에서 확인을 받는다.
 */
export async function backupRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/backup', async (_req, reply) => {
    const bytes = backupBytes();
    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Disposition', 'attachment; filename="drafting-backup.sqlite"');
    return reply.send(bytes);
  });

  // 파일은 base64 로 받는다(멀티파트 의존성 회피). 라우트 한정 바디 상한 상향.
  app.post('/api/restore', { bodyLimit: 256 * 1024 * 1024 }, async (req) => {
    const { data } = parse(z.object({ data: z.string().min(1) }), req.body);
    const buf = Buffer.from(data, 'base64');
    if (buf.length < 100) throw new HttpError(400, '백업 파일이 비었거나 손상되었습니다');
    restoreFromBytes(buf);
    return { ok: true };
  });
}

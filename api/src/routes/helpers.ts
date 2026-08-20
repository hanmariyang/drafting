import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const msg = result.error.issues
      .map((i) => `${i.path.join('.') || '(body)'}: ${i.message}`)
      .join('; ');
    throw new HttpError(400, msg);
  }
  return result.data;
}

/**
 * Set up a Server-Sent Events stream on the raw response and return a writer.
 * Wires an AbortController to the client disconnect so upstream AI calls stop.
 */
export function sseStream(request: FastifyRequest, reply: FastifyReply) {
  // take over the socket so Fastify does not also try to send a reply
  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const controller = new AbortController();
  request.raw.on('close', () => controller.abort());

  return {
    signal: controller.signal,
    send(event: string, data: unknown) {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    },
    end() {
      reply.raw.end();
    },
  };
}

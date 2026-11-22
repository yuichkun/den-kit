// How the usage receiver answers a request (worker.ts): only POST /events with a body that den-kit's
// desktop app sends (desktop/analytics.ts), whose records it keeps in D1 (store.ts). Of a request
// it reads only the method, the path, the content type and the body, and of the body it keeps
// only the records: never the address the request came from.
import { dayOf } from './days.ts';
import { parse } from './records.ts';
import { DAILY_RECORDS, keep, taken, type D1Database } from './store.ts';

export interface Env {
  DB: D1Database;
}
/** The largest body taken: a full batch with every field at its longest fits with room to spare. */
export const MAX_BODY = 64 * 1024;

/**
 * Answers one request received at `now`. The app sends a batch again later when the answer is 408,
 * 429 or 5xx, and drops it for any other 4xx (desktop/analytics.ts).
 */
export async function receive(request: Request, env: Env, now: Date): Promise<Response> {
  if (new URL(request.url).pathname !== '/events') return reply(404);
  if (request.method !== 'POST') return reply(405, { allow: 'POST' });
  if (!/^application\/json\s*(?:;|$)/i.test(request.headers.get('content-type') ?? ''))
    return reply(415);
  const body = await read(request, MAX_BODY);
  if (body === null) return reply(413);
  const today = dayOf(now);
  const batch = parse(body, today);
  if (!batch) return reply(400);
  try {
    if ((await taken(env.DB, today)) >= DAILY_RECORDS) return reply(429);
    await keep(env.DB, batch, now);
  } catch {
    return reply(503);
  }
  return reply(204);
}

/** The body as text, or null when it is longer than `max` bytes. */
async function read(request: Request, max: number): Promise<string | null> {
  if (Number(request.headers.get('content-length')) > max) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function reply(status: number, headers?: Record<string, string>) {
  return new Response(null, { status, headers });
}

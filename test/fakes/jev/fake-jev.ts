// Fake Jev (TypeSafe System One) for tests and the cloud: an HTTP server that
// validates requests as strictly as the documented API and can inject faults.
// The real service is never called from the cloud.
import { createServer, type Server } from 'node:http';

export type FakeQuestion = { type: string; instructions: unknown; criteria?: unknown };
export type Answerer = (id: string, question: FakeQuestion, state: unknown) => unknown;
export interface Fault {
  status?: number;
  retryAfter?: string;
  delayMs?: number;
  /** Raw body to send instead of the computed answers. */
  body?: string;
  /** Rewrite the computed answers (e.g. NaN probabilities, missing keys). */
  mutate?: (answers: Record<string, unknown>) => Record<string, unknown>;
  /** Close the socket without answering. */
  hangUp?: boolean;
  model?: string;
}
export interface FakeJevRequest { at: number; auth: string | undefined; body: unknown; error?: string }

export interface FakeJev {
  readonly url: string;
  readonly requests: FakeJevRequest[];
  /** Faults are consumed one per request, in order. */
  faults: Fault[];
  answerer: Answerer;
  key: string;
  latencyMs: number;
  close(): Promise<void>;
}

const tokens = (value: unknown) => Math.ceil(JSON.stringify(value ?? '').length / 4);
const MODELS = new Set(['jev-1.13.0', 'jev-latest']);

/** Deterministic default: noul 0.9; choice picks the first criteria key; score picks the middle level. */
export const defaultAnswerer: Answerer = (_id, q) => {
  if (q.type === 'noul') return { type: 'noul', noul: 0.9 };
  if (q.type === 'choice') {
    const keys = Object.keys(q.criteria as Record<string, unknown>);
    const probabilities = Object.fromEntries(keys.map((k, i) => [k, i === 0 ? 0.9 : 0.1 / Math.max(1, keys.length - 1)]));
    return { type: 'choice', choice: keys[0], probabilities, confidence: 0.9 };
  }
  const levels = (q.criteria as unknown[]).length;
  const score = Math.floor((levels - 1) / 2);
  const probabilities = Array.from({ length: levels }, (_, i) => i === score ? 0.8 : 0.2 / (levels - 1));
  return { type: 'score', score, legend: (q.criteria as unknown[])[score], probabilities, confidence: 0.8 };
};

/** Mirrors the documented request rules; returns a reason when the request would get a 422. */
export function validateJevRequest(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'body must be an object';
  const b = body as Record<string, unknown>;
  if (!('state' in b)) return 'state is required';
  if (typeof b.model !== 'string' || !MODELS.has(b.model)) return `unknown model ${String(b.model)}`;
  if (!b.questions || typeof b.questions !== 'object' || Array.isArray(b.questions)) return 'questions must be an object';
  const questions = Object.entries(b.questions as Record<string, unknown>);
  if (!questions.length) return 'at least one question is required';
  for (const [id, raw] of questions) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return `bad question id ${id}`;
    if (!raw || typeof raw !== 'object') return `question ${id} must be an object`;
    const q = raw as FakeQuestion;
    const instr = q.instructions;
    if (!(typeof instr === 'string' || (instr && typeof instr === 'object'))) return `question ${id} needs instructions`;
    if (typeof instr === 'string' && !instr.trim()) return `question ${id} has empty instructions`;
    if (q.type === 'noul') {
      if (q.criteria !== undefined && (typeof q.criteria !== 'object' || Array.isArray(q.criteria))) return `noul ${id} criteria must be an object`;
    } else if (q.type === 'choice') {
      if (!q.criteria || typeof q.criteria !== 'object' || Array.isArray(q.criteria)) return `choice ${id} criteria must be an object`;
      const n = Object.keys(q.criteria).length;
      if (n < 2 || n > 255) return `choice ${id} needs 2–255 options (got ${n})`;
    } else if (q.type === 'score') {
      if (!Array.isArray(q.criteria)) return `score ${id} criteria must be an array`;
      if (q.criteria.length < 2 || q.criteria.length > 10) return `score ${id} needs 2–10 levels (got ${q.criteria.length})`;
    } else return `question ${id} has unknown type ${String(q.type)}`;
  }
  if (tokens(body) > 64000) return 'request exceeds 64k tokens';
  if (tokens(b.state) + Math.max(...questions.map(([, q]) => tokens(q))) > 32000) return 'state plus the longest question exceed 32k tokens';
  return undefined;
}

export async function startFakeJev(options: { key?: string; answerer?: Answerer; latencyMs?: number } = {}): Promise<FakeJev> {
  const fake = {
    requests: [] as FakeJevRequest[], faults: [] as Fault[],
    answerer: options.answerer ?? defaultAnswerer, key: options.key ?? 'test-key', latencyMs: options.latencyMs ?? 0,
  };
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      const record: FakeJevRequest = { at: Date.now(), auth: req.headers.authorization, body: undefined };
      fake.requests.push(record);
      const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => {
        if (res.destroyed) return;
        res.writeHead(status, { 'content-type': 'application/json', ...headers }).end(typeof body === 'string' ? body : JSON.stringify(body));
      };
      if (req.method !== 'POST' || req.url !== '/v1/systemone') { reply(404, { error: 'not found' }); return; }
      if (req.headers.authorization !== `Bearer ${fake.key}`) { record.error = 'auth'; reply(401, { error: 'invalid api key' }); return; }
      try { record.body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { record.error = 'json'; reply(400, { error: 'invalid JSON' }); return; }
      const fault = fake.faults.shift();
      const delay = fault?.delayMs ?? fake.latencyMs;
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (fault?.hangUp) { req.socket.destroy(); return; }
      if (fault?.status) { reply(fault.status, fault.body ?? { error: `injected ${fault.status}` }, fault.retryAfter !== undefined ? { 'retry-after': fault.retryAfter } : {}); return; }
      const invalid = validateJevRequest(record.body);
      if (invalid) { record.error = invalid; reply(422, { error: invalid }); return; }
      if (fault?.body !== undefined) { reply(200, fault.body); return; }
      const body = record.body as { state: unknown; model: string; questions: Record<string, FakeQuestion> };
      let answers: Record<string, unknown> = {};
      for (const [id, q] of Object.entries(body.questions)) answers[id] = fake.answerer(id, q, body.state);
      if (fault?.mutate) answers = fault.mutate(answers);
      reply(200, { model: fault?.model ?? body.model, answers, usage: { input_tokens: tokens(body), output_tokens: 10 * Object.keys(answers).length } });
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  return Object.assign(fake, {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }),
  });
}

/** Run standalone (for manual testing): `node test/fakes/jev/fake-jev.ts` prints its URL. */
if (import.meta.url === `file://${process.argv[1]}`) {
  const fake = await startFakeJev({ key: process.env.TYPESAFE_API_KEY ?? 'test-key' });
  console.log(`fake Jev at ${fake.url} (key ${fake.key === 'test-key' ? 'test-key' : 'from TYPESAFE_API_KEY'})`);
}

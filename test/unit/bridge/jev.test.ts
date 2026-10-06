// Jev client against the fake Jev server: every documented failure maps to one
// error kind, retries stay inside the time budget, and the key never leaks.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JevClient, JEV_MODEL, parseRetryAfter } from '../../../bridge/jev.ts';
import { startFakeJev, validateJevRequest, type FakeJev } from '../../fakes/jev/fake-jev.ts';
import type { JevRequest } from '../../../src/ai/protocol.ts';

let fake: FakeJev;
beforeAll(async () => { fake = await startFakeJev({ key: 'k-123' }); });
afterAll(async () => { await fake.close(); });
beforeEach(() => { fake.requests.length = 0; fake.faults = []; fake.latencyMs = 0; });

const request: JevRequest = { state: { request: 'brighter' }, questions: { route: { type: 'choice', instructions: 'Pick a route.', criteria: { adjust: 'adjust a value', create: 'create a patch' } } } };
const client = (extra: Partial<ConstructorParameters<typeof JevClient>[0]> = {}) => new JevClient({ apiKey: 'k-123', baseUrl: fake.url, ...extra });

describe('JevClient', () => {
  it('is off without a key and makes no request', async () => {
    const jev = new JevClient({ baseUrl: fake.url });
    expect(jev.enabled).toBe(false);
    expect(jev.status.state).toBe('off');
    const r = await jev.ask(request);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('off');
    expect(fake.requests).toHaveLength(0);
  });

  it('sends the pinned model with a bearer key and returns the answers', async () => {
    const jev = client();
    const r = await jev.ask(request);
    expect(r.ok).toBe(true);
    if (r.ok) { expect((r.response.answers.route as { choice: string }).choice).toBe('adjust'); expect(r.modelWarning).toBeUndefined(); }
    expect(fake.requests[0]!.auth).toBe('Bearer k-123');
    expect((fake.requests[0]!.body as { model: string }).model).toBe(JEV_MODEL);
    expect(jev.status.state).toBe('ok');
  });

  it('401 marks the key bad, is not retried, and later calls fail fast', async () => {
    const jev = client({ apiKey: 'wrong' });
    const r = await jev.ask(request);
    expect(!r.ok && r.error.kind).toBe('auth');
    expect(fake.requests).toHaveLength(1);
    expect(jev.status.state).toBe('error');
    expect(jev.enabled).toBe(false);
    const again = await jev.ask(request);
    expect(!again.ok && again.error.kind).toBe('auth');
    expect(fake.requests).toHaveLength(1);
    expect(JSON.stringify(r)).not.toContain('wrong');
  });

  it('422 is reported as invalid and not retried', async () => {
    const r = await client().ask({ state: '', questions: { bad: { type: 'score', instructions: 'x', criteria: ['only one'] } } });
    expect(!r.ok && r.error.kind).toBe('invalid');
    if (!r.ok) expect(r.error.message).toMatch(/2–10 levels/);
    expect(fake.requests).toHaveLength(1);
  });

  it('429 / 529 are retried once when retry-after fits the budget', async () => {
    fake.faults = [{ status: 429, retryAfter: '0.05' }];
    const r = await client().ask(request, { budgetMs: 1500 });
    expect(r.ok).toBe(true);
    expect(fake.requests).toHaveLength(2);
    fake.faults = [{ status: 529 }];
    expect((await client().ask(request, { budgetMs: 1500 })).ok).toBe(true);
  });

  it('a retry-after longer than the budget gives up immediately as busy', async () => {
    fake.faults = [{ status: 429, retryAfter: '10' }];
    const started = Date.now();
    const r = await client().ask(request, { budgetMs: 800 });
    expect(!r.ok && r.error.kind).toBe('busy');
    if (!r.ok) expect(r.error.retryAfterMs).toBe(10000);
    expect(Date.now() - started).toBeLessThan(500);
    expect(fake.requests).toHaveLength(1);
  });

  it('two busy replies in a row end as busy (at most one retry)', async () => {
    fake.faults = [{ status: 529, retryAfter: '0' }, { status: 529, retryAfter: '0' }, { status: 529 }];
    const r = await client().ask(request, { budgetMs: 2000 });
    expect(!r.ok && r.error.kind).toBe('busy');
    expect(fake.requests).toHaveLength(2);
  });

  it('times out at the budget', async () => {
    fake.faults = [{ delayMs: 600 }];
    const started = Date.now();
    const r = await client().ask(request, { budgetMs: 200 });
    expect(!r.ok && r.error.kind).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('the budget is clamped to the maximum', async () => {
    fake.faults = [{ delayMs: 600 }];
    const r = await client({ maxBudgetMs: 150 }).ask(request, { budgetMs: 60000 });
    expect(!r.ok && r.error.kind).toBe('timeout');
  });

  it('a dropped connection is a network error', async () => {
    fake.faults = [{ hangUp: true }];
    const jev = client();
    const r = await jev.ask(request);
    expect(!r.ok && r.error.kind).toBe('network');
    expect(jev.status.state).toBe('error');
    // The next good answer clears the error.
    expect((await jev.ask(request)).ok).toBe(true);
    expect(jev.status.state).toBe('ok');
  });

  it('an unreachable server is a network error', async () => {
    const r = await new JevClient({ apiKey: 'x', baseUrl: 'http://127.0.0.1:1' }).ask(request);
    expect(!r.ok && r.error.kind).toBe('network');
  });

  it('non-JSON and answer-less bodies are malformed', async () => {
    fake.faults = [{ body: '<html>oops' }];
    const a = await client().ask(request);
    expect(!a.ok && a.error.kind).toBe('malformed');
    fake.faults = [{ body: JSON.stringify({ model: JEV_MODEL }) }];
    const b = await client().ask(request);
    expect(!b.ok && b.error.kind).toBe('malformed');
    fake.faults = [{ body: JSON.stringify({ model: JEV_MODEL, answers: [] }) }];
    const c = await client().ask(request);
    expect(!c.ok && c.error.kind).toBe('malformed');
  });

  it('other server errors are reported with the status', async () => {
    fake.faults = [{ status: 500 }];
    const r = await client().ask(request);
    expect(!r.ok && r.error.kind).toBe('server');
    if (!r.ok) expect(r.error.status).toBe(500);
  });

  it('can be cancelled', async () => {
    fake.faults = [{ delayMs: 500 }];
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    const r = await client().ask(request, { signal: controller.signal });
    expect(!r.ok && r.error.kind).toBe('cancelled');
  });

  it('refuses requests over the size limits before sending', async () => {
    const big = 'x'.repeat(130000);
    const r = await client().ask({ state: big, questions: request.questions });
    expect(!r.ok && r.error.kind).toBe('too-large');
    const empty = await client().ask({ state: '', questions: {} });
    expect(!empty.ok && empty.error.kind).toBe('invalid');
    expect(fake.requests).toHaveLength(0);
  });

  it('warns when the answering model differs from the pinned one', async () => {
    fake.faults = [{ model: 'jev-1.14.0' }];
    const r = await client().ask(request);
    expect(r.ok && r.modelWarning).toMatch(/jev-1\.14\.0/);
  });

  it('warm-up is a single noul request', async () => {
    const r = await client().warmUp();
    expect(r.ok).toBe(true);
    expect(Object.values((fake.requests[0]!.body as { questions: Record<string, { type: string }> }).questions)[0]!.type).toBe('noul');
  });
});

describe('parseRetryAfter', () => {
  it('reads seconds and HTTP dates', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('2')).toBe(2000);
    expect(parseRetryAfter('garbage')).toBeUndefined();
    const ms = parseRetryAfter(new Date(Date.now() + 3000).toUTCString())!;
    expect(ms).toBeGreaterThan(1000);
    expect(ms).toBeLessThanOrEqual(3000);
  });
});

describe('fake Jev validation (mirrors the documented limits)', () => {
  const q = (question: unknown) => ({ state: '', model: JEV_MODEL, questions: { a: question } });
  it('accepts the three question types', () => {
    expect(validateJevRequest(q({ type: 'noul', instructions: 'x' }))).toBeUndefined();
    expect(validateJevRequest(q({ type: 'choice', instructions: 'x', criteria: { a: 1, b: 2 } }))).toBeUndefined();
    expect(validateJevRequest(q({ type: 'score', instructions: { what: 'x' }, criteria: ['lo', 'hi'] }))).toBeUndefined();
  });
  it('rejects the documented violations', () => {
    expect(validateJevRequest({ ...q({ type: 'noul', instructions: 'x' }), model: 'gpt' })).toMatch(/model/);
    expect(validateJevRequest(q({ type: 'choice', instructions: 'x', criteria: Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`k${i}`, i])) }))).toMatch(/2–255/);
    expect(validateJevRequest(q({ type: 'score', instructions: 'x', criteria: Array.from({ length: 11 }, (_, i) => i) }))).toMatch(/2–10/);
    expect(validateJevRequest(q({ type: 'rank', instructions: 'x' }))).toMatch(/unknown type/);
    expect(validateJevRequest(q({ type: 'noul', instructions: '  ' }))).toMatch(/empty/);
    expect(validateJevRequest({ state: 'x'.repeat(130000), model: JEV_MODEL, questions: { a: { type: 'noul', instructions: 'x' } } })).toMatch(/32k|64k/);
  });
});

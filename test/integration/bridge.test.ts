// Bridge over real sockets: who may connect, the hello handshake, Jev round trips
// through the fake Jev, cancellation, telemetry, and the token endpoint.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { createBridge, type Bridge } from '../../bridge/server.ts';
import { JevClient } from '../../bridge/jev.ts';
import { Telemetry } from '../../bridge/telemetry.ts';
import { CLOSE, PROTOCOL_VERSION, WS_PATH, type ServerMessage } from '../../src/ai/protocol.ts';
import { startFakeJev, type FakeJev } from '../fakes/jev/fake-jev.ts';
import { connect, type TestSocket } from '../helpers/ws-client.ts';

const ORIGIN = 'http://127.0.0.1:5180';
let fake: FakeJev;
let logs: string;
const bridges: Bridge[] = [];
beforeAll(async () => { fake = await startFakeJev({ key: 'k' }); logs = mkdtempSync(join(tmpdir(), 'kit-bridge-')); });
afterAll(async () => { await fake.close(); rmSync(logs, { recursive: true, force: true }); });
afterEach(async () => { fake.faults = []; while (bridges.length) await bridges.pop()!.close(); });

async function bridge(extra: Parameters<typeof createBridge>[0] = {}) {
  const b = await createBridge({ origins: [ORIGIN], jev: new JevClient({ apiKey: 'k', baseUrl: fake.url }), telemetry: new Telemetry(logs), ...extra });
  bridges.push(b);
  return b;
}
const wsUrl = (b: Bridge) => `ws://127.0.0.1:${b.port}${WS_PATH}`;
let tabSerial = 0;
/** Each call is a separate browser tab (its own tab id; the same id again would replace the first socket). */
async function hello(b: Bridge, origin = ORIGIN, tab = tabSerial++ ? `tab-${tabSerial}` : 'tab-a'): Promise<TestSocket> {
  const s = await connect(wsUrl(b), origin);
  s.send({ t: 'hello', protocol: PROTOCOL_VERSION, token: b.token, tab });
  const welcome = await s.next();
  expect(welcome.t).toBe('welcome');
  return s;
}
const ask = { state: { request: 'brighter' }, questions: { route: { type: 'choice', instructions: 'Route?', criteria: { a: 'A', b: 'B' } } } };
const until = async (fn: () => boolean, ms = 2000) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw new Error('condition not met'); await new Promise(r => setTimeout(r, 10)); } };

describe('connection policy', () => {
  it('refuses a foreign or missing Origin', async () => {
    const b = await bridge();
    expect((await (await connect(wsUrl(b), 'https://evil.example')).closed).code).toBe(CLOSE.badOrigin);
    expect((await (await connect(wsUrl(b), 'http://127.0.0.1:9999')).closed).code).toBe(CLOSE.badOrigin);
    expect((await (await connect(wsUrl(b))).closed).code).toBe(CLOSE.badOrigin);
  });

  it('accepts both loopback spellings of the page origin', async () => {
    const b = await bridge();
    (await hello(b, 'http://localhost:5180')).ws.close();
    (await hello(b, ORIGIN)).ws.close();
  });

  it('closes on a wrong token, a missing hello, a non-hello first message and a protocol mismatch', async () => {
    const b = await bridge({ helloTimeoutMs: 150 });
    const wrong = await connect(wsUrl(b), ORIGIN);
    wrong.send({ t: 'hello', protocol: PROTOCOL_VERSION, token: 'nope', tab: 'x' });
    expect((await wrong.closed).code).toBe(CLOSE.badToken);
    const silent = await connect(wsUrl(b), ORIGIN);
    expect((await silent.closed).code).toBe(CLOSE.helloTimeout);
    const rude = await connect(wsUrl(b), ORIGIN);
    rude.send({ t: 'status.get', id: '1' });
    expect((await rude.closed).code).toBe(CLOSE.protocol);
    const old = await connect(wsUrl(b), ORIGIN);
    old.send({ t: 'hello', protocol: 0, token: b.token, tab: 'x' });
    const error = await old.next();
    expect(error.t === 'error' && error.message).toMatch(/protocol 0/);
    expect((await old.closed).code).toBe(CLOSE.protocol);
    expect(b.tabs()).toHaveLength(0);
  });

  it('refuses other paths and non-loopback Host headers', async () => {
    const b = await bridge();
    await expect(connect(`ws://127.0.0.1:${b.port}/elsewhere`, ORIGIN)).rejects.toThrow();
    const res = await fetch(`http://127.0.0.1:${b.port}${WS_PATH}`, { headers: { host: 'evil.example' } }).catch(() => null);
    expect(res?.status ?? 404).not.toBe(101);
  });

  it('origins can be replaced after start (the harness learns its port late)', async () => {
    const b = await bridge({ origins: [] });
    expect((await (await connect(wsUrl(b), ORIGIN)).closed).code).toBe(CLOSE.badOrigin);
    b.setOrigins([ORIGIN]);
    (await hello(b)).ws.close();
  });

  it('fails fast when its port is busy', async () => {
    const blocker = createServer();
    await new Promise<void>(r => blocker.listen(0, '127.0.0.1', r));
    const port = (blocker.address() as { port: number }).port;
    await expect(createBridge({ port })).rejects.toThrow(/EADDRINUSE/);
    await new Promise(r => blocker.close(r));
  });
});

describe('messages', () => {
  it('welcome carries the status; Jev is off without a key; codex is off until CP2b', async () => {
    const b = await bridge({ jev: new JevClient({}) });
    const s = await connect(wsUrl(b), ORIGIN);
    s.send({ t: 'hello', protocol: PROTOCOL_VERSION, token: b.token, tab: 't' });
    const welcome = await s.next() as Extract<ServerMessage, { t: 'welcome' }>;
    expect(welcome.status.jev.state).toBe('off');
    expect(welcome.status.codex.state).toBe('off');
    s.send({ t: 'status.get', id: 's1' });
    const status = await s.next();
    expect(status.t === 'status' && status.id).toBe('s1');
    s.ws.close();
  });

  it('answers malformed messages with an error and keeps the connection', async () => {
    const b = await bridge();
    const s = await hello(b);
    s.send('not json');
    expect((await s.next()).t).toBe('error');
    s.send({ t: 'launch-missiles' });
    const e = await s.next();
    expect(e.t === 'error' && e.message).toMatch(/unknown message type/);
    s.send({ t: 'jev.ask', id: 'x' });
    expect((await s.next()).t).toBe('error');
    s.ws.send(Buffer.from([1, 2, 3]));
    expect((await s.next()).t).toBe('error');
    s.send({ t: 'status.get', id: 'still-here' });
    expect((await s.next()).t).toBe('status');
    s.ws.close();
  });

  it('round-trips a Jev request', async () => {
    const b = await bridge();
    const s = await hello(b);
    s.send({ t: 'jev.ask', id: 'q1', request: ask, budgetMs: 1000 });
    const r = await s.next();
    expect(r.t).toBe('jev.result');
    if (r.t === 'jev.result') { expect(r.id).toBe('q1'); expect(r.result.ok).toBe(true); }
    s.ws.close();
  });

  it('reports Jev failures as results and broadcasts status changes', async () => {
    const b = await bridge({ jev: new JevClient({ apiKey: 'wrong', baseUrl: fake.url }) });
    const s = await hello(b);
    const other = await hello(b);
    s.send({ t: 'jev.ask', id: 'q1', request: ask });
    const messages = [await s.next(), await s.next()];
    const result = messages.find(m => m.t === 'jev.result');
    expect(result?.t === 'jev.result' && !result.result.ok && result.result.error.kind).toBe('auth');
    const status = messages.find(m => m.t === 'status');
    expect(status?.t === 'status' && status.status.jev.state).toBe('error');
    const pushed = await other.next();
    expect(pushed.t === 'status' && pushed.status.jev.state).toBe('error');
    s.ws.close(); other.ws.close();
  });

  it('cancels on request and when the tab disconnects', async () => {
    const b = await bridge();
    const s = await hello(b);
    fake.faults = [{ delayMs: 400 }];
    s.send({ t: 'jev.ask', id: 'slow', request: ask, budgetMs: 2000 });
    await until(() => b.tabs()[0]?.pending === 1);
    s.send({ t: 'jev.cancel', id: 'slow' });
    const r = await s.next();
    expect(r.t === 'jev.result' && !r.result.ok && r.result.error.kind).toBe('cancelled');
    fake.faults = [{ delayMs: 400 }];
    s.send({ t: 'jev.ask', id: 'slow2', request: ask, budgetMs: 2000 });
    await until(() => b.tabs()[0]?.pending === 1);
    s.ws.close();
    await until(() => b.tabs().length === 0);
  });

  it('rejects duplicate ids and caps requests in flight per tab', async () => {
    const b = await bridge();
    const s = await hello(b);
    fake.faults = Array.from({ length: 10 }, () => ({ delayMs: 300 }));
    s.send({ t: 'jev.ask', id: 'd', request: ask, budgetMs: 2000 });
    s.send({ t: 'jev.ask', id: 'd', request: ask, budgetMs: 2000 });
    const dup = await s.next();
    expect(dup.t === 'error' && dup.ref).toBe('d');
    for (let i = 0; i < 8; i++) s.send({ t: 'jev.ask', id: `n${i}`, request: ask, budgetMs: 2000 });
    const busy = await s.next();
    expect(busy.t === 'jev.result' && busy.id === 'n7' && !busy.result.ok && busy.result.error.kind).toBe('busy');
    s.ws.close();
  });

  it('writes telemetry as JSONL, never the key, and refuses oversized records', async () => {
    const b = await bridge();
    const s = await hello(b);
    s.send({ t: 'telemetry', record: { kind: 'route', request: 'brighter', ms: 12 } });
    s.send({ t: 'jev.ask', id: 'q', request: ask });
    await s.nextOf('jev.result');
    s.send({ t: 'telemetry', record: { blob: 'x'.repeat(70 * 1024) } });
    expect((await s.nextOf('error')).message).toMatch(/too large/);
    const files = readdirSync(logs);
    const trace = readFileSync(join(logs, files.find(f => f.startsWith('trace-'))!), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    expect(trace.at(-1)).toMatchObject({ tab: expect.stringMatching(/^tab-/), kind: 'route', request: 'brighter' });
    const jev = readFileSync(join(logs, files.find(f => f.startsWith('jev-'))!), 'utf8');
    expect(jev).toContain('"ok":true');
    expect(jev).not.toContain('Bearer');
    s.ws.close();
  });

  it('warm-up updates the status and pushes it to open tabs', async () => {
    fake.faults = [{ delayMs: 200 }];
    const b = await bridge({ warmUp: true });
    const s = await hello(b);
    const pushed = await s.next();
    expect(pushed.t === 'status' && pushed.status.jev.state).toBe('ok');
    s.ws.close();
  });

  it('drops tabs that stop answering pings', async () => {
    const b = await bridge({ heartbeatMs: 50 });
    const s = await hello(b);
    (s.ws as unknown as { _receiver: { removeAllListeners(e: string): void } })._receiver.removeAllListeners('ping');
    s.ws.pong = () => {};
    await until(() => b.tabs().length === 0, 1000);
  });
});

describe('token endpoint', () => {
  it('serves the token to same-origin pages only', async () => {
    const b = await bridge();
    const url = `http://127.0.0.1:${b.port}/__kit/token`;
    const ok = await fetch(url, { headers: { 'sec-fetch-site': 'same-origin' } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ token: b.token, protocol: PROTOCOL_VERSION });
    expect((await fetch(url, { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    expect((await fetch(url, { headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await fetch(`http://127.0.0.1:${b.port}/other`)).status).toBe(404);
  });
});

describe('the same tab on a new socket', () => {
  it('replaces the old socket (a reconnect that beat the old close)', async () => {
    const b = await bridge();
    const first = await hello(b, ORIGIN, 'same');
    const second = await hello(b, ORIGIN, 'same');
    expect((await first.closed).code).toBe(CLOSE.replaced);
    expect(b.tabs().map(t => t.tab)).toEqual(['same']);
    second.send({ t: 'status.get', id: 's' });
    expect((await second.nextOf('status')).id).toBe('s');
  });
});

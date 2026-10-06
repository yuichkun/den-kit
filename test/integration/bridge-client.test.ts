// The browser's bridge client against the real bridge (Node `ws` stands in for
// the browser WebSocket): it never throws, reconnects with backoff, survives a
// bridge restart with a new token, and settles every request exactly once.
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { BridgeClient, type SocketLike } from '../../src/ai/bridge-client.ts';
import { createBridge, type Bridge } from '../../bridge/server.ts';
import { JevClient } from '../../bridge/jev.ts';
import { PROTOCOL_VERSION, WS_PATH } from '../../src/ai/protocol.ts';
import { startFakeJev, type FakeJev } from '../fakes/jev/fake-jev.ts';

const ORIGIN = 'http://127.0.0.1:5180';
const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()!(); });
const until = async (fn: () => boolean, ms = 3000) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw new Error('condition not met'); await new Promise(r => setTimeout(r, 10)); } };

async function setup(options: { port?: number; token?: string; fake?: FakeJev } = {}) {
  const fake = options.fake ?? await startFakeJev({ key: 'k' });
  if (!options.fake) cleanup.push(() => fake.close());
  const bridge = await createBridge({ port: options.port, token: options.token, origins: [ORIGIN], jev: new JevClient({ apiKey: 'k', baseUrl: fake.url }) });
  let closed = false;
  cleanup.push(async () => { if (!closed) await bridge.close(); });
  return { fake, bridge, close: async () => { closed = true; await bridge.close(); } };
}
function client(bridge: Pick<Bridge, 'port' | 'token'>, extra: Partial<ConstructorParameters<typeof BridgeClient>[0]> = {}) {
  const c = new BridgeClient({
    token: bridge.token, url: `ws://127.0.0.1:${bridge.port}${WS_PATH}`,
    createSocket: url => new WebSocket(url, { origin: ORIGIN }) as unknown as SocketLike,
    backoff: { baseMs: 30, maxMs: 200 }, ...extra,
  });
  cleanup.push(() => c.stop());
  return c;
}
const request = { state: 'x', questions: { route: { type: 'choice' as const, instructions: 'Route?', criteria: { a: 'A', b: 'B' } } } };

describe('BridgeClient', () => {
  it('without a token it is disabled and answers "off" immediately', async () => {
    const c = new BridgeClient({ token: null });
    c.start();
    expect(c.state.value).toBe('disabled');
    expect(c.detail.value).toMatch(/kit:dev/);
    const r = await c.askJev(request);
    expect(!r.ok && r.error.kind).toBe('off');
  });

  it('connects, receives the status and round-trips Jev', async () => {
    const { bridge } = await setup();
    const c = client(bridge);
    c.start();
    await until(() => c.online);
    expect(c.status.value?.jev.state).toBe('unknown');
    expect(c.jevReady).toBe(true);
    const r = await c.askJev(request, { budgetMs: 1000 });
    expect(r.ok).toBe(true);
    await until(() => c.status.value?.jev.state === 'ok');
  });

  it('settles in-flight requests when the bridge goes away, then reconnects when it is back', async () => {
    const fake = await startFakeJev({ key: 'k' });
    cleanup.push(() => fake.close());
    const first = await setup({ fake, token: 'fixed' });
    const port = first.bridge.port;
    const c = client(first.bridge);
    c.start();
    await until(() => c.online);
    fake.faults = [{ delayMs: 1000 }];
    const pending = c.askJev(request, { budgetMs: 3000 });
    await new Promise(r => setTimeout(r, 50));
    await first.close();
    const r = await pending;
    expect(!r.ok && r.error.kind).toBe('network');
    await until(() => c.state.value === 'offline');
    expect((await c.askJev(request)).ok).toBe(false);
    await setup({ fake, port, token: 'fixed' });
    await until(() => c.online, 5000);
    fake.faults = [];
    expect((await c.askJev(request)).ok).toBe(true);
  });

  it('picks up a new token after the bridge restarts with one', async () => {
    const fake = await startFakeJev({ key: 'k' });
    cleanup.push(() => fake.close());
    const first = await setup({ fake, token: 'old' });
    const port = first.bridge.port;
    let served = 'old';
    const c = client(first.bridge, { fetchToken: async () => served });
    c.start();
    await until(() => c.online);
    await first.close();
    await until(() => c.state.value === 'offline');
    served = 'new';
    await setup({ fake, port, token: 'new' });
    await until(() => c.online, 5000);
  });

  it('a token that cannot be refreshed ends in "refused" without retry storms', async () => {
    const { bridge } = await setup();
    const c = client({ port: bridge.port, token: 'stale' }, { fetchToken: async () => null });
    c.start();
    await until(() => c.state.value === 'refused');
    expect(c.detail.value).toMatch(/Reload/);
    expect(bridge.tabs()).toHaveLength(0);
  });

  it('a refused origin is reported and not retried', async () => {
    const { bridge } = await setup();
    const c = new BridgeClient({ token: bridge.token, url: `ws://127.0.0.1:${bridge.port}${WS_PATH}`, createSocket: url => new WebSocket(url, { origin: 'http://evil.example' }) as unknown as SocketLike, backoff: { baseMs: 10, maxMs: 20 } });
    cleanup.push(() => c.stop());
    c.start();
    await until(() => c.state.value === 'refused');
    expect(c.detail.value).toMatch(/origin/);
    await new Promise(r => setTimeout(r, 100));
    expect(c.state.value).toBe('refused');
  });

  it('a missing bridge means offline with backoff, never an exception', async () => {
    const c = new BridgeClient({ token: 't', url: 'ws://127.0.0.1:1/__kit/ws', createSocket: url => new WebSocket(url) as unknown as SocketLike, backoff: { baseMs: 20, maxMs: 50 } });
    cleanup.push(() => c.stop());
    c.start();
    await until(() => c.state.value === 'offline');
    expect(c.detail.value).toMatch(/not running/);
    await new Promise(r => setTimeout(r, 200));
    expect(c.stats.reconnects).toBeGreaterThan(1);
  });

  it('cancellation and a silent bridge both settle the request exactly once', async () => {
    // A server that welcomes and then ignores everything.
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    cleanup.push(() => new Promise<void>(r => wss.close(() => r())));
    wss.on('connection', ws => ws.on('message', () => ws.send(JSON.stringify({ t: 'welcome', protocol: PROTOCOL_VERSION, bridge: 'mute', status: { jev: { state: 'ok' }, codex: { state: 'off' } } }))));
    await new Promise(r => wss.once('listening', r));
    const port = (wss.address() as { port: number }).port;
    const c = client({ port, token: 't' }, { replyMarginMs: 50 });
    c.start();
    await until(() => c.online);
    const controller = new AbortController();
    const cancelled = c.askJev(request, { budgetMs: 5000, signal: controller.signal });
    controller.abort();
    expect(await cancelled).toMatchObject({ ok: false, error: { kind: 'cancelled' } });
    const timedOut = await c.askJev(request, { budgetMs: 100 });
    expect(!timedOut.ok && timedOut.error.kind).toBe('timeout');
    const pre = new AbortController(); pre.abort();
    expect(await c.askJev(request, { signal: pre.signal })).toMatchObject({ ok: false, error: { kind: 'cancelled' } });
  });

  it('forwards telemetry once online and drops it quietly while offline', async () => {
    const { bridge } = await setup();
    const c = client(bridge);
    c.telemetry({ kind: 'before-connect' });
    c.start();
    await until(() => c.online);
    const sent = c.stats.sent;
    c.telemetry({ kind: 'test' });
    expect(c.stats.sent).toBe(sent + 1);
  });
});

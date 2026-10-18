// The browser's bridge client against the real bridge (Node `ws` stands in for
// the browser WebSocket): it never throws, reconnects with backoff, survives a
// bridge restart with a new token, and forwards LLM messages to its listeners.
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { WebSocket, WebSocketServer } from 'ws';
import { BridgeClient, type LlmInbound, type SocketLike } from '../../src/ai/bridge-client.ts';
import { createBridge, type Bridge } from '../../bridge/server.ts';
import { PROTOCOL_VERSION, WS_PATH, type ServerMessage } from '../../src/ai/protocol.ts';

const ORIGIN = 'http://127.0.0.1:5180';
const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()!(); });
const until = async (fn: () => boolean, ms = 3000) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw new Error('condition not met'); await new Promise(r => setTimeout(r, 10)); } };

async function setup(options: { port?: number; token?: string } = {}) {
  const bridge = await createBridge({ port: options.port, token: options.token, origins: [ORIGIN] });
  let closed = false;
  cleanup.push(async () => { if (!closed) await bridge.close(); });
  return { bridge, close: async () => { closed = true; await bridge.close(); } };
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

describe('BridgeClient', () => {
  it('without a token it is disabled and cannot send an LLM request', async () => {
    const c = new BridgeClient({ token: null });
    c.start();
    expect(c.state.value).toBe('disabled');
    expect(c.detail.value).toMatch(/dev/);
    expect(c.codexReady).toBe(false);
    expect(c.llmStart('r', 'brighter', 'edit the patch')).toBe(false);
  });

  it('connects, receives Codex status and forwards an unavailable LLM result', async () => {
    const { bridge } = await setup();
    const c = client(bridge);
    const inbound: LlmInbound[] = [];
    c.onLlm(message => inbound.push(message));
    c.start();
    await until(() => c.online);
    expect(c.status.value).toMatchObject({ codex: { state: 'off' } });
    expect(Object.keys(c.status.value!)).toEqual(['codex']);
    expect(c.codexReady).toBe(false);
    expect(c.llmStart('r', 'brighter', 'edit the patch')).toBe(true);
    await until(() => inbound.some(m => m.t === 'llm.event' && m.event.kind === 'done'));
    expect(inbound.find(m => m.t === 'llm.event' && m.event.kind === 'done')).toMatchObject({ t: 'llm.event', id: 'r', event: { kind: 'done', status: 'failed', error: { code: 'off' } } });
  });

  it('reports a disconnected bridge, refuses offline sends and reconnects when it returns', async () => {
    const first = await setup({ token: 'fixed' });
    const port = first.bridge.port;
    const c = client(first.bridge);
    c.start();
    await until(() => c.online);
    await first.close();
    await until(() => c.state.value === 'offline');
    const sent = c.stats.sent;
    expect(c.llmStart('offline', 'brighter', 'edit the patch')).toBe(false);
    expect(c.stats.sent).toBe(sent);
    await setup({ port, token: 'fixed' });
    await until(() => c.online, 5000);
    expect(c.llmStart('back', 'brighter', 'edit the patch')).toBe(true);
    expect(c.stats.connects).toBe(2);
  });

  it('picks up a new token after the bridge restarts with one', async () => {
    const first = await setup({ token: 'old' });
    const port = first.bridge.port;
    let served = 'old';
    const c = client(first.bridge, { fetchToken: async () => served });
    c.start();
    await until(() => c.online);
    await first.close();
    await until(() => c.state.value === 'offline');
    served = 'new';
    await setup({ port, token: 'new' });
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

  it('forwards LLM events, tool calls, and request errors once and removes unsubscribed listeners', async () => {
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    cleanup.push(() => new Promise<void>(r => wss.close(() => r())));
    const messages: ServerMessage[] = [
      { t: 'llm.event', id: 'r', event: { kind: 'delta', text: 'working' } },
      { t: 'tool.call', id: 'r', callId: 'call', tool: 'kit_get_patch', args: {} },
      { t: 'error', ref: 'r', message: 'request failed' },
    ];
    wss.on('connection', ws => ws.on('message', raw => {
      const incoming = JSON.parse(String(raw));
      if (incoming.t === 'hello') ws.send(JSON.stringify({ t: 'welcome', protocol: PROTOCOL_VERSION, bridge: 'test', status: { codex: { state: 'ok' } } }));
      else if (incoming.t === 'llm.start') for (const message of messages) ws.send(JSON.stringify(message));
    }));
    await new Promise(r => wss.once('listening', r));
    const port = (wss.address() as { port: number }).port;
    const c = client({ port, token: 't' });
    const inbound: LlmInbound[] = [];
    const unsubscribe = c.onLlm(message => inbound.push(message));
    c.start();
    await until(() => c.online);
    expect(c.codexReady).toBe(true);
    inbound.length = 0;
    expect(c.llmStart('r', 'brighter', 'edit the patch')).toBe(true);
    await until(() => inbound.length === messages.length);
    expect(inbound).toEqual(messages);
    unsubscribe();
    expect(c.llmStart('r', 'brighter', 'edit the patch')).toBe(true);
    await new Promise(r => setTimeout(r, 30));
    expect(inbound).toEqual(messages);
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

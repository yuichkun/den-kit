// Bridge over real sockets: connection policy, the hello handshake, rejected
// retired messages, local telemetry, heartbeat, and the token endpoint.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { createBridge, type Bridge } from '../../bridge/server.ts';
import { Telemetry } from '../../bridge/telemetry.ts';
import { CLOSE, PROTOCOL_VERSION, WS_PATH, type ServerMessage } from '../../src/ai/protocol.ts';
import { connect, type TestSocket } from '../helpers/ws-client.ts';

const ORIGIN = 'http://127.0.0.1:5180';
let logs: string;
const bridges: Bridge[] = [];
beforeAll(() => { logs = mkdtempSync(join(tmpdir(), 'kit-bridge-')); });
afterAll(() => { rmSync(logs, { recursive: true, force: true }); });
afterEach(async () => { while (bridges.length) await bridges.pop()!.close(); });

async function bridge(extra: Parameters<typeof createBridge>[0] = {}) {
  const b = await createBridge({ origins: [ORIGIN], telemetry: new Telemetry(logs), ...extra });
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
  it('welcome carries only Codex status, off when no Codex client is configured', async () => {
    const b = await bridge();
    const s = await connect(wsUrl(b), ORIGIN);
    s.send({ t: 'hello', protocol: PROTOCOL_VERSION, token: b.token, tab: 't' });
    const welcome = await s.next() as Extract<ServerMessage, { t: 'welcome' }>;
    expect(Object.keys(welcome.status)).toEqual(['codex']);
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

  it('rejects retired Jev request and cancellation messages without disconnecting', async () => {
    const b = await bridge();
    const s = await hello(b);
    for (const t of ['jev.ask', 'jev.cancel']) {
      s.send({ t, id: 'retired', request: { state: 'brighter', questions: {} } });
      const error = await s.nextOf('error');
      expect(error.message).toMatch(/unknown message type/);
      expect(b.tabs()).toMatchObject([{ pending: 0 }]);
    }
    s.send({ t: 'status.get', id: 'after-retired' });
    expect((await s.nextOf('status')).id).toBe('after-retired');
    s.ws.close();
  });

  it('writes local telemetry as JSONL without the bridge token and refuses oversized records', async () => {
    const b = await bridge({ token: 'private-bridge-token' });
    const s = await hello(b);
    s.send({ t: 'telemetry', record: { kind: 'request', route: 'llm', ms: 12 } });
    // A status response proves the earlier telemetry frame was handled.
    s.send({ t: 'status.get', id: 'after-telemetry' });
    await s.nextOf('status');
    s.send({ t: 'telemetry', record: { blob: 'x'.repeat(70 * 1024) } });
    expect((await s.nextOf('error')).message).toMatch(/too large/);
    const files = readdirSync(logs);
    const raw = readFileSync(join(logs, files.find(f => f.startsWith('trace-'))!), 'utf8');
    const trace = raw.trim().split('\n').map(l => JSON.parse(l));
    expect(trace.at(-1)).toMatchObject({ tab: expect.stringMatching(/^tab-/), kind: 'request', route: 'llm' });
    expect(raw).not.toContain(b.token);
    expect(files.some(f => f.startsWith('jev-'))).toBe(false);
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

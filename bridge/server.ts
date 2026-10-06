// Local AI bridge: one WebSocket per browser tab, bound to 127.0.0.1 only.
// It holds the secrets (Jev key; Codex login from CP2b), talks to the outside
// services and writes JSONL telemetry. The patch itself lives in the browser.
//
// Trust model: a connection must come from the Vite page's Origin and present
// the per-launch token in its first message within a few seconds; otherwise it
// is closed with a code that says why (see CLOSE in src/ai/protocol.ts).
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { CLOSE, MAX_FRAME_BYTES, PROTOCOL_VERSION, WS_PATH, parseClientMessage, type BridgeStatus, type ClientMessage, type ServerMessage } from '../src/ai/protocol.ts';
import { JevClient } from './jev.ts';
import { Telemetry } from './telemetry.ts';

export const BRIDGE_VERSION = 'den-kit-bridge/1';
export const TOKEN_PATH = '/__kit/token';
export const MAX_PENDING_PER_TAB = 8;
const MAX_TELEMETRY_BYTES = 64 * 1024;

export interface BridgeOptions {
  port?: number;
  token?: string;
  /** Page origins allowed to connect, e.g. http://127.0.0.1:5180 (both 127.0.0.1 and localhost are added for each port). */
  origins?: string[];
  jev?: JevClient;
  telemetry?: Telemetry;
  helloTimeoutMs?: number;
  heartbeatMs?: number;
  /** Send one tiny Jev request at startup to warm the connection and learn whether the key works. */
  warmUp?: boolean;
  log?: (line: string) => void;
}

interface Tab { socket: WebSocket; id: string; tab: string; writer: boolean; alive: boolean; pending: Map<string, AbortController> }

export interface Bridge {
  readonly port: number;
  readonly token: string;
  readonly server: Server;
  status(): BridgeStatus;
  /** Replace the allowed page origins (the e2e harness learns Vite's port after listening). */
  setOrigins(origins: string[]): void;
  tabs(): Array<{ id: string; tab: string; writer: boolean; pending: number }>;
  close(): Promise<void>;
}

/** Expand each origin to both loopback spellings at the same port. */
export function expandOrigins(origins: string[]): Set<string> {
  const out = new Set<string>();
  for (const origin of origins) {
    try {
      const url = new URL(origin);
      for (const host of ['127.0.0.1', 'localhost']) out.add(`${url.protocol}//${host}${url.port ? `:${url.port}` : ''}`);
    } catch { /* ignore malformed entries */ }
  }
  return out;
}

const isLoopbackHost = (host: string | undefined) => !!host && /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host);

export async function createBridge(options: BridgeOptions = {}): Promise<Bridge> {
  const token = options.token ?? randomBytes(24).toString('base64url');
  const jev = options.jev ?? new JevClient();
  const telemetry = options.telemetry;
  const helloTimeoutMs = options.helloTimeoutMs ?? 5000;
  const log = options.log ?? (() => {});
  let origins = expandOrigins(options.origins ?? []);
  const tabs = new Set<Tab>();
  let nextTab = 1;

  const status = (): BridgeStatus => ({ jev: { ...jev.status }, codex: { state: 'off', detail: 'The LLM path arrives in CP2b.' } });
  const send = (socket: WebSocket, message: ServerMessage) => { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message)); };
  const broadcastStatus = () => { const s = status(); for (const t of tabs) send(t.socket, { t: 'status', status: s }); };
  const originAllowed = (origin: string | undefined) => !!origin && origins.has(origin);

  // HTTP: only the token endpoint (same-origin pages may re-read the token after a bridge restart).
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === TOKEN_PATH) {
      const site = req.headers['sec-fetch-site'];
      const origin = req.headers.origin;
      const ok = isLoopbackHost(req.headers.host) && (site === undefined || site === 'same-origin') && (origin === undefined || originAllowed(origin));
      if (!ok) { res.writeHead(403, { 'content-type': 'text/plain' }).end('forbidden'); return; }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ token, protocol: PROTOCOL_VERSION }));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== WS_PATH || !isLoopbackHost(req.headers.host)) { socket.end('HTTP/1.1 404 Not Found\r\n\r\n'); return; }
    wss.handleUpgrade(req, socket, head, ws => {
      // Refuse with a close code (not an HTTP status) so the browser can tell the reason.
      if (!originAllowed(req.headers.origin)) { log(`refused origin ${String(req.headers.origin)}`); ws.close(CLOSE.badOrigin, 'origin not allowed'); return; }
      accept(ws);
    });
  });

  function accept(socket: WebSocket) {
    let tab: Tab | undefined;
    const helloTimer = setTimeout(() => { if (!tab) socket.close(CLOSE.helloTimeout, 'no hello'); }, helloTimeoutMs);
    socket.on('message', (data, isBinary) => {
      if (isBinary) { send(socket, { t: 'error', message: 'binary frames are not supported' }); return; }
      const parsed = parseClientMessage(data.toString());
      if ('error' in parsed) { send(socket, { t: 'error', message: parsed.error }); return; }
      if (!tab) {
        if (parsed.t !== 'hello') { socket.close(CLOSE.protocol, 'hello first'); return; }
        if (parsed.token !== token) { socket.close(CLOSE.badToken, 'bad token'); return; }
        if (parsed.protocol !== PROTOCOL_VERSION) { send(socket, { t: 'error', message: `protocol ${parsed.protocol} is not supported (bridge speaks ${PROTOCOL_VERSION}); reload the page or restart kit:dev` }); socket.close(CLOSE.protocol, 'protocol mismatch'); return; }
        clearTimeout(helloTimer);
        tab = { socket, id: `t${nextTab++}`, tab: parsed.tab, writer: parsed.writer, alive: true, pending: new Map() };
        tabs.add(tab);
        socket.on('pong', () => { if (tab) tab.alive = true; });
        send(socket, { t: 'welcome', protocol: PROTOCOL_VERSION, bridge: BRIDGE_VERSION, status: status() });
        return;
      }
      handle(tab, parsed);
    });
    socket.on('close', () => {
      clearTimeout(helloTimer);
      if (!tab) return;
      for (const controller of tab.pending.values()) controller.abort();
      tab.pending.clear();
      tabs.delete(tab);
    });
    socket.on('error', error => log(`socket error: ${error.message}`));
  }

  function handle(tab: Tab, message: ClientMessage) {
    switch (message.t) {
      case 'hello': send(tab.socket, { t: 'error', message: 'already said hello' }); return;
      case 'writer': tab.writer = message.writer; return;
      case 'status.get': send(tab.socket, { t: 'status', id: message.id, status: status() }); return;
      case 'telemetry': {
        const text = JSON.stringify(message.record);
        if (text.length > MAX_TELEMETRY_BYTES) { send(tab.socket, { t: 'error', message: 'telemetry record too large' }); return; }
        telemetry?.write('trace', { tab: tab.tab, ...message.record });
        return;
      }
      case 'jev.cancel': tab.pending.get(message.id)?.abort(); return;
      case 'jev.ask': {
        if (tab.pending.has(message.id)) { send(tab.socket, { t: 'error', message: `duplicate request id ${message.id}`, ref: message.id }); return; }
        if (tab.pending.size >= MAX_PENDING_PER_TAB) { send(tab.socket, { t: 'jev.result', id: message.id, result: { ok: false, error: { kind: 'busy', message: 'Too many Jev requests in flight from this tab.' }, ms: 0 } }); return; }
        const controller = new AbortController();
        tab.pending.set(message.id, controller);
        const before = jev.status.state + (jev.status.detail ?? '');
        void jev.ask(message.request, { budgetMs: message.budgetMs, signal: controller.signal }).then(result => {
          tab.pending.delete(message.id);
          telemetry?.write('jev', { tab: tab.tab, id: message.id, ok: result.ok, ms: result.ms, questions: Object.keys(message.request.questions), ...(result.ok ? { model: result.response.model, usage: result.response.usage } : { error: result.error.kind, status: result.error.status }) });
          send(tab.socket, { t: 'jev.result', id: message.id, result });
          if (jev.status.state + (jev.status.detail ?? '') !== before) broadcastStatus();
        });
        return;
      }
    }
  }

  const heartbeat = setInterval(() => {
    for (const t of tabs) {
      if (!t.alive) { t.socket.terminate(); continue; }
      t.alive = false;
      try { t.socket.ping(); } catch { /* closed meanwhile */ }
    }
  }, options.heartbeatMs ?? 15000);
  heartbeat.unref();

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  if (options.warmUp && jev.enabled) {
    void jev.warmUp().then(result => {
      log(result.ok ? `Jev ready (${result.ms} ms)` : `Jev warm-up failed: ${result.error.message}`);
      broadcastStatus();
    });
  }

  return {
    port, token, server, status,
    setOrigins(next) { origins = expandOrigins(next); },
    tabs: () => [...tabs].map(t => ({ id: t.id, tab: t.tab, writer: t.writer, pending: t.pending.size })),
    async close() {
      clearInterval(heartbeat);
      for (const t of tabs) { for (const c of t.pending.values()) c.abort(); t.socket.terminate(); }
      tabs.clear();
      wss.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

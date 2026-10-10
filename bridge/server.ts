// Local AI bridge: one WebSocket per browser tab, bound to 127.0.0.1 only.
// It holds the secrets (Jev key, the Codex login), talks to the outside
// services and writes JSONL telemetry. The patch itself lives in the browser:
// the LLM's tool calls are sent to the tab that started the request.
//
// LLM requests survive a short disconnect: while a tab is away its messages are
// kept and pending tool calls are sent again when it says hello under the same
// tab id (the browser ignores repeats). A tab that stays away for `llmGraceMs`
// has its requests stopped and its conversations closed.
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
import type { CodexClient, TurnSink } from './codex/client.ts';

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
  /** The LLM path (Codex app-server); the bridge stops it on close. */
  codex?: CodexClient;
  /** How long a disconnected tab keeps its LLM requests and conversations. */
  llmGraceMs?: number;
  log?: (line: string) => void;
}

interface Tab { socket: WebSocket; id: string; tab: string; alive: boolean; pending: Map<string, AbortController> }

export interface Bridge {
  readonly port: number;
  readonly token: string;
  readonly server: Server;
  status(): BridgeStatus;
  /** Replace the allowed page origins (the e2e harness learns Vite's port after listening). */
  setOrigins(origins: string[]): void;
  tabs(): Array<{ id: string; tab: string; pending: number }>;
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

  const codex = options.codex;
  const llmGraceMs = options.llmGraceMs ?? 30000;
  const status = (): BridgeStatus => ({ jev: { ...jev.status }, codex: codex ? codex.status : { state: 'off', detail: 'dev was started with KIT_CODEX=off.' } });
  const send = (socket: WebSocket, message: ServerMessage) => { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message)); };
  const broadcastStatus = () => { const s = status(); for (const t of tabs) send(t.socket, { t: 'status', status: s }); };
  const unsubscribeCodex = codex?.onStatus(() => broadcastStatus());

  // ---- LLM routing (by tab id, which survives reconnects) ----
  const SEP = '\u0000';
  const keyOf = (tabName: string, id: string) => `${tabName}${SEP}${id}`;
  const running = new Map<string, Set<string>>(); // tab id → request keys
  const threads = new Map<string, Set<string>>(); // tab id → conversations
  const away = new Map<string, { messages: ServerMessage[]; timer: ReturnType<typeof setTimeout> }>();
  const add = (map: Map<string, Set<string>>, tabName: string, value: string) => { let set = map.get(tabName); if (!set) map.set(tabName, set = new Set()); set.add(value); };
  const connected = (tabName: string) => { for (const t of tabs) if (t.tab === tabName) return t; return undefined; };
  function deliver(tabName: string, message: ServerMessage) {
    const t = connected(tabName);
    if (t) { send(t.socket, message); return; }
    const a = away.get(tabName);
    if (a && a.messages.length < 5000) a.messages.push(message);
  }
  function sinkFor(tabName: string, id: string): TurnSink {
    return {
      event: event => {
        if (event.kind === 'thread') add(threads, tabName, event.thread);
        if (event.kind === 'done') running.get(tabName)?.delete(keyOf(tabName, id));
        if (event.kind === 'steered') event = { ...event, target: event.target.slice(tabName.length + SEP.length) };
        deliver(tabName, { t: 'llm.event', id, event });
      },
      toolCall: call => deliver(tabName, { t: 'tool.call', id, callId: call.callId, tool: call.tool, args: call.args }),
    };
  }
  /** A tab went away: keep its LLM work for a while, then stop it. */
  function leave(tabName: string) {
    if (!codex || connected(tabName) || away.has(tabName)) return;
    if (!running.get(tabName)?.size && !threads.get(tabName)?.size) return;
    const timer = setTimeout(() => {
      away.delete(tabName);
      for (const key of running.get(tabName) ?? []) codex.stopTurn(key, 'The editor tab closed.');
      for (const thread of threads.get(tabName) ?? []) codex.forget(thread);
      running.delete(tabName); threads.delete(tabName);
      log(`tab ${tabName} did not come back; its LLM requests were stopped`);
    }, llmGraceMs);
    timer.unref?.();
    away.set(tabName, { messages: [], timer });
  }
  /** The same tab is back: deliver what it missed and ask again for tool results it never sent. */
  function rejoin(tab: Tab) {
    const a = away.get(tab.tab);
    if (a) { clearTimeout(a.timer); away.delete(tab.tab); for (const m of a.messages) send(tab.socket, m); }
    if (!codex) return;
    for (const key of running.get(tab.tab) ?? []) {
      const id = key.slice(tab.tab.length + 1);
      for (const call of codex.pendingToolCalls(key)) send(tab.socket, { t: 'tool.call', id, callId: call.callId, tool: call.tool, args: call.args });
    }
  }
  const llmOff = (socket: WebSocket, id: string) => send(socket, { t: 'llm.event', id, event: { kind: 'done', status: 'failed', error: { message: 'The LLM path is off in this bridge (KIT_CODEX=off).', code: 'off' }, ms: 0 } });
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
        if (parsed.protocol !== PROTOCOL_VERSION) { send(socket, { t: 'error', message: `protocol ${parsed.protocol} is not supported (bridge speaks ${PROTOCOL_VERSION}); reload the page or restart dev` }); socket.close(CLOSE.protocol, 'protocol mismatch'); return; }
        clearTimeout(helloTimer);
        // The same tab on a new socket (a reconnect that beat the old socket's close): the new one wins.
        const previous = connected(parsed.tab);
        if (previous) { tabs.delete(previous); previous.socket.close(CLOSE.replaced, 'replaced by a newer connection'); }
        tab = { socket, id: `t${nextTab++}`, tab: parsed.tab, alive: true, pending: new Map() };
        tabs.add(tab);
        socket.on('pong', () => { if (tab) tab.alive = true; });
        const mine = [...running.get(parsed.tab) ?? []].map(key => key.slice(parsed.tab.length + SEP.length));
        send(socket, { t: 'welcome', protocol: PROTOCOL_VERSION, bridge: BRIDGE_VERSION, status: status(), running: mine });
        rejoin(tab);
        return;
      }
      handle(tab, parsed);
    });
    socket.on('close', () => {
      clearTimeout(helloTimer);
      if (!tab) return;
      for (const controller of tab.pending.values()) controller.abort();
      tab.pending.clear();
      if (!tabs.delete(tab)) return; // already replaced by a newer socket of the same tab
      leave(tab.tab);
    });
    socket.on('error', error => log(`socket error: ${error.message}`));
  }

  function handle(tab: Tab, message: ClientMessage) {
    switch (message.t) {
      case 'hello': send(tab.socket, { t: 'error', message: 'already said hello' }); return;
      case 'status.get': send(tab.socket, { t: 'status', id: message.id, status: status() }); return;
      case 'telemetry': {
        const text = JSON.stringify(message.record);
        if (text.length > MAX_TELEMETRY_BYTES) { send(tab.socket, { t: 'error', message: 'telemetry record too large' }); return; }
        telemetry?.write('trace', { tab: tab.tab, ...message.record });
        return;
      }
      case 'jev.cancel': tab.pending.get(message.id)?.abort(); return;
      case 'llm.start': {
        if (!codex) { llmOff(tab.socket, message.id); return; }
        const key = keyOf(tab.tab, message.id);
        add(running, tab.tab, key);
        // Only the tab's own conversations can be continued.
        const thread = message.thread && threads.get(tab.tab)?.has(message.thread) ? message.thread : undefined;
        // A member may start from a copy of one of the tab's own conversations only.
        const fork = message.fork ? { thread: threads.get(tab.tab)?.has(message.fork.thread) ? message.fork.thread : '', fallback: message.fork.fallback } : undefined;
        codex.startTurn({ key, text: message.text, thread, instructions: message.instructions, role: message.role, images: message.images, fork }, sinkFor(tab.tab, message.id));
        return;
      }
      case 'llm.steer':
        if (!codex) { llmOff(tab.socket, message.id); return; }
        codex.steer({ key: keyOf(tab.tab, message.id), target: keyOf(tab.tab, message.target), text: message.text, images: message.images }, sinkFor(tab.tab, message.id));
        return;
      case 'llm.stop': codex?.stopTurn(keyOf(tab.tab, message.id)); return;
      case 'llm.answer': {
        const prefix = keyOf(tab.tab, '');
        if (!codex?.answer(message.question, message.answers, key => key.startsWith(prefix))) send(tab.socket, { t: 'error', message: 'That question is no longer open.', ref: message.id });
        return;
      }
      case 'llm.forget':
        if (codex && threads.get(tab.tab)?.delete(message.thread)) codex.forget(message.thread);
        return;
      case 'tool.result': {
        const owner = keyOf(tab.tab, message.id);
        codex?.toolResult(message.callId, message.output, key => key === owner);
        return;
      }
      case 'codex.retry': void codex?.retry(); return;
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
    tabs: () => [...tabs].map(t => ({ id: t.id, tab: t.tab, pending: t.pending.size })),
    async close() {
      clearInterval(heartbeat);
      for (const a of away.values()) clearTimeout(a.timer);
      away.clear();
      unsubscribeCodex?.();
      await codex?.stop();
      for (const t of tabs) { for (const c of t.pending.values()) c.abort(); t.socket.terminate(); }
      tabs.clear();
      wss.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

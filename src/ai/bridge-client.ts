// Browser side of the local AI bridge. Keeps one WebSocket open with backoff,
// pairs requests with replies, and degrades to "AI offline" without ever
// blocking the editor: every request resolves (never rejects) with a result.
import { shallowRef, ref } from 'vue';
import { CLOSE, PROTOCOL_VERSION, WS_PATH, type BridgeStatus, type ClientMessage, type JevRequest, type JevResult, type ServerMessage } from './protocol.ts';

export type BridgeState = 'disabled' | 'connecting' | 'online' | 'offline' | 'refused';

export interface SocketLike {
  readyState: number;
  onopen: ((e: unknown) => void) | null;
  onclose: ((e: { code: number; reason: string }) => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface BridgeClientOptions {
  /** Per-launch token injected by `kit:dev` (virtual:kit-bridge); null when no bridge was started. */
  token: string | null;
  url?: string;
  tab?: string;
  createSocket?: (url: string) => SocketLike;
  /** Re-read the token after a bridge restart (GET /__kit/token through the Vite proxy). */
  fetchToken?: () => Promise<string | null>;
  backoff?: { baseMs: number; maxMs: number };
  /** Extra time the browser waits beyond a request's own budget before giving up on the bridge. */
  replyMarginMs?: number;
}

interface Pending { resolve: (r: JevResult) => void; timer: ReturnType<typeof setTimeout>; started: number }

const OPEN = 1;

export class BridgeClient {
  readonly state = ref<BridgeState>('disabled');
  readonly detail = ref('');
  readonly status = shallowRef<BridgeStatus | null>(null);
  readonly stats = { connects: 0, reconnects: 0, sent: 0 };
  private socket: SocketLike | null = null;
  private token: string | null;
  private writer = true;
  private stopped = true;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pending = new Map<string, Pending>();
  private serial = 0;
  private readonly url: string;
  private readonly tab: string;
  private readonly createSocket: (url: string) => SocketLike;
  private readonly fetchToken: () => Promise<string | null>;
  private readonly backoff: { baseMs: number; maxMs: number };
  private readonly replyMarginMs: number;
  private statusListeners = new Set<(s: BridgeStatus) => void>();

  constructor(options: BridgeClientOptions) {
    this.token = options.token;
    this.url = options.url ?? defaultUrl();
    this.tab = options.tab ?? Math.random().toString(36).slice(2, 10);
    this.createSocket = options.createSocket ?? (url => new WebSocket(url) as unknown as SocketLike);
    this.fetchToken = options.fetchToken ?? defaultFetchToken;
    this.backoff = options.backoff ?? { baseMs: 500, maxMs: 10000 };
    this.replyMarginMs = options.replyMarginMs ?? 1500;
  }

  get online() { return this.state.value === 'online'; }
  get jevReady() { return this.online && !!this.status.value && this.status.value.jev.state !== 'off' && !(this.status.value.jev.state === 'error' && this.status.value.jev.detail === 'auth'); }
  onStatus(listener: (s: BridgeStatus) => void) { this.statusListeners.add(listener); return () => this.statusListeners.delete(listener); }

  start() {
    if (!this.token) { this.state.value = 'disabled'; this.detail.value = 'AI offline: start the editor with `npm run kit:dev` to enable the AI bridge.'; return; }
    this.stopped = false;
    this.open();
  }

  stop() {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const s = this.socket; this.socket = null;
    if (s) { s.onclose = null; s.close(1000, 'stopped'); }
    this.failAll('network', 'The AI bridge connection was closed.');
    this.state.value = 'offline';
  }

  setWriter(writer: boolean) {
    this.writer = writer;
    this.post({ t: 'writer', writer });
  }

  telemetry(record: Record<string, unknown>) { this.post({ t: 'telemetry', record }); }

  /** Ask Jev through the bridge. Always resolves; when the bridge is unavailable the result says why. */
  askJev(request: JevRequest, options: { budgetMs?: number; signal?: AbortSignal } = {}): Promise<JevResult> {
    const started = performance.now();
    if (!this.online) return Promise.resolve({ ok: false, error: { kind: this.state.value === 'disabled' ? 'off' : 'network', message: this.detail.value || 'The AI bridge is not connected.' }, ms: 0 });
    if (options.signal?.aborted) return Promise.resolve({ ok: false, error: { kind: 'cancelled', message: 'Cancelled.' }, ms: 0 });
    const id = `j${++this.serial}`;
    return new Promise<JevResult>(resolve => {
      const budget = options.budgetMs ?? this.status.value?.jev.budgetMs ?? 1200;
      const timer = setTimeout(() => this.settle(id, { ok: false, error: { kind: 'timeout', message: 'The AI bridge did not answer in time.' }, ms: Math.round(performance.now() - started) }), budget + this.replyMarginMs);
      this.pending.set(id, { resolve, timer, started });
      options.signal?.addEventListener('abort', () => {
        this.post({ t: 'jev.cancel', id });
        this.settle(id, { ok: false, error: { kind: 'cancelled', message: 'Cancelled.' }, ms: Math.round(performance.now() - started) });
      }, { once: true });
      if (!this.post({ t: 'jev.ask', id, request, budgetMs: options.budgetMs })) this.settle(id, { ok: false, error: { kind: 'network', message: 'The AI bridge is not connected.' }, ms: 0 });
    });
  }

  // ---- connection ------------------------------------------------------------
  private open() {
    if (this.stopped) return;
    this.state.value = 'connecting';
    let socket: SocketLike;
    try { socket = this.createSocket(this.url); } catch (error) { this.scheduleRetry(`Could not open the AI bridge socket: ${String(error)}`); return; }
    this.socket = socket;
    let welcomed = false;
    socket.onopen = () => {
      socket.send(JSON.stringify({ t: 'hello', protocol: PROTOCOL_VERSION, token: this.token ?? '', tab: this.tab, writer: this.writer } satisfies ClientMessage));
    };
    socket.onmessage = event => {
      let message: ServerMessage;
      try { message = JSON.parse(String(event.data)) as ServerMessage; } catch { return; }
      if (!message || typeof message !== 'object') return;
      switch (message.t) {
        case 'welcome':
          welcomed = true;
          this.attempt = 0;
          this.stats.connects++;
          this.state.value = 'online';
          this.detail.value = '';
          this.setStatus(message.status);
          return;
        case 'status': this.setStatus(message.status); return;
        case 'jev.result': this.settle(message.id, message.result); return;
        case 'error':
          if (message.ref && this.pending.has(message.ref)) this.settle(message.ref, { ok: false, error: { kind: 'invalid', message: message.message }, ms: 0 });
          else if (!welcomed) this.detail.value = message.message;
          else console.warn(`[den-kit] bridge: ${message.message}`);
          return;
      }
    };
    socket.onerror = () => { /* onclose follows with the reason */ };
    socket.onclose = event => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.failAll('network', 'The AI bridge disconnected.');
      if (this.stopped) return;
      if (event.code === CLOSE.badOrigin) { this.refuse('AI bridge refused this page (origin). Open the editor at the address `npm run kit:dev` prints.'); return; }
      if (event.code === CLOSE.protocol) { this.refuse(`AI bridge speaks a different protocol${this.detail.value ? ` (${this.detail.value})` : ''}. Reload the page; if it persists, restart \`npm run kit:dev\`.`); return; }
      if (event.code === CLOSE.badToken) { void this.refreshToken(); return; }
      this.scheduleRetry(welcomed ? 'AI bridge disconnected; reconnecting…' : 'AI offline: the bridge is not running (start the editor with `npm run kit:dev`).');
    };
  }

  private async refreshToken() {
    const fresh = await this.fetchToken().catch(() => null);
    if (this.stopped) return;
    if (fresh && fresh !== this.token) { this.token = fresh; this.scheduleRetry('AI bridge restarted; reconnecting…', 0); return; }
    this.refuse('AI bridge rejected this page’s token. Reload the page.');
  }

  private refuse(message: string) { this.state.value = 'refused'; this.detail.value = message; }

  private scheduleRetry(message: string, delay?: number) {
    this.state.value = 'offline';
    this.detail.value = message;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const wait = delay ?? Math.min(this.backoff.maxMs, this.backoff.baseMs * 2 ** this.attempt) * (0.75 + Math.random() * 0.5);
    this.attempt = Math.min(this.attempt + 1, 16);
    if (this.attempt > 1) this.stats.reconnects++;
    this.retryTimer = setTimeout(() => { this.retryTimer = null; this.open(); }, wait);
  }

  /** Reconnect now (e.g. after the user restarted kit:dev). */
  retryNow() { if (this.state.value === 'online' || this.stopped) return; this.attempt = 0; this.scheduleRetry(this.detail.value, 0); }

  private post(message: ClientMessage): boolean {
    const s = this.socket;
    if (!s || s.readyState !== OPEN || this.state.value !== 'online') return false;
    try { s.send(JSON.stringify(message)); this.stats.sent++; return true; } catch { return false; }
  }

  private setStatus(status: BridgeStatus) {
    this.status.value = status;
    for (const l of this.statusListeners) l(status);
  }

  private settle(id: string, result: JevResult) {
    const p = this.pending.get(id);
    if (!p) return; // late or duplicate reply
    this.pending.delete(id);
    clearTimeout(p.timer);
    p.resolve(result);
  }

  private failAll(kind: 'network', message: string) {
    for (const [id, p] of [...this.pending]) this.settle(id, { ok: false, error: { kind, message }, ms: Math.round(performance.now() - p.started) });
  }
}

function defaultUrl() {
  if (typeof location === 'undefined') return `ws://127.0.0.1:5180${WS_PATH}`;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${WS_PATH}`;
}

async function defaultFetchToken(): Promise<string | null> {
  const res = await fetch('/__kit/token', { cache: 'no-store' });
  if (!res.ok) return null;
  const data = await res.json() as { token?: unknown };
  return typeof data.token === 'string' ? data.token : null;
}

// Page side of the local AI bridge: the AI interface (src/host/ai.ts) for the
// hosts that run the agent runtime behind a WebSocket bridge (desktop/ and dev/).
// Keeps one WebSocket open with backoff, forwards LLM events, and degrades to
// "AI offline" without blocking the editor.
import { shallowRef, ref } from 'vue';
import type {
  AI,
  AIAccount,
  AIConnection,
  AIWording,
  LlmInbound,
  LlmStartOptions,
} from '../../src/host/ai.ts';
import {
  CLOSE,
  PROTOCOL_VERSION,
  WS_PATH,
  type BridgeStatus,
  type ClientMessage,
  type ServerMessage,
  type ToolOutput,
} from '../../bridge/protocol.ts';

export type { LlmInbound, LlmStartOptions };
export type BridgeState = AIConnection;

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
  /** How this host words what happens to requests. */
  wording: AIWording;
  /** Signing in and choosing a model in den-kit, when this host offers it. */
  account?: AIAccount | null;
  /** Per-launch token injected by `dev` (virtual:kit-bridge); null when no bridge was started. */
  token: string | null;
  url?: string;
  tab?: string;
  createSocket?: (url: string) => SocketLike;
  /** Re-read the token after a bridge restart (GET /__kit/token through the Vite proxy). */
  fetchToken?: () => Promise<string | null>;
  backoff?: { baseMs: number; maxMs: number };
}

const OPEN = 1;

export class BridgeClient implements AI {
  readonly state = ref<BridgeState>('disabled');
  readonly detail = ref('');
  readonly status = shallowRef<BridgeStatus | null>(null);
  readonly stats = { connects: 0, reconnects: 0, sent: 0 };
  private socket: SocketLike | null = null;
  private token: string | null;
  private stopped = true;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly url: string;
  private readonly tab: string;
  private readonly createSocket: (url: string) => SocketLike;
  private readonly fetchToken: () => Promise<string | null>;
  private readonly backoff: { baseMs: number; maxMs: number };
  private statusListeners = new Set<(s: BridgeStatus) => void>();
  private llmListeners = new Set<(m: LlmInbound) => void>();

  readonly wording: AIWording;
  readonly account: AIAccount | null;

  constructor(options: BridgeClientOptions) {
    this.wording = options.wording;
    this.account = options.account ?? null;
    this.token = options.token;
    this.url = options.url ?? defaultUrl();
    this.tab = options.tab ?? Math.random().toString(36).slice(2, 10);
    this.createSocket =
      options.createSocket ?? (url => new WebSocket(url) as unknown as SocketLike);
    this.fetchToken = options.fetchToken ?? defaultFetchToken;
    this.backoff = options.backoff ?? { baseMs: 500, maxMs: 10000 };
  }

  get online() {
    return this.state.value === 'online';
  }
  onStatus(listener: (s: BridgeStatus) => void) {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }
  /** Codex is signed in and running. */
  get codexReady() {
    return this.online && this.status.value?.codex.state === 'ok';
  }
  onLlm(listener: (m: LlmInbound) => void) {
    this.llmListeners.add(listener);
    return () => {
      this.llmListeners.delete(listener);
    };
  }
  // LLM requests: false when the message could not be sent (offline).
  llmStart(
    id: string,
    text: string,
    instructions: string,
    thread?: string,
    options: LlmStartOptions = {},
  ) {
    return this.post({
      t: 'llm.start',
      id,
      text,
      instructions,
      ...(thread ? { thread } : {}),
      ...(options.role ? { role: options.role } : {}),
      ...(options.images?.length ? { images: options.images } : {}),
      ...(options.fork ? { fork: options.fork } : {}),
    });
  }
  llmSteer(id: string, target: string, text: string, images?: string[]) {
    return this.post({ t: 'llm.steer', id, target, text, ...(images?.length ? { images } : {}) });
  }
  llmStop(id: string) {
    return this.post({ t: 'llm.stop', id });
  }
  llmAnswer(id: string, question: string, answers: Record<string, string[]>) {
    return this.post({ t: 'llm.answer', id, question, answers });
  }
  llmForget(thread: string) {
    return this.post({ t: 'llm.forget', thread });
  }
  toolResult(id: string, callId: string, output: ToolOutput) {
    return this.post({ t: 'tool.result', id, callId, output });
  }
  codexRetry() {
    return this.post({ t: 'codex.retry' });
  }

  start() {
    if (!this.token) {
      this.state.value = 'disabled';
      this.detail.value =
        'AI offline: start the editor with `npm run dev` to enable the AI bridge.';
      return;
    }
    this.stopped = false;
    this.open();
  }

  stop() {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const s = this.socket;
    this.socket = null;
    if (s) {
      s.onclose = null;
      s.close(1000, 'stopped');
    }
    this.state.value = 'offline';
  }

  telemetry(record: Record<string, unknown>) {
    this.post({ t: 'telemetry', record });
  }

  // ---- connection ------------------------------------------------------------
  private open() {
    if (this.stopped) return;
    this.state.value = 'connecting';
    let socket: SocketLike;
    try {
      socket = this.createSocket(this.url);
    } catch (error) {
      this.scheduleRetry(`Could not open the AI bridge socket: ${String(error)}`);
      return;
    }
    this.socket = socket;
    let welcomed = false;
    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          t: 'hello',
          protocol: PROTOCOL_VERSION,
          token: this.token ?? '',
          tab: this.tab,
        } satisfies ClientMessage),
      );
    };
    socket.onmessage = event => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      if (!message || typeof message !== 'object') return;
      switch (message.t) {
        case 'welcome':
          welcomed = true;
          this.attempt = 0;
          this.stats.connects++;
          this.state.value = 'online';
          this.detail.value = '';
          this.setStatus(message.status);
          for (const l of this.llmListeners) l({ t: 'welcome', running: message.running ?? [] });
          return;
        case 'status':
          this.setStatus(message.status);
          return;
        case 'llm.event':
        case 'tool.call':
          for (const l of this.llmListeners) l(message);
          return;
        case 'error':
          if (message.ref)
            for (const l of this.llmListeners)
              l({ t: 'error', message: message.message, ref: message.ref });
          else if (!welcomed) this.detail.value = message.message;
          else console.warn(`[den-kit] bridge: ${message.message}`);
          return;
      }
    };
    socket.onerror = () => {
      /* onclose follows with the reason */
    };
    socket.onclose = event => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.stopped) return;
      if (event.code === CLOSE.badOrigin) {
        this.refuse(
          'AI bridge refused this page (origin). Open the editor at the address `npm run dev` prints.',
        );
        return;
      }
      if (event.code === CLOSE.protocol) {
        this.refuse(
          `AI bridge speaks a different protocol${this.detail.value ? ` (${this.detail.value})` : ''}. Reload the page; if it persists, restart \`npm run dev\`.`,
        );
        return;
      }
      if (event.code === CLOSE.badToken) {
        void this.refreshToken();
        return;
      }
      this.scheduleRetry(
        welcomed
          ? 'AI bridge disconnected; reconnecting…'
          : 'AI offline: the bridge is not running (start the editor with `npm run dev`).',
      );
    };
  }

  private async refreshToken() {
    const fresh = await this.fetchToken().catch(() => null);
    if (this.stopped) return;
    if (fresh && fresh !== this.token) {
      this.token = fresh;
      this.scheduleRetry('AI bridge restarted; reconnecting…', 0);
      return;
    }
    this.refuse('AI bridge rejected this page’s token. Reload the page.');
  }

  private refuse(message: string) {
    this.state.value = 'refused';
    this.detail.value = message;
  }

  private scheduleRetry(message: string, delay?: number) {
    this.state.value = 'offline';
    this.detail.value = message;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const wait =
      delay ??
      Math.min(this.backoff.maxMs, this.backoff.baseMs * 2 ** this.attempt) *
        (0.75 + Math.random() * 0.5);
    this.attempt = Math.min(this.attempt + 1, 16);
    if (this.attempt > 1) this.stats.reconnects++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, wait);
  }

  /** Reconnect now (e.g. after the user restarted dev). */
  retryNow() {
    if (this.state.value === 'online' || this.stopped) return;
    this.attempt = 0;
    this.scheduleRetry(this.detail.value, 0);
  }

  private post(message: ClientMessage): boolean {
    const s = this.socket;
    if (!s || s.readyState !== OPEN || this.state.value !== 'online') return false;
    try {
      s.send(JSON.stringify(message));
      this.stats.sent++;
      return true;
    } catch {
      return false;
    }
  }

  private setStatus(status: BridgeStatus) {
    this.status.value = status;
    for (const l of this.statusListeners) l(status);
  }
}

function defaultUrl() {
  if (typeof location === 'undefined') return `ws://127.0.0.1:5180${WS_PATH}`;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${WS_PATH}`;
}

async function defaultFetchToken(): Promise<string | null> {
  const res = await fetch('/__kit/token', { cache: 'no-store' });
  if (!res.ok) return null;
  const data = (await res.json()) as { token?: unknown };
  return typeof data.token === 'string' ? data.token : null;
}

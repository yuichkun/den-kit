// JSON-RPC over newline-delimited JSON (the Codex app-server stdio transport).
// Robust to what a child process can do: lines split across chunks (and UTF-8
// characters split across chunks), CRLF, blank or malformed lines, huge lines,
// late or unknown replies, back-pressure on stdin and a pipe that closes
// mid-write. Every pending request settles: with a result, an RpcError, an
// RpcTimeout or RpcClosed.
import type { Readable, Writable } from 'node:stream';
import type { RequestId, RpcNotification, RpcRequest } from './protocol.ts';

export class RpcError extends Error {
  readonly code: number;
  readonly data: unknown;
  readonly method: string;
  constructor(method: string, code: number, message: string, data?: unknown) { super(message); this.name = 'RpcError'; this.method = method; this.code = code; this.data = data; }
}
export class RpcTimeout extends Error {
  readonly method: string;
  constructor(method: string, ms: number) { super(`${method} got no reply within ${Math.round(ms / 1000)} s.`); this.name = 'RpcTimeout'; this.method = method; }
}
export class RpcClosed extends Error {
  constructor(message = 'The Codex app-server connection closed.') { super(message); this.name = 'RpcClosed'; }
}

export interface RpcHandlers {
  /** A request from the server; answer it with respond()/respondError(). */
  onRequest(request: RpcRequest): void;
  onNotification(notification: RpcNotification): void;
  onMalformed?(line: string, reason: string): void;
  onClose?(reason: string): void;
}

interface Pending { method: string; resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> | null }

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isId = (v: unknown): v is RequestId => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));

export class RpcPeer {
  readonly stats = { sent: 0, received: 0, malformed: 0, lateReplies: 0, oversized: 0 };
  private readonly output: Writable;
  private readonly handlers: RpcHandlers;
  private readonly maxLineChars: number;
  private readonly trace?: (direction: 'in' | 'out', line: string) => void;
  private pending = new Map<RequestId, Pending>();
  private serial = 0;
  private buffer = '';
  private skipping = false;
  private queue: string[] = [];
  private waitingDrain = false;
  private closedReason: string | null = null;

  constructor(input: Readable, output: Writable, handlers: RpcHandlers, options: { maxLineChars?: number; trace?: (direction: 'in' | 'out', line: string) => void } = {}) {
    this.output = output;
    this.handlers = handlers;
    this.maxLineChars = options.maxLineChars ?? 32 * 1024 * 1024;
    this.trace = options.trace;
    input.setEncoding('utf8'); // keeps multi-byte characters whole across chunks
    input.on('data', (chunk: string) => this.receive(chunk));
    input.on('end', () => this.close('The Codex app-server closed its output.'));
    input.on('error', error => this.close(`Reading from the Codex app-server failed: ${error.message}`));
    output.on('error', error => this.close(`Writing to the Codex app-server failed: ${error.message}`));
    output.on('drain', () => { this.waitingDrain = false; this.flush(); });
  }

  get closed() { return this.closedReason !== null; }
  get inFlight() { return this.pending.size; }

  request<T = unknown>(method: string, params?: unknown, options: { timeoutMs?: number } = {}): Promise<T> {
    if (this.closedReason !== null) return Promise.reject(new RpcClosed(this.closedReason));
    const id = ++this.serial;
    return new Promise<T>((resolve, reject) => {
      const timer = options.timeoutMs ? setTimeout(() => { if (this.pending.delete(id)) reject(new RpcTimeout(method, options.timeoutMs!)); }, options.timeoutMs) : null;
      this.pending.set(id, { method, resolve: resolve as (v: unknown) => void, reject, timer });
      this.write(params === undefined ? { id, method } : { id, method, params });
    });
  }

  notify(method: string, params?: unknown) { this.write(params === undefined ? { method } : { method, params }); }
  respond(id: RequestId, result: unknown) { this.write({ id, result }); }
  respondError(id: RequestId, code: number, message: string) { this.write({ id, error: { code, message } }); }

  /** Settle everything; later writes are dropped and later requests reject. */
  close(reason: string) {
    if (this.closedReason !== null) return;
    this.closedReason = reason;
    this.queue = [];
    for (const [id, p] of [...this.pending]) { this.pending.delete(id); if (p.timer) clearTimeout(p.timer); p.reject(new RpcClosed(reason)); }
    this.handlers.onClose?.(reason);
  }

  // ---- writing ----------------------------------------------------------------------------
  private write(message: unknown) {
    if (this.closedReason !== null) return;
    this.queue.push(`${JSON.stringify(message)}\n`);
    this.flush();
  }

  private flush() {
    while (this.queue.length && !this.waitingDrain && this.closedReason === null) {
      const line = this.queue.shift()!;
      this.stats.sent++;
      this.trace?.('out', line.slice(0, -1));
      try {
        if (!this.output.write(line)) this.waitingDrain = true;
      } catch (error) {
        this.close(`Writing to the Codex app-server failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  // ---- reading ------------------------------------------------------------------------------
  private receive(chunk: string) {
    let start = 0;
    for (let i = chunk.indexOf('\n'); i >= 0; i = chunk.indexOf('\n', start)) {
      const piece = chunk.slice(start, i);
      start = i + 1;
      if (this.skipping) { this.skipping = false; this.buffer = ''; continue; }
      if (this.buffer.length + piece.length > this.maxLineChars) { this.oversized(this.buffer + piece); this.buffer = ''; continue; }
      const line = this.buffer + piece;
      this.buffer = '';
      this.line(line.endsWith('\r') ? line.slice(0, -1) : line);
    }
    if (this.skipping) return;
    this.buffer += chunk.slice(start);
    if (this.buffer.length > this.maxLineChars) { this.oversized(this.buffer); this.buffer = ''; this.skipping = true; }
  }

  private oversized(text: string) {
    this.stats.oversized++;
    this.handlers.onMalformed?.(text.slice(0, 200), `line longer than ${this.maxLineChars} characters (dropped)`);
  }

  private line(text: string) {
    if (!text.trim()) return;
    this.trace?.('in', text);
    let message: unknown;
    try { message = JSON.parse(text); } catch { return this.malformed(text, 'not JSON'); }
    if (!isObject(message)) return this.malformed(text, 'not an object');
    this.stats.received++;
    if (typeof message.method === 'string') {
      if ('id' in message) {
        if (!isId(message.id)) return this.malformed(text, 'request id is not a string or number');
        this.handlers.onRequest({ id: message.id, method: message.method, params: message.params });
      } else this.handlers.onNotification({ method: message.method, params: message.params });
      return;
    }
    if (isId(message.id) && ('result' in message || 'error' in message)) {
      const pending = this.pending.get(message.id);
      if (!pending) { this.stats.lateReplies++; return; }
      this.pending.delete(message.id);
      if (pending.timer) clearTimeout(pending.timer);
      if ('error' in message) {
        const e = isObject(message.error) ? message.error : {};
        pending.reject(new RpcError(pending.method, typeof e.code === 'number' ? e.code : -32603, typeof e.message === 'string' ? e.message : 'Unknown error', e.data));
      } else pending.resolve(message.result);
      return;
    }
    this.malformed(text, 'neither a request, a notification nor a response');
  }

  private malformed(text: string, reason: string) {
    this.stats.malformed++;
    this.handlers.onMalformed?.(text.slice(0, 200), reason);
  }
}

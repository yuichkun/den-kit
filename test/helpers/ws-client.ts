// Tiny WebSocket test client for the bridge: queued messages and the close code.
import { WebSocket } from 'ws';
import type { ServerMessage } from '../../bridge/protocol.ts';

export interface TestSocket {
  ws: WebSocket;
  next(timeoutMs?: number): Promise<ServerMessage>;
  closed: Promise<{ code: number; reason: string }>;
  send(message: unknown): void;
  /** Skip messages until one of type t arrives (status pushes can interleave). */
  nextOf<T extends ServerMessage['t']>(
    t: T,
    timeoutMs?: number,
  ): Promise<Extract<ServerMessage, { t: T }>>;
}

export function connect(url: string, origin?: string): Promise<TestSocket> {
  const ws = new WebSocket(url, origin === undefined ? {} : { origin });
  const queue: ServerMessage[] = [];
  const waiters: Array<(m: ServerMessage) => void> = [];
  ws.on('message', data => {
    const m = JSON.parse(data.toString()) as ServerMessage;
    const w = waiters.shift();
    if (w) w(m);
    else queue.push(m);
  });
  const closed = new Promise<{ code: number; reason: string }>(resolve =>
    ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() })),
  );
  const socket: TestSocket = {
    ws,
    closed,
    send: message => ws.send(typeof message === 'string' ? message : JSON.stringify(message)),
    next: (timeoutMs = 3000) =>
      queue.length
        ? Promise.resolve(queue.shift()!)
        : new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error('no message within timeout')), timeoutMs);
            waiters.push(m => {
              clearTimeout(t);
              resolve(m);
            });
          }),
    async nextOf(t, timeoutMs = 3000) {
      const end = Date.now() + timeoutMs;
      for (;;) {
        const m = await socket.next(Math.max(1, end - Date.now()));
        if (m.t === t) return m as never;
      }
    },
  };
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(socket));
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });
}

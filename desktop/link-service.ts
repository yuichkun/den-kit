// The prototype's private stdio connection to the native Link peer. Only the
// trusted editor can submit validated commands; a work gets no process or IPC API.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { DesktopLinkState } from './page/api.ts';

export function linkCommand(value: unknown): string {
  if (!value || typeof value !== 'object') throw new Error('Invalid Link command.');
  const r = value as { type?: unknown; value?: unknown };
  if (r.type === 'status') return 'status';
  if (['enable', 'sync', 'play'].includes(String(r.type)) && typeof r.value === 'boolean')
    return `${r.type} ${r.value ? 1 : 0}`;
  if (
    r.type === 'tempo' &&
    typeof r.value === 'number' &&
    Number.isFinite(r.value) &&
    r.value >= 20 &&
    r.value <= 999
  )
    return `tempo ${r.value}`;
  throw new Error('Choose a tempo from 20 to 999 BPM or a valid Link control.');
}

function validState(value: unknown): value is DesktopLinkState {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  return (
    ['enabled', 'playing', 'startStopSync'].every(k => typeof s[k] === 'boolean') &&
    ['peers', 'tempo', 'beat', 'phase', 'timeUs', 'startTimeUs', 'transportTimeUs'].every(
      k => typeof s[k] === 'number' && Number.isFinite(s[k]),
    ) &&
    Number(s.peers) >= 0 &&
    Number(s.tempo) >= 20 &&
    Number(s.tempo) <= 999
  );
}

export class LinkService {
  private child: ChildProcessWithoutNullStreams | null = null;
  private serial = 0;
  private pending = new Map<
    number,
    {
      resolve: (state: DesktopLinkState) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(privatePath: string, args: string[] = []) {
    this.path = privatePath;
    this.args = args;
  }
  private readonly path: string;
  private readonly args: string[];

  private start() {
    if (this.child) return;
    const child = spawn(this.path, this.args, { stdio: 'pipe', windowsHide: true });
    this.child = child;
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      if (line.length > 8192)
        return this.fail('Link returned an invalid response. Reconnect Link.');
      let response: { id: number; ok: boolean; state?: unknown; error?: string };
      try {
        response = JSON.parse(line);
      } catch {
        return this.fail('Link returned an invalid response. Reconnect Link.');
      }
      if (!response || typeof response !== 'object')
        return this.fail('Link returned an invalid response. Reconnect Link.');
      const request = this.pending.get(response.id);
      if (!request) return;
      clearTimeout(request.timer);
      this.pending.delete(response.id);
      if (response.ok && validState(response.state)) request.resolve(response.state);
      else
        request.reject(
          new Error(response.error || 'Link returned an invalid state. Reconnect Link.'),
        );
    });
    // Drain diagnostics without exposing filesystem paths or unbounded native output in the UI.
    child.stderr.resume();
    child.stdin.on('error', () => {
      if (this.child === child) this.fail('Link disconnected. Turn Link off and on to reconnect.');
    });
    child.on('error', () => {
      if (this.child === child)
        this.fail('Link could not start. Rebuild the Link prototype and reopen it.');
    });
    child.on('exit', () => {
      lines.close();
      if (this.child === child) this.fail('Link disconnected. Turn Link off and on to reconnect.');
    });
  }

  request(value: unknown): Promise<DesktopLinkState> {
    const command = linkCommand(value);
    if (this.pending.size >= 8) return Promise.reject(new Error('Link is busy. Try again.'));
    this.start();
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.fail('Link is not responding. Turn Link off and on to reconnect.'),
        2000,
      );
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin.write(`${id} ${command}\n`);
    });
  }

  private fail(message: string) {
    const child = this.child;
    this.child = null;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(message));
    }
    this.pending.clear();
    child?.kill();
  }
  close() {
    this.fail('Link closed.');
  }
}

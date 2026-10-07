// FOR TESTS ONLY. A pod that is really the test machine's own bash, npm and
// files, reached over a WebSocket from test/fakes/pod/fake-pod.ts. It gives the
// cloud tests the same interface as BrowserPod (browserpod.ts), which needs an
// API key the tests do not have. It is used only when the test harness sets
// KIT_FAKE_POD_URL; `npm run kit:dev` never does.
import { PodUnavailable, keepEnd, type PodHost, type PodProcess, type PodRunOptions, type PodRunResult, type Portal } from './host.ts';

type Inbound =
  | { t: 'hello'; home: string }
  | { t: 'out'; id: string; text: string }
  | { t: 'exit'; id: string; code: number | null; timedOut: boolean }
  | { t: 'ok'; id: string }
  | { t: 'file'; id: string; content: string | null }
  | { t: 'portal'; url: string; port: number }
  | { t: 'error'; id?: string; message: string };

export async function connectFakePod(url: string): Promise<PodHost> {
  const socket = new WebSocket(url);
  const host = new FakePodHost(socket);
  await host.ready;
  return host;
}

class FakePodHost implements PodHost {
  readonly kind = 'fake' as const;
  home = '';
  readonly ready: Promise<void>;
  private seq = 0;
  private readonly waits = new Map<string, { out: string; onOutput?: (t: string) => void; done(m: Inbound): void }>();
  private readonly portals = new Map<number, string>();
  private readonly listeners = new Set<(p: Portal) => void>();
  private readonly socket: WebSocket;

  constructor(socket: WebSocket) {
    this.socket = socket;
    this.ready = new Promise((resolve, reject) => {
      socket.addEventListener('error', () => reject(new PodUnavailable('The test pod could not be reached.')));
      socket.addEventListener('message', e => {
        const m = JSON.parse(String(e.data)) as Inbound;
        if (m.t === 'hello') { this.home = m.home; resolve(); return; }
        if (m.t === 'portal') { this.portals.set(m.port, m.url); for (const l of this.listeners) l({ url: m.url, port: m.port }); return; }
        const id = 'id' in m ? m.id : undefined;
        const w = id ? this.waits.get(id) : undefined;
        if (!w) return;
        if (m.t === 'out') { w.out = keepEnd(w.out + m.text); w.onOutput?.(m.text); return; }
        w.done(m);
      });
    });
  }

  private send(message: Record<string, unknown>) { this.socket.send(JSON.stringify(message)); }

  run(script: string, options: PodRunOptions = {}): Promise<PodRunResult> {
    const id = `r${++this.seq}`, started = performance.now();
    return new Promise(resolve => {
      this.waits.set(id, {
        out: '', onOutput: options.onOutput,
        done: m => {
          const w = this.waits.get(id)!; this.waits.delete(id);
          const exit = m as Extract<Inbound, { t: 'exit' }>;
          resolve({ exitCode: m.t === 'exit' ? exit.code : null, output: (m.t === 'error' ? `${w.out}\n${m.message}` : w.out).trim(), timedOut: m.t === 'exit' && exit.timedOut, ms: Math.round(performance.now() - started) });
        },
      });
      this.send({ t: 'run', id, script, cwd: options.cwd ?? this.home, env: options.env, timeoutMs: options.timeoutMs });
    });
  }

  start(name: string, script: string, options: Omit<PodRunOptions, 'timeoutMs'> = {}): PodProcess {
    const id = `s${++this.seq}`;
    let running = true, out = '';
    const done = new Promise<void>(resolve => {
      this.waits.set(id, { out: '', onOutput: text => { out = keepEnd(out + text, 64_000); options.onOutput?.(text); }, done: () => { this.waits.delete(id); running = false; resolve(); } });
    });
    this.send({ t: 'start', id, name, script, cwd: options.cwd ?? this.home, env: options.env });
    return { name, done, get running() { return running; }, output: () => out };
  }

  private request(message: Record<string, unknown>): Promise<Inbound> {
    const id = `q${++this.seq}`;
    return new Promise(resolve => { this.waits.set(id, { out: '', done: m => { this.waits.delete(id); resolve(m); } }); this.send({ ...message, id }); });
  }
  async writeFile(path: string, content: string): Promise<void> {
    const m = await this.request({ t: 'write', path, content });
    if (m.t === 'error') throw new Error(m.message);
  }
  async readFile(path: string): Promise<string | null> {
    const m = await this.request({ t: 'read', path });
    return m.t === 'file' ? m.content : null;
  }
  onPortal(listener: (portal: Portal) => void): () => void {
    this.listeners.add(listener);
    for (const [port, url] of this.portals) listener({ url, port });
    return () => { this.listeners.delete(listener); };
  }
  dispose() { this.socket.close(); }
}

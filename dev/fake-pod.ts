// FOR TESTS ONLY. A pod that is really the test machine's own bash, npm and
// files, reached over a WebSocket from test/fakes/pod/fake-pod.ts. It gives the
// cloud tests the same interface as BrowserPod (browserpod.ts), which needs an
// API key the tests do not have. It is used only when the test harness sets
// KIT_FAKE_POD_URL; `vp run dev` never does.
import type {
  PodHost,
  PodProcess,
  PodRunOptions,
  PodRunResult,
  Portal,
} from '../src/host/workspace.ts';
import { PodUnavailable, keepEnd } from '../src/workspace/pod-io.ts';

type Inbound =
  | { t: 'hello'; home: string }
  | { t: 'out'; id: string; text: string }
  | { t: 'exit'; id: string; code: number | null; timedOut: boolean }
  | { t: 'ok'; id: string }
  | { t: 'file'; id: string; content: string | null }
  | { t: 'portal'; url: string; port: number }
  | { t: 'error'; id?: string; message: string };

/** Bytes as base64, the way they go over the socket. */
function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** A pod for one work's disk (a home of its own on the test machine). */
export async function connectFakePod(url: string, disk: string): Promise<PodHost> {
  const address = new URL(url);
  address.searchParams.set('disk', disk);
  const socket = new WebSocket(address);
  const host = new FakePodHost(socket);
  await host.ready;
  return host;
}

class FakePodHost implements PodHost {
  readonly kind = 'fake' as const;
  home = '';
  readonly ready: Promise<void>;
  private seq = 0;
  private readonly waits = new Map<
    string,
    { out: string; onOutput?: (t: string) => void; done(m: Inbound): void }
  >();
  private readonly portals = new Map<number, string>();
  /** The machine is the test machine: closed, commands get a proxy that leads nowhere. */
  private online = false;
  private readonly listeners = new Set<(p: Portal) => void>();
  private readonly socket: WebSocket;

  constructor(socket: WebSocket) {
    this.socket = socket;
    this.ready = new Promise((resolve, reject) => {
      socket.addEventListener('error', () =>
        reject(new PodUnavailable('The test pod could not be reached.')),
      );
      socket.addEventListener('message', e => {
        const m = JSON.parse(String(e.data)) as Inbound;
        if (m.t === 'hello') {
          this.home = m.home;
          resolve();
          return;
        }
        if (m.t === 'portal') {
          this.portals.set(m.port, m.url);
          for (const l of this.listeners) l({ url: m.url, port: m.port });
          return;
        }
        const id = 'id' in m ? m.id : undefined;
        const w = id ? this.waits.get(id) : undefined;
        if (!w) return;
        if (m.t === 'out') {
          w.out = keepEnd(w.out + m.text);
          w.onOutput?.(m.text);
          return;
        }
        w.done(m);
      });
    });
  }

  private send(message: Record<string, unknown>) {
    this.socket.send(JSON.stringify(message));
  }

  network(open: boolean) {
    this.online = open;
  }
  /** What the network being closed looks like to a command: every proxy points at a port nothing answers. */
  private env(env?: Record<string, string>): Record<string, string> | undefined {
    if (this.online) return env;
    const nowhere = 'http://127.0.0.1:9';
    return {
      ...env,
      HTTP_PROXY: nowhere,
      HTTPS_PROXY: nowhere,
      ALL_PROXY: nowhere,
      http_proxy: nowhere,
      https_proxy: nowhere,
      all_proxy: nowhere,
      npm_config_proxy: nowhere,
      npm_config_https_proxy: nowhere,
      NODE_USE_ENV_PROXY: '1',
    };
  }

  run(script: string, options: PodRunOptions = {}): Promise<PodRunResult> {
    const id = `r${++this.seq}`,
      started = performance.now();
    return new Promise(resolve => {
      this.waits.set(id, {
        out: '',
        onOutput: options.onOutput,
        done: m => {
          const w = this.waits.get(id)!;
          this.waits.delete(id);
          const exit = m as Extract<Inbound, { t: 'exit' }>;
          resolve({
            exitCode: m.t === 'exit' ? exit.code : null,
            output: (m.t === 'error' ? `${w.out}\n${m.message}` : w.out).trim(),
            timedOut: m.t === 'exit' && exit.timedOut,
            ms: Math.round(performance.now() - started),
          });
        },
      });
      this.send({
        t: 'run',
        id,
        script,
        cwd: options.cwd ?? this.home,
        env: this.env(options.env),
        timeoutMs: options.timeoutMs,
      });
    });
  }

  start(name: string, script: string, options: Omit<PodRunOptions, 'timeoutMs'> = {}): PodProcess {
    const id = `s${++this.seq}`;
    let running = true,
      out = '';
    const done = new Promise<void>(resolve => {
      this.waits.set(id, {
        out: '',
        onOutput: text => {
          out = keepEnd(out + text, 64_000);
          options.onOutput?.(text);
        },
        done: () => {
          this.waits.delete(id);
          running = false;
          resolve();
        },
      });
    });
    this.send({
      t: 'start',
      id,
      name,
      script,
      cwd: options.cwd ?? this.home,
      env: this.env(options.env),
    });
    return {
      name,
      done,
      get running() {
        return running;
      },
      output: () => out,
      stop: async () => {
        if (running) this.send({ t: 'stop', id });
        await done;
      },
    };
  }

  async stopAll(): Promise<void> {
    await this.request({ t: 'stopAll' });
  }

  private request(message: Record<string, unknown>): Promise<Inbound> {
    const id = `q${++this.seq}`;
    return new Promise(resolve => {
      this.waits.set(id, {
        out: '',
        done: m => {
          this.waits.delete(id);
          resolve(m);
        },
      });
      this.send({ ...message, id });
    });
  }
  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    const m = await this.request(
      typeof content === 'string'
        ? { t: 'write', path, content }
        : { t: 'write', path, content: base64(content), base64: true },
    );
    if (m.t === 'error') throw new Error(m.message);
  }
  async readFile(path: string): Promise<string | null> {
    const m = await this.request({ t: 'read', path });
    return m.t === 'file' ? m.content : null;
  }
  onPortal(listener: (portal: Portal) => void): () => void {
    this.listeners.add(listener);
    for (const [port, url] of this.portals) listener({ url, port });
    return () => {
      this.listeners.delete(listener);
    };
  }
  dispose() {
    this.socket.close();
  }
}

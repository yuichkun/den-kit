// FOR TESTS ONLY: stands in for BrowserPod (which needs an API key the cloud
// tests do not have). The page talks to it through dev/fake-pod.ts over a
// WebSocket; commands run in this machine's bash, in a temporary home (one per
// disk the page asks for: a work's disk, like BrowserPod's storage key), and a
// server they start is reported as a "portal" (its local address). Commands run
// with the test machine's own tools, so it checks den-kit's side of the pod
// (files, commands, the dev server, the code parts), not BrowserPod itself.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';

export interface FakePod {
  url: string;
  /** The home of a page that names no disk. */
  home: string;
  /** The home of a disk. */
  homeOf(disk: string): string;
  close(): Promise<void>;
  /** Commands the page ran (scripts), for tests to inspect. */ commands: string[];
}

async function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.unref();
    s.on('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as AddressInfo).port;
      s.close(() => ok(p));
    });
  });
}

export async function startFakePod(options: { root?: string } = {}): Promise<FakePod> {
  const root = options.root ?? mkdtempSync(join(tmpdir(), 'den-kit-fake-pod-'));
  const home = join(root, 'home');
  const homeOf = (disk: string) => join(root, 'disks', disk.replace(/[^\w-]/g, '_'));
  mkdirSync(join(home, '.den-kit', 'run'), { recursive: true });
  const children = new Set<ChildProcess>();
  const commands: string[] = [];
  let scripts = 0;
  const env = {
    ...process.env,
    CI: '1',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    npm_config_progress: 'false',
    npm_config_fund: 'false',
    npm_config_audit: 'false',
    npm_config_update_notifier: 'false',
  };

  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise(r => wss.once('listening', r));
  const port = (wss.address() as AddressInfo).port;

  wss.on('connection', (socket: WebSocket, request) => {
    const disk = new URL(request.url ?? '/', 'http://pod').searchParams.get('disk');
    const home = disk ? homeOf(disk) : join(root, 'home');
    mkdirSync(join(home, '.den-kit', 'run'), { recursive: true });
    const inside = (p: string) => {
      const abs = resolve(p);
      return abs === home || abs.startsWith(`${home}/`) ? abs : null;
    };
    const baseEnv = { ...env, HOME: home };
    const send = (m: Record<string, unknown>) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(m));
    };
    // Like BrowserPod, whose pod lives in the tab: the page going away stops what it started.
    const mine = new Set<ChildProcess>();
    socket.on('close', () => {
      for (const c of mine) {
        try {
          process.kill(-c.pid!, 'SIGKILL');
        } catch {
          /* gone */
        }
      }
    });
    send({ t: 'hello', home });
    socket.on('message', async raw => {
      let m: Record<string, unknown>;
      try {
        m = JSON.parse(String(raw));
      } catch {
        return;
      }
      const id = String(m.id ?? '');
      try {
        if (m.t === 'write') {
          const p = inside(String(m.path));
          if (!p) throw new Error(`${m.path} is outside the pod's home.`);
          mkdirSync(dirname(p), { recursive: true });
          writeFileSync(p, String(m.content ?? ''));
          send({ t: 'ok', id });
          return;
        }
        if (m.t === 'read') {
          const p = inside(String(m.path));
          send({ t: 'file', id, content: p && existsSync(p) ? readFileSync(p, 'utf8') : null });
          return;
        }
        if (m.t === 'run' || m.t === 'start') {
          const script = String(m.script ?? '');
          commands.push(script);
          const file = join(
            home,
            '.den-kit',
            'run',
            `${m.t === 'start' ? `start-${String(m.name ?? 'proc').replace(/[^a-z0-9-]/gi, '')}` : ++scripts % 64}.sh`,
          );
          writeFileSync(file, `${script}\n`);
          const env: Record<string, string | undefined> = {
            ...baseEnv,
            ...(m.env as Record<string, string> | undefined),
          };
          // A server asked for a port gets a free one here (several tests run servers); its portal says the port it asked for.
          const asked = env.PORT ? Number(env.PORT) : null;
          if (asked) env.PORT = String(await freePort());
          const cwd = inside(String(m.cwd ?? home)) ?? home;
          mkdirSync(cwd, { recursive: true });
          const child = spawn('bash', [file], {
            cwd,
            env,
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          children.add(child);
          mine.add(child);
          let portalSent = false,
            timedOut = false;
          const onData = (b: Buffer) => {
            const text = b.toString('utf8');
            send({ t: 'out', id, text });
            if (m.t === 'start' && !portalSent) {
              const found = /https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/.exec(
                text.replace(/\x1b\[[0-9;]*m/g, ''),
              );
              if (found) {
                portalSent = true;
                send({
                  t: 'portal',
                  url: `http://127.0.0.1:${found[1]}/`,
                  port: asked ?? Number(found[1]),
                });
              }
            }
          };
          child.stdout!.on('data', onData);
          child.stderr!.on('data', onData);
          const timer =
            m.t === 'run' && typeof m.timeoutMs === 'number'
              ? setTimeout(() => {
                  timedOut = true;
                  try {
                    process.kill(-child.pid!, 'SIGINT');
                  } catch {
                    /* gone */
                  }
                  setTimeout(() => {
                    try {
                      process.kill(-child.pid!, 'SIGKILL');
                    } catch {
                      /* gone */
                    }
                  }, 1500);
                }, m.timeoutMs)
              : null;
          child.on('close', code => {
            if (timer) clearTimeout(timer);
            children.delete(child);
            mine.delete(child);
            send({ t: 'exit', id, code: timedOut ? null : code, timedOut });
          });
          return;
        }
      } catch (error) {
        send({ t: 'error', id, message: error instanceof Error ? error.message : String(error) });
      }
    });
  });

  return {
    url: `ws://127.0.0.1:${port}/`,
    home,
    homeOf,
    commands,
    async close() {
      for (const c of children) {
        try {
          process.kill(-c.pid!, 'SIGKILL');
        } catch {
          /* gone */
        }
      }
      await new Promise(r => wss.close(() => r(undefined)));
      if (!options.root) rmSync(root, { recursive: true, force: true });
    },
  };
}

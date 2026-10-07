// FOR TESTS ONLY: an object with BrowserPod's API (the @leaningtech/browserpod
// 3.4.0 typings) that does its work with this machine's processes and files, so
// den-kit's BrowserPod adapter (src/pod/browserpod.ts) runs its real code without
// an API key. It follows what BrowserPod's documentation says, taking the
// harder reading where the documentation is silent:
// - run() resolves when the program exits, with an opaque Process and no exit status;
// - the program's output reaches the terminal's onOutput as raw bytes, in pieces
//   that may split lines (and UTF-8 characters);
// - `env` is the program's whole environment (nothing is inherited), and without
//   `env` the program gets the pod's own (HOME, PATH, and here this machine's
//   network settings, which npm needs in this environment);
// - createFile() wipes an existing file; read(length) may return less than asked;
// - a server that listens on a port is announced through onPortal.
import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readSync, writeSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { dirname } from 'node:path';

interface Terminal { write(data: string): void }
const freePort = () => new Promise<number>((ok, fail) => { const s = createServer(); s.unref(); s.on('error', fail); s.listen(0, '127.0.0.1', () => { const p = (s.address() as AddressInfo).port; s.close(() => ok(p)); }); });

export class MockBrowserPod {
  /** Every run: the program, its arguments and the environment it got (for tests). */
  readonly runs: Array<{ executable: string; args: string[]; env?: string[]; cwd?: string }> = [];
  private portalListeners: Array<(p: { url: string; port: number }) => void> = [];
  private children = new Set<ChildProcess>();
  private readonly home: string;
  private readonly path: string;
  /** Output pieces are cut at this size (to split lines and characters). */
  private readonly chunk: number;

  constructor(options: { home: string; path?: string; chunk?: number }) {
    this.home = options.home; this.path = options.path ?? process.env.PATH ?? '/usr/bin:/bin'; this.chunk = options.chunk ?? 7;
  }

  async createCustomTerminal(opts: { cols?: number; rows?: number; onOutput: (buffer: ArrayBuffer) => void }): Promise<Terminal & { attach(child: ChildProcess): void; output: (b: Buffer) => void }> {
    let child: ChildProcess | null = null;
    return {
      write: (data: string) => { if (data.includes('\x03') && child?.pid) { try { process.kill(-child.pid, 'SIGINT'); } catch { /* gone */ } } },
      attach: (c: ChildProcess) => { child = c; },
      output: (b: Buffer) => { for (let i = 0; i < b.length; i += this.chunk) { const piece = b.subarray(i, i + this.chunk); opts.onOutput(piece.buffer.slice(piece.byteOffset, piece.byteOffset + piece.byteLength) as ArrayBuffer); } },
    };
  }

  async run(executable: string, args: string[], opts: { terminal: Terminal; env?: string[]; cwd?: string; echo?: boolean }): Promise<object> {
    this.runs.push({ executable, args, env: opts.env, cwd: opts.cwd });
    // The pod's own environment is this machine's (its network settings too: npm needs them here), with the pod's home.
    const own = { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string')), HOME: this.home, PATH: this.path, USER: 'user' };
    const env: Record<string, string> = opts.env ? Object.fromEntries(opts.env.map(kv => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)])) : own;
    // A server asked for a port gets a free one here (several tests run servers); its portal says the port it asked for.
    const asked = env.PORT ? Number(env.PORT) : null;
    if (asked) env.PORT = String(await freePort());
    const terminal = opts.terminal as Terminal & { attach(child: ChildProcess): void; output: (b: Buffer) => void };
    const child = spawn(executable, args, { cwd: opts.cwd ?? '/', env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.children.add(child);
    terminal.attach(child);
    let announced = false;
    const out = (b: Buffer) => {
      terminal.output(b);
      // (Only a server, given a PORT, is announced: other output may print addresses too, a proxy's for one.)
      if (asked && !announced) {
        const m = /https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/.exec(b.toString('utf8').replace(/\x1b\[[0-9;]*m/g, ''));
        if (m) { announced = true; for (const l of this.portalListeners) l({ url: `http://127.0.0.1:${m[1]}/`, port: asked ?? Number(m[1]) }); }
      }
    };
    child.stdout!.on('data', out); child.stderr!.on('data', out);
    return new Promise(resolve => child.on('close', () => { this.children.delete(child); resolve({}); }));
  }

  onPortal(cb: (args: { url: string; port: number }) => void): void { this.portalListeners.push(cb); }
  onOpen(): void { /* not used */ }

  async createDirectory(path: string, opts?: { recursive?: boolean }): Promise<void> { mkdirSync(path, { recursive: !!opts?.recursive }); }

  async createFile(path: string, mode: string) {
    if (mode !== 'binary' && mode !== 'utf-8') throw new Error(`createFile: bad mode "${mode}"`);
    if (!existsSync(dirname(path))) throw new Error(`createFile: no directory ${dirname(path)}`);
    return this.file(openSync(path, 'w+'));
  }
  async openFile(path: string, mode: string) {
    if (mode !== 'binary' && mode !== 'utf-8') throw new Error(`openFile: bad mode "${mode}"`);
    if (!existsSync(path)) throw new Error(`openFile: no file ${path}`);
    return this.file(openSync(path, 'r+'));
  }
  private file(fd: number) {
    let position = 0;
    return {
      write: async (data: ArrayBuffer) => { const n = writeSync(fd, new Uint8Array(data), 0, data.byteLength, position); position += n; return n; },
      // Never more than 1000 bytes at a time: callers must loop.
      read: async (length: number) => { const buf = Buffer.alloc(Math.min(length, 1000)); const n = readSync(fd, buf, 0, buf.length, position); position += n; return buf.buffer.slice(buf.byteOffset, buf.byteOffset + n); },
      getSize: async () => fstatSync(fd).size,
      close: async () => { closeSync(fd); },
    };
  }

  /** Stop everything it started (the tab closing). */
  dispose() { for (const c of this.children) { try { process.kill(-c.pid!, 'SIGKILL'); } catch { /* gone */ } } }
}

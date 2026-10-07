// The real pod: BrowserPod (Leaning Technologies) — a Linux-like machine compiled
// to WebAssembly that runs inside this browser tab, with bash, git, Node and npm.
// Its runtime loads from rt.browserpod.io when the first pod boots; nothing of it
// is fetched when no API key is set. The page must be cross-origin isolated
// (vite.config.ts sends COOP and COEP).
//
// BrowserPod's API runs a program with a terminal and reports nothing back but
// what the terminal shows, so each command runs as a script file followed by a
// line that prints its exit status (host.ts); output is read from a terminal of
// our own (createCustomTerminal), one per command.
import type { BrowserPod as Pod } from '@leaningtech/browserpod';
import { MAX_OUTPUT, PodUnavailable, cleanOutput, exitMarker, keepEnd, newNonce, readExit, runnerLine, type PodHost, type PodProcess, type PodRunOptions, type PodRunResult, type Portal } from './host.ts';

export interface BrowserPodOptions {
  apiKey: string;
  /** The pod's disk is kept in this browser (IndexedDB) under this key, so installed packages survive a reload. */
  storageKey?: string;
  log?(line: string): void;
}

const env = (vars: Record<string, string> | undefined) => Object.entries({ CI: '1', NO_COLOR: '1', FORCE_COLOR: '0', TERM: 'dumb', npm_config_progress: 'false', npm_config_fund: 'false', npm_config_audit: 'false', ...vars }).map(([k, v]) => `${k}=${v}`);

export async function bootBrowserPod(options: BrowserPodOptions): Promise<PodHost> {
  if (!globalThis.crossOriginIsolated) throw new PodUnavailable('This page is not cross-origin isolated, which BrowserPod needs.', 'Open den-kit through `npm run kit:dev` (it sends the COOP and COEP headers).');
  let mod: typeof import('@leaningtech/browserpod');
  try { mod = await import('@leaningtech/browserpod'); } catch (error) { throw new PodUnavailable(`The BrowserPod package could not be loaded: ${error instanceof Error ? error.message : String(error)}`, 'Run `npm ci` in kit/.'); }
  if (!mod.BrowserPod) throw new PodUnavailable('The BrowserPod runtime could not be loaded from rt.browserpod.io.', 'Check the network connection, then reload.');
  let pod: Pod;
  try { pod = await mod.BrowserPod.boot({ apiKey: options.apiKey, storageKey: options.storageKey }); } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PodUnavailable(`BrowserPod did not start: ${message}`, /key|auth|401|403|token/i.test(message) ? 'Check BROWSERPOD_API_KEY in kit/.env (console.browserpod.io), then restart `npm run kit:dev`.' : undefined);
  }
  const host = new BrowserPodHost(pod, options.log);
  await host.init();
  return host;
}

class BrowserPodHost implements PodHost {
  readonly kind = 'browserpod' as const;
  home = '/home/user';
  private readonly portals = new Map<number, string>();
  private readonly listeners = new Set<(p: Portal) => void>();
  private scripts = 0;
  private readonly pod: Pod;
  private readonly log?: (line: string) => void;

  constructor(pod: Pod, log?: (line: string) => void) {
    this.pod = pod; this.log = log;
    pod.onPortal(({ url, port }) => {
      this.portals.set(port, url);
      this.log?.(`portal ${port} → ${url}`);
      for (const l of this.listeners) l({ url, port });
    });
  }

  /** Where home is (scripts and the project live under it). */
  async init() {
    const nonce = newNonce();
    const r = await this.exec(['-c', `printf '%s' "$HOME"; printf '\\n${exitMarker(nonce)}%d>>\\n' $?`], nonce, { timeoutMs: 60_000 });
    const home = r.output.trim().split('\n').at(-1)?.trim();
    if (home && home.startsWith('/')) this.home = home;
    const dir = `${this.home}/.den-kit/run`;
    await this.pod.createDirectory(dir, { recursive: true }).catch(() => undefined);
  }

  async run(script: string, options: PodRunOptions = {}): Promise<PodRunResult> {
    const nonce = newNonce();
    const path = `${this.home}/.den-kit/run/${++this.scripts % 64}.sh`;
    await this.writeFile(path, `${script.replace(/\s+$/, '')}\n`);
    return this.exec(['-c', runnerLine(nonce), 'den-kit', options.cwd ?? this.home, path], nonce, options);
  }

  private async exec(args: string[], nonce: string, options: PodRunOptions): Promise<PodRunResult> {
    const started = performance.now();
    const decoder = new TextDecoder();
    let raw = '', seen = 0, settled = false;
    let resolveMarker!: () => void;
    const marked = new Promise<void>(r => { resolveMarker = r; });
    const terminal = await this.pod.createCustomTerminal({
      cols: 200, rows: 50,
      onOutput: buffer => {
        raw += decoder.decode(buffer, { stream: true });
        if (raw.length > MAX_OUTPUT * 2) raw = raw.slice(raw.length - MAX_OUTPUT * 2);
        const text = cleanOutput(raw);
        if (options.onOutput && text.length > seen) { const fresh = text.slice(seen); seen = text.length; const shown = fresh.split(exitMarker(nonce))[0]!; if (shown) options.onOutput(shown); }
        if (readExit(text, nonce)) resolveMarker();
      },
    });
    const ran = this.pod.run('bash', args, { terminal, cwd: options.cwd ?? this.home, env: env(options.env), echo: false }).catch(error => { raw += `\n${error instanceof Error ? error.message : String(error)}\n`; });
    let timedOut = false;
    const timer = options.timeoutMs ? new Promise<void>(r => setTimeout(() => { if (!settled) { timedOut = true; terminal.write('\x03'); } r(); }, options.timeoutMs)) : null;
    // The marker is the end; the run itself ending (without one) is too. A timeout gives it two more seconds to print.
    await Promise.race([marked, ran.then(() => new Promise(r => setTimeout(r, 300))), ...(timer ? [timer.then(() => Promise.race([marked, new Promise(r => setTimeout(r, 2000))]))] : [])]);
    settled = true;
    const text = cleanOutput(raw);
    const found = readExit(text, nonce);
    return { exitCode: timedOut ? null : found?.exitCode ?? null, output: keepEnd((found?.output ?? text).trim()), timedOut, ms: Math.round(performance.now() - started) };
  }

  start(name: string, script: string, options: Omit<PodRunOptions, 'timeoutMs'> = {}): PodProcess {
    let out = '', running = true;
    const decoder = new TextDecoder();
    const self = this;
    const done = (async () => {
      const path = `${this.home}/.den-kit/run/${name.replace(/[^a-z0-9-]/gi, '')}.sh`;
      await this.writeFile(path, `${script.replace(/\s+$/, '')}\n`);
      const terminal = await this.pod.createCustomTerminal({
        cols: 200, rows: 50,
        onOutput: buffer => { const text = cleanOutput(decoder.decode(buffer, { stream: true })); out = keepEnd(out + text, 64_000); if (text) options.onOutput?.(text); },
      });
      await this.pod.run('bash', [path], { terminal, cwd: options.cwd ?? this.home, env: env(options.env), echo: false });
    })().catch(error => { out += `\n${error instanceof Error ? error.message : String(error)}`; }).finally(() => { running = false; self.log?.(`${name} ended`); });
    return { name, done, get running() { return running; }, output: () => out };
  }

  async writeFile(path: string, content: string): Promise<void> {
    const dir = path.slice(0, path.lastIndexOf('/'));
    if (dir) await this.pod.createDirectory(dir, { recursive: true }).catch(() => undefined);
    const bytes = new TextEncoder().encode(content);
    const write = async () => {
      const file = await this.pod.createFile(path, 'binary') as import('@leaningtech/browserpod').BinaryFile;
      try { await file.write(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer); return await file.getSize(); } finally { await file.close(); }
    };
    // If creating a file does not empty an existing one, a shorter text would keep the old tail: remove it and write again.
    if (await write() !== bytes.byteLength) {
      await this.run(`rm -f -- ${JSON.stringify(path)}`, { timeoutMs: 20_000 });
      if (await write() !== bytes.byteLength) throw new Error(`Writing ${path} left a file of the wrong size.`);
    }
  }

  async readFile(path: string): Promise<string | null> {
    let file: import('@leaningtech/browserpod').BinaryFile;
    try { file = await this.pod.openFile(path, 'binary') as import('@leaningtech/browserpod').BinaryFile; } catch { return null; }
    try {
      const size = await file.getSize();
      if (size === 0) return '';
      const chunks: Uint8Array[] = [];
      let got = 0;
      while (got < size) { const part = new Uint8Array(await file.read(size - got)); if (!part.byteLength) break; chunks.push(part); got += part.byteLength; }
      const all = new Uint8Array(got); let at = 0; for (const c of chunks) { all.set(c, at); at += c.byteLength; }
      return new TextDecoder().decode(all);
    } catch { return null; } finally { await file.close().catch(() => undefined); }
  }

  onPortal(listener: (portal: Portal) => void): () => void {
    this.listeners.add(listener);
    for (const [port, url] of this.portals) listener({ url, port });
    return () => { this.listeners.delete(listener); };
  }
}

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

/** Quiet, colourless tools (their output goes to den-kit's log and to the AI). */
const QUIET = { CI: '1', NO_COLOR: '1', FORCE_COLOR: '0', TERM: 'dumb', npm_config_progress: 'false', npm_config_fund: 'false', npm_config_audit: 'false', npm_config_update_notifier: 'false' };
/** Set by the shell itself; not carried over from the pod's environment. */
const SHELL_OWN = new Set(['PWD', 'OLDPWD', 'SHLVL', '_']);
/** `env` lines (KEY=value), or `export -p` lines (declare -x KEY="value") when there is no env. */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const plain = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    const declared = /^declare -x ([A-Za-z_][A-Za-z0-9_]*)="(.*)"$/.exec(line);
    if (declared) out[declared[1]!] = declared[2]!.replace(/\\(["\\$`])/g, '$1');
    else if (plain) out[plain[1]!] = plain[2]!;
  }
  for (const k of SHELL_OWN) delete out[k];
  return out;
}

/** What decides whether this tab can be cross-origin isolated. */
export interface PageFacts {
  href: string;
  /** A secure context (https, or http on 127.0.0.1 / localhost). */
  secure: boolean;
  /** Shown inside another page (an app's preview, a frame). */
  framed: boolean;
  /** The isolation headers the server sends with this page (null: it could not be read). */
  headers: { coop: string | null; coep: string | null } | null;
  /** A service worker answers this page's loads (den-kit has none: one left here by another app). */
  serviceWorker: boolean;
}
/** Why this tab is not cross-origin isolated, and what fixes it (the checks in the order that decides). */
export function isolationProblem(f: PageFacts): { reason: string; fix: string } {
  const origin = new URL(f.href).origin;
  if (!f.secure) return { reason: `${origin} is not a secure address, so the browser ignores the isolation headers`, fix: 'Open http://127.0.0.1:5180/ (or http://localhost:5180/) on the Mac running `npm run kit:dev`, not a network address.' };
  if (f.framed) return { reason: 'den-kit is shown inside another page (an app\'s preview or a frame), which cannot be isolated', fix: `Open ${origin}/ in a tab of its own (Chrome recommended).` };
  if (!f.headers) return { reason: 'den-kit could not read its own page from the server', fix: 'Check that `npm run kit:dev` is still running, then reload.' };
  if (f.headers.coop !== 'same-origin' || !/^(require-corp|credentialless)$/.test(f.headers.coep ?? '')) return { reason: `the server sends COOP "${f.headers.coop ?? 'none'}" and COEP "${f.headers.coep ?? 'none'}" with this page`, fix: `Another server may be answering on ${origin}: stop it, start \`npm run kit:dev\` (from the den folder, on this branch) and reload.` };
  if (f.serviceWorker) return { reason: 'a service worker left on this address by another app answers den-kit\'s page without its isolation headers', fix: `Reload: den-kit removes it. If this stays, open Chrome DevTools ▸ Application ▸ Service workers, press Unregister for ${origin}, then reload.` };
  return { reason: 'the server sends the isolation headers, but this tab was not isolated', fix: `Open ${origin}/ in an incognito window (⇧⌘N). If it works there, a browser extension changes den-kit's headers: turn it off for 127.0.0.1.` };
}
async function pageFacts(): Promise<PageFacts> {
  let headers: PageFacts['headers'] = null;
  try {
    const res = await fetch(location.href, { method: 'HEAD', cache: 'no-store' });
    headers = { coop: res.headers.get('cross-origin-opener-policy'), coep: res.headers.get('cross-origin-embedder-policy') };
  } catch { /* the server is gone */ }
  let framed = false;
  try { framed = window.top !== window; } catch { framed = true; }
  return { href: location.href, secure: globalThis.isSecureContext, framed, headers, serviceWorker: !!navigator.serviceWorker?.controller };
}

/**
 * den-kit uses no service worker. One left on its address by another app (a dev
 * server that ran on the same port) answers page loads itself, without den-kit's
 * isolation headers, so the tab is never isolated and BrowserPod cannot start.
 * When the tab is not isolated, remove such workers and load the page again (once).
 */
export async function clearForeignServiceWorkers(): Promise<boolean> {
  if (globalThis.crossOriginIsolated || !navigator.serviceWorker?.getRegistrations) return false;
  const registrations = await navigator.serviceWorker.getRegistrations().catch(() => []);
  if (!registrations.length) return false;
  await Promise.all(registrations.map(r => r.unregister().catch(() => false)));
  const key = 'den-kit:service-workers-cleared';
  try { if (sessionStorage.getItem(key)) return false; sessionStorage.setItem(key, String(Date.now())); } catch { return false; }
  console.info(`den-kit: removed ${registrations.length} service worker(s) left on this address by another app; loading again.`);
  location.reload();
  return true;
}

export async function bootBrowserPod(options: BrowserPodOptions): Promise<PodHost> {
  if (!globalThis.crossOriginIsolated) {
    const facts = await pageFacts();
    const problem = isolationProblem(facts);
    console.info('den-kit: not cross-origin isolated', facts);
    throw new PodUnavailable(`This page is not cross-origin isolated, which BrowserPod needs: ${problem.reason}.`, problem.fix);
  }
  options.log?.('Loading BrowserPod (rt.browserpod.io)…');
  let mod: typeof import('@leaningtech/browserpod');
  try { mod = await import('@leaningtech/browserpod'); } catch (error) { throw new PodUnavailable(`The BrowserPod package could not be loaded: ${error instanceof Error ? error.message : String(error)}`, 'Run `npm ci` in kit/.'); }
  if (!mod.BrowserPod) throw new PodUnavailable('The BrowserPod runtime could not be loaded from rt.browserpod.io.', 'Check the network connection, then reload.');
  options.log?.('Starting BrowserPod (checking the API key)…');
  let pod: Pod;
  const watch = bootWatch();
  try { pod = await Promise.race([mod.BrowserPod.boot({ apiKey: options.apiKey, storageKey: options.storageKey }), watch.failed]); } catch (error) {
    if (error instanceof PodUnavailable) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new PodUnavailable(`BrowserPod did not start: ${message}`, KEY_PROBLEM.test(message) ? KEY_FIX : undefined);
  } finally { watch.stop(); }
  options.log?.('Starting the Linux machine…');
  const host = new BrowserPodHost(pod, options.log);
  await host.init();
  return host;
}

const KEY_PROBLEM = /api ?key|auth|401|403|token|credential/i;
const KEY_FIX = 'Check BROWSERPOD_API_KEY in kit/.env (a key from console.browserpod.io), then restart `npm run kit:dev` and reload.';
/** How long BrowserPod may take to start (it downloads its machine the first time). */
export const BOOT_LIMIT_MS = 180_000;

/**
 * BrowserPod's boot does not end when the key is refused: it reports that as an
 * uncaught error ("WebSocket connection failed, check your API key.") and keeps
 * waiting. Watch for that (and for a boot that never ends) to say so instead.
 */
function bootWatch(): { failed: Promise<never>; stop(): void } {
  let fail!: (error: PodUnavailable) => void;
  const failed = new Promise<never>((_, reject) => { fail = reject; });
  failed.catch(() => undefined);
  const check = (message: string) => {
    if (/websocket connection failed|check your api key/i.test(message) || (KEY_PROBLEM.test(message) && /browserpod|browserportal|pod/i.test(message))) fail(new PodUnavailable(`BrowserPod refused to start: ${message}`, KEY_FIX));
  };
  const onError = (e: ErrorEvent) => check(e.message || (e.error instanceof Error ? e.error.message : String(e.error ?? '')));
  const onRejection = (e: PromiseRejectionEvent) => check(e.reason instanceof Error ? e.reason.message : String(e.reason ?? ''));
  globalThis.addEventListener?.('error', onError);
  globalThis.addEventListener?.('unhandledrejection', onRejection);
  const timer = setTimeout(() => fail(new PodUnavailable(`BrowserPod did not start within ${BOOT_LIMIT_MS / 60_000} minutes.`, 'Check the network and BROWSERPOD_API_KEY in kit/.env, then reload. (The browser console may say more.)')), BOOT_LIMIT_MS);
  return { failed, stop() { clearTimeout(timer); globalThis.removeEventListener?.('error', onError); globalThis.removeEventListener?.('unhandledrejection', onRejection); } };
}

/** Exported for the tests (test/fakes/pod/mock-browserpod.ts stands in for BrowserPod there). */
export class BrowserPodHost implements PodHost {
  readonly kind = 'browserpod' as const;
  home = '/home/user';
  /** The pod's own environment (PATH, HOME…), read once without passing any (see init). */
  private base: Record<string, string> = {};
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

  /**
   * The pod's own environment (read once without passing one: run's env may replace the
   * environment rather than add to it, so every command gets it back) and where home is.
   */
  async init() {
    const nonce = newNonce();
    const r = await this.exec(['-c', `env 2>/dev/null || export -p; printf '\\n${exitMarker(nonce)}%d>>\\n' $?`], nonce, { timeoutMs: 60_000 }, null);
    this.base = parseEnv(r.output);
    if (this.base.HOME?.startsWith('/')) this.home = this.base.HOME; else this.base.HOME = this.home;
    // Without one, the usual places (Node and npm live in one of them).
    this.base.PATH ??= '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
    this.log?.(`pod environment: ${Object.keys(this.base).join(', ')}; home ${this.home}`);
    const dir = `${this.home}/.den-kit/run`;
    await this.pod.createDirectory(dir, { recursive: true }).catch(() => undefined);
  }
  /** The environment a command runs with: the pod's own, quiet tools, then the command's. */
  private env(vars?: Record<string, string>): string[] { return Object.entries({ ...this.base, ...QUIET, ...vars }).map(([k, v]) => `${k}=${v}`); }

  async run(script: string, options: PodRunOptions = {}): Promise<PodRunResult> {
    const nonce = newNonce();
    const path = `${this.home}/.den-kit/run/${++this.scripts % 64}.sh`;
    await this.writeFile(path, `${script.replace(/\s+$/, '')}\n`);
    return this.exec(['-c', runnerLine(nonce), 'den-kit', options.cwd ?? this.home, path], nonce, options);
  }

  /** Run bash with `args`; `env` null: the pod's own environment untouched (to read it). */
  private async exec(args: string[], nonce: string, options: PodRunOptions, env: string[] | null = this.env(options.env)): Promise<PodRunResult> {
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
    const ran = this.pod.run('bash', args, { terminal, cwd: options.cwd ?? this.home, ...(env ? { env } : {}), echo: false }).catch(error => { raw += `\n${error instanceof Error ? error.message : String(error)}\n`; });
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
      await this.pod.run('bash', [path], { terminal, cwd: options.cwd ?? this.home, env: this.env(options.env), echo: false });
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

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
import { desktopProjectError } from './project-errors.ts';
import type {
  PodHost,
  PodProcess,
  PodRunOptions,
  PodRunResult,
  Portal,
} from '../../src/host/workspace.ts';
import {
  MAX_OUTPUT,
  PodUnavailable,
  cleanOutput,
  exitMarker,
  keepEnd,
  newNonce,
  readExit,
  runnerLine,
} from '../../src/workspace/pod-io.ts';

export interface BrowserPodOptions {
  apiKey: string;
  /** Installed-app users need app actions, while contributors need setup diagnostics. */
  audience?: 'desktop' | 'developer';
  /** The work the pod is for: its disk is kept in this browser (IndexedDB) under a key of its own, so installed packages survive a reload. */
  work: string;
  log?(line: string): void;
}

/** The key BrowserPod keeps a work's disk under. */
export const diskKey = (work: string) => `den-kit-work-${work}`;

/**
 * What BrowserPod gets for an outbound socket while the network is closed: it
 * answers the way the portal answers a refused connection (a TCP connection is
 * disconnected at once) and leaves UDP (name lookups) unanswered, so a command
 * fails instead of waiting for a socket that never opens.
 */
class Refusing extends EventTarget {
  readyState = 1;
  binaryType = 'arraybuffer';
  readonly url: string;
  onmessage: ((event: { target: unknown; data: unknown }) => void) | null = null;
  onclose: ((event: { target: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  constructor(url: string) {
    super();
    this.url = url;
    // Ready, as the portal says it is (an init without a portal).
    setTimeout(() => this.reply({ type: 'init' }));
  }
  private reply(message: Record<string, unknown>) {
    if (this.readyState === 1) this.onmessage?.({ target: this, data: JSON.stringify(message) });
  }
  send(data: unknown) {
    if (typeof data !== 'string') return;
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(data);
    } catch {
      return;
    }
    if (m.type === 'tcpconnect')
      setTimeout(() =>
        this.reply({
          type: 'tcpdisconnect',
          destip: m.srcip,
          destport: m.srcport,
          srcip: m.destip,
          srcport: m.destport,
        }),
      );
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ target: this });
  }
}

/**
 * BrowserPod reaches the internet through WebSockets this page opens to its
 * portal (`wss://main.browserportal.io/conn`); its start and the portal of the dev
 * server use others. While the network is closed, those sockets are stand-ins
 * that refuse every connection, and opening or closing the network ends the
 * sockets of the other state, so BrowserPod's pool never mixes them. This relies
 * on how BrowserPod connects: `vp run desktop:check --real` checks that a pod
 * cannot reach github.com outside an install and can install inside one.
 */
export function networkGate(scope: { WebSocket: typeof WebSocket } = globalThis) {
  const Native = scope.WebSocket;
  const outbound = new Set<{ close(): void }>();
  let open = false;
  const isOutbound = (url: string) => {
    try {
      const u = new URL(url);
      return u.pathname === '/conn' && /(^|\.)browserportal\.io$/.test(u.hostname);
    } catch {
      return false;
    }
  };
  scope.WebSocket = new Proxy(Native, {
    construct(target, args: [string | URL, (string | string[])?], newTarget) {
      const url = String(args[0]);
      if (!isOutbound(url)) return Reflect.construct(target, args, newTarget);
      const socket = open
        ? (Reflect.construct(target, args, newTarget) as WebSocket)
        : (new Refusing(url) as unknown as WebSocket);
      outbound.add(socket);
      socket.addEventListener('close', () => outbound.delete(socket));
      return socket;
    },
  });
  return (value: boolean) => {
    if (value === open) return;
    open = value;
    for (const socket of outbound) {
      outbound.delete(socket);
      socket.close();
    }
  };
}
let network: ((open: boolean) => void) | null = null;

/** Quiet, colourless tools (their output goes to den-kit's log and to the AI). */
const QUIET = {
  CI: '1',
  NO_COLOR: '1',
  FORCE_COLOR: '0',
  TERM: 'dumb',
  npm_config_progress: 'false',
  npm_config_fund: 'false',
  npm_config_audit: 'false',
  npm_config_update_notifier: 'false',
};
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
  if (!f.secure)
    return {
      reason: `${origin} is not a secure address, so the browser ignores the isolation headers`,
      fix: 'Open http://127.0.0.1:5180/ (or http://localhost:5180/) on the Mac running `npm run dev`, not a network address.',
    };
  if (f.framed)
    return {
      reason:
        "den-kit is shown inside another page (an app's preview or a frame), which cannot be isolated",
      fix: `Open ${origin}/ in a tab of its own (Chrome recommended).`,
    };
  if (!f.headers)
    return {
      reason: 'den-kit could not read its own page from the server',
      fix: 'Check that `npm run dev` is still running, then reload.',
    };
  if (
    f.headers.coop !== 'same-origin' ||
    !/^(require-corp|credentialless)$/.test(f.headers.coep ?? '')
  )
    return {
      reason: `the server sends COOP "${f.headers.coop ?? 'none'}" and COEP "${f.headers.coep ?? 'none'}" with this page`,
      fix: `Another server may be answering on ${origin}: stop it, start \`npm run dev\` (from the den-kit folder) and reload.`,
    };
  if (f.serviceWorker)
    return {
      reason:
        "a service worker left on this address by another app answers den-kit's page without its isolation headers",
      fix: `Reload: den-kit removes it. If this stays, open Chrome DevTools ▸ Application ▸ Service workers, press Unregister for ${origin}, then reload.`,
    };
  return {
    reason: 'the server sends the isolation headers, but this tab was not isolated',
    fix: `Open ${origin}/ in an incognito window (⇧⌘N). If it works there, a browser extension changes den-kit's headers: turn it off for 127.0.0.1.`,
  };
}
async function pageFacts(): Promise<PageFacts> {
  let headers: PageFacts['headers'] = null;
  try {
    const res = await fetch(location.href, { method: 'HEAD', cache: 'no-store' });
    headers = {
      coop: res.headers.get('cross-origin-opener-policy'),
      coep: res.headers.get('cross-origin-embedder-policy'),
    };
  } catch {
    /* the server is gone */
  }
  let framed = false;
  try {
    framed = window.top !== window;
  } catch {
    framed = true;
  }
  return {
    href: location.href,
    secure: globalThis.isSecureContext,
    framed,
    headers,
    serviceWorker: !!navigator.serviceWorker?.controller,
  };
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
  try {
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    return false;
  }
  console.info(
    `den-kit: removed ${registrations.length} service worker(s) left on this address by another app; loading again.`,
  );
  location.reload();
  return true;
}

/** What BrowserPod needs from the browser besides isolation (without it, it fails to start with an obscure error), or null. */
export function missingBrowserFeature(): string | null {
  if (
    typeof (
      globalThis.WebAssembly?.Memory?.prototype as { toResizableBuffer?: unknown } | undefined
    )?.toResizableBuffer !== 'function'
  )
    return 'resizable WebAssembly memory';
  if (typeof (Atomics as { waitAsync?: unknown }).waitAsync !== 'function')
    return 'Atomics.waitAsync';
  return null;
}

export async function bootBrowserPod(
  options: BrowserPodOptions & { testing?: BootTesting },
): Promise<PodHost> {
  try {
    return await boot(options);
  } catch (error) {
    throw options.audience === 'desktop' ? desktopProjectError(error, [options.apiKey]) : error;
  }
}

async function boot(options: BrowserPodOptions & { testing?: BootTesting }): Promise<PodHost> {
  if (!globalThis.crossOriginIsolated) {
    const facts = await pageFacts();
    const problem = isolationProblem(facts);
    console.info('den-kit: not cross-origin isolated', facts);
    throw new PodUnavailable(
      `This page is not cross-origin isolated, which BrowserPod needs: ${problem.reason}.`,
      problem.fix,
    );
  }
  const missing = missingBrowserFeature();
  if (missing)
    throw new PodUnavailable(
      `This browser is too old for BrowserPod (it lacks ${missing}).`,
      'Update Chrome (chrome://settings/help), then reload the page.',
    );
  if (startedFor !== null && startedFor !== options.work)
    throw new PodUnavailable(
      'The project tools in this window belong to the work that started them.',
      "Reopen den-kit with this work open: it starts this work's own project tools.",
    );
  startedFor = options.work;
  starting ??= startBoot(options).catch(error => {
    starting = null;
    startedFor = null;
    throw error;
  });
  const boot = await starting;
  if (boot.problem && !boot.pod) throw boot.problem;
  if (!boot.pod) options.log?.('Connecting project tools…');
  const pod = boot.pod ?? (await Promise.race([boot.ready, boot.failed]));
  options.log?.('Preparing the project workspace…');
  network ??= networkGate();
  const host = new BrowserPodHost(
    pod,
    line => console.info('[den-kit] Project tools:', line),
    network,
  );
  await host.init();
  return host;
}
/** For the tests: BrowserPod's module stand-in and a shorter limit. */
export interface BootTesting {
  load: () => Promise<typeof import('@leaningtech/browserpod')>;
  limitMs?: number;
}
/** For the tests: as a fresh page. */
export function resetBrowserPodForTest() {
  starting = null;
  startedFor = null;
}

/** BrowserPod's calls return thenables that are not always real Promises (no .catch): make them Promises. */
const promise = <T>(work: () => PromiseLike<T> | T): Promise<T> => {
  try {
    return Promise.resolve(work());
  } catch (error) {
    return Promise.reject(error);
  }
};
/** BrowserPod hands terminal output over in resizable buffers (its WebAssembly memory), which TextDecoder refuses: copy the bytes. */
export const plainBytes = (data: ArrayBuffer | ArrayBufferView): Uint8Array =>
  (ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data)
  ).slice();

const KEY_PROBLEM = /api ?key|auth|401|403|token|credential/i;
const KEY_FIX =
  'Check BROWSERPOD_API_KEY in .env (a key from console.browserpod.io) and the network; after changing the key, restart `npm run dev` and reload the page.';
/** How long den-kit waits for BrowserPod to start before saying so (it keeps starting; asking again waits for the same start). */
export const BOOT_LIMIT_MS = 300_000;

/**
 * BrowserPod starts once per page: its disk can be opened only once, so a second
 * BrowserPod.boot in the same page fails with "Device already opened in another
 * tab". Every attempt after the first waits for that same start, whatever den-kit
 * said about it meanwhile (a refused key, a slow start).
 */
interface Boot {
  /** Settles when BrowserPod has started (it never settles when the key is refused). */
  ready: Promise<Pod>;
  pod: Pod | null;
  /** Why it has not started (null: still starting, or started). */
  problem: PodUnavailable | null;
  /** Rejects with `problem` when one is found (for the attempt waiting now). */
  failed: Promise<never>;
}
let starting: Promise<Boot> | null = null;
/** The work the pod of this page is for (BrowserPod starts once per page). */
let startedFor: string | null = null;

async function startBoot(options: BrowserPodOptions & { testing?: BootTesting }): Promise<Boot> {
  if (!(await claimPod(options.work)))
    throw new PodUnavailable(
      "This work's project tools are running in another den-kit window.",
      'Close the other window, then press Start the pod here.',
    );
  options.log?.('Loading project tools…');
  let mod: typeof import('@leaningtech/browserpod');
  try {
    mod = await (options.testing?.load ?? (() => import('@leaningtech/browserpod')))();
  } catch (error) {
    throw new PodUnavailable(
      `The BrowserPod package could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
      'Run `npm ci` in the den-kit repo.',
    );
  }
  if (!mod.BrowserPod)
    throw new PodUnavailable(
      'The BrowserPod runtime could not be loaded from rt.browserpod.io.',
      'Check the network connection, then reload.',
    );
  let fail!: (error: PodUnavailable) => void;
  const failed = new Promise<never>((_, reject) => {
    fail = reject;
  });
  failed.catch(() => undefined);
  const boot: Boot = { ready: null as unknown as Promise<Pod>, pod: null, problem: null, failed };
  const report = (problem: PodUnavailable) => {
    if (boot.pod || boot.problem) return;
    boot.problem = problem;
    fail(problem);
  };
  // BrowserPod reports a refused key (and any failure of its connection) as an uncaught error, and its start never ends.
  const check = (message: string) => {
    if (/websocket connection failed|check your api key/i.test(message))
      report(new PodUnavailable(`BrowserPod could not connect: ${message}`, KEY_FIX));
    else if (/device already opened/i.test(message))
      report(
        new PodUnavailable(
          "BrowserPod's disk is open in another den-kit tab (or in a page that is still closing).",
          'Close the other den-kit tabs, then reload this one.',
        ),
      );
  };
  const onError = (e: ErrorEvent) =>
    check(e.message || (e.error instanceof Error ? e.error.message : String(e.error ?? '')));
  const onRejection = (e: PromiseRejectionEvent) =>
    check(e.reason instanceof Error ? e.reason.message : String(e.reason ?? ''));
  globalThis.addEventListener?.('error', onError);
  globalThis.addEventListener?.('unhandledrejection', onRejection);
  const limit = options.testing?.limitMs ?? BOOT_LIMIT_MS;
  const timer = setTimeout(
    () =>
      report(
        new PodUnavailable(
          `BrowserPod has not started after ${Math.round(limit / 60_000)} minutes.`,
          'It keeps starting: press Start the pod again in a minute. If it never starts, check the network and BROWSERPOD_API_KEY, then reload the page.',
        ),
      ),
    limit,
  );
  const stop = () => {
    clearTimeout(timer);
    globalThis.removeEventListener?.('error', onError);
    globalThis.removeEventListener?.('unhandledrejection', onRejection);
  };
  boot.ready = promise(() =>
    mod.BrowserPod.boot({ apiKey: options.apiKey, storageKey: diskKey(options.work) }),
  );
  boot.ready.then(
    pod => {
      boot.pod = pod;
      boot.problem = null;
      stop();
    },
    error => {
      stop();
      const message = error instanceof Error ? error.message : String(error);
      report(
        /device already opened/i.test(message)
          ? new PodUnavailable(
              "BrowserPod's disk is open in another den-kit tab (or in a page that is still closing).",
              'Close the other den-kit tabs, then reload this one.',
            )
          : new PodUnavailable(
              `BrowserPod did not start: ${message}`,
              KEY_PROBLEM.test(message)
                ? KEY_FIX
                : 'Reload the page to start BrowserPod again (it can start once per page).',
            ),
      );
    },
  );
  return boot;
}

/** Only one den-kit tab may run BrowserPod (its disk is shared by every tab of this address): hold a lock for the page's lifetime. */
let claimed = false;
function claimPod(work: string): Promise<boolean> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (claimed || !locks?.request) return Promise.resolve(true);
  return new Promise(resolve => {
    void locks
      .request(`den-kit:browserpod:${work}`, { ifAvailable: true }, lock => {
        if (!lock) {
          resolve(false);
          return null;
        }
        claimed = true;
        resolve(true);
        return new Promise<void>(() => undefined);
      })
      .catch(() => resolve(true));
  });
}

/** Exported for the tests (test/fakes/pod/mock-browserpod.ts stands in for BrowserPod there). */
export class BrowserPodHost implements PodHost {
  readonly kind = 'browserpod' as const;
  home = '/home/user';
  /**
   * BrowserPod keeps its disk in IndexedDB a moment after a write and has no call to
   * wait for that: a write made just before quitting was lost, one 0.5 s before kept.
   */
  readonly settleMs = 1000;
  /** The pod's own environment (PATH, HOME…), read once without passing any (see init). */
  private base: Record<string, string> = {};
  private readonly portals = new Map<number, string>();
  private readonly listeners = new Set<(p: Portal) => void>();
  private scripts = 0;
  private readonly pod: Pod;
  private readonly log?: (line: string) => void;
  private readonly gate: (open: boolean) => void;

  constructor(pod: Pod, log?: (line: string) => void, gate: (open: boolean) => void = () => {}) {
    this.pod = pod;
    this.log = log;
    this.gate = gate;
    pod.onPortal(({ url, port }) => {
      this.portals.set(port, url);
      this.log?.(`portal ${port} → ${url}`);
      for (const l of this.listeners) l({ url, port });
    });
  }

  network(open: boolean) {
    this.gate(open);
  }

  /**
   * The pod's own environment (read once without passing one: run's env may replace the
   * environment rather than add to it, so every command gets it back) and where home is.
   */
  async init() {
    const nonce = newNonce();
    const r = await this.exec(
      ['-c', `env 2>/dev/null || export -p; printf '\\n${exitMarker(nonce)}%d>>\\n' $?`],
      nonce,
      { cwd: '/', timeoutMs: 60_000 },
      null,
    );
    this.base = parseEnv(r.output);
    if (this.base.HOME?.startsWith('/')) this.home = this.base.HOME;
    else this.base.HOME = this.home;
    // Without one, the usual places (Node and npm live in one of them).
    this.base.PATH ??= '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
    this.log?.(`pod environment: ${Object.keys(this.base).join(', ')}; home ${this.home}`);
    const dir = `${this.home}/.den-kit/run`;
    await promise(() => this.pod.createDirectory(dir, { recursive: true })).catch(() => undefined);
  }
  /** The environment a command runs with: the pod's own, quiet tools, then the command's. */
  private env(vars?: Record<string, string>): string[] {
    return Object.entries({ ...this.base, ...QUIET, ...vars }).map(([k, v]) => `${k}=${v}`);
  }

  async run(script: string, options: PodRunOptions = {}): Promise<PodRunResult> {
    const nonce = newNonce();
    const path = `${this.home}/.den-kit/run/${++this.scripts % 64}.sh`;
    await this.writeFile(path, `${script.replace(/\s+$/, '')}\n`);
    return this.exec(
      ['-c', runnerLine(nonce), 'den-kit', options.cwd ?? this.home, path],
      nonce,
      options,
    );
  }

  /** Run bash with `args`; `env` null: the pod's own environment untouched (to read it). */
  private async exec(
    args: string[],
    nonce: string,
    options: PodRunOptions,
    env: string[] | null = this.env(options.env),
  ): Promise<PodRunResult> {
    const started = performance.now();
    const decoder = new TextDecoder();
    let raw = '',
      seen = 0,
      settled = false;
    let resolveMarker!: () => void;
    const marked = new Promise<void>(r => {
      resolveMarker = r;
    });
    const terminal = await this.pod.createCustomTerminal({
      cols: 200,
      rows: 50,
      onOutput: buffer => {
        raw += decoder.decode(plainBytes(buffer), { stream: true });
        if (raw.length > MAX_OUTPUT * 2) raw = raw.slice(raw.length - MAX_OUTPUT * 2);
        const text = cleanOutput(raw);
        if (options.onOutput && text.length > seen) {
          const fresh = text.slice(seen);
          seen = text.length;
          const shown = fresh.split(exitMarker(nonce))[0]!;
          if (shown) options.onOutput(shown);
        }
        if (readExit(text, nonce)) resolveMarker();
      },
    });
    const ran = promise(() =>
      this.pod.run('bash', args, {
        terminal,
        cwd: options.cwd ?? this.home,
        ...(env ? { env } : {}),
        echo: false,
      }),
    ).catch(error => {
      raw += `\n${error instanceof Error ? error.message : String(error)}\n`;
    });
    let timedOut = false;
    const timer = options.timeoutMs
      ? new Promise<void>(r =>
          setTimeout(() => {
            if (!settled) {
              timedOut = true;
              terminal.write('\x03');
            }
            r();
          }, options.timeoutMs),
        )
      : null;
    // The marker is the end; the run itself ending (without one) is too. A timeout gives it two more seconds to print.
    await Promise.race([
      marked,
      ran.then(() => new Promise(r => setTimeout(r, 300))),
      ...(timer
        ? [timer.then(() => Promise.race([marked, new Promise(r => setTimeout(r, 2000))]))]
        : []),
    ]);
    settled = true;
    const text = cleanOutput(raw);
    const found = readExit(text, nonce);
    return {
      exitCode: timedOut ? null : (found?.exitCode ?? null),
      output: keepEnd((found?.output ?? text).trim()),
      timedOut,
      ms: Math.round(performance.now() - started),
    };
  }

  start(name: string, script: string, options: Omit<PodRunOptions, 'timeoutMs'> = {}): PodProcess {
    let out = '',
      running = true;
    const decoder = new TextDecoder();
    const self = this;
    const done = (async () => {
      const path = `${this.home}/.den-kit/run/${name.replace(/[^a-z0-9-]/gi, '')}.sh`;
      await this.writeFile(path, `${script.replace(/\s+$/, '')}\n`);
      const terminal = await this.pod.createCustomTerminal({
        cols: 200,
        rows: 50,
        onOutput: buffer => {
          const text = cleanOutput(decoder.decode(plainBytes(buffer), { stream: true }));
          out = keepEnd(out + text, 64_000);
          if (text) options.onOutput?.(text);
        },
      });
      await this.pod.run('bash', [path], {
        terminal,
        cwd: options.cwd ?? this.home,
        env: this.env(options.env),
        echo: false,
      });
    })()
      .catch(error => {
        out += `\n${error instanceof Error ? error.message : String(error)}`;
      })
      .finally(() => {
        running = false;
        self.log?.(`${name} ended`);
      });
    return {
      name,
      done,
      get running() {
        return running;
      },
      output: () => out,
    };
  }

  async writeFile(path: string, content: string): Promise<void> {
    const dir = path.slice(0, path.lastIndexOf('/'));
    if (dir)
      await promise(() => this.pod.createDirectory(dir, { recursive: true })).catch(
        () => undefined,
      );
    const bytes = new TextEncoder().encode(content);
    const write = async () => {
      const file = (await this.pod.createFile(
        path,
        'binary',
      )) as import('@leaningtech/browserpod').BinaryFile;
      try {
        await file.write(
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
        );
        return await file.getSize();
      } finally {
        await file.close();
      }
    };
    // If creating a file does not empty an existing one, a shorter text would keep the old tail: remove it and write again.
    if ((await write()) !== bytes.byteLength) {
      await this.run(`rm -f -- ${JSON.stringify(path)}`, { timeoutMs: 20_000 });
      if ((await write()) !== bytes.byteLength)
        throw new Error(`Writing ${path} left a file of the wrong size.`);
    }
  }

  async readFile(path: string): Promise<string | null> {
    let file: import('@leaningtech/browserpod').BinaryFile;
    try {
      file = (await this.pod.openFile(
        path,
        'binary',
      )) as import('@leaningtech/browserpod').BinaryFile;
    } catch {
      return null;
    }
    try {
      const size = await file.getSize();
      if (size === 0) return '';
      const chunks: Uint8Array[] = [];
      let got = 0;
      while (got < size) {
        const part = new Uint8Array(await file.read(size - got));
        if (!part.byteLength) break;
        chunks.push(part);
        got += part.byteLength;
      }
      const all = new Uint8Array(got);
      let at = 0;
      for (const c of chunks) {
        all.set(c, at);
        at += c.byteLength;
      }
      return new TextDecoder().decode(all);
    } catch {
      return null;
    } finally {
      await promise(() => file.close()).catch(() => undefined);
    }
  }

  onPortal(listener: (portal: Portal) => void): () => void {
    this.listeners.add(listener);
    for (const [port, url] of this.portals) listener({ url, port });
    return () => {
      this.listeners.delete(listener);
    };
  }
}

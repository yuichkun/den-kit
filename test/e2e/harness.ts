// Shared e2e harness: real Vite dev server + Chromium (Playwright library, the
// repo's existing browser-test style; no new test framework).
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import {
  chromium,
  errors as playwrightErrors,
  type Browser,
  type Page,
  type Request,
} from 'playwright';
import { createBridge, type Bridge } from '../../bridge/server.ts';
import { SandboxServer } from '../../desktop/sandbox.ts';
import { fakeCodex, type FakeCodex } from '../helpers/fake-codex.ts';
import { startFakePod, type FakePod } from '../fakes/pod/fake-pod.ts';

export const kitRoot = fileURLToPath(new URL('../..', import.meta.url));

export function chromiumPath(): string | undefined {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  for (const p of ['/opt/pw-browsers/chromium']) if (existsSync(p)) return p;
  return undefined;
}

export interface Harness {
  server: ViteDevServer;
  browser: Browser;
  url: string;
  bridge: Bridge | null;
  codex: FakeCodex | null;
  pod: FakePod | null;
  close(): Promise<void>;
}

export interface HarnessOptions {
  port?: number;
  env?: Record<string, string>;
  /** Start the local AI bridge (default true). */
  bridge?: boolean;
  /** Run the LLM path against the fake Codex app-server (never the real one). */
  codex?:
    | boolean
    | { signedIn?: boolean; env?: Record<string, string>; timeouts?: Record<string, number> };
  /** A pod for the screen project: the test stand-in (this machine's bash and npm), never BrowserPod. Off: no pod (as without a key). */
  pod?: boolean;
}

export async function startHarness(options: HarnessOptions = {}): Promise<Harness> {
  for (const [k, v] of Object.entries(options.env ?? {})) process.env[k] = v;
  let bridge: Bridge | null = null;
  let codex: FakeCodex | null = null;
  if (options.bridge !== false) {
    if (options.codex) {
      const c = options.codex === true ? {} : options.codex;
      codex = fakeCodex({
        signedIn: c.signedIn,
        env: c.env,
        client: c.timeouts ? { timeouts: c.timeouts } : {},
      });
      await codex.client.start();
    }
    bridge = await createBridge({
      codex: codex?.client,
      // As in `vp run dev`: code parts load from each work's own origin on the bridge's port.
      sandbox: new SandboxServer({
        port: 0,
        requireSecret: false,
        content: () => null,
        refused: () => undefined,
      }),
      sandboxControl: true,
    });
    process.env.KIT_BRIDGE_TOKEN = bridge.token;
    process.env.KIT_BRIDGE_PORT = String(bridge.port);
  } else {
    delete process.env.KIT_BRIDGE_TOKEN;
  }
  // The page learns the pod's address through virtual:kit-pod when Vite loads it; BrowserPod is never used in tests.
  delete process.env.BROWSERPOD_API_KEY;
  const pod = options.pod ? await startFakePod() : null;
  if (pod) process.env.KIT_FAKE_POD_URL = pod.url;
  else delete process.env.KIT_FAKE_POD_URL;
  const server = await createServer({
    root: kitRoot,
    configFile: `${kitRoot}/vite.config.ts`,
    server: { port: options.port ?? 0, strictPort: false, host: '127.0.0.1' },
    logLevel: 'error',
    clearScreen: false,
  });
  await server.listen();
  const url = server.resolvedUrls!.local[0]!;
  bridge?.setOrigins([new URL(url).origin]);
  const browser = await chromium.launch({
    executablePath: chromiumPath(),
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  // close() uses the fields, so a test that replaces h.bridge (restart) still cleans up the live one.
  const h: Harness = {
    server,
    browser,
    url,
    bridge,
    codex,
    pod,
    async close() {
      await h.browser.close();
      await h.server.close();
      await h.bridge?.close();
      await h.codex?.cleanup();
      await h.pod?.close();
    },
  };
  return h;
}

/** What reloadKit reports on a page from openKit: its unfinished requests (and when each started), response statuses, its last heartbeat. */
type Watch = { open: Map<Request, number>; status: WeakMap<Request, number>; heartbeat?: number };
const watched = new WeakMap<Page, Watch>();
const HEARTBEAT = 'kit-e2e-heartbeat';

export async function openKit(
  h: Harness,
  options: {
    clearStorage?: boolean;
    query?: string;
    /** Runs in the page before the app. */ initScript?: string;
    /** Click the start overlay (starts audio) like a user would. Default true. */ start?: boolean;
    /** Show the first-launch start screen (fresh storage); off by default so tests begin on the bass starter. */ startScreen?: boolean;
    viewport?: { width: number; height: number };
    /** The page to open: the development host (default) or another host's page, such as desktop.html. */ path?: string;
  } = {},
): Promise<{ page: Page; errors: string[] }> {
  // A fresh context per page: isolated storage, so a page left open by a failed test cannot interfere.
  const context = await h.browser.newContext({
    viewport: options.viewport ?? { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  // The context goes with its page; at the end of a file the browser may already be closing, which is fine.
  page.on('close', () => {
    context.close().catch(() => undefined);
  });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  const watch: Watch = { open: new Map(), status: new WeakMap() };
  watched.set(page, watch);
  page.on('request', r => watch.open.set(r, Date.now()));
  page.on('response', r => watch.status.set(r.request(), r.status()));
  page.on('requestfinished', r => watch.open.delete(r));
  page.on('requestfailed', r => watch.open.delete(r));
  page.on('console', m => {
    if (m.text() === HEARTBEAT) watch.heartbeat = Date.now();
  });
  // A heartbeat from the page's main thread, for reloadKit. Console messages still arrive while a navigation is pending;
  // page.evaluate then gets no answer, even from a page that still runs.
  await page.addInitScript(beat => {
    if (window.top === window) setInterval(() => console.debug(beat), 500);
  }, HEARTBEAT);
  if (options.clearStorage !== false)
    await page.addInitScript(() => {
      try {
        if (!sessionStorage.getItem('kit-e2e-keep')) localStorage.clear();
      } catch {
        /* ignore */
      }
    });
  if (options.initScript) await page.addInitScript({ content: options.initScript });
  const query = options.startScreen
    ? (options.query ?? '')
    : `${options.query ? `${options.query}&` : '?'}noStart`;
  await page.goto(h.url + (options.path ?? '') + query);
  await page.waitForFunction(
    () => (window as unknown as { __kit?: unknown }).__kit !== undefined,
    null,
    { timeout: 60000 },
  );
  if (options.start !== false) await startAudio(page);
  return { page, errors };
}

/** Click the full-screen start overlay and wait until it is gone (audio running). */
export async function startAudio(page: Page) {
  await page.click('[data-testid=start-overlay]');
  await page.waitForSelector('[data-testid=start-overlay]', { state: 'detached', timeout: 30000 });
}

/**
 * page.reload() on a page from openKit. A reload times out alike whether the old page never lets go or the new
 * document never comes back, so on a timeout the error also says what the page and its requests were doing.
 */
export async function reloadKit(page: Page) {
  const documents: Request[] = [];
  const onRequest = (r: Request) => {
    if (r.isNavigationRequest() && r.frame() === page.mainFrame()) documents.push(r);
  };
  page.on('request', onRequest);
  try {
    await page.reload();
  } catch (e) {
    if (e instanceof playwrightErrors.TimeoutError) {
      const message = e.message;
      e.message = `${message.trimEnd()}\n\n${await stalledReload(page, documents)}\n`;
      // The test runner prints the stack, which starts with the original message.
      if (e.stack?.includes(message)) e.stack = e.stack.replace(message, () => e.message);
    }
    throw e;
  } finally {
    page.off('request', onRequest);
  }
}

/** What the page and its requests are doing once a reload has timed out. */
async function stalledReload(page: Page, documents: Request[]): Promise<string> {
  const now = Date.now();
  const watch = watched.get(page);
  if (!watch) return 'No more to say: the page is not from openKit.';
  const state = (r: Request) => {
    const start = watch.open.get(r),
      status = watch.status.get(r),
      failure = r.failure();
    if (start !== undefined)
      return `open for ${now - start} ms, ${status === undefined ? 'no response yet' : `response ${status}`}`;
    return failure ? `failed: ${failure.errorText}` : `finished, response ${status}`;
  };
  const open = [...watch.open.keys()].sort((a, b) => watch.open.get(a)! - watch.open.get(b)!);
  const lines = [
    'When the reload timed out:',
    `- the reload's document request: ${documents.length ? documents.map(r => `${r.url()}, ${state(r)}`).join('; ') : 'none sent'}`,
    `- the page's main thread: ${watch.heartbeat ? `last heartbeat ${now - watch.heartbeat} ms ago (one every 500 ms while it runs)` : 'no heartbeat yet'}`,
  ];
  const requests = [
    open.length
      ? `- ${open.length} ${open.length === 1 ? 'request' : 'requests'} open, oldest first:`
      : '- no requests open',
    ...open.slice(0, 20).map(r => `  - ${r.resourceType()} ${r.url().slice(0, 200)}: ${state(r)}`),
    ...(open.length > 20 ? [`  - and ${open.length - 20} more`] : []),
  ];
  // page.evaluate has no timeout of its own.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const answer = await Promise.race([
    page
      .evaluate(() => ({
        readyState: document.readyState,
        engineState:
          (window as unknown as { __kit?: { engineState?: { value: string } } }).__kit?.engineState
            ?.value ?? null,
        documentAgeMs: Math.round(performance.now()),
      }))
      .then(
        s => `answered in ${Date.now() - now} ms: ${JSON.stringify(s)}`,
        (e: Error) => `failed after ${Date.now() - now} ms: ${e.message.split('\n')[0]}`,
      ),
    new Promise<string>(resolve => {
      timer = setTimeout(
        () => resolve('no answer within 3000 ms (none comes while a navigation is pending)'),
        3000,
      );
    }),
  ]);
  clearTimeout(timer);
  return [...lines, `- page.evaluate: ${answer}`, ...requests].join('\n');
}

/** Peak of the post-safety output over a short window, read from the engine's analyser. */
export async function outputPeak(page: Page, ms = 300): Promise<number> {
  return page.evaluate(async ms => {
    const kit = (window as unknown as { __kit: { engine: { outAnalyser: AnalyserNode | null } } })
      .__kit;
    const a = kit.engine.outAnalyser;
    if (!a) return -1;
    const data = new Float32Array(a.fftSize);
    let peak = 0;
    const end = performance.now() + ms;
    while (performance.now() < end) {
      a.getFloatTimeDomainData(data);
      for (const s of data) peak = Math.max(peak, Math.abs(s));
      await new Promise(r => setTimeout(r, 20));
    }
    return peak;
  }, ms);
}

export async function waitCompiled(page: Page, timeout = 60000) {
  await page.waitForFunction(
    () => {
      const k = (window as unknown as { __kit: { compileStatus: { value: string } } }).__kit;
      return ['ok', 'error', 'empty'].includes(k.compileStatus.value);
    },
    null,
    { timeout },
  );
  return page.evaluate(() => {
    const k = (
      window as unknown as {
        __kit: { compileStatus: { value: string }; compileMessage: { value: string } };
      }
    ).__kit;
    return { status: k.compileStatus.value, message: k.compileMessage.value };
  });
}

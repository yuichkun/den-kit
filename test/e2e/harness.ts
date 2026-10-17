// Shared e2e harness: real Vite dev server + Chromium (Playwright library, the
// repo's existing browser-test style; no new test framework).
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import { chromium, type Browser, type Page } from 'playwright';
import { createBridge, type Bridge } from '../../bridge/server.ts';
import { fakeCodex, type FakeCodex } from '../helpers/fake-codex.ts';
import { startFakePod, type FakePod } from '../fakes/pod/fake-pod.ts';

export const kitRoot = fileURLToPath(new URL('../..', import.meta.url));

export function chromiumPath(): string | undefined {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  for (const p of ['/opt/pw-browsers/chromium']) if (existsSync(p)) return p;
  return undefined;
}

export interface Harness { server: ViteDevServer; browser: Browser; url: string; bridge: Bridge | null; codex: FakeCodex | null; pod: FakePod | null; close(): Promise<void> }

export interface HarnessOptions {
  port?: number;
  env?: Record<string, string>;
  /** Start the local AI bridge (default true). */
  bridge?: boolean;
  /** Run the LLM path against the fake Codex app-server (never the real one). */
  codex?: boolean | { signedIn?: boolean; env?: Record<string, string>; timeouts?: Record<string, number> };
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
      codex = fakeCodex({ signedIn: c.signedIn, env: c.env, client: c.timeouts ? { timeouts: c.timeouts } : {} });
      await codex.client.start();
    }
    bridge = await createBridge({ codex: codex?.client });
    process.env.KIT_BRIDGE_TOKEN = bridge.token;
    process.env.KIT_BRIDGE_PORT = String(bridge.port);
  } else {
    delete process.env.KIT_BRIDGE_TOKEN;
  }
  // The page learns the pod's address through virtual:kit-pod when Vite loads it; BrowserPod is never used in tests.
  delete process.env.BROWSERPOD_API_KEY;
  const pod = options.pod ? await startFakePod() : null;
  if (pod) process.env.KIT_FAKE_POD_URL = pod.url; else delete process.env.KIT_FAKE_POD_URL;
  const server = await createServer({ root: kitRoot, configFile: `${kitRoot}/vite.config.ts`, server: { port: options.port ?? 0, strictPort: false, host: '127.0.0.1' }, logLevel: 'error', clearScreen: false });
  await server.listen();
  const url = server.resolvedUrls!.local[0]!;
  bridge?.setOrigins([new URL(url).origin]);
  const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  // close() uses the fields, so a test that replaces h.bridge (restart) still cleans up the live one.
  const h: Harness = { server, browser, url, bridge, codex, pod, async close() { await h.browser.close(); await h.server.close(); await h.bridge?.close(); await h.codex?.cleanup(); await h.pod?.close(); } };
  return h;
}

export async function openKit(h: Harness, options: { clearStorage?: boolean; query?: string; /** Runs in the page before the app. */ initScript?: string; /** Click the start overlay (starts audio) like a user would. Default true. */ start?: boolean; /** Show the first-launch start screen (fresh storage); off by default so tests begin on the bass starter. */ startScreen?: boolean; viewport?: { width: number; height: number } } = {}): Promise<{ page: Page; errors: string[] }> {
  // A fresh context per page: isolated storage, so a page left open by a failed test cannot interfere.
  const context = await h.browser.newContext({ viewport: options.viewport ?? { width: 1440, height: 900 } });
  const page = await context.newPage();
  // The context goes with its page; at the end of a file the browser may already be closing, which is fine.
  page.on('close', () => { context.close().catch(() => undefined); });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  if (options.clearStorage !== false) await page.addInitScript(() => { try { if (!sessionStorage.getItem('kit-e2e-keep')) localStorage.clear(); } catch { /* ignore */ } });
  if (options.initScript) await page.addInitScript({ content: options.initScript });
  const query = options.startScreen ? options.query ?? '' : `${options.query ? `${options.query}&` : '?'}noStart`;
  await page.goto(h.url + query);
  await page.waitForFunction(() => (window as unknown as { __kit?: unknown }).__kit !== undefined, null, { timeout: 60000 });
  if (options.start !== false) await startAudio(page);
  return { page, errors };
}

/** Click the full-screen start overlay and wait until it is gone (audio running). */
export async function startAudio(page: Page) {
  await page.click('[data-testid=start-overlay]');
  await page.waitForSelector('[data-testid=start-overlay]', { state: 'detached', timeout: 30000 });
}

/** Peak of the post-safety output over a short window, read from the engine's analyser. */
export async function outputPeak(page: Page, ms = 300): Promise<number> {
  return page.evaluate(async ms => {
    const kit = (window as unknown as { __kit: { engine: { outAnalyser: AnalyserNode | null } } }).__kit;
    const a = kit.engine.outAnalyser; if (!a) return -1;
    const data = new Float32Array(a.fftSize); let peak = 0;
    const end = performance.now() + ms;
    while (performance.now() < end) { a.getFloatTimeDomainData(data); for (const s of data) peak = Math.max(peak, Math.abs(s)); await new Promise(r => setTimeout(r, 20)); }
    return peak;
  }, ms);
}

export async function waitCompiled(page: Page, timeout = 60000) {
  await page.waitForFunction(() => { const k = (window as unknown as { __kit: { compileStatus: { value: string } } }).__kit; return ['ok', 'error', 'empty'].includes(k.compileStatus.value); }, null, { timeout });
  return page.evaluate(() => { const k = (window as unknown as { __kit: { compileStatus: { value: string }; compileMessage: { value: string } } }).__kit; return { status: k.compileStatus.value, message: k.compileMessage.value }; });
}

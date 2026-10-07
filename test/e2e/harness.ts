// Shared e2e harness: real Vite dev server + Chromium (Playwright library, the
// repo's existing browser-test style; no new test framework).
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import { chromium, type Browser, type Page } from 'playwright';
import { createBridge, type Bridge } from '../../bridge/server.ts';
import { JevClient } from '../../bridge/jev.ts';
import { startFakeJev, type Answerer, type FakeJev } from '../fakes/jev/fake-jev.ts';
import { fakeCodex, type FakeCodex } from '../helpers/fake-codex.ts';

export const kitRoot = fileURLToPath(new URL('../..', import.meta.url));

export function chromiumPath(): string | undefined {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  for (const p of ['/opt/pw-browsers/chromium']) if (existsSync(p)) return p;
  return undefined;
}

export interface Harness { server: ViteDevServer; browser: Browser; url: string; bridge: Bridge | null; jev: FakeJev | null; codex: FakeCodex | null; close(): Promise<void> }

export interface HarnessOptions {
  port?: number;
  env?: Record<string, string>;
  /** Start the AI bridge (default true) wired to a fake Jev (never the real service). */
  bridge?: boolean;
  /** Key the bridge sends; the fake accepts only 'e2e-key'. null runs with Jev off. */
  jevKey?: string | null;
  /** How the fake Jev answers (default: position-biased, i.e. an unsure model). */
  jevAnswerer?: Answerer;
  /** Warm Jev up at bridge start like kit:dev does (learns a bad key early). */
  warmUp?: boolean;
  /** Run the LLM path against the fake Codex app-server (never the real one). */
  codex?: boolean | { signedIn?: boolean; env?: Record<string, string>; timeouts?: Record<string, number> };
}

export async function startHarness(options: HarnessOptions = {}): Promise<Harness> {
  for (const [k, v] of Object.entries(options.env ?? {})) process.env[k] = v;
  let bridge: Bridge | null = null;
  let jev: FakeJev | null = null;
  let codex: FakeCodex | null = null;
  if (options.bridge !== false) {
    jev = await startFakeJev({ key: 'e2e-key', answerer: options.jevAnswerer });
    const key = options.jevKey === undefined ? 'e2e-key' : options.jevKey;
    if (options.codex) {
      const c = options.codex === true ? {} : options.codex;
      codex = fakeCodex({ signedIn: c.signedIn, env: c.env, client: c.timeouts ? { timeouts: c.timeouts } : {} });
      await codex.client.start();
    }
    bridge = await createBridge({ jev: new JevClient({ apiKey: key ?? undefined, baseUrl: jev.url }), warmUp: options.warmUp, codex: codex?.client });
    process.env.KIT_BRIDGE_TOKEN = bridge.token;
    process.env.KIT_BRIDGE_PORT = String(bridge.port);
  } else {
    delete process.env.KIT_BRIDGE_TOKEN;
  }
  const server = await createServer({ root: kitRoot, configFile: `${kitRoot}/vite.config.ts`, server: { port: options.port ?? 0, strictPort: false, host: '127.0.0.1' }, logLevel: 'error', clearScreen: false });
  await server.listen();
  const url = server.resolvedUrls!.local[0]!;
  bridge?.setOrigins([new URL(url).origin]);
  const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  // close() uses the fields, so a test that replaces h.bridge (restart) still cleans up the live one.
  const h: Harness = { server, browser, url, bridge, jev, codex, async close() { await h.browser.close(); await h.server.close(); await h.bridge?.close(); await h.jev?.close(); await h.codex?.cleanup(); } };
  return h;
}

export async function openKit(h: Harness, options: { clearStorage?: boolean; query?: string; /** Runs in the page before the app (e.g. a fake speech recognizer). */ initScript?: string; /** Click the start overlay (starts audio) like a user would. Default true. */ start?: boolean; /** Show the first-launch start screen (fresh storage); off by default so tests begin on the bass starter. */ startScreen?: boolean; viewport?: { width: number; height: number } } = {}): Promise<{ page: Page; errors: string[] }> {
  // A fresh context per page: isolated storage, so a page left open by a failed test cannot interfere.
  const context = await h.browser.newContext({ viewport: options.viewport ?? { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('close', () => { void context.close(); });
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

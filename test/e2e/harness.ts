// Shared e2e harness: real Vite dev server + Chromium (Playwright library, the
// repo's existing browser-test style; no new test framework).
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import { chromium, type Browser, type Page } from 'playwright';

export const kitRoot = fileURLToPath(new URL('../..', import.meta.url));

export function chromiumPath(): string | undefined {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  for (const p of ['/opt/pw-browsers/chromium']) if (existsSync(p)) return p;
  return undefined;
}

export interface Harness { server: ViteDevServer; browser: Browser; url: string; close(): Promise<void> }

export async function startHarness(options: { port?: number; env?: Record<string, string> } = {}): Promise<Harness> {
  for (const [k, v] of Object.entries(options.env ?? {})) process.env[k] = v;
  const server = await createServer({ root: kitRoot, configFile: `${kitRoot}/vite.config.ts`, server: { port: options.port ?? 0, strictPort: false, host: '127.0.0.1' }, logLevel: 'error', clearScreen: false });
  await server.listen();
  const url = server.resolvedUrls!.local[0]!;
  const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  return { server, browser, url, async close() { await browser.close(); await server.close(); } };
}

export async function openKit(h: Harness, options: { clearStorage?: boolean; query?: string } = {}): Promise<{ page: Page; errors: string[] }> {
  // A fresh context per page: isolated storage, so a page left open by a failed test cannot interfere.
  const context = await h.browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('close', () => { void context.close(); });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  if (options.clearStorage !== false) await page.addInitScript(() => { try { if (!sessionStorage.getItem('kit-e2e-keep')) localStorage.clear(); } catch { /* ignore */ } });
  await page.goto(h.url + (options.query ?? ''));
  await page.waitForFunction(() => (window as unknown as { __kit?: unknown }).__kit !== undefined, null, { timeout: 60000 });
  return { page, errors };
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

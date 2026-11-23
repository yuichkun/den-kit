// Exports the works this prototype shows (the ids in moments.json) from den-kit's
// showcase, through den-kit's own export: each becomes a work file with its playable
// build, as File > Export makes it. Needs den-kit running (vp run dev) and its player
// built (vp run build, or vp build --config vite.player.config.ts).
//
//   node prototype/field/export-works.mjs [den-kit address] [out folder]
//
// CHROMIUM_PATH names the browser to drive when Playwright's own is not installed.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [kit = 'http://127.0.0.1:5180/', out = join(here, 'out/works')] = process.argv.slice(2);
const ids = Object.keys(JSON.parse(readFileSync(join(here, 'moments.json'), 'utf8')));
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => console.error('den-kit:', e.message));
  await page.goto(new URL('?noStart', kit).href, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__kit !== undefined, null, { timeout: 60000 });
  const overlay = await page.$('[data-testid=start-overlay]');
  if (overlay) {
    await overlay.click();
    await page.waitForSelector('[data-testid=start-overlay]', {
      state: 'detached',
      timeout: 30000,
    });
  }
  for (const id of ids) {
    const name = await page.evaluate(async id => {
      const { WORKS } = await import('/src/screen/showcase/index.ts');
      const work = WORKS.find(w => w.id === id);
      if (!work) throw new Error(`den-kit's showcase has no work ${id}`);
      window.__kit.loadWork(work);
      return window.__kit.doc.value.name;
    }, id);
    // The sound compiles before the export can carry it.
    await page.waitForTimeout(1500);
    const bytes = await page.evaluate(async () => Array.from(await window.__kit.exportWork()));
    writeFileSync(join(out, `${id}.denkit`), Buffer.from(bytes));
    console.log(`${id}: ${name}, ${(bytes.length / 1e6).toFixed(1)} MB`);
  }
} finally {
  await browser.close();
}

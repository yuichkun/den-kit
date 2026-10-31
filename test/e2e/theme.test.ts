// den-kit's theme, chosen in Settings: it changes den-kit's own screens and the cables'
// route, is kept for the next start, and leaves the work's plugin screen as it was.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { openKit, reloadKit, startHarness, waitCompiled, type Harness } from './harness.ts';

let h: Harness;
before(async () => {
  h = await startHarness();
});
after(async () => {
  await h?.close();
});

const theme = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme);
const canvas = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
/** The drawn line of every cable that is not a short arrow between neighbors. */
const cables = (page: Page) =>
  page.$$eval('.kit-edge:not(.adjacent)', edges =>
    edges.map(e => ({
      kind: e.getAttribute('data-kind'),
      d: e.querySelector('.cable')!.getAttribute('d')!,
      dashes: getComputedStyle(e.querySelector('.cable')!).strokeDasharray,
    })),
  );
async function pluginLook(page: Page) {
  await page.click('[data-testid=view-plugin]');
  const look = await page
    .locator('[data-testid=plugin-window]')
    .evaluate(el => getComputedStyle(el).backgroundColor);
  await page.click('[data-testid=view-patch]');
  return look;
}

describe("den-kit's theme", () => {
  it('Settings changes the theme in any host, keeps it, and leaves the plugin screen alone', async () => {
    const { page, errors } = await openKit(h);
    await waitCompiled(page);
    assert.equal(await theme(page), 'tile-light');
    const before = { canvas: await canvas(page), plugin: await pluginLook(page) };
    let drawn = await cables(page);
    assert.ok(drawn.some(c => c.kind === 'audio') && drawn.some(c => c.kind === 'control'));
    // What a cable carries is in its line: audio solid, control dashed.
    for (const c of drawn) assert.equal(c.dashes === 'none', c.kind === 'audio', c.kind!);
    assert.ok(
      drawn.every(c => c.d.includes('C')),
      'Tile cables curve',
    );

    // The development host has no AI account; Settings still opens, with the theme.
    await page.click('[data-testid=desktop-settings-open]');
    await page.selectOption('[data-testid=settings-theme]', 'plate-dark');
    assert.equal(await theme(page), 'plate-dark');
    await page.keyboard.press('Escape');
    assert.notEqual(await canvas(page), before.canvas);
    drawn = await cables(page);
    assert.ok(drawn.length > 0 && drawn.every(c => !c.d.includes('C')), 'Plate cables are angled');
    for (const c of drawn) assert.equal(c.dashes === 'none', c.kind === 'audio', c.kind!);
    assert.equal(await pluginLook(page), before.plugin);

    await page.evaluate(() => sessionStorage.setItem('kit-e2e-keep', '1'));
    await reloadKit(page);
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'plate-dark');
    assert.deepEqual(errors, []);
    await page.close();
  });
});

// The showcase works with parts through the real UI: Rain Field, opened from the
// start screen, rains by itself (one Drop part ×16); dragging up on the drops'
// patch on the field moves the Drop's Rain for all sixteen copies without
// recompiling, each still moved by its own spread. Septet plays a held note
// through seven saws per voice; dragging across its lanes moves the Saw part's
// Detune, live too. Both pass the plugin check in the browser.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { openKit, outputPeak, startHarness, waitCompiled, type Harness } from './harness.ts';

let h: Harness;
before(async () => {
  h = await startHarness({ bridge: false });
});
after(async () => {
  await h?.close();
});

const kit = (page: Page, fn: (k: any) => unknown): Promise<any> =>
  page.evaluate(`(${fn.toString()})(window.__kit)`);
const compiles = (page: Page) => kit(page, k => k.compiler.stats.started);
async function openWork(page: Page, id: string) {
  await page.keyboard.press('Control+Alt+KeyN');
  await page.waitForSelector('[data-testid=start-screen]');
  await page.click(`[data-work=${id}]`);
  await page.waitForSelector('[data-testid=start-screen]', { state: 'detached' });
  return waitCompiled(page);
}
/** The plugin control wired to a parameter of a part's use. */
const faceKnob = (page: Page, use: string, param: string): Promise<string> =>
  page.evaluate(
    ([u, p]) =>
      Object.values<any>((window as any).__kit.doc.value.edges).find(
        e => e.to.node === u && e.to.port === p,
      ).from.node,
    [use, param] as const,
  );
/** Drags on the playing plugin from (x, y) by (dx, dy), in the panel's own pixels. */
async function dragOnPlugin(page: Page, x: number, y: number, dx: number, dy: number) {
  const panel = page.locator('[data-testid=plugin-window] [data-testid=panel]');
  await panel.waitFor();
  const b = (await panel.boundingBox())!;
  const k = b.width / (await kit(page, k => k.doc.value.panel.width));
  await page.mouse.move(b.x + x * k, b.y + y * k);
  await page.mouse.down();
  await page.mouse.move(b.x + (x + dx) * k, b.y + (y + dy) * k, { steps: 8 });
  await page.mouse.up();
}

describe('the showcase works with parts', () => {
  it("Rain Field rains by itself; the Drop's Rain plays all sixteen copies live; the patch shows one Drop ×16", async () => {
    const { page, errors } = await openKit(h);
    await waitCompiled(page);
    assert.equal((await openWork(page, 'rain')).status, 'ok');
    assert.match(await page.locator('.vue-flow__node[data-id="drop1"]').innerText(), /×16/);
    assert.ok((await outputPeak(page, 800)) > 0.01, 'it rains with no keys held');
    const rain = await faceKnob(page, 'drop1', 'rain');
    await page.keyboard.press('Control+Alt+KeyE');
    const before = await page.evaluate(
      id => (window as any).__kit.doc.value.nodes[id].values.value,
      rain,
    );
    const started = await compiles(page);
    await dragOnPlugin(page, 390, 232, 0, -40); // the drops' patch, right of their stake
    const after = await page.evaluate(
      id => (window as any).__kit.doc.value.nodes[id].values.value,
      rain,
    );
    assert.ok(after > before, `Rain went up (${before} → ${after})`);
    await page.waitForTimeout(300);
    assert.equal(await compiles(page), started, "dragging the Drop's Rain does not recompile");
    // Rain reaches every copy through its spread: sixteen copies, each moved by its own amount (Rain and Pitch spread at random).
    const spreads: number[] = await kit(page, k =>
      Object.entries(k.generated.value.values)
        .filter(([name]) => name.endsWith('$spread_scale'))
        .map(([, v]) => v),
    );
    assert.equal(spreads.length, 32, JSON.stringify(spreads));
    assert.ok(new Set(spreads).size >= 30, 'each copy is moved by its own amount');
    assert.ok((await outputPeak(page, 600)) > 0.01);
    const seen = await page.evaluate(async () =>
      (await (window as any).__kit.look({ picture: false })).issues.filter(
        (i: any) => i.severity === 'error',
      ),
    );
    assert.deepEqual(seen, []);
    assert.deepEqual(errors, []);
    await page.close();
  });

  it("Septet: a held note through seven saws per voice; the Saw part's Detune plays live from the lanes", async () => {
    const { page, errors } = await openKit(h);
    await waitCompiled(page);
    assert.equal((await openWork(page, 'supersaw')).status, 'ok');
    assert.match(await page.locator('.vue-flow__node[data-id="saw1"]').innerText(), /×7/);
    await kit(page, k => k.noteOn(57, 110));
    assert.ok((await outputPeak(page, 600)) > 0.02, 'it sounds');
    const detune = await faceKnob(page, 'saw1', 'detune');
    assert.deepEqual(
      await page.evaluate(id => (window as any).__kit.doc.value.nodes[id].config, detune),
      { min: 0, max: 1, scale: 'linear', unit: 'st' },
    );
    await page.keyboard.press('Control+Alt+KeyE');
    const started = await compiles(page);
    await dragOnPlugin(page, 300, 200, 40, 0); // across the lanes
    await page.waitForTimeout(300);
    assert.equal(await compiles(page), started, 'Detune does not recompile');
    assert.ok(
      await page.evaluate(
        id => (window as any).__kit.doc.value.nodes[id].values.value > 0.35,
        detune,
      ),
    );
    await kit(page, k => k.noteOff(57));
    const seen = await page.evaluate(async () =>
      (await (window as any).__kit.look({ picture: false })).issues.filter(
        (i: any) => i.severity === 'error',
      ),
    );
    assert.deepEqual(seen, []);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

// The U5 works through the real UI: Rainfall, opened from the start screen,
// rains by itself (one Drop part ×16, its face on the plugin); turning the
// Drop's face knob plays all sixteen copies without recompiling, each still
// moved by its own spread. Supersaw plays
// a held note through seven saws per voice; its Detune knob is the Saw's face
// and plays live too. Both pass the plugin check in the browser.
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
async function turnUp(page: Page, id: string, by = 70) {
  const knob = page.locator(`[data-widget=${id}] dk-knob`);
  await knob.waitFor();
  const b = (await knob.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - by, { steps: 8 });
  await page.mouse.up();
}

describe('the U5 works', () => {
  it('Rainfall rains by itself; the Drop face plays all sixteen copies live; the patch shows one Drop ×16', async () => {
    const { page, errors } = await openKit(h);
    await waitCompiled(page);
    assert.equal((await openWork(page, 'rain')).status, 'ok');
    assert.match(await page.locator('.vue-flow__node[data-id="drop1"]').innerText(), /×16/);
    assert.ok((await outputPeak(page, 800)) > 0.01, 'it rains with no keys held');
    const rain = await faceKnob(page, 'drop1', 'rain');
    assert.deepEqual(await kit(page, k => k.doc.value.ui.groups.drop1Face.length), 7);
    await page.keyboard.press('Control+Alt+KeyE');
    const before = await page.evaluate(
      id => (window as any).__kit.doc.value.nodes[id].values.value,
      rain,
    );
    const started = await compiles(page);
    await turnUp(page, rain);
    const after = await page.evaluate(
      id => (window as any).__kit.doc.value.nodes[id].values.value,
      rain,
    );
    assert.ok(after > before, `Rain went up (${before} → ${after})`);
    await page.waitForTimeout(300);
    assert.equal(await compiles(page), started, 'turning a face knob does not recompile');
    // The knob reaches every copy through its spread: sixteen copies, each moved by its own amount (Rain and Pitch spread at random).
    const spreads: number[] = await kit(page, k =>
      Object.entries(k.generated.value.values)
        .filter(([name]) => /\$spread_scale$/.test(name))
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

  it("Supersaw: a held note through seven saws per voice; the Saw face's Detune plays live", async () => {
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
    await turnUp(page, detune, 40);
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

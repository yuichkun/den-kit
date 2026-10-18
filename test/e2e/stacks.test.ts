// U5c copies (×N) through the real UI: the inspector's count makes a module
// run as copies (×N badge, stacked box, thick cable, Σ where it is summed) and
// it plays; spreading a knob draws a bar per copy, and moving the spread or
// drawing the bars changes the sound without recompiling and undoes in one
// step; a count too big to build is refused with a reason while the last
// sound plays on; Splay and Copy number are in the palette.
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
async function fresh() {
  const { page, errors } = await openKit(h);
  await waitCompiled(page);
  return { page, errors };
}
async function select(page: Page, id: string) {
  await page.click(`.vue-flow__node[data-id="${id}"] header`);
  await page.waitForSelector('[data-testid=stack-section]');
}
const compiles = (page: Page) => kit(page, k => k.compiler.stats.started);
/** Wait until the compile for the latest edit has finished (the status may still read "ok" from before). */
async function settled(page: Page) {
  await page.waitForTimeout(250);
  return waitCompiled(page);
}

describe('copies (×N)', () => {
  it('×8 on the oscillator: a badge and a stacked box, a thick cable summed (Σ) into the filter, and it still plays', async () => {
    const { page, errors } = await fresh();
    await select(page, 'osc1');
    await page.click('[data-testid=stack-section] [data-count="8"]');
    await page.waitForSelector(
      '.vue-flow__node[data-id="osc1"] [data-testid=stack-badge]:has-text("×8")',
    );
    assert.equal(await kit(page, k => k.doc.value.nodes.osc1.count), 8);
    assert.equal((await settled(page)).status, 'ok');
    assert.equal(await page.locator('.vue-flow__node[data-id="osc1"] .mod.stacked').count(), 1);
    assert.equal(
      await page.locator('.kit-edge.thick[data-copies="8"]').count(),
      1,
      'the cable out of osc1 is thick',
    );
    assert.equal(
      await page.locator('.kit-edge.thick .sum').count(),
      1,
      'Σ where it meets the single filter',
    );
    assert.match(
      (await page.locator('[data-testid=stack-cost]').textContent()) ?? '',
      /Load: .*CPU here/,
    );
    await kit(page, k => k.noteOn(45, 100));
    assert.ok((await outputPeak(page, 400)) > 0.001, 'eight oscillators per voice still sound');
    await kit(page, k => k.noteOff(45));
    // ⌘Z puts it back to one.
    await page.locator('[data-testid=patch-view]').click({ position: { x: 20, y: 20 } });
    await page.keyboard.press('Control+KeyZ');
    await page.waitForSelector('.vue-flow__node[data-id="osc1"] [data-testid=stack-badge]', {
      state: 'detached',
    });
    assert.equal(await page.locator('.kit-edge.thick').count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
  });

  it('a spread knob draws a bar per copy; its amount, a reroll and drawing the bars play live (no recompile); ⌘Z undoes a drawing in one step', async () => {
    const { page, errors } = await fresh();
    await select(page, 'filter1');
    await page.click('[data-testid=stack-section] [data-count="4"]');
    await settled(page);
    await page.selectOption('[data-spread-kind=resonance]', 'random');
    await page.waitForSelector('[data-bars=resonance] rect');
    assert.equal(await page.locator('[data-bars=resonance] rect').count(), 4);
    assert.equal((await settled(page)).status, 'ok');
    const started = await compiles(page);
    const before = await kit(page, k => JSON.stringify(k.generated.value.values));
    // The amount slider, dragged: values move, nothing recompiles.
    await page.locator('[data-spread-amount=resonance]').evaluate((el: HTMLInputElement) => {
      el.value = String(Number(el.max) * 0.8);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(150);
    const amount = await kit(page, k => k.doc.value.nodes.filter1.spread.resonance.amount);
    assert.ok(amount > 0, `amount set (${amount})`);
    assert.notEqual(
      await kit(page, k => JSON.stringify(k.generated.value.values)),
      before,
      "the copies' AudioParams moved",
    );
    const seed = await kit(page, k => k.doc.value.nodes.filter1.spread.resonance.seed);
    await page.click('[data-reroll=resonance]');
    assert.notEqual(await kit(page, k => k.doc.value.nodes.filter1.spread.resonance.seed), seed);
    // Drawing across the bars gives each copy its own value: one undo step.
    const undoDepth = await kit(page, k => k.history.undoStack.length);
    const bars = (await page.locator('[data-bars=resonance]').boundingBox())!;
    await page.mouse.move(bars.x + 2, bars.y + bars.height * 0.1);
    await page.mouse.down();
    await page.mouse.move(bars.x + bars.width - 2, bars.y + bars.height * 0.9, { steps: 8 });
    await page.mouse.up();
    const each = await kit(page, k => k.doc.value.nodes.filter1.spread.resonance);
    assert.equal(each.kind, 'each');
    assert.equal(each.values.length, 4);
    assert.ok(each.values[0] > each.values[3], `drawn high to low (${each.values})`);
    assert.equal(
      await kit(page, k => k.history.undoStack.length),
      undoDepth + 1,
      'the drawing is one step',
    );
    await page.waitForTimeout(300);
    assert.equal(await compiles(page), started, 'spreading plays live: no recompile');
    await page.keyboard.press('Control+KeyZ');
    assert.equal(await kit(page, k => k.doc.value.nodes.filter1.spread.resonance.kind), 'random');
    assert.deepEqual(errors, []);
    await page.close();
  });

  it('a count too big to build is refused with a reason and the last sound plays on; ×1 builds again', async () => {
    const { page, errors } = await fresh();
    // The pad: four voices, so ×128 oscillators would be 512 of them.
    await kit(page, k => k.loadStarter('pad'));
    assert.equal((await settled(page)).status, 'ok');
    await kit(page, k => k.noteOn(57, 110));
    await page.waitForTimeout(500);
    await select(page, 'osc1');
    await page.fill('[data-testid=stack-count]', '500');
    await page.locator('[data-testid=stack-count]').press('Enter');
    await page.waitForSelector('[data-testid=banner]:has-text("the limit in this PoC")');
    assert.equal(
      await kit(page, k => k.doc.value.nodes.osc1.count),
      128,
      'the count is held at the most copies allowed',
    );
    assert.equal((await settled(page)).status, 'error');
    assert.ok((await outputPeak(page, 500)) > 0.001, 'the last sound plays on');
    await page.click('[data-testid=stack-section] [data-count="1"]');
    await page.waitForSelector('[data-testid=banner]', { state: 'detached' });
    assert.equal((await settled(page)).status, 'ok');
    await kit(page, k => k.noteOff(57));
    assert.deepEqual(errors, []);
    await page.close();
  });

  it('Splay and Copy number are in the palette; a stacked noise into Splay builds and sounds on both sides', async () => {
    const { page, errors } = await fresh();
    await page.fill('[data-testid=palette-filter]', 'splay');
    await page.waitForSelector('.grid-palette .tile[data-type="kit.splay"]');
    await page.fill('[data-testid=palette-filter]', 'copy number');
    await page.waitForSelector('.grid-palette .tile[data-type="kit.copy"]');
    assert.equal(
      await page.locator('.grid-palette .tile[data-type="kit.stackSum"]').count(),
      0,
      'what expansion makes is not offered',
    );
    const r = await kit(
      page,
      k =>
        k.commit([
          {
            op: 'addNode',
            node: { id: 'noise9', type: 'den.seededNoise', count: 6, pos: { x: 0, y: 700 } },
          },
          { op: 'addNode', node: { id: 'splay9', type: 'kit.splay', pos: { x: 260, y: 700 } } },
          {
            op: 'connect',
            from: { node: 'noise9', port: 'out' },
            to: { node: 'splay9', port: 'in' },
          },
          {
            op: 'connect',
            from: { node: 'splay9', port: 'left' },
            to: { node: 'out1', port: 'left' },
            replace: true,
          },
          {
            op: 'connect',
            from: { node: 'splay9', port: 'right' },
            to: { node: 'out1', port: 'right' },
            replace: true,
          },
        ]).ok,
    );
    assert.equal(r, true);
    assert.equal((await settled(page)).status, 'ok');
    assert.ok((await outputPeak(page, 300)) > 0.01, 'the noises sound');
    assert.equal(await page.locator('.kit-edge.thick[data-copies="6"]').count(), 1);
    assert.equal(
      await page.locator('.kit-edge.thick .sum').count(),
      0,
      'Splay takes every copy: nothing is summed',
    );
    assert.deepEqual(errors, []);
    await page.close();
  });
});

// U1 in the browser: the AI panel sits next to the canvas (never over it), work
// goes by keyboard (request, stop, undo, back to the canvas), nothing ever asks
// you to choose, the patch keys (⌘A, nudge, fit, zoom), the plugin view that
// scales to its window (Patch ⇄ Plugin, Play ⇄ Edit, full screen) and the start
// screen that appears only when asked for. Fake Codex only.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { openKit, startHarness, waitCompiled, type Harness } from './harness.ts';

const kit = (page: Page, fn: (k: any) => unknown): Promise<any> => page.evaluate(`(${fn.toString()})(window.__kit)`);
const box = async (page: Page, selector: string) => (await page.locator(selector).boundingBox())!;
const overlaps = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const active = (page: Page) => page.evaluate(() => { const el = document.activeElement as HTMLElement | null; return el ? `${el.tagName.toLowerCase()}${el.dataset.testid ? `[${el.dataset.testid}]` : ''}` : ''; });
async function settled(page: Page, text: string, timeout = 30000) {
  await page.waitForFunction(t => { const o = (window as any).__kit.requests.history.value.filter((x: any) => x.text === t).at(-1); return o && !o.live && o.status !== 'working' && o.status !== 'thinking'; }, text, { timeout });
  return kit(page, k => k.requests.history.value.at(-1));
}
/** Four knobs on the plugin (one transaction). */
const KNOBS = `k => {
  const knob = (id, label, node, port, min, max, scale, value, x) => [{ op: 'addNode', node: { id, type: 'ui.knob', label, pos: { x: -300, y: x }, panel: { x, y: 120, w: 110, h: 130 }, config: { min, max, scale, unit: '' }, values: { value } } }, { op: 'connect', from: { node: id, port: 'out' }, to: { node, port } }];
  k.commit([...knob('kcut', 'Cutoff', 'cut1', 'hz', 40, 8000, 'log', 300, 40), ...knob('kres', 'Resonance', 'filter1', 'resonance', 0.5, 8, 'linear', 0.707, 180), ...knob('krel', 'Release', 'aenv1', 'release', 0.01, 2, 'log', 0.12, 320), ...knob('kgain', 'Level', 'gain1', 'gain', 0, 0.5, 'linear', 0.12, 460)]);
}`;

let h: Harness;
before(async () => { h = await startHarness({ codex: true }); });
after(async () => { await h?.close(); });

describe('the AI panel', () => {
  it('sits next to the canvas and never over it, at any width; ⌘J hides it and the canvas takes the room', async () => {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1100, height: 760 }]) {
      const { page, errors } = await openKit(h, { viewport });
      await waitCompiled(page);
      const dock = await box(page, '[data-testid=ai-dock]'), canvas = await box(page, '[data-testid=workspace]');
      assert.ok(!overlaps(dock, canvas), `${viewport.width}: ${JSON.stringify({ dock, canvas })}`);
      assert.ok(dock.height > viewport.height * 0.85, 'full height');
      assert.ok(dock.width <= viewport.width * 0.37 + 1, 'gives way on a narrow window');
      // Requests and answers stay inside the panel, in readable type.
      await page.keyboard.press('Control+k');
      await page.keyboard.type('リリース長く');
      await page.keyboard.press('Enter');
      await page.waitForSelector('[data-testid=ai-result][data-status=applied]');
      const line = await box(page, '[data-testid=ai-result]');
      assert.ok(!overlaps(line, canvas));
      assert.ok(await page.$eval('[data-testid=ai-result] .ask', el => parseFloat(getComputedStyle(el).fontSize)) >= 16);
      assert.ok(await page.$eval('[data-testid=ai-input]', el => parseFloat(getComputedStyle(el).fontSize)) >= 16);
      await page.keyboard.press('Escape'); // leave the prompt
      await page.keyboard.press('Control+j');
      await page.waitForSelector('[data-testid=ai-dock]', { state: 'hidden' });
      assert.ok((await box(page, '[data-testid=workspace]')).width > canvas.width + 250);
      await page.keyboard.press('Control+j');
      await page.waitForSelector('[data-testid=ai-dock]', { state: 'visible' });
      assert.deepEqual(errors, []);
      await page.close();
    }
  });

  it('keyboard only: ask, Esc back to the canvas (its keys work again), ⌘Z takes the request back', async () => {
    const { page, errors } = await openKit(h);
    await waitCompiled(page);
    const release = await kit(page, k => k.doc.value.nodes.aenv1.values.release);
    await page.keyboard.press('Enter'); // Enter anywhere jumps to the prompt
    assert.equal(await active(page), 'textarea[ai-input]');
    await page.keyboard.type('リリース長く');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-testid=ai-result][data-status=applied]');
    assert.equal(await active(page), 'textarea[ai-input]', 'ready for the next request');
    await page.keyboard.press('Escape');
    assert.notEqual(await active(page), 'textarea[ai-input]');
    await page.keyboard.press('Control+a'); // a canvas key, no click needed
    assert.equal(await kit(page, k => k.selection.value.length), await kit(page, k => Object.keys(k.doc.value.nodes).length));
    await page.keyboard.press('Control+z');
    assert.equal(await kit(page, k => k.doc.value.nodes.aenv1.values.release), release);
    assert.deepEqual(errors, []);
    await page.close();
  });

  it('requests go to the LLM without choosing a route; Esc stops it; no buttons to pick', async () => {
    const { page, errors } = await openKit(h);
    await waitCompiled(page);
    await page.waitForFunction(() => (window as any).__kit.bridge.codexReady, null, { timeout: 30000 });
    await page.keyboard.press('Control+k');
    await page.keyboard.type('make it pop somehow');
    await page.keyboard.press('Enter');
    const line = await settled(page, 'make it pop somehow');
    assert.equal(line.route, 'llm', JSON.stringify(line));
    assert.equal(await page.locator('[data-testid=ai-history] button').count(), 0);
    // A long request: Esc stops it from the keyboard.
    await page.keyboard.press('Control+k');
    await page.keyboard.type('slow please');
    await page.keyboard.press('Shift+Enter');
    await page.waitForSelector('[data-testid=ai-stop]');
    await page.keyboard.press('Escape');
    assert.equal((await settled(page, 'slow please')).status, 'stopped');
    assert.deepEqual(errors, []);
    await page.close();
  });
});

describe('patch keys', () => {
  it('⌘A selects all; arrows nudge (Shift: more) as one undo step; ⇧1 fits; ⌘= / ⌘- zoom', async () => {
    const { page, errors } = await openKit(h);
    await waitCompiled(page);
    await page.locator('.vue-flow__node[data-id="osc1"] header').click();
    const x0 = await kit(page, k => k.doc.value.nodes.osc1.pos.x);
    const steps = await kit(page, k => k.history.size);
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    assert.equal(await kit(page, k => k.doc.value.nodes.osc1.pos.x), x0 + 3 * 12 + 48);
    assert.equal(await kit(page, k => k.history.size), steps + 1);
    await page.keyboard.press('Control+z');
    assert.equal(await kit(page, k => k.doc.value.nodes.osc1.pos.x), x0);
    await page.keyboard.press('Control+a');
    assert.equal(await kit(page, k => k.selection.value.length), await kit(page, k => Object.keys(k.doc.value.nodes).length));
    const zoom = () => page.evaluate(() => Number(/scale\(([\d.]+)\)/.exec((document.querySelector('.vue-flow__transformationpane') as HTMLElement).style.transform)?.[1] ?? 1));
    const z0 = await zoom();
    await page.keyboard.press('Control+Equal');
    await page.waitForTimeout(300);
    assert.ok(await zoom() > z0);
    await page.keyboard.press('Control+Minus');
    await page.keyboard.press('Control+Minus');
    await page.waitForTimeout(300);
    assert.ok(await zoom() < z0);
    await page.keyboard.press('Shift+Digit1');
    await page.waitForTimeout(400);
    assert.ok(Math.abs(await zoom() - z0) < 0.05, 'fit brings the whole patch back');
    await page.keyboard.press('Escape');
    assert.equal(await kit(page, k => k.selection.value.length), 0);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

describe('the plugin view', () => {
  it('fills its window and scales the panel; ⌥⌘E and ⌘E switch; edit keys; ⇧⌘F shows only the plugin', async () => {
    const { page, errors } = await openKit(h);
    await waitCompiled(page);
    await page.evaluate(`(${KNOBS})(window.__kit)`);
    await page.keyboard.press('Control+Alt+KeyE');
    await page.waitForSelector('[data-testid=plugin-view]');
    const win = await box(page, '[data-testid=plugin-window]'), panel = await box(page, '[data-testid=panel]');
    assert.ok(Number(await page.getAttribute('[data-testid=panel]', 'data-scale')) > 1, 'scaled up to the window');
    assert.ok(Math.abs(panel.width - win.width) < 2 || Math.abs(panel.height - win.height) < 2, 'fills one side of the window');
    // Edit by keyboard: select, nudge, select all, take off, undo.
    await page.keyboard.press('Control+e');
    await page.waitForSelector('[data-testid=plugin-edit].active');
    await page.click('[data-widget=kres]');
    const x0 = await kit(page, k => k.doc.value.nodes.kres.panel.x);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    assert.equal(await kit(page, k => k.doc.value.nodes.kres.panel.x), x0 + 1 + 10, 'design-tool steps: 1 px, Shift 10 px');
    await page.keyboard.press('Control+a');
    assert.equal(await kit(page, k => k.selection.value.length), 4);
    await page.keyboard.press('Delete');
    assert.equal(await page.locator('[data-widget]').count(), 0);
    await page.keyboard.press('Control+z');
    assert.equal(await page.locator('[data-widget]').count(), 4);
    await page.keyboard.press('Control+e');
    await page.waitForSelector('[data-testid=plugin-play].active');
    // Full screen: only the plugin, scaled to the whole window; Esc comes back.
    await page.keyboard.press('Control+Shift+KeyF');
    await page.waitForSelector('[data-testid=leave-focus]');
    assert.ok(!(await page.isVisible('.toolbar')) && !(await page.isVisible('[data-testid=ai-dock]')) && !(await page.isVisible('[data-testid=keyboard]')));
    const full = await box(page, '[data-testid=plugin-window]');
    assert.ok(full.width >= 1430 && full.height >= 890, JSON.stringify(full));
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-testid=leave-focus]', { state: 'detached' });
    assert.ok(await page.isVisible('[data-testid=ai-dock]'), 'the panel comes back as it was');
    await page.keyboard.press('Control+Alt+KeyE');
    await page.waitForSelector('[data-testid=patch-view]');
    assert.deepEqual(errors, []);
    await page.close();
  });
});

describe('widgets under the mouse', () => {
  it('a knob drag ends on release (two drags are two undo steps); a key played with the mouse stops on release', async () => {
    const { page, errors } = await openKit(h);
    await waitCompiled(page);
    await page.evaluate(`(${KNOBS})(window.__kit)`);
    await page.keyboard.press('Control+Alt+KeyE');
    const knob = page.locator('[data-widget=kres] dk-knob');
    await knob.waitFor();
    const value = () => kit(page, k => k.doc.value.nodes.kres.values.value);
    const v0 = await value();
    const drag = async (dy: number) => {
      const b = (await knob.boundingBox())!;
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - 10);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - 10 - dy, { steps: 5 });
      await page.mouse.up();
    };
    await drag(30);
    const v1 = await value();
    await drag(30); // well within the 1.5 s merge window: only an ended gesture keeps it apart
    const v2 = await value();
    assert.ok(v0 < v1 && v1 < v2, `${v0} < ${v1} < ${v2}`);
    await page.keyboard.press('Control+z');
    assert.equal(await value(), v1, 'the second drag is its own undo step');
    // The keyboard at the bottom, played with the mouse: the key stops when released.
    const keys = (await page.locator('[data-testid=keyboard] dk-keyboard').boundingBox())!;
    await page.mouse.move(keys.x + keys.width * 0.3, keys.y + keys.height * 0.85);
    await page.mouse.down();
    await page.waitForFunction(() => (window as any).__kit.heldNotes.value.length === 1);
    await page.mouse.up();
    await page.waitForFunction(() => (window as any).__kit.heldNotes.value.length === 0, null, { timeout: 2000 });
    assert.deepEqual(errors, []);
    await page.close();
  });
});

describe('the start screen', () => {
  it('opens on the first launch only; arrows and Enter start a work (and the sound); ⌥⌘N brings it back; Esc keeps the patch', async () => {
    const { page, errors } = await openKit(h, { startScreen: true, start: false });
    await page.waitForSelector('[data-testid=start-screen]');
    assert.equal(await page.$('[data-testid=start-overlay]'), null, 'one screen at a time');
    assert.equal(await active(page), 'input[start-describe]');
    await page.keyboard.press('ArrowRight'); // from the text to the works
    await page.keyboard.press('ArrowRight'); // the second work
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-testid=start-screen]', { state: 'detached' });
    assert.equal(await kit(page, k => k.doc.value.name), 'Afterglow');
    await page.waitForFunction(() => (window as any).__kit.engineState.value === 'running', null, { timeout: 30000 });
    await waitCompiled(page);
    // Asked for again: Esc leaves the patch as it is.
    const before = await kit(page, k => k.doc.value.revision);
    await page.keyboard.press('Control+Alt+KeyN');
    await page.waitForSelector('[data-testid=start-screen]');
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-testid=start-screen]', { state: 'detached' });
    assert.equal(await kit(page, k => k.doc.value.revision), before);
    // Described in words: a new patch, and the request goes to the AI.
    await page.keyboard.press('Control+Alt+KeyN');
    await page.keyboard.type('ベース作って');
    await page.keyboard.press('Enter');
    const line = await settled(page, 'ベース作って');
    assert.equal(line.status, 'applied', JSON.stringify(line));
    assert.ok(await kit(page, k => Object.values<any>(k.doc.value.nodes).some((n: any) => n.type === 'kit.voiceIn')));
    assert.ok(await page.isVisible('[data-testid=ai-dock]'));
    // A later launch with a saved patch does not show it.
    await page.evaluate(() => sessionStorage.setItem('kit-e2e-keep', '1'));
    await kit(page, k => k.saveNow());
    await page.reload();
    await page.waitForFunction(() => (window as any).__kit !== undefined);
    await page.waitForSelector('[data-testid=start-overlay]');
    assert.equal(await page.$('[data-testid=start-screen]'), null);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

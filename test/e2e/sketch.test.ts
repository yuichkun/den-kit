// U8c in the page: the person picks up the pen (P), circles a knob and leaves a
// sticky note on the plugin, sends a request: the AI gets the marks in words
// (what each goes around) and the plugin re-drawn with the numbered marks; the
// marks wait, dimmed, while it works and go when it is done. ⌘Z while drawing
// takes back a mark, not an edit; Esc puts the pen down; a stylus draws where
// it touches nothing. On the patch, a box
// around a module with words the fast path knows works like selecting it; an
// arrow between modules goes to the LLM with the patch drawn plainly. A sketch
// can also be laid under the plugin as a picture to build on.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { openKit, startHarness, waitCompiled, type Harness } from './harness.ts';

const kit = (page: Page, fn: (k: any) => unknown, arg?: unknown): Promise<any> => page.evaluate(`(${fn.toString()})(window.__kit, ${JSON.stringify(arg ?? null)})`);
/** Send what is in the prompt (Shift: straight to the LLM) and wait for the line to end. */
async function send(page: Page, text: string, llm = false) {
  const before = await kit(page, k => k.fast.history.value.length);
  await page.keyboard.press('Control+k');
  if (text) await page.keyboard.type(text);
  await page.keyboard.press(llm ? 'Shift+Enter' : 'Enter');
  await page.waitForFunction(n => { const h = (window as any).__kit.fast.history.value; const o = h.at(-1); return h.length > n && o && !o.live && o.status !== 'thinking' && o.status !== 'working'; }, before, { timeout: 60000 });
  return kit(page, k => k.fast.history.value.at(-1));
}
async function drag(page: Page, points: Array<[number, number]>) {
  await page.mouse.move(...points[0]!);
  await page.mouse.down();
  for (const p of points.slice(1)) await page.mouse.move(...p);
  await page.mouse.up();
}
const loop = (cx: number, cy: number, rx: number, ry: number) => Array.from({ length: 33 }, (_, i) => [cx + rx * Math.cos(i / 32 * 2 * Math.PI), cy + ry * Math.sin(i / 32 * 2 * Math.PI)] as [number, number]);
const marks = (page: Page, view: string) => page.locator(`[data-ink=${view}] [data-mark]`);

let h: Harness;
before(async () => { h = await startHarness({ codex: true }); });
after(async () => { await h?.close(); });

describe('sketching for the AI', () => {
  it('circle a knob and leave a note on the plugin: the AI gets them in words and in a picture; the marks wait, then go', { timeout: 180000 }, async () => {
    const { page, errors } = await openKit(h);
    await waitCompiled(page);
    await page.waitForFunction(() => (window as any).__kit.bridge.codexReady, null, { timeout: 30000 });
    // A cutoff knob on the plugin (the inspector's "→ Plugin").
    await kit(page, k => k.select(['cut1']));
    await page.click('[data-expose=hz]');
    await page.click('[data-testid=view-plugin]');
    const knob = page.locator('[data-testid=plugin-view] [data-widget]').first();
    await knob.waitFor();
    const knobId = await knob.getAttribute('data-widget');
    const revision = await kit(page, k => k.doc.value.revision);
    // P picks up the pen; a loop around the knob.
    await page.keyboard.press('p');
    await page.waitForSelector('[data-testid=ink-bar]');
    assert.equal(await page.locator('[data-testid=ai-pen]').getAttribute('aria-pressed'), 'true');
    const kb = (await knob.boundingBox())!;
    await drag(page, loop(kb.x + kb.width / 2, kb.y + kb.height / 2, kb.width * 0.8, kb.height * 0.8));
    // A stray stroke, taken back with ⌘Z (a mark, not an edit).
    await drag(page, [[kb.x + kb.width * 2, kb.y], [kb.x + kb.width * 2.5, kb.y + 20], [kb.x + kb.width * 3, kb.y]]);
    assert.equal(await marks(page, 'plugin').count(), 2);
    await page.keyboard.press('Control+z');
    assert.equal(await marks(page, 'plugin').count(), 1);
    assert.equal(await kit(page, k => k.doc.value.revision), revision);
    // A yellow sticky note in empty space.
    await page.click('[data-testid=ink-bar] [data-color="#ffd166"]');
    await page.click('[data-testid=ink-bar] [data-tool=note]');
    const panel = (await page.locator('[data-testid=plugin-view] [data-testid=panel]').boundingBox())!;
    await page.mouse.click(panel.x + panel.width * 0.6, panel.y + panel.height * 0.55);
    await page.waitForSelector('[data-testid=ink-note-input]');
    await page.keyboard.type('ここに波形表示');
    await page.keyboard.press('Enter');
    assert.equal(await marks(page, 'plugin').count(), 2);
    assert.match((await page.locator('[data-testid=ai-sketch-chip]').textContent())!, /2 marks on the plugin/);
    // Esc puts the pen down; the marks stay.
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-testid=ink-bar]', { state: 'detached' });
    assert.equal(await marks(page, 'plugin').count(), 2);
    // Send: the marks wait (dimmed) while the AI works.
    const sending = send(page, 'sketch test');
    await page.waitForFunction(() => document.querySelectorAll('[data-ink=plugin] .mark.sent').length === 2, null, { timeout: 30000 });
    const o = await sending;
    assert.equal(o.route, 'llm');
    assert.match(o.reply, /^pictures 1 \[image\/(png|jpeg) \d+\]; 2 marks: ① red pen loop around [a-z0-9]+ \(knob “[^”]+”\) \(x -?\d+, y -?\d+, \d+×\d+\) \| ② yellow sticky note “ここに波形表示” in empty space \(x \d+, y \d+, \d+×\d+\)$/);
    assert.ok(o.reply.includes(`around ${knobId} (knob`), o.reply);
    // What den-kit sent: the words, and the plugin re-drawn with the marks.
    const said = h.codex!.records().filter(r => r.scenario === 'sketch').map(r => String(r.text)).at(-1)!;
    assert.match(said, /\[den-kit\] The person sketched on the plugin \(\d+×\d+ design pixels\); the marks are numbered on the picture \(the plugin re-drawn at its design size\):\n①/);
    const start = h.codex!.sent('turn/start').at(-1)! as { params: { input: Array<{ type: string; url?: string }> } };
    assert.deepEqual(start.params.input.map(i => i.type), ['text', 'image']);
    assert.match(start.params.input[1]!.url!, /^data:image\/(png|jpeg);base64,/);
    // Done: the marks go; the line says a sketch went with it.
    await page.waitForFunction(() => document.querySelectorAll('[data-ink=plugin] [data-mark]').length === 0);
    assert.equal(await page.locator('[data-testid=ai-sketch-chip]').count(), 0);
    assert.match((await page.locator('[data-testid=ai-line-sketch]').last().textContent())!, /2 marks on the plugin/);
    assert.deepEqual(errors, []);
    assert.deepEqual(h.codex!.violations(), []);
    await page.close();
  });

  it('on the patch: a box around a module with words the fast path knows works like selecting it; an arrow goes to the LLM drawn plainly', { timeout: 180000 }, async () => {
    const { page, errors } = await openKit(h);
    await waitCompiled(page);
    await page.waitForFunction(() => (window as any).__kit.bridge.codexReady, null, { timeout: 30000 });
    await page.waitForSelector('[data-testid=patch-view] .vue-flow__node[data-id=filter1]');
    await kit(page, k => k.select([]));
    const revision = await kit(page, k => k.doc.value.revision);
    // The ✎ in the AI panel picks up the pen too; then the box tool.
    await page.click('[data-testid=ai-pen]');
    await page.click('[data-testid=ink-bar] [data-tool=rect]');
    const f = (await page.locator('.vue-flow__node[data-id=filter1]').boundingBox())!;
    await drag(page, [[f.x - 12, f.y - 12], [f.x + f.width / 2, f.y + f.height / 2], [f.x + f.width + 12, f.y + f.height + 12]]);
    assert.equal(await marks(page, 'patch').count(), 1);
    const o = await send(page, 'brighter');
    assert.equal(o.status, 'applied');
    assert.notEqual(o.route, 'llm');
    assert.deepEqual(o.attached.map((a: { id: string }) => a.id), ['filter1']);
    assert.ok(o.label, JSON.stringify(o));
    assert.ok(await kit(page, k => k.doc.value.revision) > revision);
    await page.waitForFunction(() => document.querySelectorAll('[data-ink=patch] [data-mark]').length === 0);
    // An arrow from the oscillator to the filter, straight to the LLM: the patch drawn plainly with the arrow.
    await page.keyboard.press('Escape');
    await page.keyboard.press('p');
    await page.click('[data-testid=ink-bar] [data-tool=arrow]');
    const osc = (await page.locator('.vue-flow__node[data-id=osc1]').boundingBox())!;
    const fl = (await page.locator('.vue-flow__node[data-id=filter1]').boundingBox())!;
    await drag(page, [[osc.x + osc.width / 2, osc.y + osc.height / 2], [(osc.x + fl.x) / 2 + 40, (osc.y + fl.y) / 2], [fl.x + fl.width / 2, fl.y + fl.height / 2]]);
    await page.keyboard.press('Escape');
    const o2 = await send(page, 'sketch test: wire it like this', true);
    assert.match(o2.reply, /^pictures 1 \[image\/png \d+\]; 1 marks: ① red arrow from osc1 \([^)]+\) to filter1 \([^)]+\)$/);
    const said = h.codex!.records().filter(r => r.scenario === 'sketch').map(r => String(r.text)).at(-1)!;
    assert.match(said, /\[den-kit\] The person sketched on the patch; the marks are numbered on the picture \(the patch drawn plainly: modules as named boxes, cables as lines\):\n① red arrow/);
    assert.deepEqual(errors, []);
    assert.deepEqual(h.codex!.violations(), []);
    await page.close();
  });

  it('a stylus draws where it touches nothing and works as usual on a knob; the first time it says so; it can be turned off', { timeout: 120000 }, async () => {
    const { page, errors } = await openKit(h);
    await waitCompiled(page);
    await kit(page, k => k.select(['cut1']));
    await page.click('[data-expose=hz]');
    await page.click('[data-testid=view-plugin]');
    await page.locator('[data-testid=plugin-view] [data-widget]').first().waitFor();
    // A pen stroke (Playwright's mouse is not a pen): down on the element, moves and up on the window.
    const pen = (selector: string, dx: number, dy: number) => page.evaluate(([sel, x, y]) => {
      const el = document.querySelector(sel as string)!;
      const r = el.getBoundingClientRect();
      const at = (k: number) => ({ pointerType: 'pen', pointerId: 7, isPrimary: true, bubbles: true, cancelable: true, composed: true, clientX: r.left + 12 + (x as number) * k, clientY: r.top + 12 + (y as number) * k });
      el.dispatchEvent(new PointerEvent('pointerdown', at(0)));
      for (let k = 1; k <= 6; k++) window.dispatchEvent(new PointerEvent('pointermove', at(k / 6)));
      window.dispatchEvent(new PointerEvent('pointerup', at(1)));
    }, [selector, dx, dy]);
    await pen('[data-testid=plugin-view] [data-widget]', 30, 0);
    assert.equal(await marks(page, 'plugin').count(), 0, 'on a knob the pen is a pointer');
    await pen('[data-testid=plugin-view] [data-testid=panel]', 140, 50);
    assert.equal(await marks(page, 'plugin').count(), 1);
    assert.equal(await page.locator('[data-testid=toast]', { hasText: 'Your pen draws for the AI' }).count(), 1);
    await pen('[data-testid=plugin-view] [data-testid=panel]', 60, 90);
    assert.equal(await page.locator('[data-testid=toast]', { hasText: 'Your pen draws for the AI' }).count(), 1, 'said once');
    assert.equal(await marks(page, 'plugin').count(), 2);
    // Off (the sketch bar's “stylus draws”): kept in the browser; the pen is only a pointer.
    await kit(page, k => { k.stylusDraws.value = false; });
    await pen('[data-testid=plugin-view] [data-testid=panel]', 80, 20);
    assert.equal(await marks(page, 'plugin').count(), 2);
    assert.equal(await page.evaluate(() => localStorage.getItem('den-kit:stylus-draws')), 'off');
    assert.deepEqual(errors, []);
    await page.close();
  });

  it('from a blank plugin: a box and a note, sent with nothing typed', { timeout: 120000 }, async () => {
    const { page, errors } = await openKit(h);
    await waitCompiled(page);
    await page.waitForFunction(() => (window as any).__kit.bridge.codexReady, null, { timeout: 30000 });
    await page.click('[data-testid=view-plugin]');
    const panel = page.locator('[data-testid=plugin-view] [data-testid=panel]');
    await panel.waitFor();
    assert.equal(await page.locator('[data-testid=plugin-view] [data-item]').count(), 0, 'nothing on the plugin yet');
    await page.keyboard.press('p');
    await page.click('[data-testid=ink-bar] [data-tool=rect]');
    const b = (await panel.boundingBox())!;
    await drag(page, [[b.x + b.width * 0.05, b.y + b.height * 0.1], [b.x + b.width * 0.3, b.y + b.height * 0.3], [b.x + b.width * 0.6, b.y + b.height * 0.55]]);
    await page.click('[data-testid=ink-bar] [data-tool=note]');
    await page.mouse.click(b.x + b.width * 0.1, b.y + b.height * 0.2);
    await page.waitForSelector('[data-testid=ink-note-input]');
    await page.keyboard.type('big waveform here');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    const o = await send(page, '');
    assert.equal(o.text, 'Do what my sketch shows.');
    assert.match(o.reply, /^pictures 1 \[image\/png \d+\]; 2 marks: ① red box in empty space \(x \d+, y \d+, \d+×\d+\) \| ② red sticky note “big waveform here” in empty space \(x \d+, y \d+, \d+×\d+\)$/);
    assert.deepEqual(errors, []);
    await page.close();
  });

  it('a sketch laid under the plugin becomes the reference picture to build on', { timeout: 120000 }, async () => {
    const { page, errors } = await openKit(h);
    await waitCompiled(page);
    await page.click('[data-testid=view-plugin]');
    const panel = page.locator('[data-testid=plugin-view] [data-testid=panel]');
    await panel.waitFor();
    await page.keyboard.press('p');
    const b = (await panel.boundingBox())!;
    await drag(page, [[b.x + 40, b.y + 40], [b.x + b.width / 2, b.y + b.height / 2], [b.x + b.width - 40, b.y + 60]]);
    await page.click('[data-testid=ink-underlay]');
    await page.waitForSelector('[data-testid=underlay]');
    assert.equal(await page.locator('[data-testid=plugin-edit]').getAttribute('class'), 'active');
    assert.equal(await marks(page, 'plugin').count(), 0);
    assert.equal(await page.locator('[data-testid=ink-bar]').count(), 0);
    const underlay = await kit(page, k => ({ u: k.doc.value.ui.underlay, name: k.doc.value.assets[k.doc.value.ui.underlay?.asset]?.name }));
    assert.deepEqual([underlay.u.visible, underlay.u.opacity, underlay.name], [true, 0.6, 'sketch.png']);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

// U4 in the browser: looking the plugin over the way the AI does (and the
// person, with ✓ Check). The plugin is drawn off-screen and photographed in the
// page; the checks measure where things were drawn: text that does not fit,
// labels squeezed, words on a control, text too faint for what is behind it,
// custom parts that fail. Every showcase work passes; a careless screen does not.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { openKit, startHarness, waitCompiled, type Harness } from './harness.ts';

const kit = (page: Page, fn: (k: any) => unknown): Promise<any> => page.evaluate(`(${fn.toString()})(window.__kit)`);
interface Seen { issues: Array<{ code: string; ids: string[]; message: string; severity: string }>; png: number[]; width: number; height: number; ms: number }
const look = (page: Page, picture = false): Promise<Seen> => page.evaluate(async p => { const r = await (window as any).__kit.look({ picture: p }); return { ...r, png: r.png ? [...r.png.slice(0, 24)] : [] }; }, picture);

let h: Harness;
before(async () => { h = await startHarness({ bridge: false }); });
after(async () => { await h?.close(); });

describe('looking the plugin over', () => {
  it('every showcase work: nothing that needs fixing, and a picture of the plugin at its size', async () => {
    const { page, errors } = await openKit(h);
    await waitCompiled(page);
    for (const id of ['acid', 'pad', 'musicbox', 'toy', 'tapeecho', 'fuzz', 'lofi', 'space', 'duck', 'neon']) {
      await page.keyboard.press('Control+Alt+KeyN');
      await page.waitForSelector('[data-testid=start-screen]');
      await page.click(`[data-work=${id}]`);
      await page.waitForSelector('[data-testid=start-screen]', { state: 'detached' });
      const seen = await look(page, id === 'space' || id === 'fuzz');
      assert.deepEqual(seen.issues.filter(i => i.severity === 'error').map(i => i.message), [], id);
      if (id === 'space' || id === 'fuzz') {
        const size = await kit(page, k => [k.doc.value.panel.width, k.doc.value.panel.height]);
        assert.deepEqual([seen.width, seen.height], size, `${id} picture size`);
        assert.deepEqual(seen.png.slice(0, 8), [137, 80, 78, 71, 13, 10, 26, 10], 'a PNG');
        // The PNG header says the same size.
        const w = (seen.png[16]! << 24) | (seen.png[17]! << 16) | (seen.png[18]! << 8) | seen.png[19]!;
        assert.equal(w, size[0]);
      }
    }
    assert.deepEqual(errors, []);
    await page.close();
  });

  it('a careless screen: what does not fit, what is squeezed, words on a control, faint text, a failing part — and ✓ Check shows it', async () => {
    const { page, errors } = await openKit(h);
    await waitCompiled(page);
    await kit(page, k => k.commit([
      { op: 'addNode', node: { id: 'kl', type: 'ui.knob', label: 'An extremely long label', pos: { x: -300, y: 0 }, panel: { x: 20, y: 20, w: 60, h: 90 }, config: { min: 0.5, max: 8, scale: 'linear', unit: '' } } },
      { op: 'connect', from: { node: 'kl', port: 'out' }, to: { node: 'filter1', port: 'resonance' } },
      { op: 'addElement', element: { id: 'over', kind: 'text', text: 'OVER THE KNOB', rect: { x: 4, y: 44, w: 120, h: 20 }, textStyle: { size: 14, color: 'fg' } } },
      { op: 'addElement', element: { id: 'long', kind: 'text', text: 'This sentence is much too long for its little box', rect: { x: 200, y: 20, w: 90, h: 20 }, textStyle: { size: 14 } } },
      { op: 'addElement', element: { id: 'faint', kind: 'text', text: 'Faint words', rect: { x: 340, y: 200, w: 200, h: 24 }, textStyle: { size: 14, color: '#3a3a3a' } } },
      { op: 'addElement', element: { id: 'bad', kind: 'part', code: 'export default function draw() { throw new Error("no paint"); }', rect: { x: 380, y: 20, w: 120, h: 80 } } },
    ]));
    const seen = await look(page);
    const has = (code: string, id: string) => seen.issues.some(i => i.code === code && i.ids.includes(id));
    assert.ok(has('text-overflow', 'long'), JSON.stringify(seen.issues));
    assert.ok(has('squeezed', 'kl'), JSON.stringify(seen.issues));
    assert.ok(has('overlap', 'over'), JSON.stringify(seen.issues));
    assert.ok(has('contrast', 'faint'), JSON.stringify(seen.issues));
    assert.ok(has('part-error', 'bad'), JSON.stringify(seen.issues));
    assert.match(seen.issues.find(i => i.code === 'part-error')!.message, /no paint/);
    assert.equal(seen.issues.find(i => i.code === 'contrast' && i.ids.includes('faint'))!.severity, 'error');
    // The same in the editor: ⌥⌘K in edit mode lists it (even with the cursor still in the AI prompt); picking one selects what it is about.
    await page.keyboard.press('Control+Alt+KeyE');
    await page.waitForSelector('[data-testid=plugin-view]');
    await page.keyboard.press('Control+KeyE');
    await page.waitForSelector('[data-testid=plugin-edit].active');
    await page.keyboard.press('Control+k');
    await page.waitForFunction(() => document.activeElement?.matches('[data-testid=ai-input]'));
    await page.keyboard.press('Control+Alt+KeyK');
    await page.waitForSelector('[data-testid=plugin-checks] .issue[data-code=text-overflow]');
    assert.equal(await page.locator('[data-testid=plugin-checks] .issue').count(), seen.issues.length);
    await page.click('[data-testid=plugin-checks] .issue[data-code=text-overflow]');
    assert.deepEqual(await kit(page, k => k.selection.value), ['long']);
    // Fixing it and checking again: that problem is gone.
    await kit(page, k => k.commit([{ op: 'setRect', id: 'long', rect: { x: 120, y: 260, w: 460, h: 24 } }]));
    await page.waitForSelector('[data-testid=plugin-checks] header:has-text("the plugin changed")');
    await page.click('[data-testid=plugin-checks] header button:has-text("Again")');
    await page.waitForFunction(() => !document.querySelector('[data-testid=plugin-checks] .issue[data-code=text-overflow]') && !document.querySelector('[data-testid=plugin-checks] header')?.textContent?.includes('Looking'));
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-testid=plugin-checks]', { state: 'detached' });
    assert.deepEqual(errors, []);
    await page.close();
  });
});

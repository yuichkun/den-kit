// U5e faces through the real UI: a part's face goes on the plugin from the
// inspector as controls wired to that use (turning one plays the part, no
// recompile); edited on the plugin and saved as the part's face, it is what
// another use gets. Decorations become a screen part; its My parts file carries
// its picture, so in another browser placing it puts the screen (picture and
// all) on that plugin.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { openKit, startHarness, waitCompiled, type Harness } from './harness.ts';

let h: Harness;
before(async () => { h = await startHarness({ bridge: false }); });
after(async () => { await h?.close(); });

const kit = (page: Page, fn: (k: any) => unknown): Promise<any> => page.evaluate(`(${fn.toString()})(window.__kit)`);
const compiles = (page: Page) => kit(page, k => k.compiler.stats.started);

describe('faces', () => {
  it('put on the plugin from the inspector, played without recompiling, saved from the plugin and put on another use', async () => {
    const { page, errors } = await openKit(h);
    await waitCompiled(page);
    const use: string = await kit(page, k => { const r = k.commit([{ op: 'makePart', ids: ['cut1', 'filter1'], name: 'Tone' }]); k.select(r.created); return r.created[0]; });
    await waitCompiled(page);
    await page.waitForSelector('[data-testid=part-face]:has-text("the default")');
    await page.click('[data-testid=part-face-put]');
    await page.waitForSelector('[data-testid=toast]:has-text("is on the plugin")');
    await page.waitForSelector('[data-testid=part-face-put]:has-text("Update face on plugin")');
    const members: string[] = await kit(page, k => k.doc.value.ui.groups[`${k.selection.value[0]}Face`]);
    const knobs: string[] = await kit(page, k => k.doc.value.ui.groups[`${k.selection.value[0]}Face`].filter((id: string) => k.doc.value.nodes[id]?.type === 'ui.knob'));
    assert.equal(knobs.length, 2, JSON.stringify(members));
    const reso: string = await page.evaluate(([ids, u]) => { const k = (window as any).__kit; return (ids as string[]).find(id => Object.values<any>(k.doc.value.edges).some(e => e.from.node === id && e.to.node === u && e.to.port === 'resonance'))!; }, [knobs, use] as const);
    assert.ok(reso);
    await waitCompiled(page);
    // Play: turn the face's knob on the plugin.
    await page.keyboard.press('Control+Alt+KeyE');
    const knob = page.locator(`[data-widget=${reso}] dk-knob`);
    await knob.waitFor();
    const started = await compiles(page);
    const b = (await knob.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - 60, { steps: 6 });
    await page.mouse.up();
    const value: number = await page.evaluate(id => (window as any).__kit.doc.value.nodes[id].values.value, reso);
    assert.ok(value > 0.707, `the face's knob turned (${value})`);
    assert.equal(await page.evaluate(id => (window as any).__kit.generated.value.values[`${id}_value`], reso), value, 'its AudioParam follows');
    await page.waitForTimeout(300);
    assert.equal(await compiles(page), started, 'playing a face does not recompile');
    // Edit: drop the cutoff knob from the face on the plugin, then save what is left as the part's face.
    const cutoffKnob = knobs.find(id => id !== reso)!;
    await kit(page, k => k.select([]));
    await page.evaluate(id => (window as any).__kit.commit([{ op: 'removeNode', id }]), cutoffKnob);
    const left: string[] = await kit(page, k => k.doc.value.ui.groups[`${Object.values<any>(k.doc.value.nodes).find((n: any) => n.type === 'kit.part').id}Face`]);
    await page.keyboard.press('Control+KeyE');
    await page.waitForSelector('[data-testid=plugin-edit].active');
    await page.evaluate(ids => (window as any).__kit.select(ids), left);
    await page.waitForSelector('[data-testid=save-face]:has-text("Save as Tone\'s face")');
    await page.click('[data-testid=save-face]');
    await page.waitForSelector('[data-testid=toast]:has-text("Tone\'s face: 1 control")');
    assert.equal(await kit(page, k => Object.values<any>(k.doc.value.parts)[0].face.controls.length), 1);
    // Another use gets the saved face, the same layout.
    const second: string = await kit(page, k => { const r = k.commit([{ op: 'addNode', node: { type: 'kit.part', part: Object.keys(k.doc.value.parts)[0], pos: { x: 0, y: 1200 } } }]); return r.created[0]; });
    assert.equal(await page.evaluate(id => (window as any).__kit.putFace(id).ok, second), true);
    const shape = (id: string) => page.evaluate(u => {
      const k = (window as any).__kit, d = k.doc.value;
      const rects = d.ui.groups[`${u}Face`].map((m: string) => d.ui.elements[m]?.rect ?? d.nodes[m].panel);
      const x0 = Math.min(...rects.map((r: any) => r.x)), y0 = Math.min(...rects.map((r: any) => r.y));
      return rects.map((r: any) => [r.x - x0, r.y - y0, r.w, r.h].join(',')).sort();
    }, id);
    assert.deepEqual(await shape(second), await shape(use));
    assert.deepEqual(errors, []);
    await page.close();
  });

  it('decorations become a screen part; its file carries the picture; another browser places it and the screen shows', async () => {
    const { page, errors } = await openKit(h);
    await waitCompiled(page);
    // A picture of our own (a 1×1 PNG), a plate and a word.
    const asset: string = await page.evaluate(async () => {
      const k = (window as any).__kit;
      const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), c => c.charCodeAt(0));
      const meta = await k.addAssetFile(new File([bytes], 'logo.png', { type: 'image/png' }));
      k.commit([
        { op: 'addElement', element: { kind: 'shape', id: 'plate1', shape: 'rect', rect: { x: 100, y: 50, w: 220, h: 90 } } },
        { op: 'addElement', element: { kind: 'text', id: 'word1', text: 'NEBULA', rect: { x: 120, y: 60, w: 140, h: 24 } } },
        { op: 'addElement', element: { kind: 'image', id: 'logo1', asset: meta.id, rect: { x: 270, y: 60, w: 40, h: 40 } } },
      ]);
      return meta.id;
    });
    assert.match(asset, /^a[0-9a-f]{15}$/);
    await page.keyboard.press('Control+Alt+KeyE');
    await page.keyboard.press('Control+KeyE');
    await page.waitForSelector('[data-testid=plugin-edit].active');
    await kit(page, k => k.select(['plate1', 'word1', 'logo1']));
    await page.click('[data-testid=make-screen-part]');
    await page.waitForSelector('[data-testid=toast]:has-text("Made the screen part “Nebula”")');
    assert.deepEqual(await kit(page, k => k.doc.value.ui.groups.nebula1Face), ['plate1', 'word1', 'logo1']);
    // Now they are that part's face: the inspector offers to save changes to it.
    await page.waitForSelector('[data-testid=save-face]:has-text("Save as Nebula\'s face")');
    assert.equal(await kit(page, k => k.saveToMyParts('nebula').ok), true);
    // Out to a file, with the picture inside.
    await page.keyboard.press('Control+Alt+KeyE');
    await page.click('.grid-palette .catgrid button:has-text("My parts")');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=my-parts-export]')]);
    const file = join(mkdtempSync(join(tmpdir(), 'kit-screen-')), 'my-parts.json');
    await download.saveAs(file);
    assert.match(readFileSync(file, 'utf8'), new RegExp(`"${asset}": \\{[^}]*"data": "data:image/png;base64,`));
    assert.deepEqual(errors, []);
    await page.close();
    // Another browser (fresh storage): read the file, place the part from the palette.
    const other = await openKit(h);
    await waitCompiled(other.page);
    await other.page.click('.grid-palette .catgrid button:has-text("My parts")');
    await other.page.setInputFiles('[data-testid=my-parts-file]', file);
    await other.page.waitForSelector('[data-testid=toast]:has-text("My parts: added 1")');
    await other.page.click('.grid-palette .tile[data-type="mine:nebula"]');
    const use: string = await kit(other.page, k => k.selection.value[0]);
    const members: string[] = await other.page.evaluate(u => (window as any).__kit.doc.value.ui.groups[`${u}Face`], use);
    assert.equal(members.length, 3, 'the screen went on the plugin with the part');
    const image: string = await other.page.evaluate(ids => (ids as string[]).find(id => (window as any).__kit.doc.value.ui.elements[id].kind === 'image')!, members);
    await other.page.keyboard.press('Control+Alt+KeyE');
    await other.page.waitForFunction(id => { const img = document.querySelector(`[data-element="${id}"] img`) as HTMLImageElement | null; return !!img && img.complete && img.naturalWidth === 1; }, image);
    assert.equal(await other.page.locator(`[data-element="${image}"] .missing`).count(), 0);
    assert.deepEqual(other.errors, []);
    await other.page.close();
  });
});

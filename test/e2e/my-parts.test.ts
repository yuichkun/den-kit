// U5d My parts through the real UI: a part saved from one patch is placed in
// another from the palette and plays; a newer version is offered with what
// changes and updating keeps the use's values (one ⌘Z undoes it); My parts go
// out to a file and come back; a broken file is refused with a reason.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { openKit, startHarness, waitCompiled, type Harness } from './harness.ts';

let h: Harness;
before(async () => { h = await startHarness({ bridge: false }); });
after(async () => { await h?.close(); });

const kit = (page: Page, fn: (k: any) => unknown): Promise<any> => page.evaluate(`(${fn.toString()})(window.__kit)`);
async function settled(page: Page) { await page.waitForTimeout(250); return waitCompiled(page); }
async function pick(page: Page, ids: string[]) {
  for (const [i, id] of ids.entries()) await page.click(`.vue-flow__node[data-id="${id}"] header`, { modifiers: i ? ['Shift'] : [] });
}

describe('My parts', () => {
  it('save a part, place it in another patch from the palette, take a newer version (values kept, one ⌘Z), and carry My parts in a file', async () => {
    const { page, errors } = await openKit(h);
    await waitCompiled(page);
    // Make a part of the bass's oscillator and filter, and save it.
    await pick(page, ['osc1', 'filter1']);
    await page.keyboard.press('Control+KeyG');
    await page.waitForSelector('[data-testid=toast]:has-text("Made a part")');
    await page.click('[data-testid=my-part-save]');
    await page.waitForSelector('[data-testid=toast]:has-text("to My parts")');
    await page.waitForSelector('[data-testid=my-part-status]:has-text("From My parts")');
    const id: string = await kit(page, k => Object.keys(k.myParts.value.parts)[0]);
    assert.ok(id);
    // Another patch: the pad. My parts are in the palette.
    await kit(page, k => k.loadStarter('pad'));
    await settled(page);
    await page.click('.grid-palette .catgrid button:has-text("My parts")');
    await page.click(`.grid-palette .tile[data-type="mine:${id}"]`);
    const use: string = await kit(page, k => k.selection.value[0]);
    const def: string = await kit(page, k => k.doc.value.nodes[k.selection.value[0]].part);
    assert.equal(await kit(page, k => k.doc.value.parts[k.doc.value.nodes[k.selection.value[0]].part].from.version), 1);
    assert.equal((await settled(page)).status, 'ok');
    await page.waitForSelector('[data-testid=my-part-status]:has-text("v1")');
    // This patch now: the use with its own resonance (kept for later), then v2 is made and saved (a new knob).
    await kit(page, k => { const use = k.selection.value[0]; k.commit([{ op: 'setValue', node: use, port: 'resonance', value: 3 }]); });
    const v1Patch: string = await kit(page, k => JSON.stringify(k.doc.value));
    await kit(page, k => { const use = k.selection.value[0]; const part = k.doc.value.nodes[use].part; k.commit([{ op: 'addNode', node: { id: 'wob9', type: 'den.lfo', inside: part } }, { op: 'addParam', part, node: 'wob9', port: 'rate', id: 'rate', label: 'Rate' }]); });
    await page.click('[data-testid=my-part-save]');
    await page.waitForSelector('[data-testid=toast]:has-text("as v2")');
    // Back to the patch as it was with v1: the newer version is offered with what it changes.
    await page.evaluate(text => { (window as any).__v1 = text; }, v1Patch);
    await kit(page, k => { k.replace(JSON.parse(String((window as any).__v1)), 'Back to v1', false); });
    await kit(page, (k: any) => k.select([Object.values<any>(k.doc.value.nodes).find(n => n.type === 'kit.part').id]));
    await page.waitForSelector('[data-testid=my-part-newer]:has-text("adds the knob “Rate”")');
    await page.click('[data-testid=my-part-update]');
    await page.waitForSelector('[data-testid=toast]:has-text("Updated to v2")');
    assert.equal(await kit(page, (k: any) => k.doc.value.parts[k.doc.value.nodes[k.selection.value[0]].part].from.version), 2);
    assert.equal(await kit(page, (k: any) => k.doc.value.nodes[k.selection.value[0]].values.resonance), 3, 'the use keeps its own value');
    assert.ok(await kit(page, (k: any) => k.doc.value.nodes[k.selection.value[0]].values.rate !== undefined), 'the new knob is there');
    assert.equal((await settled(page)).status, 'ok');
    await page.locator('[data-testid=patch-view]').click({ position: { x: 20, y: 20 } });
    await page.keyboard.press('Control+KeyZ');
    assert.equal(await kit(page, (k: any) => Object.values<any>(k.doc.value.parts).find(p => p.from)?.from.version), 1);
    assert.equal(use.length > 0 && def.length > 0, true);
    // Out to a file, removed, and back from the file.
    await page.click('.grid-palette .catgrid button:has-text("My parts")');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=my-parts-export]')]);
    const dir = mkdtempSync(join(tmpdir(), 'kit-my-parts-'));
    const file = join(dir, 'my-parts.json');
    await download.saveAs(file);
    assert.match(readFileSync(file, 'utf8'), /"schema": "den-kit\/my-parts"/);
    page.once('dialog', d => void d.accept());
    await page.hover(`.grid-palette .tile[data-type="mine:${id}"]`);
    await page.click(`.grid-palette [data-remove="${id}"]`);
    await page.waitForSelector(`.grid-palette .tile[data-type="mine:${id}"]`, { state: 'detached' });
    await page.setInputFiles('[data-testid=my-parts-file]', file);
    await page.waitForSelector('[data-testid=toast]:has-text("My parts: added 1")');
    await page.waitForSelector(`.grid-palette .tile[data-type="mine:${id}"]`);
    assert.equal(await kit(page, (k: any) => { const p = Object.values<any>(k.myParts.value.parts)[0]; return p.versions[p.versions.length - 1].version; }), 2);
    // A broken file: refused with the reason, My parts unchanged.
    const broken = join(dir, 'broken.json');
    writeFileSync(broken, '{"schema":"something-else"}');
    await page.setInputFiles('[data-testid=my-parts-file]', broken);
    await page.waitForSelector('[data-testid=toast]:has-text("Not a den-kit My parts file")');
    assert.equal(await kit(page, k => Object.keys(k.myParts.value.parts).length), 1);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

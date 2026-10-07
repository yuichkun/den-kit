// U5b parts through the real UI: ⌘G makes a part from the selection and the
// sound goes on; Enter / double-click go inside, breadcrumbs and Esc come out;
// a knob of the part (◆) turned inside sets the use we came through, without
// recompiling; edits inside reach every use; ⇧⌘G and ⌘Z put things back.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { openKit, outputPeak, startHarness, waitCompiled, type Harness } from './harness.ts';

let h: Harness;
before(async () => { h = await startHarness({ bridge: false }); });
after(async () => { await h?.close(); });

const kit = (page: Page, fn: (k: any) => unknown): Promise<any> => page.evaluate(`(${fn.toString()})(window.__kit)`);
const snapshot = (page: Page) => kit(page, k => { const sort = (v: any): any => Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(key => [key, sort(v[key])])) : v; return JSON.stringify(sort({ n: k.doc.value.nodes, e: k.doc.value.edges, p: k.doc.value.parts })); });
const shown = (page: Page) => page.$$eval('.vue-flow__node', els => els.map(e => e.getAttribute('data-id')).sort());

async function fresh() {
  const { page, errors } = await openKit(h);
  await waitCompiled(page);
  return { page, errors };
}
/** Click modules one by one (Shift adds), like a person picking them. */
async function pick(page: Page, ids: string[]) {
  for (const [i, id] of ids.entries()) await page.click(`.vue-flow__node[data-id="${id}"] header`, { modifiers: i ? ['Shift'] : [] });
}
async function compiles(page: Page) { return kit(page, k => k.compiler.stats.started); }

describe('parts', () => {
  it('⌘G makes a part of the picked modules and it still plays; Enter goes in, Esc comes out; ⇧⌘G unpacks; ⌘Z undoes each step', async () => {
    const { page, errors } = await fresh();
    const before = await snapshot(page);
    await pick(page, ['osc1', 'filter1', 'vca1']);
    await page.keyboard.press('Control+KeyG');
    await page.waitForSelector('[data-testid=toast]:has-text("Made a part")');
    const use: string = await kit(page, k => k.selection.value[0]);
    assert.match(use, /^oscillatorLowpassVca\d$/);
    assert.equal(await page.locator(`.vue-flow__node[data-id="${use}"] [data-testid=part-contents]`).textContent(), 'Oscillator → Lowpass → VCA');
    assert.deepEqual(await waitCompiled(page).then(r => r.status), 'ok');
    // It still sounds: play a note.
    await kit(page, k => k.noteOn(45, 100));
    assert.ok(await outputPeak(page, 400) > 0.001, 'the bass still plays through the part');
    await kit(page, k => k.noteOff(45));
    // Enter goes inside: only the part's modules (and its inputs and outputs) are shown.
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-testid=part-crumbs]');
    assert.equal(await page.locator('[data-testid=part-crumbs] .crumb.here').textContent(), 'Oscillator + Lowpass + VCA');
    const inside = await shown(page);
    assert.ok(inside.includes('osc1') && inside.includes('filter1') && inside.includes('vca1'));
    assert.ok(!inside.includes('voice1') && !inside.includes(use), 'the main patch is not shown inside');
    // The ◆ knob inside (resonance, a parameter) sets the use's own value, without recompiling.
    const started = await compiles(page);
    const knob = page.locator('.vue-flow__node[data-id="filter1"] [data-param=resonance] svg');
    const box = (await knob.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.move(box.x + box.width / 2, box.y - 40, { steps: 6 }); await page.mouse.up();
    const value = await kit(page, (k: any) => { const id = k.partPath.value[0]; return k.doc.value.nodes[id].values.resonance; });
    assert.ok(value > 0.707, `the use's resonance went up (${value})`);
    assert.equal(await kit(page, k => k.doc.value.nodes.filter1.values.resonance), 0.707, 'the knob inside keeps the default');
    await page.waitForTimeout(300);
    assert.equal(await compiles(page), started, 'turning a parameter does not recompile');
    // Esc clears a selection first; with nothing selected it comes out, with the use selected. Double-click goes back in; the breadcrumb comes out too.
    if ((await kit(page, k => k.selection.value.length)) > 0) {
      await page.keyboard.press('Escape');
      assert.deepEqual(await kit(page, k => k.selection.value), []);
      assert.equal(await page.locator('[data-testid=part-crumbs]').count(), 1, 'still inside');
    }
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-testid=part-crumbs]', { state: 'detached' });
    assert.deepEqual(await kit(page, k => k.selection.value), [use]);
    await page.dblclick(`.vue-flow__node[data-id="${use}"] header`);
    await page.waitForSelector('[data-testid=part-crumbs]');
    await page.click('[data-testid=part-crumbs] [data-crumb="0"]');
    await page.waitForSelector('[data-testid=part-crumbs]', { state: 'detached' });
    // ⇧⌘G puts the modules back; ⌘Z three times returns to the very start.
    await page.click(`.vue-flow__node[data-id="${use}"] header`);
    await page.keyboard.press('Control+Shift+KeyG');
    await page.waitForFunction(() => !Object.keys((window as any).__kit.doc.value.parts).length);
    assert.equal(await kit(page, k => k.doc.value.nodes.filter1.inside), undefined);
    await page.keyboard.press('Control+KeyZ');
    await page.waitForFunction(() => Object.keys((window as any).__kit.doc.value.parts).length === 1);
    await page.keyboard.press('Control+KeyZ'); // the knob turn
    await page.keyboard.press('Control+KeyZ'); // the part
    await page.waitForFunction(() => !Object.keys((window as any).__kit.doc.value.parts).length);
    assert.equal(await snapshot(page), before);
    assert.deepEqual(errors, []);
    await page.close();
  });

  it('a part used twice: an edit inside reaches both; the inspector shows a knob on the part, hears it alone and makes an own copy', async () => {
    const { page, errors } = await fresh();
    await kit(page, k => {
      const r = k.commit([{ op: 'makePart', ids: ['filter1'], name: 'Tone' }]);
      if (!r.ok) throw r.error;
      const r2 = k.commit([{ op: 'addNode', node: { id: 'tone2', type: 'kit.part', part: 'tone', pos: { x: 600, y: 700 } } }, { op: 'connect', from: { node: 'mix1', port: 'out' }, to: { node: 'tone2', port: 'input' } }, { op: 'connect', from: { node: 'tone2', port: 'out' }, to: { node: 'out1', port: 'right' } }]);
      if (!r2.ok) throw r2.error;
    });
    await waitCompiled(page);
    // Go inside through tone2 (selected, then the inspector's button).
    await page.click('.vue-flow__node[data-id="tone2"] header');
    assert.equal(await page.locator('[data-testid=part-inspector] [data-testid=part-name]').inputValue(), 'Tone');
    await page.click('[data-testid=part-enter]');
    await page.waitForSelector('[data-testid=part-crumbs]');
    // A module added inside (from the search palette) is in the part; widgets are not offered here.
    await page.locator('[data-testid=patch-view]').focus();
    await page.keyboard.press('Tab');
    await page.fill('[data-testid=palette-search]', 'knob');
    assert.equal(await page.locator('.palette li[data-type="ui.knob"]').count(), 0, 'no controls inside a part');
    await page.fill('[data-testid=palette-search]', 'gain');
    await page.keyboard.press('Enter');
    const gain: string = await kit(page, k => k.selection.value[0]);
    assert.equal(await kit(page, (k: any) => k.doc.value.nodes[k.selection.value[0]].inside), 'tone');
    // ◇ next to its knob shows it on the part: both uses get the parameter.
    await page.click(`[data-testid=inspector] [data-param-toggle=gain]`);
    await page.waitForFunction(() => (window as any).__kit.doc.value.parts.tone.params.some((p: any) => p.id === 'gain'));
    assert.equal(await kit(page, k => k.doc.value.nodes.tone2.values.gain), 1);
    assert.ok(await kit(page, k => Object.values(k.doc.value.nodes).filter((n: any) => n.type === 'kit.part').every((n: any) => n.iface.inputs.some((p: any) => p.id === 'gain'))));
    // An edit inside (a cable through the new gain) reaches every use.
    await kit(page, (k: any) => {
      const outlet = k.doc.value.parts.tone.outputs[0].node;
      const gain = k.selection.value[0];
      const r = k.commit([{ op: 'connect', from: { node: 'filter1', port: 'out' }, to: { node: gain, port: 'in' } }, { op: 'connect', from: { node: gain, port: 'out' }, to: { node: outlet, port: 'in' }, replace: true }]);
      if (!r.ok) throw r.error;
    });
    await waitCompiled(page);
    const flat: string[] = await kit(page, (k: any) => Object.keys(k.generated.value.values));
    for (const use of ['tone1', 'tone2']) assert.ok(flat.includes(`${use}_${gain}_gain`), `${use} has the gain inside (${flat.join(', ')})`);
    // Hear alone (the crumb bar), then everything again.
    await page.click('[data-testid=part-solo]');
    await page.waitForFunction(() => JSON.stringify((window as any).__kit.solo.value) === '["tone2"]');
    assert.equal((await waitCompiled(page)).status, 'ok');
    await page.click('[data-testid=part-solo]');
    await page.waitForFunction(() => (window as any).__kit.solo.value === null);
    // Out, then an own copy for tone2: an edit inside it leaves the other use alone.
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    await page.waitForSelector('[data-testid=part-crumbs]', { state: 'detached' });
    await page.click('.vue-flow__node[data-id="tone2"] header');
    await page.click('[data-testid=part-detach]');
    await page.waitForFunction(() => (window as any).__kit.doc.value.nodes.tone2.part !== 'tone');
    assert.equal(await page.locator('[data-testid=part-name]').inputValue(), 'Tone 2');
    assert.equal(await kit(page, k => Object.keys(k.doc.value.parts).length), 2);
    assert.deepEqual(errors, []);
    await page.close();
  });

  it('the parts palette places another use; a problem inside shows on the use outside and on the module inside', async () => {
    const { page, errors } = await fresh();
    await kit(page, k => { const r = k.commit([{ op: 'makePart', ids: ['gain1'], name: 'Level' }]); if (!r.ok) throw r.error; });
    await page.click('.grid-palette .catgrid button:has-text("Parts")');
    await page.click('.grid-palette .tile[data-type="part:level"]');
    await page.waitForFunction(() => Object.values((window as any).__kit.doc.value.nodes).filter((n: any) => n.part === 'level').length === 2);
    // An empty codebox inside: an error on both uses outside, and on the codebox inside.
    await kit(page, k => { const r = k.commit([{ op: 'addNode', node: { id: 'box9', type: 'kit.codebox', inside: 'level', code: '' } }]); if (!r.ok) throw r.error; });
    await page.waitForSelector('.vue-flow__node[data-id="level1"] .mod.error');
    await page.dblclick('.vue-flow__node[data-id="level1"] header');
    await page.waitForSelector('.vue-flow__node[data-id="box9"] .mod.error');
    assert.equal(await page.locator('.vue-flow__node[data-id="gain1"] .mod.error').count(), 0);
    // The code view highlights what the part became.
    await page.keyboard.press('Escape');
    await page.click('.vue-flow__node[data-id="level1"] header');
    await kit(page, k => { const r = k.commit([{ op: 'removeNode', id: 'box9' }]); if (!r.ok) throw r.error; });
    await waitCompiled(page);
    await page.click('[data-testid=view-code]');
    await page.waitForSelector('.code-view .line.hl');
    assert.ok((await page.locator('.code-view .line.hl').first().textContent())!.includes('level1_gain1'));
    assert.deepEqual(errors, []);
    await page.close();
  });
});

// Copies with the LLM: asked for a supersaw, the (fake) model stacks the bass's
// oscillator ×7 behind a ×7 pitch shift whose semitones spread, through den-kit's
// tools in this page; it compiles, the copies are in the program, and one ⌘Z
// takes it all back.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { openKit, startHarness, waitCompiled, type Harness } from './harness.ts';

const kit = (page: Page, fn: (k: any) => unknown): Promise<any> => page.evaluate(`(${fn.toString()})(window.__kit)`);
const snapshot = (page: Page) => kit(page, k => JSON.stringify({ n: k.doc.value.nodes, e: Object.keys(k.doc.value.edges).length }));
async function ask(page: Page, text: string) {
  await page.keyboard.press('Control+k');
  await page.keyboard.type(text);
  await page.keyboard.press('Shift+Enter');
  await page.waitForFunction(t => { const o = (window as any).__kit.requests.history.value.at(-1); return o && o.text === t && !o.live && o.status !== 'thinking'; }, text, { timeout: 120000 });
  return kit(page, k => { const o = k.requests.history.value.at(-1); return { status: o.status, label: o.label }; });
}

let h: Harness;
before(async () => { h = await startHarness({ codex: true }); });
after(async () => { await h?.close(); });

describe('copies with the LLM', () => {
  it('the model stacks seven detuned saws per voice; it compiles and one ⌘Z undoes it all', { timeout: 180000 }, async () => {
    const { page, errors } = await openKit(h);
    await waitCompiled(page);
    await page.waitForFunction(() => (window as any).__kit.bridge.codexReady, null, { timeout: 30000 });
    const before = await snapshot(page);
    const line = await ask(page, 'make it a supersaw');
    assert.equal(line.status, 'applied', JSON.stringify(line));
    assert.equal(line.label, 'Layered seven saw waves and slightly detuned each one');
    const doc = await kit(page, k => k.doc.value);
    assert.equal(doc.nodes.osc1.count, 7);
    assert.deepEqual(doc.nodes.detune1.spread, { semitones: { kind: 'range', amount: 0.15 } });
    assert.equal((await waitCompiled(page)).status, 'ok');
    // Seven pitch shifts, spread evenly ±0.15 semitones; the oscillators' shared knobs stay one AudioParam each.
    const values = await kit(page, k => k.generated.value.values);
    assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(k => Math.round(values[`detune1_${k}_semitones`] * 1000) / 1000), [-0.15, -0.1, -0.05, 0, 0.05, 0.1, 0.15]);
    assert.ok(await page.locator('.vue-flow__node[data-id="osc1"] [data-testid=stack-badge]:has-text("×7")').count());
    await page.locator('[data-testid=ai-input]').blur();
    await page.keyboard.press('Control+z');
    assert.equal(await snapshot(page), before);
    assert.deepEqual(errors, []);
    assert.deepEqual(h.codex!.violations(), []);
    await page.close();
  });
});

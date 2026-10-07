// Parts with the LLM: the (fake) model makes the core of the bass a part and
// layers a second use of it with its own setting, through den-kit's tools in
// this page; one ⌘Z takes it all back. A request made inside a part tells the
// model which part and which use.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { openKit, startHarness, waitCompiled, type Harness } from './harness.ts';

const kit = (page: Page, fn: (k: any) => unknown): Promise<any> => page.evaluate(`(${fn.toString()})(window.__kit)`);
const snapshot = (page: Page) => kit(page, k => JSON.stringify({ n: Object.keys(k.doc.value.nodes).sort(), e: Object.keys(k.doc.value.edges).length, p: k.doc.value.parts }));
async function ask(page: Page, text: string) {
  await page.keyboard.press('Control+k');
  await page.keyboard.type(text);
  await page.keyboard.press('Shift+Enter');
  await page.waitForFunction(t => { const o = (window as any).__kit.fast.history.value.at(-1); return o && o.text === t && !o.live && o.status !== 'thinking'; }, text, { timeout: 120000 });
  return kit(page, k => { const o = k.fast.history.value.at(-1); return { status: o.status, label: o.label, steps: o.steps, where: o.where }; });
}

let h: Harness;
before(async () => { h = await startHarness({ codex: true }); });
after(async () => { await h?.close(); });

describe('parts with the LLM', () => {
  it('the model makes a part, uses it again with its own setting and listens; one ⌘Z undoes it all', { timeout: 180000 }, async () => {
    const { page, errors } = await openKit(h);
    await waitCompiled(page);
    await page.waitForFunction(() => (window as any).__kit.bridge.codexReady, null, { timeout: 30000 });
    const before = await snapshot(page);
    const line = await ask(page, '音の芯をパーツにして、もう1つ重ねて');
    assert.equal(line.status, 'applied', JSON.stringify(line));
    assert.equal(line.label, 'パーツ「Core」にして、もう1つ重ねました');
    const doc = await kit(page, k => k.doc.value);
    assert.deepEqual(Object.keys(doc.parts), ['core']);
    assert.equal(doc.parts.core.doc, 'The oscillator through the filter.');
    assert.deepEqual(Object.values<any>(doc.nodes).filter(n => n.part === 'core').map(n => n.id).sort(), ['core1', 'core2']);
    assert.equal(doc.nodes.core2.values.resonance, 4);
    assert.equal((await waitCompiled(page)).status, 'ok');
    // Both uses are in the program, each with its own resonance.
    const values = await kit(page, k => k.generated.value.values);
    assert.equal(values.core1_filter1_resonance, 0.707);
    assert.equal(values.core2_filter1_resonance, 4);
    await page.locator('[data-testid=ai-input]').blur();
    await page.keyboard.press('Control+z');
    assert.equal(await snapshot(page), before);
    assert.deepEqual(errors, []);
    assert.deepEqual(h.codex!.violations(), []);
    await page.close();
  });

  it('asked inside a part, the model is told which part and which use', { timeout: 180000 }, async () => {
    const { page, errors } = await openKit(h);
    await waitCompiled(page);
    await page.waitForFunction(() => (window as any).__kit.bridge.codexReady, null, { timeout: 30000 });
    await kit(page, k => { k.select(['osc1', 'filter1']); });
    await page.locator('[data-testid=patch-view]').focus();
    await page.keyboard.press('Control+KeyG');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-testid=part-crumbs]');
    const use = await kit(page, k => k.partPath.value[0]);
    const line = await ask(page, 'how does this work?');
    assert.equal(line.status, 'reply', JSON.stringify(line));
    assert.deepEqual(line.where.path, [use]);
    const starts = h.codex!.sent('turn/start');
    assert.match(JSON.stringify(starts.at(-1)), new RegExp(`The person is inside part \\\\"Oscillator \\+ Lowpass\\\\" \\(part oscillatorLowpass, entered through ${use}\\)`));
    assert.deepEqual(errors, []);
    await page.close();
  });
});

// A2 in the browser: the AI bar applies fast edits (lexicon and Jev through the
// real bridge and the fake Jev server), undo / A/B work, faults never touch the
// patch, and audio keeps playing across fast edits.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { openKit, outputPeak, startHarness, waitCompiled, type Harness } from './harness.ts';
import { scriptedAnswerer } from '../fakes/jev/scripted.ts';

type K = { __kit: any };
const kit = (page: Page, fn: (k: any) => unknown): Promise<any> => page.evaluate(`(${fn.toString()})(window.__kit)`);
let h: Harness;
before(async () => {
  h = await startHarness({ jevAnswerer: scriptedAnswerer({
    'make it sound brighter and more alive': { route: 'adjust', aspect: 'brightness_up', amount: 'medium' },
    'put it in a big hall': { route: 'add_effect', fx: 'reverb' },
  }) });
});
after(async () => { await h?.close(); });

async function ready() {
  const { page, errors } = await openKit(h);
  await waitCompiled(page);
  await page.waitForFunction(() => (window as unknown as K).__kit.bridge.jevReady, null, { timeout: 15000 });
  return { page, errors };
}
async function ask(page: Page, text: string) {
  await page.keyboard.press('Control+k');
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => { const s = document.querySelector('[data-testid=ai-result]')?.getAttribute('data-status'); return s && s !== 'working'; }, null, { timeout: 10000 });
  return page.getAttribute('[data-testid=ai-result]', 'data-status');
}

describe('AI bar (fast path)', () => {
  it('⌘K + a Japanese phrase applies via the lexicon; Undo restores the knob; typing never plays notes', async () => {
    const { page, errors } = await ready();
    const before = await kit(page, k => k.doc.value.nodes.aenv1.values.release);
    const compiles = await kit(page, k => k.compiler.stats.started);
    assert.equal(await ask(page, 'リリース長く'), 'applied');
    assert.match(await page.textContent('[data-testid=ai-badge]') ?? '', /lexicon/);
    assert.ok(await kit(page, k => k.doc.value.nodes.aenv1.values.release) > before);
    await page.waitForTimeout(200);
    assert.equal(await kit(page, k => k.compiler.stats.started), compiles, 'a value edit does not recompile');
    await page.click('[data-testid=ai-undo]');
    assert.equal(await kit(page, k => k.doc.value.nodes.aenv1.values.release), before);
    assert.equal(h.jev!.requests.length, 0, 'the lexicon path never calls Jev');
    assert.deepEqual(errors, []);
    await page.close();
  });

  it('a free-form request goes through Jev; A/B flips the edit; audio keeps sounding', async () => {
    const { page, errors } = await ready();
    await page.click('[data-testid=enable-audio]');
    await page.waitForFunction(() => (window as unknown as K).__kit.engine.hasNode, null, { timeout: 60000 });
    await kit(page, k => k.engine.noteOn(45, 100));
    assert.equal(await ask(page, 'make it sound brighter and more alive'), 'applied');
    assert.match(await page.textContent('[data-testid=ai-badge]') ?? '', /Jev \d+ ms/);
    const after = await kit(page, k => k.doc.value.nodes.cut1.values.hz);
    assert.ok(after > 300);
    await page.click('[data-testid=ai-ab]');
    assert.equal(await kit(page, k => k.doc.value.nodes.cut1.values.hz), 300);
    await page.click('[data-testid=ai-ab]');
    assert.equal(await kit(page, k => k.doc.value.nodes.cut1.values.hz), after);
    // A structural fast edit (add reverb) recompiles and keeps the held note sounding.
    assert.equal(await ask(page, 'put it in a big hall'), 'applied');
    await waitCompiled(page);
    await page.waitForFunction(() => { const k = (window as unknown as K).__kit; return k.engine.currentHash === k.generated.value.hash; }, null, { timeout: 60000 });
    assert.ok(await outputPeak(page) > 0.005, 'still sounding after the swap');
    await kit(page, k => k.engine.noteOff(45));
    assert.deepEqual(errors, []);
    await page.close();
  });

  it('an unsure Jev offers chips; clicking one applies it', async () => {
    const { page } = await ready();
    const rev = await kit(page, k => k.doc.value.revision);
    assert.equal(await ask(page, 'make it pop somehow'), 'chips');
    assert.equal(await kit(page, k => k.doc.value.revision), rev);
    const chips = await page.$$('[data-testid=ai-chip]');
    assert.ok(chips.length > 0);
    await chips[0]!.click();
    await page.waitForSelector('[data-testid=ai-result][data-status=applied]');
    assert.equal(await kit(page, k => k.history.peek().author.handler), 'chip');
    await page.close();
  });

  it('Jev faults (overload, timeout, broken JSON) never change the patch or block editing', async () => {
    const { page, errors } = await ready();
    const rev = await kit(page, k => k.doc.value.revision);
    for (const fault of [{ status: 529 }, { delayMs: 4000 }, { body: '{"answers": nope' }]) {
      h.jev!.faults = [fault, fault];
      await kit(page, k => { k.fast.settings.budgetMs = 600; });
      const status = await ask(page, 'something unrecognisable');
      assert.equal(status, 'nothing', JSON.stringify(fault));
      assert.match(await page.textContent('[data-testid=ai-message]') ?? '', /Jev/);
      assert.equal(await kit(page, k => k.doc.value.revision), rev);
    }
    h.jev!.faults = [];
    // Editing still works right away.
    assert.equal(await kit(page, k => k.commit([{ op: 'setValue', node: 'gain1', port: 'gain', value: 0.2 }]).ok), true);
    assert.deepEqual(errors, []);
    await page.close();
  });

  it('the dev drawer shows recent requests and τ changes take effect', async () => {
    const { page } = await ready();
    await ask(page, 'brighter');
    await page.click('[data-testid=ai-drawer-toggle]');
    await page.waitForSelector('[data-testid=ai-drawer]');
    assert.match(await page.textContent('[data-testid=ai-drawer]') ?? '', /brighter/);
    await page.fill('[data-testid=ai-tau]', '0.95');
    assert.equal(await kit(page, k => k.fast.settings.tau), 0.95);
    assert.equal(await ask(page, 'make it sound brighter and more alive'), 'chips');
    await page.close();
  });
});

describe('Jev key rejected', () => {
  let bad: Harness;
  before(async () => { bad = await startHarness({ jevKey: 'wrong-key', warmUp: true }); });
  after(async () => { await bad?.close(); });
  it('the toolbar says the key was rejected; the lexicon still works', async () => {
    const { page } = await openKit(bad);
    await waitCompiled(page);
    await page.waitForFunction(() => /Jev key ✕/.test(document.querySelector('[data-testid=ai-status-jev]')?.textContent ?? ''), null, { timeout: 15000 });
    assert.equal(await ask(page, 'brighter'), 'applied');
    assert.equal(await ask(page, 'make it pop'), 'nothing');
    assert.match(await page.textContent('[data-testid=ai-message]') ?? '', /Jev is unavailable|Jev/);
    await page.close();
  });
});

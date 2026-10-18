// K5 audio engine in a real browser: create → sound → rewire → keeps sounding →
// failure keeps the previous sound; plus the D-row abnormal cases.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { openKit, outputPeak, reloadKit, startAudio, startHarness, waitCompiled, type Harness } from './harness.ts';

type K = { __kit: any };
let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h?.close(); });

// Run fn(window.__kit) in the page (fn is serialized; it must not close over test variables).
const kit = (page: Page, fn: (k: any) => unknown): Promise<any> => page.evaluate(`(${fn.toString()})(window.__kit)`);
async function ready(query = '') {
  const { page, errors } = await openKit(h, { query });
  await waitCompiled(page);
  await page.waitForFunction(() => (window as unknown as K).__kit.engine.hasNode, null, { timeout: 60000 });
  return { page, errors };
}
async function settle(page: Page) {
  await page.waitForFunction(() => { const k = (window as unknown as K).__kit; return k.compileStatus.value !== 'waiting' && k.compileStatus.value !== 'compiling'; }, null, { timeout: 60000 });
  await page.waitForTimeout(150);
}

describe('audio engine', () => {
  it('plays, survives a structural edit while a note is held, and keeps the old sound when compilation fails', async () => {
    const { page, errors } = await ready();
    await kit(page, k => k.engine.noteOn(48, 100));
    assert.ok(await outputPeak(page) > 0.005, 'bass should sound');
    const firstHash = await kit(page, k => k.engine.currentHash);
    // Structural edit while the key is held: new artifact, held note re-sent.
    await kit(page, k => k.commit([{ op: 'setConfig', node: 'osc1', key: 'waveform', value: 'sine' }]));
    await settle(page);
    await page.waitForFunction(h0 => (window as unknown as K).__kit.engine.currentHash !== h0, firstHash);
    assert.ok(await outputPeak(page) > 0.005, 'still sounding after the swap');
    // Now break it: a codebox with a syntax error in the signal path.
    const before = await kit(page, k => k.engine.currentHash);
    const r = await kit(page, k => k.commit([
      { op: 'addNode', node: { id: 'box1', type: 'kit.codebox', code: "import { defineSubgraph } from '@unworklet/core';\nexport default defineSubgraph(() => ({ tick(i) { return { out: i.in.mul( } } }));" } },
      { op: 'connect', from: { node: 'gain1', port: 'out' }, to: { node: 'box1', port: 'in' } },
      { op: 'connect', from: { node: 'box1', port: 'out' }, to: { node: 'out1', port: 'left' }, replace: true },
    ]).ok);
    assert.equal(r, true);
    const status = await waitCompiled(page);
    assert.equal(status.status, 'error');
    const issues = await kit(page, k => k.compileIssues.value);
    assert.ok(issues.some((i: { node?: string; line?: number }) => i.node === 'box1' && i.line), `codebox error attributed with a line: ${JSON.stringify(issues)}`);
    assert.equal(await kit(page, k => k.engine.currentHash), before, 'previous artifact stays loaded');
    assert.ok(await outputPeak(page) > 0.005, 'previous sound keeps playing');
    // Undo returns to a compilable patch.
    await kit(page, k => k.undo());
    assert.equal((await waitCompiled(page)).status, 'ok');
    await kit(page, k => k.engine.noteOff(48));
    assert.deepEqual(errors.filter(e => !e.includes('favicon')), []);
    await page.close();
  });

  it('value edits reach the AudioParam without recompiling', async () => {
    const { page } = await ready();
    const started = await kit(page, k => k.compiler.stats.started);
    await kit(page, k => k.commit([{ op: 'setValue', node: 'gain1', port: 'gain', value: 0.5 }]));
    await page.waitForTimeout(100);
    assert.equal(await kit(page, k => k.compiler.stats.started), started);
    assert.equal(await kit(page, k => k.compileStatus.value), 'ok');
    const value = await kit(page, async k => { await new Promise(r => setTimeout(r, 50)); return (k.engine as any).current.node.params.gain1_gain.value; });
    assert.ok(Math.abs(value - 0.5) < 1e-6, `param value ${value}`);
    await page.close();
  });

  it('C4 a burst of structural edits ends on the latest patch with few compiles', async () => {
    const { page } = await ready();
    const started = await kit(page, k => k.compiler.stats.started);
    for (let n = 0; n < 12; n++) await kit(page, k => k.commit([{ op: 'setConfig', node: 'osc1', key: 'waveform', value: k.doc.value.nodes.osc1.config.waveform === 'saw' ? 'sine' : 'saw' }]));
    await settle(page);
    await page.waitForFunction(() => { const k = (window as unknown as K).__kit; return k.engine.currentHash === k.generated.value.hash; }, null, { timeout: 60000 });
    const compiles = await kit(page, k => k.compiler.stats.started) - started;
    assert.ok(compiles <= 3, `compiled ${compiles} times`);
    await page.close();
  });

  it('D5/D12 many swaps rotate the AudioContext and leak no nodes', async () => {
    const { page, errors } = await ready('?rotateAfter=6');
    await kit(page, k => k.engine.noteOn(50, 100));
    for (let n = 0; n < 14; n++) {
      await page.evaluate(held => (window as unknown as K).__kit.commit([{ op: 'setValue', node: 'filter1', port: 'resonance', value: 0.6 }, { op: 'setConfig', node: 'voice1', key: 'heldCapacity', value: held }]), 8 + n);
      await settle(page);
    }
    await page.waitForTimeout(300);
    const stats = await kit(page, k => k.engine.stats);
    assert.ok(stats.rotations >= 1, JSON.stringify(stats));
    assert.ok(stats.created - stats.disposed <= 2 && stats.created - stats.disposed >= 1, JSON.stringify(stats));
    assert.ok(await outputPeak(page) > 0.005, 'sounding after rotation');
    assert.deepEqual(errors, []);
    await page.close();
  });

  it('B6/D9 runaway feedback is muted, reported and recoverable; the safety stage bounds the output', async () => {
    const { page } = await ready();
    const ok = await kit(page, k => k.commit([
      { op: 'addNode', node: { id: 'noise1', type: 'den.seededNoise' } }, { op: 'addNode', node: { id: 'h1', type: 'kit.history' } },
      { op: 'addNode', node: { id: 'sum1', type: 'kit.add' } }, { op: 'addNode', node: { id: 'fb1', type: 'kit.gain', values: { gain: 1.5 } } },
      { op: 'connect', from: { node: 'noise1', port: 'out' }, to: { node: 'sum1', port: 'a' } }, { op: 'connect', from: { node: 'h1', port: 'out' }, to: { node: 'fb1', port: 'in' } },
      { op: 'connect', from: { node: 'fb1', port: 'out' }, to: { node: 'sum1', port: 'b' } }, { op: 'connect', from: { node: 'sum1', port: 'out' }, to: { node: 'h1', port: 'in' } },
      { op: 'connect', from: { node: 'sum1', port: 'out' }, to: { node: 'out1', port: 'left' }, replace: true },
    ]).ok);
    assert.equal(ok, true);
    await settle(page);
    await page.waitForFunction(() => (window as unknown as K).__kit.engine.stats.healthEvents > 0, null, { timeout: 15000 });
    const peak = await outputPeak(page, 400);
    assert.ok(peak <= 0.99, `post-safety peak ${peak}`);
    assert.ok(await kit(page, k => k.toasts.value.some((t: { text: string }) => /runaway|NaN/.test(t.text))));
    // It keeps running away: muted, explained in a banner (not a blocking overlay)…
    await page.waitForSelector('[data-testid=banner]', { timeout: 20000 });
    assert.match(await page.textContent('[data-testid=banner]') ?? '', /muted/i);
    assert.equal(await page.$('[data-testid=start-overlay]'), null);
    // …and the next change (here: undo) brings the sound back without any button.
    await kit(page, k => k.undo());
    await settle(page);
    await page.waitForFunction(() => !document.querySelector('[data-testid=banner]'), null, { timeout: 20000 });
    assert.equal(await kit(page, k => k.healthMuted.value), false);
    await page.close();
  });

  it('C2/B7b a codebox that loops forever while building times out; the worker is replaced', async () => {
    const { page } = await ready('?compileTimeout=4000');
    const before = await kit(page, k => k.engine.currentHash);
    await kit(page, k => k.commit([
      { op: 'addNode', node: { id: 'box1', type: 'kit.codebox', code: "import { defineSubgraph, type Node } from '@unworklet/core';\nexport default defineSubgraph(() => { while (Date.now() > 0) { /* never ends */ } return { tick(i: { in: Node<'f32'> }) { return { out: i.in }; } }; });" } },
      { op: 'connect', from: { node: 'gain1', port: 'out' }, to: { node: 'box1', port: 'in' } },
      { op: 'connect', from: { node: 'box1', port: 'out' }, to: { node: 'out1', port: 'left' }, replace: true },
    ]));
    const status = await waitCompiled(page, 30000);
    assert.equal(status.status, 'error');
    assert.match(status.message, /timed out/);
    assert.equal(await kit(page, k => k.engine.currentHash), before);
    assert.equal(await kit(page, k => k.compiler.stats.timeouts), 1);
    await kit(page, k => k.undo());
    assert.equal((await waitCompiled(page)).status, 'ok');
    await page.close();
  });

  it('opens behind a start overlay: the first key press starts audio and that note sounds; the bottom is just the keyboard', async () => {
    const { page, errors } = await openKit(h, { start: false });
    await waitCompiled(page);
    assert.match(await page.textContent('[data-testid=start-overlay]') ?? '', /Click anywhere to start/);
    await page.keyboard.down('a');
    await page.waitForSelector('[data-testid=start-overlay]', { state: 'detached', timeout: 30000 });
    await page.waitForFunction(() => (window as unknown as K).__kit.engine.hasNode, null, { timeout: 60000 });
    assert.ok(await outputPeak(page) > 0.005, 'the key that started audio also plays');
    await page.keyboard.up('a');
    assert.equal(await page.$('[data-testid=enable-audio], [data-testid=volume], [data-phrase]'), null, 'no audio buttons, volume or phrase buttons');
    const printed = await page.evaluate(() => [...(document.querySelector('[data-testid=keyboard] dk-keyboard')?.shadowRoot?.querySelectorAll('.k') ?? [])].map(e => e.textContent).join(''));
    assert.equal([...printed].sort().join(''), [...'AWSEDFTGYHUJK'].sort().join(''), 'the computer keys are printed on the keyboard');
    assert.deepEqual(errors, []);
    await page.close();
    // A click on the overlay works the same.
    const second = await openKit(h, { start: false });
    await startAudio(second.page);
    assert.equal(await kit(second.page, k => k.engineState.value), 'running');
    await second.page.close();
  });

  it('D1 a non-48 kHz device is refused with a clear message (and compiling still works)', async () => {
    const context = await h.browser.newContext();
    const page = await context.newPage();
    await page.addInitScript(() => {
      const Real = AudioContext;
      (window as unknown as { AudioContext: unknown }).AudioContext = class extends Real { constructor(o?: AudioContextOptions) { super({ ...o, sampleRate: 44100 }); } };
    });
    await page.goto(`${h.url}?noStart`);
    await page.waitForFunction(() => (window as unknown as K).__kit, null, { timeout: 60000 });
    await waitCompiled(page);
    await page.click('[data-testid=start-overlay]');
    await page.waitForFunction(() => (window as unknown as K).__kit.engineState.value === 'error');
    assert.match(await kit(page, k => k.engineMessage.value), /48 kHz/);
    assert.match(await page.textContent('[data-testid=start-error]') ?? '', /48 kHz/, 'the overlay explains it');
    assert.equal(await kit(page, k => k.compileStatus.value), 'ok');
    await page.close();
  });

  it('F1/F7 autosave restores after reload; a corrupted autosave falls back with a warning', async () => {
    const { page } = await openKit(h);
    await waitCompiled(page);
    const record = await kit(page, k => { k.commit([{ op: 'setName', name: 'Persist me' }, { op: 'setValue', node: 'filter1', port: 'resonance', value: 2.5 }]); k.saveNow(); return localStorage.getItem('den-kit:autosave'); });
    await page.evaluate(() => sessionStorage.setItem('kit-e2e-keep', '1'));
    await reloadKit(page);
    await page.waitForFunction(() => (window as unknown as K).__kit?.doc.value.name === 'Persist me', null, { timeout: 60000 });
    assert.equal(await kit(page, k => k.doc.value.nodes.filter1.values.resonance), 2.5);
    await page.close();
    // A torn write: the checksum no longer matches. Inject it before the app starts.
    const context = await h.browser.newContext();
    const broken = JSON.stringify({ ...JSON.parse(record as string), text: (JSON.parse(record as string).text as string).replace('Persist', 'Broken') });
    await context.addInitScript(value => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('den-kit:autosave', value); } }, broken);
    const second = await context.newPage();
    await second.goto(h.url);
    await second.waitForFunction(() => (window as unknown as K).__kit?.toasts.value.length > 0, null, { timeout: 60000 });
    assert.ok(await kit(second, k => k.toasts.value.some((t: { text: string }) => /Autosave could not be read/.test(t.text))));
    assert.equal(await kit(second, k => k.doc.value.name), 'Bass');
    assert.ok(await second.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('den-kit:autosave:broken'))));
    await context.close();
  });
});

// CP2b in the browser: the prompt → bridge → (fake) Codex → kit_* tools run in
// this page against a draft (real compile and offline render workers) → the
// draft lands on the live patch as one undoable step. Steer, stop, questions,
// the user's edits winning, a codebox the LLM fixes, sign-in and crash states.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { openKit, outputPeak, startHarness, waitCompiled, type Harness } from './harness.ts';

const kit = (page: Page, fn: (k: any) => unknown): Promise<any> => page.evaluate(`(${fn.toString()})(window.__kit)`);
const lines = (page: Page) => kit(page, k => k.fast.history.value.map((o: any) => ({ id: o.id, text: o.text, status: o.status, route: o.route, label: o.label, message: o.message, steps: o.steps, conflicts: o.conflicts, reply: o.reply, actions: (o.actions ?? []).map((a: any) => a.label), undone: o.undone, fix: o.fix })));
const lineFor = async (page: Page, text: string) => (await lines(page)).filter((l: { text: string }) => l.text === text).at(-1);

async function ready(page: Page) {
  await waitCompiled(page);
  await page.waitForFunction(() => (window as any).__kit.bridge.codexReady, null, { timeout: 30000 });
}
/** Type into the prompt; Shift+Enter sends straight to the LLM. */
async function prompt(page: Page, text: string, toLlm = false) {
  await page.keyboard.press('Control+k');
  await page.keyboard.type(text);
  await page.keyboard.press(toLlm ? 'Shift+Enter' : 'Enter');
}
async function settled(page: Page, text: string, timeout = 90000) {
  await page.waitForFunction(t => { const o = (window as any).__kit.fast.history.value.filter((x: any) => x.text === t).at(-1); return o && !o.live && o.status !== 'working' && o.status !== 'thinking'; }, text, { timeout });
  return lineFor(page, text);
}
const sendCount = (h: Harness, method: string) => h.codex!.sent(method).length;

let h: Harness;
before(async () => { h = await startHarness({ codex: true }); });
after(async () => { await h?.close(); });

describe('LLM path (fake Codex, real tools in the browser)', () => {
  it('Shift+Enter: the LLM edits a draft, listens (spectrogram), and the edit lands as one step; ⌘Z undoes it', { timeout: 180000 }, async () => {
    const { page, errors } = await openKit(h);
    await ready(page);
    assert.match(await page.textContent('[data-testid=ai-status-codex]') ?? '', /LLM/);
    const before = await kit(page, k => JSON.stringify(Object.keys(k.doc.value.nodes).sort()));
    await prompt(page, 'wobble the cutoff', true);
    // While it works: a live line with what it is doing; the live patch is untouched.
    await page.waitForSelector('[data-route=llm] [data-testid=ai-activity]', { timeout: 15000 });
    const line = await settled(page, 'wobble the cutoff');
    assert.equal(line.status, 'applied', JSON.stringify(line));
    assert.equal(line.label, 'Added an LFO that wobbles the cutoff (checked by listening).');
    assert.ok(line.steps.some((s: string) => /compiled ✓/.test(s)), line.steps.join(' | '));
    assert.ok(line.steps.some((s: string) => /listened \(-?\d/.test(s)), line.steps.join(' | '));
    assert.equal(await kit(page, k => k.history.peek().author.kind), 'ai-llm');
    assert.ok(await kit(page, k => !!k.doc.value.nodes.lfo2 && !!k.doc.value.nodes.sum2));
    assert.equal((await waitCompiled(page)).status, 'ok');
    // The render ran in the browser worker: real metrics and a PNG went back to the model.
    const listen = h.codex!.replies().find(r => JSON.stringify(r).includes('peak'))!;
    const items = (listen.result as { contentItems: Array<{ type: string; imageUrl?: string }> }).contentItems;
    assert.deepEqual(items.map(i => i.type), ['inputText', 'inputImage']);
    assert.match(items[1]!.imageUrl!, /^data:image\/png;base64,iVBORw0KGgo/);
    // ⌘Z takes the whole LLM edit back.
    await page.locator('[data-testid=ai-input]').blur();
    await page.keyboard.press('Control+z');
    assert.equal(await kit(page, k => JSON.stringify(Object.keys(k.doc.value.nodes).sort())), before);
    assert.equal((await lineFor(page, 'wobble the cutoff')).undone, true);
    assert.deepEqual(errors, []);
    assert.deepEqual(h.codex!.violations(), []);
    await page.close();
  });

  it('a codebox request goes to the LLM by itself; its compile error comes back with the line; the fixed code plays', { timeout: 180000 }, async () => {
    const { page, errors } = await openKit(h);
    await ready(page);
    await prompt(page, 'write a bitcrusher in a codebox');
    const line = await settled(page, 'write a bitcrusher in a codebox');
    assert.equal(line.route, 'llm');
    assert.equal(line.status, 'applied', JSON.stringify(line));
    const broken = h.codex!.replies().find(r => JSON.stringify(r).includes('does not compile'));
    assert.ok(broken, 'the compile error went back to the model');
    assert.match(JSON.stringify(broken), /crush1/);
    assert.match(await kit(page, k => k.doc.value.nodes.crush1.code), /floor\(\)/);
    assert.equal((await waitCompiled(page)).status, 'ok');
    await kit(page, k => k.noteOn(45, 100));
    assert.ok(await outputPeak(page, 400) > 0.001, 'the crushed bass sounds');
    await kit(page, k => k.noteOff(45));
    assert.deepEqual(errors, []);
    await page.close();
  });

  it('a question becomes buttons; a click continues the same conversation', { timeout: 180000 }, async () => {
    const { page, errors } = await openKit(h);
    await ready(page);
    const threads = sendCount(h, 'thread/start');
    await prompt(page, 'make it different', true);
    const asked = await settled(page, 'make it different');
    assert.equal(asked.status, 'chips');
    assert.equal(asked.message, 'Which direction?');
    assert.deepEqual(asked.actions, ['Brighter', 'Darker']);
    await page.click('[data-testid=ai-action]:has-text("Darker")');
    const answered = await settled(page, 'Darker');
    assert.equal(answered.status, 'applied', JSON.stringify(answered));
    assert.equal(await kit(page, k => k.doc.value.nodes.cut1.values.hz), 120);
    assert.equal(sendCount(h, 'thread/start'), threads + 1, 'the follow-up stayed in the same conversation');
    assert.deepEqual(errors, []);
    await page.close();
  });

  it('Esc stops a running request and nothing changes', { timeout: 120000 }, async () => {
    const { page, errors } = await openKit(h);
    await ready(page);
    const before = await kit(page, k => k.doc.value.revision);
    await prompt(page, 'slow please', true);
    await page.waitForFunction(() => /thinking/.test(document.querySelector('[data-route=llm] [data-testid=ai-activity]')?.textContent ?? ''), null, { timeout: 15000 });
    await page.keyboard.press('Escape');
    const line = await settled(page, 'slow please', 20000);
    assert.equal(line.status, 'stopped');
    assert.equal(await kit(page, k => k.doc.value.revision), before);
    assert.equal(await kit(page, k => k.llm.busy.value), false);
    assert.deepEqual(errors, []);
    await page.close();
  });

  it('a request typed while the LLM works is added to it', { timeout: 120000 }, async () => {
    const { page, errors } = await openKit(h);
    await ready(page);
    await prompt(page, 'slow please', true);
    await page.waitForFunction(() => /thinking/.test(document.querySelector('[data-route=llm] [data-testid=ai-activity]')?.textContent ?? ''), null, { timeout: 15000 });
    await prompt(page, 'make it darker', true);
    const merged = await settled(page, 'make it darker', 20000);
    assert.equal(merged.status, 'merged');
    const line = await settled(page, 'slow please', 30000);
    assert.equal(line.status, 'applied', JSON.stringify(line));
    assert.equal(await kit(page, k => k.doc.value.nodes.cut1.values.hz), 150);
    assert.deepEqual(errors, []);
    await page.close();
  });

  it('your edits made meanwhile win; the line says what was kept', { timeout: 120000 }, async () => {
    const { page, errors } = await openKit(h);
    await ready(page);
    await prompt(page, 'add delay and open the filter', true);
    await page.waitForFunction(() => /editing|thinking/.test(document.querySelector('[data-route=llm] [data-testid=ai-activity]')?.textContent ?? ''), null, { timeout: 15000 });
    await kit(page, k => k.commit([{ op: 'setValue', node: 'cut1', port: 'hz', value: 444 }]));
    const line = await settled(page, 'add delay and open the filter', 30000);
    assert.equal(line.status, 'applied', JSON.stringify(line));
    assert.equal(await kit(page, k => k.doc.value.nodes.cut1.values.hz), 444, 'the user’s value stays');
    assert.equal(await kit(page, k => k.doc.value.nodes.gain1.values.gain), 0.2, 'the rest of the LLM edit landed');
    assert.equal(line.conflicts.length, 1);
    assert.match(await page.textContent('[data-testid=ai-conflicts]') ?? '', /kept your edits/);
    assert.deepEqual(errors, []);
    await page.close();
  });

  it('a Codex crash fails the request clearly; Codex restarts and the next request works', { timeout: 120000 }, async () => {
    const { page, errors } = await openKit(h);
    await ready(page);
    await prompt(page, 'crash now', true);
    const line = await settled(page, 'crash now', 30000);
    assert.equal(line.status, 'failed');
    assert.match(line.message, /stopped unexpectedly/);
    await page.waitForFunction(() => (window as any).__kit.bridge.codexReady, null, { timeout: 30000 });
    await prompt(page, 'explain this patch', true);
    const next = await settled(page, 'explain this patch', 30000);
    assert.equal(next.status, 'reply');
    assert.match(next.reply, /oscillator/);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

describe('LLM path, not signed in', () => {
  let s: Harness;
  before(async () => { s = await startHarness({ codex: { signedIn: false } }); });
  after(async () => { await s?.close(); });

  it('the status and the request say how to sign in; signing in is picked up without a restart', { timeout: 120000 }, async () => {
    const { page, errors } = await openKit(s);
    await waitCompiled(page);
    await page.waitForFunction(() => (window as any).__kit.bridge.status.value?.codex.state === 'login', null, { timeout: 30000 });
    assert.match(await page.textContent('[data-testid=ai-status-codex]') ?? '', /sign in/);
    await prompt(page, 'write a bitcrusher in a codebox');
    const line = await settled(page, 'write a bitcrusher in a codebox', 15000);
    assert.equal(line.status, 'escalate');
    assert.match(line.message, /not signed in.*kit:codex:login/);
    s.codex!.signIn();
    await page.waitForFunction(() => (window as any).__kit.bridge.codexReady, null, { timeout: 30000 });
    assert.deepEqual(errors, []);
    await page.close();
  });
});

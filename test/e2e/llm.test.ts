// The LLM path in the browser: the prompt → bridge → (fake) Codex → kit_* tools
// run in this page against the live patch (real compile and offline render
// workers): each edit that checks out lands at once, the whole request is one
// ⌘Z. Steer, stop, questions nobody is asked, the user's edits in between, a
// codebox the LLM fixes, sign-in and crash states.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { openKit, outputPeak, startHarness, waitCompiled, type Harness } from './harness.ts';

const kit = (page: Page, fn: (k: any) => unknown): Promise<any> =>
  page.evaluate(`(${fn.toString()})(window.__kit)`);
const lines = (page: Page) =>
  kit(page, k =>
    k.requests.history.value.map((o: any) => ({
      id: o.id,
      text: o.text,
      status: o.status,
      route: o.route,
      label: o.label,
      message: o.message,
      note: o.note,
      steps: o.steps,
      reply: o.reply,
      undone: o.undone,
      fix: o.fix,
    })),
  );
const lineFor = async (page: Page, text: string) =>
  (await lines(page)).filter((l: { text: string }) => l.text === text).at(-1);

async function ready(page: Page) {
  await waitCompiled(page);
  await page.waitForFunction(() => (window as any).__kit.bridge.codexReady, null, {
    timeout: 30000,
  });
}
/** Type into the prompt; Enter and Shift+Enter both send to the LLM. */
async function prompt(page: Page, text: string, toLlm = false) {
  await page.keyboard.press('Control+k');
  await page.keyboard.type(text);
  await page.keyboard.press(toLlm ? 'Shift+Enter' : 'Enter');
}
async function settled(page: Page, text: string, timeout = 90000) {
  await page.waitForFunction(
    t => {
      const o = (window as any).__kit.requests.history.value
        .filter((x: any) => x.text === t)
        .at(-1);
      return o && !o.live && o.status !== 'working' && o.status !== 'thinking';
    },
    text,
    { timeout },
  );
  return lineFor(page, text);
}

let h: Harness;
before(async () => {
  h = await startHarness({ codex: true });
});
after(async () => {
  await h?.close();
});

describe('LLM path (fake Codex, real tools in the browser)', () => {
  it(
    'Shift+Enter: the LLM edits the live patch while it works, listens (spectrogram); one ⌘Z undoes the request',
    { timeout: 180000 },
    async () => {
      const { page, errors } = await openKit(h);
      await ready(page);
      assert.match((await page.textContent('[data-testid=ai-status-codex]')) ?? '', /● AI$/);
      const before = await kit(page, k => JSON.stringify(Object.keys(k.doc.value.nodes).sort()));
      // Record, for every LLM step that lands, whether its request was still running.
      await kit(page, k => {
        (window as any).__landedLive = [];
        k.onTransaction((tx: any) => {
          if (tx.author.kind === 'ai-llm')
            (window as any).__landedLive.push(
              k.requests.history.value.find((o: any) => o.id === tx.author.take)?.live,
            );
        });
      });
      await prompt(page, 'wobble the cutoff', true);
      await page.waitForSelector('[data-route=llm] [data-testid=ai-activity]', { timeout: 15000 });
      const line = await settled(page, 'wobble the cutoff');
      assert.equal(line.status, 'applied', JSON.stringify(line));
      assert.equal(line.label, 'Added an LFO that wobbles the cutoff (checked by listening).');
      assert.ok(
        line.steps.some((s: string) => /\+ lfo2.* ✓$/.test(s)),
        line.steps.join(' | '),
      ); // landed: checked and compiled
      assert.ok(
        line.steps.some((s: string) => /listened \(-?\d/.test(s)),
        line.steps.join(' | '),
      );
      assert.equal(await kit(page, k => k.history.peek().author.kind), 'ai-llm');
      assert.ok(await kit(page, k => !!k.doc.value.nodes.lfo2 && !!k.doc.value.nodes.sum2));
      assert.deepEqual(
        await page.evaluate(() => (window as any).__landedLive),
        [true],
        'the edit landed while the request was still running',
      );
      assert.equal((await waitCompiled(page)).status, 'ok');
      // The render ran in the browser worker: real metrics and a PNG went back to the model.
      const listen = h.codex!.mcpCalls().find(c => c.text.includes('peak'))!;
      assert.deepEqual(listen.types, ['text', 'image']);
      assert.equal(listen.images[0]!.mimeType, 'image/png');
      assert.match(listen.images[0]!.prefix, /^iVBORw0KGgo/);
      // ⌘Z takes the whole LLM edit back.
      await page.locator('[data-testid=ai-input]').blur();
      await page.keyboard.press('Control+z');
      assert.equal(
        await kit(page, k => JSON.stringify(Object.keys(k.doc.value.nodes).sort())),
        before,
      );
      assert.equal((await lineFor(page, 'wobble the cutoff')).undone, true);
      assert.deepEqual(errors, []);
      assert.deepEqual(h.codex!.violations(), []);
      await page.close();
    },
  );

  it(
    'a codebox request goes to the LLM by itself; its compile error comes back with the line; the fixed code plays',
    { timeout: 180000 },
    async () => {
      const { page, errors } = await openKit(h);
      await ready(page);
      await prompt(page, 'write a bitcrusher in a codebox');
      const line = await settled(page, 'write a bitcrusher in a codebox');
      assert.equal(line.route, 'llm');
      assert.equal(line.status, 'applied', JSON.stringify(line));
      const broken = h.codex!.mcpCalls().find(c => c.text.includes('would not compile'));
      assert.ok(broken, 'the compile error went back to the model');
      assert.match(broken.text, /crush1/);
      assert.match(broken.text, /Nothing was applied/);
      assert.match(await kit(page, k => k.doc.value.nodes.crush1.code), /floor\(\)/);
      assert.equal((await waitCompiled(page)).status, 'ok');
      await kit(page, k => k.noteOn(45, 100));
      assert.ok((await outputPeak(page, 400)) > 0.001, 'the crushed bass sounds');
      await kit(page, k => k.noteOff(45));
      assert.deepEqual(errors, []);
      await page.close();
    },
  );

  it(
    'a Codex question is never put to you: it is answered empty and the request goes on',
    { timeout: 120000 },
    async () => {
      const { page, errors } = await openKit(h);
      await ready(page);
      await prompt(page, 'ask me with codex', true);
      const line = await settled(page, 'ask me with codex', 30000);
      assert.equal(line.status, 'reply', JSON.stringify(line));
      assert.match(line.reply, /You chose nothing/);
      assert.ok(
        line.steps.some((s: string) => /skipped a question/.test(s)),
        line.steps.join(' | '),
      );
      assert.equal(
        await page
          .locator(
            '[data-testid=ai-panel] button:not([data-testid=ai-close]):not([data-testid=ai-mic]):not([data-testid=ai-screen]):not([data-testid=ai-pen])',
          )
          .count(),
        0,
        'nothing to pick',
      );
      assert.deepEqual(errors, []);
      await page.close();
    },
  );

  it(
    'Esc stops a running request; nothing had landed, so nothing changed',
    { timeout: 120000 },
    async () => {
      const { page, errors } = await openKit(h);
      await ready(page);
      const before = await kit(page, k => k.doc.value.revision);
      await prompt(page, 'slow please', true);
      await page.waitForFunction(
        () =>
          /thinking/.test(
            document.querySelector('[data-route=llm] [data-testid=ai-activity]')?.textContent ?? '',
          ),
        null,
        { timeout: 15000 },
      );
      await page.keyboard.press('Escape');
      const line = await settled(page, 'slow please', 20000);
      assert.equal(line.status, 'stopped');
      assert.equal(await kit(page, k => k.doc.value.revision), before);
      assert.equal(await kit(page, k => k.llm.busy.value), false);
      assert.deepEqual(errors, []);
      await page.close();
    },
  );

  it(
    'a short edit typed with Enter while the LLM works is added to it',
    { timeout: 120000 },
    async () => {
      const { page, errors } = await openKit(h);
      await ready(page);
      await prompt(page, 'slow please', true);
      await page.waitForFunction(
        () =>
          /thinking/.test(
            document.querySelector('[data-route=llm] [data-testid=ai-activity]')?.textContent ?? '',
          ),
        null,
        { timeout: 15000 },
      );
      await prompt(page, 'brighter');
      const merged = await settled(page, 'brighter', 20000);
      assert.equal(merged.route, 'llm');
      assert.equal(merged.status, 'merged');
      const line = await settled(page, 'slow please', 30000);
      assert.equal(line.status, 'applied', JSON.stringify(line));
      assert.equal(await kit(page, k => k.doc.value.nodes.cut1.values.hz), 2400);
      assert.deepEqual(errors, []);
      await page.close();
    },
  );

  it(
    'your edit made while it works stays yours: ⌘Z takes back yours, then the request',
    { timeout: 120000 },
    async () => {
      const { page, errors } = await openKit(h);
      await ready(page);
      const hz = await kit(page, k => k.doc.value.nodes.cut1.values.hz);
      await prompt(page, 'add delay and open the filter', true);
      // The LLM's step lands first (cutoff 1500, level 0.2); then the user turns the cutoff.
      await page.waitForFunction(
        () => (window as any).__kit.doc.value.nodes.cut1.values.hz === 1500,
        null,
        { timeout: 15000 },
      );
      await kit(page, k => k.commit([{ op: 'setValue', node: 'cut1', port: 'hz', value: 444 }]));
      const line = await settled(page, 'add delay and open the filter', 30000);
      assert.equal(line.status, 'applied', JSON.stringify(line));
      assert.equal(
        await kit(page, k => k.doc.value.nodes.cut1.values.hz),
        444,
        'the user’s value stays',
      );
      assert.equal(
        await kit(page, k => k.doc.value.nodes.gain1.values.gain),
        0.2,
        'the LLM edit landed',
      );
      await page.locator('[data-testid=ai-input]').blur();
      await page.keyboard.press('Control+z');
      assert.equal(await kit(page, k => k.doc.value.nodes.cut1.values.hz), 1500);
      await page.keyboard.press('Control+z');
      assert.equal(await kit(page, k => k.doc.value.nodes.cut1.values.hz), hz);
      assert.notEqual(await kit(page, k => k.doc.value.nodes.gain1.values.gain), 0.2);
      assert.deepEqual(errors, []);
      await page.close();
    },
  );

  it(
    'a Codex crash fails the request clearly; Codex restarts and the next request works',
    { timeout: 120000 },
    async () => {
      const { page, errors } = await openKit(h);
      await ready(page);
      await prompt(page, 'crash now', true);
      const line = await settled(page, 'crash now', 30000);
      assert.equal(line.status, 'failed');
      assert.match(line.message, /stopped unexpectedly/);
      await page.waitForFunction(() => (window as any).__kit.bridge.codexReady, null, {
        timeout: 30000,
      });
      await prompt(page, 'explain this patch', true);
      const next = await settled(page, 'explain this patch', 30000);
      assert.equal(next.status, 'reply');
      assert.match(next.reply, /oscillator/);
      assert.deepEqual(errors, []);
      await page.close();
    },
  );
});

describe('LLM path, not signed in', () => {
  let s: Harness;
  before(async () => {
    s = await startHarness({ codex: { signedIn: false } });
  });
  after(async () => {
    await s?.close();
  });

  it(
    'the status and the request say how to sign in; signing in is picked up without a restart',
    { timeout: 120000 },
    async () => {
      const { page, errors } = await openKit(s);
      await waitCompiled(page);
      await page.waitForFunction(
        () => (window as any).__kit.bridge.status.value?.codex.state === 'login',
        null,
        { timeout: 30000 },
      );
      assert.match((await page.textContent('[data-testid=ai-status-codex]')) ?? '', /sign in/);
      await prompt(page, 'write a bitcrusher in a codebox');
      const line = await settled(page, 'write a bitcrusher in a codebox', 15000);
      assert.equal(line.status, 'failed');
      assert.match(line.message, /not signed in.*codex:login/);
      s.codex!.signIn();
      await page.waitForFunction(() => (window as any).__kit.bridge.codexReady, null, {
        timeout: 30000,
      });
      assert.deepEqual(errors, []);
      await page.close();
    },
  );
});

// Voice input in the browser with a scripted stand-in for Chrome's speech
// recognizer (the real one needs a microphone and Google's servers): hold Space,
// speak, release → the request runs. Taps, typing and errors never send.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { openKit, startHarness, waitCompiled, type Harness } from './harness.ts';

type K = { __kit: any; __speech: any };
const kit = (page: Page, fn: (k: any) => unknown): Promise<any> => page.evaluate(`(${fn.toString()})(window.__kit)`);

/** A fake webkitSpeechRecognition driven by window.__speech.say(text). */
const FAKE = `
  window.__speech = { started: 0, instances: [], failWith: null,
    say(text) { const r = this.instances.at(-1); r.results = [{ isFinal: false, 0: { transcript: text } }]; r.onresult && r.onresult({ resultIndex: 0, results: r.results }); } };
  class FakeRecognition {
    constructor() { this.lang = ''; this.continuous = false; this.interimResults = false; this.results = []; window.__speech.instances.push(this); }
    start() { window.__speech.started++; const fail = window.__speech.failWith; if (fail) setTimeout(() => { this.onerror && this.onerror({ error: fail }); this.onend && this.onend(); }, 20); }
    stop() { setTimeout(() => { const last = this.results.at(-1); if (last) last.isFinal = true; this.onresult && this.onresult({ resultIndex: 0, results: this.results }); this.onend && this.onend(); }, 40); }
    abort() { setTimeout(() => { this.onerror && this.onerror({ error: 'aborted' }); this.onend && this.onend(); }, 0); }
  }
  window.webkitSpeechRecognition = FakeRecognition;
  window.SpeechRecognition = FakeRecognition;
`;
const NO_SPEECH = `delete window.webkitSpeechRecognition; delete window.SpeechRecognition; window.webkitSpeechRecognition = undefined; window.SpeechRecognition = undefined;`;

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h?.close(); });

async function open(initScript = FAKE) {
  const { page, errors } = await openKit(h, { initScript });
  await waitCompiled(page);
  return { page, errors };
}
async function holdAndSay(page: Page, text: string | null, holdMs = 400) {
  await page.keyboard.down('Space');
  await page.waitForFunction(() => (window as unknown as K).__speech?.started > 0 || document.querySelector('[data-testid=ai-voice-message]'), null, { timeout: 5000 });
  if (text !== null) await page.evaluate(t => (window as unknown as K).__speech.say(t), text);
  await page.waitForTimeout(holdMs);
  await page.keyboard.up('Space');
}

describe('voice input (hold Space)', () => {
  it('hold Space, speak, release: the request runs like a typed one (Japanese by default)', async () => {
    const { page, errors } = await open();
    const before = await kit(page, k => k.doc.value.nodes.cut1.values.hz);
    await page.keyboard.down('Space');
    await page.waitForFunction(() => (window as unknown as K).__speech.started === 1);
    assert.match(await page.getAttribute('[data-testid=ai-input]', 'placeholder') ?? '', /Listening/);
    await page.evaluate(() => (window as unknown as K).__speech.say('明るく'));
    await page.waitForFunction(() => (document.querySelector('[data-testid=ai-input]') as HTMLInputElement).value === '明るく');
    await page.waitForTimeout(300);
    await page.keyboard.up('Space');
    await page.waitForSelector('[data-testid=ai-result][data-status=applied]', { timeout: 10000 });
    assert.ok(await kit(page, k => k.doc.value.nodes.cut1.values.hz) > before);
    assert.equal(await page.evaluate(() => (window as unknown as K).__speech.instances[0].lang), 'ja-JP');
    assert.deepEqual(errors, []);
    await page.close();
  });

  it('a quick tap of Space sends nothing; Space while typing types a space; ⌘K then Space talks', async () => {
    const { page } = await open();
    const rev = await kit(page, k => k.doc.value.revision);
    await page.keyboard.down('Space');
    await page.keyboard.up('Space');
    await page.waitForTimeout(300);
    assert.equal(await kit(page, k => k.doc.value.revision), rev);
    assert.equal(await page.$('[data-testid=ai-voice-message]'), null);
    // Typing in the AI bar: Space is a space.
    await page.click('[data-testid=ai-input]');
    await page.keyboard.type('more reverb');
    assert.equal(await page.inputValue('[data-testid=ai-input]'), 'more reverb');
    const started = await page.evaluate(() => (window as unknown as K).__speech.started);
    await page.fill('[data-testid=ai-input]', '');
    // Empty AI input (after ⌘K): holding Space talks.
    await page.keyboard.press('Control+k');
    await holdAndSay(page, 'リリース長く');
    await page.waitForSelector('[data-testid=ai-result][data-status=applied]', { timeout: 10000 });
    assert.equal(await page.evaluate(() => (window as unknown as K).__speech.started), started + 1);
    await page.close();
  });

  it('Shift+Space still opens the module search, not the microphone', async () => {
    const { page } = await open();
    await page.locator('[data-testid=patch-view]').focus();
    await page.keyboard.press('Shift+Space');
    await page.waitForSelector('.palette input, [data-testid=palette-search]', { timeout: 5000 });
    assert.equal(await page.evaluate(() => (window as unknown as K).__speech.started), 0);
    await page.close();
  });

  it('a blocked microphone and silence are explained; nothing changes', async () => {
    const { page } = await open();
    const rev = await kit(page, k => k.doc.value.revision);
    await page.evaluate(() => { (window as unknown as K).__speech.failWith = 'not-allowed'; });
    await holdAndSay(page, null);
    await page.waitForSelector('[data-testid=ai-voice-message]');
    assert.match(await page.textContent('[data-testid=ai-voice-message]') ?? '', /blocked/);
    await page.evaluate(() => { (window as unknown as K).__speech.failWith = null; });
    await holdAndSay(page, null);
    await page.waitForFunction(() => /catch anything/.test(document.querySelector('[data-testid=ai-voice-message]')?.textContent ?? ''));
    assert.equal(await kit(page, k => k.doc.value.revision), rev);
    await page.close();
  });

  it('without speech recognition the bar says it needs Chrome', async () => {
    const { page, errors } = await open(NO_SPEECH);
    await page.keyboard.down('Space');
    await page.waitForSelector('[data-testid=ai-voice-message]');
    await page.keyboard.up('Space');
    assert.match(await page.textContent('[data-testid=ai-voice-message]') ?? '', /needs Chrome/);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

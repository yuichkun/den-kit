// U8b in the page: every LLM request says what the person is looking at; the
// model can ask to see it (kit_look as "seen"): without screen sharing it gets
// the plugin re-drawn and is told so, with sharing a picture of the view as
// the person sees it. (The cloud's headless Chrome cannot share a tab, so the
// shared tab is a stand-in here; the real one is checked on a Mac.)
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { openKit, startHarness, waitCompiled, type Harness } from './harness.ts';

const kit = (page: Page, fn: (k: any) => unknown): Promise<any> => page.evaluate(`(${fn.toString()})(window.__kit)`);
async function ask(page: Page, text: string) {
  await page.keyboard.press('Control+k');
  await page.keyboard.type(text);
  await page.keyboard.press('Shift+Enter');
  await page.waitForFunction(t => { const o = (window as any).__kit.fast.history.value.at(-1); return o && o.text === t && !o.live && o.status !== 'thinking'; }, text, { timeout: 60000 });
  return kit(page, k => k.fast.history.value.at(-1));
}

let h: Harness;
before(async () => { h = await startHarness({ codex: true }); });
after(async () => { await h?.close(); });

describe('the AI sees what the person sees', () => {
  it('says what the person looks at; shows it as a picture once the screen is shared', { timeout: 120000 }, async () => {
    const { page, errors } = await openKit(h);
    await waitCompiled(page);
    await page.waitForFunction(() => (window as any).__kit.bridge.codexReady, null, { timeout: 30000 });
    await page.click('[data-testid=view-plugin]');
    await page.waitForSelector('[data-testid=plugin-view] [data-testid=panel]');
    // The eye in the AI panel: off until the person shares the tab.
    assert.equal(await page.locator('[data-testid=ai-screen]').getAttribute('aria-pressed'), 'false');
    const first = await ask(page, 'what do you see?');
    // (The bass starter's plugin is empty, so the re-drawn plugin has no picture.)
    assert.match(first.reply, /^no picture: The person has not shared their screen with you \(they can, in the AI panel\)\. The person is looking at the plugin, playing it at \d+% of its design size; their screen is not shared with you\.\nInstead, the plugin re-drawn/);
    const said = h.codex!.records().filter(r => r.scenario === 'see').map(r => String(r.text));
    assert.match(said[0]!, /\[den-kit\] The person is looking at the plugin, playing it at \d+% of its design size; their screen is not shared with you\.\n\nwhat do you see\?$/);
    // The stand-in for a shared tab: pictures of the requested part of the page.
    await kit(page, k => {
      k.screen.stub = async (rect: { width: number; height: number }) => {
        const c = new OffscreenCanvas(Math.round(rect.width), Math.round(rect.height));
        const g = c.getContext('2d')!; g.fillStyle = '#39ff14'; g.fillRect(0, 0, c.width, c.height);
        return { data: new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()), mime: 'image/png', width: c.width, height: c.height, source: 'tab' };
      };
    });
    const second = await ask(page, 'and now what do you see?');
    assert.match(second.reply, /^picture: What the person sees now \(plugin, \d+×\d+, from their shared tab\)\. The person is looking at the plugin, playing it at \d+% of its design size; they let you see their screen/);
    const reply = h.codex!.replies().filter(r => /What the person sees now/.test(JSON.stringify(r))).at(-1)!;
    const items = (reply.result as { contentItems: Array<{ type: string; imageUrl?: string }> }).contentItems;
    assert.deepEqual(items.map(i => i.type), ['inputText', 'inputImage']);
    // In the patch view the line says what is in sight.
    await page.click('[data-testid=view-patch]');
    await page.waitForSelector('[data-testid=patch-view] .vue-flow__node');
    await ask(page, 'what do you see in the patch?');
    const last = h.codex!.records().filter(r => r.scenario === 'see').map(r => String(r.text)).at(-1)!;
    assert.match(last, /The person is looking at the patch \(zoom \d+%; in sight: [a-z0-9, ]+/);
    assert.deepEqual(errors, []);
    assert.deepEqual(h.codex!.violations(), []);
    await page.close();
  });
});

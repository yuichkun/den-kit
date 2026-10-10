// U4 with the LLM: the (fake) model builds the plugin screen with den-kit's
// tools in this page — reads it, writes a design brief, edits, looks at it
// (the real off-screen picture and checks), fixes what the look found, looks
// again — and the person sees it land on the plugin; one ⌘Z takes it all back.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { openKit, startHarness, waitCompiled, type Harness } from './harness.ts';

const kit = (page: Page, fn: (k: any) => unknown): Promise<any> => page.evaluate(`(${fn.toString()})(window.__kit)`);

let h: Harness;
before(async () => { h = await startHarness({ codex: true }); });
after(async () => { await h?.close(); });

describe('the LLM builds the plugin screen', () => {
  it('reads, writes a brief, edits, looks, fixes what it found, looks again; the plugin shows it; one ⌘Z undoes it', { timeout: 180000 }, async () => {
    const { page, errors } = await openKit(h);
    await waitCompiled(page);
    await page.waitForFunction(() => (window as any).__kit.bridge.codexReady, null, { timeout: 30000 });
    const before = await kit(page, k => JSON.stringify({ ui: k.doc.value.ui, nodes: Object.keys(k.doc.value.nodes).sort(), panel: k.doc.value.panel }));
    await page.keyboard.press('Control+k');
    await page.keyboard.type('画面を作って');
    await page.keyboard.press('Shift+Enter');
    await page.waitForFunction(() => { const o = (window as any).__kit.requests.history.value.at(-1); return o && o.text === '画面を作って' && !o.live && o.status !== 'thinking'; }, null, { timeout: 120000 });
    const line = await kit(page, k => { const o = k.requests.history.value.at(-1); return { status: o.status, label: o.label, steps: o.steps, screen: o.screen }; });
    assert.equal(line.status, 'applied', JSON.stringify(line));
    assert.equal(line.label, '夜のドライブ風の画面を作りました（チェックで 2 件直しました）');
    assert.equal(line.screen, true);
    assert.ok(line.steps.some((s: string) => /^looked at the screen \(\d+ to fix\)$/.test(s)), line.steps.join(' | '));
    assert.ok(line.steps.includes('looked at the screen (fine)'), line.steps.join(' | '));
    // What landed: the brief, the look, the texts, three wired knobs, the fixes.
    const doc = await kit(page, k => k.doc.value);
    assert.match(doc.ui.brief, /^Night-drive bass/);
    assert.equal(doc.ui.look.tokens.accent, '#3ad1ff');
    assert.equal(doc.ui.elements.text1.text, 'NIGHT BASS');
    assert.equal(doc.ui.elements.text2.textStyle.color, 'muted');
    assert.equal(doc.nodes.knob2.panel.x, 136);
    for (const [knob, target] of [['knob1', 'cut1.hz'], ['knob2', 'filter1.resonance'], ['knob3', 'aenv1.release']]) assert.ok(Object.values<any>(doc.edges).some(e => e.from.node === knob && `${e.to.node}.${e.to.port}` === target), `${knob} → ${target}`);
    // The model saw the problems, and a picture of the screen.
    const looks = h.codex!.replies().filter(r => /Looked at the plugin/.test(JSON.stringify(r)));
    assert.equal(looks.length, 2);
    assert.match(JSON.stringify(looks[0]), /overlap/);
    assert.match(JSON.stringify(looks[0]), /text2 .*hard to read/);
    assert.match(JSON.stringify(looks[1]), /found nothing to fix/);
    const items = (looks[0]!.result as { contentItems: Array<{ type: string; imageUrl?: string }> }).contentItems;
    assert.deepEqual(items.map(i => i.type), ['inputText', 'inputImage']);
    assert.match(items[1]!.imageUrl!, /^data:image\/png;base64,iVBORw0KGgo/);
    // The panel offers to show the plugin; it shows the new screen.
    await page.click('[data-testid=ai-show-plugin]');
    await page.waitForSelector('[data-testid=plugin-view] [data-element=text1]');
    assert.equal(await page.locator('[data-element=text1]').innerText(), 'NIGHT BASS');
    await page.waitForSelector('[data-widget=knob3] dk-knob');
    // One ⌘Z: the whole request goes.
    await page.locator('[data-testid=ai-input]').blur();
    await page.keyboard.press('Control+z');
    assert.equal(await kit(page, k => JSON.stringify({ ui: k.doc.value.ui, nodes: Object.keys(k.doc.value.nodes).sort(), panel: k.doc.value.panel })), before);
    assert.deepEqual(errors, []);
    assert.deepEqual(h.codex!.violations(), []);
    await page.close();
  });

  it('screen edit requests use the LLM; one ⌘Z undoes each edit and the sound stays unchanged', { timeout: 120000 }, async () => {
    const { page, errors } = await openKit(h);
    await waitCompiled(page);
    const ask = async (text: string) => {
      await page.keyboard.press('Control+k');
      await page.keyboard.type(text);
      await page.keyboard.press('Enter');
      await page.waitForFunction(t => { const o = (window as any).__kit.requests.history.value.at(-1); return o && o.text === t && !o.live && o.status !== 'working' && o.status !== 'thinking'; }, text);
      return kit(page, k => { const o = k.requests.history.value.at(-1); return { status: o.status, route: o.route, label: o.label, screen: o.screen }; });
    };
    const red = await ask('アクセントを赤にして');
    assert.deepEqual(red, { status: 'applied', route: 'llm', label: 'accent colour → red', screen: true });
    assert.equal(await kit(page, k => k.doc.value.ui.look.tokens.accent), '#ff4d4d');
    await page.click('[data-testid=ai-show-plugin]');
    await page.waitForSelector('[data-testid=plugin-view]');
    // Editing the plugin: "darker" darkens the screen, the sound stays.
    await page.keyboard.press('Control+KeyE');
    await page.waitForSelector('[data-testid=plugin-edit].active');
    const cutoff = await kit(page, k => k.doc.value.nodes.cut1.values.hz);
    const bg = await kit(page, k => k.doc.value.ui.look.tokens.bg);
    const dark = await ask('もう少し暗く');
    assert.equal(dark.label, 'darker screen');
    assert.notEqual(await kit(page, k => k.doc.value.ui.look.tokens.bg), bg);
    assert.equal(await kit(page, k => k.doc.value.nodes.cut1.values.hz), cutoff);
    await page.locator('[data-testid=ai-input]').blur();
    await page.keyboard.press('Control+z');
    assert.equal(await kit(page, k => k.doc.value.ui.look.tokens.bg), bg);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

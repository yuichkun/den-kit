// U6: the AI's free environment. The (fake) model works in the pod like in any
// web project — reads the guide, writes a code part with bash, runs TypeScript
// and ESLint on it — and the part shows on the plugin from the pod's dev server,
// reads and moves a knob, and undoes with the request. The pod here is the test
// stand-in (this machine's bash, git, Node and npm behind BrowserPod's interface);
// the code parts' frames, the page's cross-origin isolation and the message
// protocol are the real ones.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Frame, Page } from 'playwright';
import { openKit, startHarness, waitCompiled, type Harness } from './harness.ts';

const kit = (page: Page, fn: (k: any) => unknown): Promise<any> => page.evaluate(`(${fn.toString()})(window.__kit)`);
const snapshot = (page: Page) => kit(page, k => JSON.stringify({ ui: k.doc.value.ui, nodes: Object.keys(k.doc.value.nodes).sort(), edges: Object.keys(k.doc.value.edges).sort(), project: k.doc.value.project ?? null }));

async function ask(page: Page, text: string, timeout = 300000) {
  await page.keyboard.press('Control+k');
  await page.keyboard.type(text);
  await page.keyboard.press('Shift+Enter');
  await page.waitForFunction(t => { const o = (window as any).__kit.fast.history.value.at(-1); return o && o.text === t && !o.live && o.status !== 'thinking'; }, text, { timeout });
  return kit(page, k => { const o = k.fast.history.value.at(-1); return { status: o.status, label: o.label, steps: o.steps, message: o.message }; });
}
async function partFrame(page: Page, part: string, timeout = 60000): Promise<Frame> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const f = page.frames().find(fr => fr.url().includes(`part=${part}`));
    if (f) return f;
    await page.waitForTimeout(200);
  }
  throw new Error(`No frame for part ${part}`);
}

let h: Harness;
before(async () => { h = await startHarness({ codex: true, pod: true }); });
after(async () => { await h?.close(); });

describe('the pod: a free environment for the AI', () => {
  it('the AI writes a code part with bash, checks it with tsc and ESLint, puts it on the plugin; it reads and moves the knob; one ⌘Z takes it all back', { timeout: 420000 }, async () => {
    const { page, errors } = await openKit(h);
    await waitCompiled(page);
    await page.waitForFunction(() => (window as any).__kit.bridge.codexReady, null, { timeout: 30000 });
    const before = await snapshot(page);
    const line = await ask(page, 'コード部品を作って');
    assert.equal(line.status, 'applied', JSON.stringify(line));
    assert.equal(line.label, 'コード部品「meter」を作ってプラグインに置きました', JSON.stringify(line));
    assert.ok(line.steps.some((s: string) => /^ran `npm run check && npm run lint`$/.test(s)), line.steps.join(' | '));
    // The work keeps the project (the template, the part); node_modules and dist stay in the pod.
    const doc = await kit(page, k => k.doc.value);
    assert.match(doc.project.files['src/parts/meter.ts'], /kit\.norm\('knob1'\)/);
    assert.ok(doc.project.files['package.json'] && doc.project.files['AGENTS.md'] && doc.project.files['src/kit/index.ts']);
    assert.ok(!Object.keys(doc.project.files).some((p: string) => /^(node_modules|dist|\.git)\//.test(p) || p === 'src/kit/controls.ts'));
    assert.deepEqual({ kind: doc.ui.elements.meter1.kind, part: doc.ui.elements.meter1.part }, { kind: 'code', part: 'meter' });
    // What the model got back: the guide, real tool output with exit statuses, the look with the part drawn.
    const replies = JSON.stringify(h.codex!.replies());
    assert.match(replies, /## Code parts/);
    assert.match(replies, /\[exit 0/);
    assert.doesNotMatch(replies, /code part meter1[^"]*fails/);
    // The pod's git has the request as a commit.
    await page.waitForFunction(() => (window as any).__kit.pod.log.value.length > 0);
    const gitLog = await kit(page, async k => (await k.pod.bash('git log --oneline', { who: 'den-kit' })).output);
    assert.match(gitLog, /den-kit AI: コード部品「meter」を作ってプラグインに置きました/);

    // On the plugin: the part's page from the pod's dev server, drawing the knob.
    await page.click('[data-testid=ai-show-plugin]');
    await page.waitForSelector('[data-element=meter1] [data-code-state=ready]', { timeout: 60000 });
    const frame = await partFrame(page, 'meter');
    const height = () => frame.evaluate(() => document.getElementById('meter-bar')!.style.height);
    const norm = () => kit(page, k => { const n = k.doc.value.nodes.knob1; const v = n.values.value, min = n.config.min, max = n.config.max; return Math.log(v / min) / Math.log(max / min); });
    assert.equal(await height(), `${Math.round((await norm()) * 100)}%`);
    // The knob moves (the person turns it): the part follows.
    await kit(page, k => k.commit([{ op: 'setValue', node: 'knob1', port: 'value', value: 200 }], { label: 'turn' }));
    await frame.waitForFunction(h => document.getElementById('meter-bar')!.style.height === h, `${Math.round((await norm()) * 100)}%`);
    // A click on the part sets the knob (near the top: near the top of its range), as one undo step.
    const valueBefore = await kit(page, k => k.doc.value.nodes.knob1.values.value);
    await frame.click('#root', { position: { x: 30, y: 8 } });
    await page.waitForFunction(v => (window as any).__kit.doc.value.nodes.knob1.values.value !== v, valueBefore, { timeout: 10000 });
    assert.ok(await norm() > 0.9, `norm ${await norm()}`);
    // ⌘Z pressed while the part has the focus reaches den-kit: the click is undone.
    await page.keyboard.press('Control+z');
    await page.waitForFunction(v => (window as any).__kit.doc.value.nodes.knob1.values.value === v, valueBefore, { timeout: 10000 });
    // Undo the turn, then the whole AI request: the project, the part and the knob go.
    await kit(page, k => { k.undo(); k.undo(); });
    assert.equal(await snapshot(page), before);
    // The pod follows the work: the part's file is gone from it too.
    await page.waitForFunction(async () => (await (window as any).__kit.pod.readFile('src/parts/meter.ts')) === null, null, { timeout: 20000, polling: 500 });
    assert.deepEqual(errors, []);
    assert.deepEqual(h.codex!.violations(), []);
    await page.close();
  });

  it('a broken part: the plugin shows its error, the AI sees it in kit_look, fixes the file, and the part runs', { timeout: 300000 }, async () => {
    const { page, errors } = await openKit(h);
    await waitCompiled(page);
    await page.waitForFunction(() => (window as any).__kit.bridge.codexReady, null, { timeout: 30000 });
    const line = await ask(page, '壊れた部品を直して');
    assert.equal(line.status, 'applied', JSON.stringify(line));
    assert.equal(line.label, '壊れた部品を直しました', JSON.stringify(line));
    const looks = h.codex!.replies().filter(r => /Looked at the plugin/.test(JSON.stringify(r))).map(r => JSON.stringify(r));
    assert.match(looks.at(-2)!, /The code part oops1 fails: mount: Error: oops: the canvas is missing/);
    assert.doesNotMatch(looks.at(-1)!, /oops1 fails/);
    await page.click('[data-testid=ai-show-plugin]');
    await page.waitForSelector('[data-element=oops1] [data-code-state=ready]', { timeout: 60000 });
    const frame = await partFrame(page, 'oops');
    assert.equal(await frame.evaluate(() => document.getElementById('root')!.textContent), 'fixed');
    assert.deepEqual(errors, []);
    await page.close();
  });

  it('by hand: Insert ▸ Code part shows the starter from the pod; its settings come from the part; the terminal runs commands into the work', { timeout: 300000 }, async () => {
    const { page, errors } = await openKit(h);
    await waitCompiled(page);
    await page.click('[data-testid=view-plugin]');
    await page.waitForSelector('[data-testid=plugin-view]');
    await page.keyboard.press('Control+KeyE');
    await page.waitForSelector('[data-testid=plugin-edit].active');
    await page.keyboard.press('Shift+Space');
    await page.waitForSelector('[data-testid=insert-menu]');
    await page.keyboard.type('code part');
    await page.keyboard.press('Enter');
    const id = await kit(page, k => Object.values<any>(k.doc.value.ui.elements).find(e => e.kind === 'code')?.id);
    assert.ok(id);
    assert.equal(await kit(page, k => typeof k.doc.value.project.files['src/parts/wave.ts']), 'string');
    await page.waitForSelector(`[data-element=${id}] [data-code-state=ready]`, { timeout: 120000 });
    // The inspector shows the setting the part declares (its colour).
    await page.waitForSelector('[data-testid=code-part-state]');
    await page.waitForSelector('[data-prop=color]', { timeout: 20000 });
    // The person's own command: what it changes lands as their undo step.
    const r = await kit(page, async k => { const out = await k.pod.runForYou("sed -i 's/Colour/Color/' src/parts/wave.ts && grep -c Color src/parts/wave.ts"); return { exit: out.result.exitCode, output: out.result.output, changed: out.changed }; });
    assert.deepEqual(r, { exit: 0, output: '1', changed: ['src/parts/wave.ts'] });
    assert.match(await kit(page, k => k.doc.value.project.files['src/parts/wave.ts']), /label: 'Color'/);
    assert.equal(await kit(page, k => k.history.peek()?.label), 'Terminal: sed -i \'s/Colour/Color/\' src/parts/wave.ts && grep -c Color src/parts/wave.ts'.slice(0, 70));
    // ⌘Z: the edit goes, then the part and its project.
    await kit(page, k => { k.undo(); k.undo(); });
    assert.equal(await kit(page, k => k.doc.value.project ?? null), null);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

describe('without a pod (no BrowserPod key)', () => {
  let bare: Harness;
  before(async () => { bare = await startHarness({ bridge: false }); });
  after(async () => { await bare?.close(); });
  it('a code part says the pod is off and how to turn it on; nothing else breaks', { timeout: 120000 }, async () => {
    const { page, errors } = await openKit(bare);
    await waitCompiled(page);
    assert.equal(await kit(page, k => k.pod.state.value), 'unavailable');
    assert.match(await kit(page, k => k.pod.fix.value), /BROWSERPOD_API_KEY/);
    await kit(page, k => k.commit([{ op: 'setProjectFiles', files: { 'src/parts/x.ts': 'export default 1;' } }, { op: 'addElement', element: { id: 'code1', kind: 'code', part: 'x', rect: { x: 10, y: 10, w: 200, h: 100 }, props: {} } }], { label: 'add' }));
    await page.click('[data-testid=view-plugin]');
    await page.waitForSelector('[data-element=code1] [data-code-state=off]');
    assert.match(await page.locator('[data-element=code1] [data-testid=code-status]').innerText(), /no pod .*no API key/);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

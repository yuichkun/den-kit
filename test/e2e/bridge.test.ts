// A1 in a real browser: the page connects to the bridge through the Vite proxy,
// shows the AI status, survives the bridge going away and coming back, and the
// editor keeps working (CP1) when there is no bridge at all.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { openKit, startHarness, waitCompiled, type Harness } from './harness.ts';
import { createBridge } from '../../bridge/server.ts';

type K = { __kit: any };
const kit = (page: Page, fn: (k: any) => unknown): Promise<any> =>
  page.evaluate(`(${fn.toString()})(window.__kit)`);
const bridgeState = (page: Page) => kit(page, k => k.bridge.state.value);
const waitBridge = (page: Page, state: string, timeout = 15000) =>
  page.waitForFunction(s => (window as unknown as K).__kit.bridge.state.value === s, state, {
    timeout,
  });

describe('AI bridge in the browser', () => {
  let h: Harness;
  before(async () => {
    h = await startHarness({ codex: true });
  });
  after(async () => {
    await h?.close();
  });

  it('connects through the dev server, shows AI ready, and sends even a short edit to Codex', async () => {
    const { page, errors } = await openKit(h);
    await waitBridge(page, 'online');
    await page.waitForFunction(() => (window as unknown as K).__kit.bridge.codexReady);
    assert.match((await page.textContent('[data-testid=ai-status-codex]')) ?? '', /● AI$/);
    assert.equal(await page.locator('[data-testid=ai-status-jev]').count(), 0);
    const sent = h.codex!.sent('turn/start').length;
    await page.fill('[data-testid=ai-input]', 'brighter');
    await page.press('[data-testid=ai-input]', 'Enter');
    await page.waitForFunction(
      () => (window as unknown as K).__kit.requests.history.value.at(-1)?.status === 'applied',
    );
    assert.equal(h.codex!.sent('turn/start').length, sent + 1);
    assert.equal(await kit(page, k => k.requests.history.value.at(-1).route), 'llm');
    assert.equal(await kit(page, k => k.doc.value.nodes.cut1.values.hz), 2400);
    assert.deepEqual(errors, []);
    await page.close();
  });

  it('a bridge restart (new token, same port) reconnects without a reload; editing never stops', async () => {
    const { page, errors } = await openKit(h);
    await waitBridge(page, 'online');
    await waitCompiled(page);
    const port = h.bridge!.port;
    await h.bridge!.close();
    await waitBridge(page, 'offline');
    await page.waitForFunction(() =>
      /AI offline/.test(document.querySelector('[data-testid=ai-status]')?.textContent ?? ''),
    );
    // Editing and compiling are unaffected while the bridge is gone.
    const edit = await kit(page, k =>
      k.commit([{ op: 'setConfig', node: 'osc1', key: 'waveform', value: 'sine' }]),
    );
    assert.equal(edit.ok, true, JSON.stringify(edit));
    assert.equal((await waitCompiled(page)).status, 'ok');
    const before = await kit(page, k => JSON.stringify(k.doc.value));
    const offline = await kit(page, k => k.requests.run('brighter'));
    assert.equal(offline.status, 'failed');
    assert.equal(offline.route, 'llm');
    assert.equal(await kit(page, k => JSON.stringify(k.doc.value)), before);
    h.bridge = await createBridge({ port, origins: [new URL(h.url).origin] });
    await waitBridge(page, 'online', 30000);
    assert.notEqual(await kit(page, k => (k.bridge as any).token), process.env.KIT_BRIDGE_TOKEN);
    assert.deepEqual(
      errors.filter(e => !/WebSocket|ERR_CONNECTION_REFUSED|502|Failed to load resource/.test(e)),
      [],
    );
    await page.close();
  });
});

describe('without a bridge', () => {
  let h: Harness;
  before(async () => {
    h = await startHarness({ bridge: false });
  });
  after(async () => {
    await h?.close();
  });

  it('the editor works as in CP1 and says AI offline', async () => {
    const { page, errors } = await openKit(h);
    assert.equal((await waitCompiled(page)).status, 'ok');
    assert.equal(await bridgeState(page), 'disabled');
    assert.match((await page.textContent('[data-testid=ai-status]')) ?? '', /AI offline/);
    assert.match(await kit(page, k => k.bridge.detail.value), /dev/);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

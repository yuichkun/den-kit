// The Shared prototype in the browser: what the author could learn after sharing, on made-up
// data. The levels and views change what shows and which decisions they answer; the receiver's
// side plays the work without changing it, and its visit and what it sends join the story; a
// sent-back setting is heard in the work and ⌘Z takes it back.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { openKit, startHarness, waitCompiled, type Harness } from './harness.ts';

const kit = (page: Page, fn: (k: any) => unknown): Promise<any> =>
  page.evaluate(`(${fn.toString()})(window.__kit)`);
const knob = (page: Page): Promise<number> =>
  kit(page, k => k.doc.value.nodes.cutknob.values.value);
const opened = (page: Page) =>
  page.locator('[data-testid=shared-funnel] [data-stage=opened] .count').innerText();

let h: Harness;
before(async () => {
  h = await startHarness({ bridge: false });
});
after(async () => {
  await h?.close();
});

describe('the Shared prototype', () => {
  it('compares levels and views, plays the receiver’s side, and hears a sent-back setting in the work', async () => {
    const { page, errors } = await openKit(h);
    // A knob on the plugin that sets the filter's cutoff.
    const placed = await kit(page, k => {
      const r = k.commit([
        {
          op: 'addNode',
          node: {
            id: 'cutknob',
            type: 'ui.knob',
            label: 'Cutoff',
            pos: { x: 400, y: 480 },
            panel: { x: 40, y: 40, w: 160, h: 180 },
            config: { min: 100, max: 2000, scale: 'linear', unit: 'Hz' },
            values: { value: 300 },
          },
        },
        { op: 'connect', from: { node: 'cutknob', port: 'out' }, to: { node: 'cut1', port: 'hz' } },
      ]);
      return r.ok;
    });
    assert.equal(placed, true);
    await waitCompiled(page);
    await page.click('[data-testid=view-shared]');
    assert.match(await page.locator('[data-testid=shared-prototype]').innerText(), /made up/);

    // Counting per link: the stages, and the decisions it answers in this view.
    await page.waitForSelector('[data-testid=shared-funnel]');
    assert.ok(Number(await opened(page)) > 0);
    assert.equal(await page.getAttribute('[data-decision=first-sound]', 'data-answer'), 'here');
    // Only what people send: nothing is counted, and the decisions say what is missing.
    await page.click('[data-testid=shared-view] .bar [data-level=returns]');
    await page.waitForSelector('[data-testid=shared-numbers-none]');
    assert.equal(await page.locator('[data-testid=shared-funnel]').count(), 0);
    assert.equal(await page.getAttribute('[data-decision=first-sound]', 'data-answer'), 'partly');
    assert.equal(await page.getAttribute('[data-decision=page]', 'data-answer'), 'no');
    // On the plugin, counting per link: people left the knob at the top of its range.
    await page.click('[data-testid=shared-view] .bar [data-level=links]');
    await page.click('[data-lens=plugin]');
    await page.waitForSelector('[data-mark=cutknob].end');
    // Given to specific people, telling browsers apart: the drummer's link reached three browsers.
    await page.click('[data-scene=people]');
    await page.click('[data-testid=shared-view] .bar [data-level=browsers]');
    await page.click('[data-lens=numbers]');
    assert.match(
      await page.locator('[data-testid=shared-people] tr[data-link=drummer] td.warn').innerText(),
      /^3/,
    );

    // The receiver's side: a preview, an open, a press of play, a moved control, a setting sent.
    await page.click('[data-scene=public]');
    await page.click('[data-testid=shared-view] .bar [data-level=links]');
    const opens = Number(await opened(page));
    await page.click('[data-testid=shared-receiver-open]');
    await page.click('[data-testid=receiver-open-link]');
    await page.click('[data-testid=receiver-play]');
    const dial = page.locator('[data-testid=shared-receiver] [data-widget=cutknob] dk-knob .dial');
    await dial.waitFor({ state: 'visible' });
    await dial.hover();
    const box = (await dial.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++)
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - i * 8);
    await page.mouse.up();
    await page.waitForSelector(
      '[data-testid=receiver-lines] li[data-state=done]:has-text("Cutoff")',
    );
    assert.equal(await knob(page), 300, 'the receiver’s moves leave the work as it was');
    await page.fill('[data-testid=receiver-setting-name]', 'Brighter');
    await page.click('[data-testid=receiver-send]');
    await page.waitForSelector('[data-testid=receiver-sent]');
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-testid=shared-receiver]', { state: 'detached' });
    assert.equal(Number(await opened(page)), opens + 1);

    // The setting comes back under Sent back; hearing it is one edit, and ⌘Z takes it back.
    await page.click('[data-lens=returns]');
    await page.waitForSelector('[data-returned=you1][data-kind=setting]');
    await page.click('[data-listen=you1]');
    const heard = await knob(page);
    assert.ok(heard > 300, `the work plays the sent-back setting (${heard})`);
    await page.locator('[data-testid=shared-view] .bar').click({ position: { x: 4, y: 4 } });
    await page.keyboard.press('ControlOrMeta+KeyZ');
    await page.waitForFunction(
      () => (window as any).__kit.doc.value.nodes.cutknob.values.value === 300,
    );
    assert.deepEqual(await kit(page, k => k.seeing.value.view), 'shared');
    assert.deepEqual(errors, []);
    await page.close();
  });
});

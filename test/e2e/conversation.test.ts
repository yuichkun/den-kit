// U5a in the browser: the patch canvas behaves like a drawing app (drag on
// empty space selects, scrolling pans, a pinch or ⌘/Ctrl + wheel zooms); what
// is selected rides along with an AI request as chips (× leaves one out); the
// conversation about the patch survives a reload and folds away when another
// patch is opened.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { openKit, reloadKit, startHarness, waitCompiled, type Harness } from './harness.ts';

const kit = (page: Page, fn: (k: any) => unknown): Promise<any> =>
  page.evaluate(`(${fn.toString()})(window.__kit)`);
const transform = (page: Page) =>
  page.evaluate(() => {
    const t = (document.querySelector('.vue-flow__transformationpane') as HTMLElement).style
      .transform;
    const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([\d.]+)\)/.exec(t);
    return m ? { x: Number(m[1]), y: Number(m[2]), k: Number(m[3]) } : { x: 0, y: 0, k: 1 };
  });
/** A point on empty canvas near a node (nothing but the pane under it). */
async function emptyPointNear(
  page: Page,
  id: string,
): Promise<{ x: number; y: number; box: { x: number; y: number; width: number; height: number } }> {
  const box = (await page.locator(`.vue-flow__node[data-id="${id}"]`).boundingBox())!;
  for (const [dx, dy] of [
    [-40, -40],
    [-60, -20],
    [-20, -60],
    [-80, -80],
    [-40, 40],
  ]) {
    const p = { x: box.x + dx, y: box.y + dy };
    const empty = await page.evaluate(
      ({ x, y }) =>
        !!document.elementFromPoint(x, y)?.closest('.vue-flow__pane') &&
        !document.elementFromPoint(x, y)?.closest('.vue-flow__node, .vue-flow__edge'),
      p,
    );
    if (empty) return { ...p, box };
  }
  throw new Error(`no empty canvas near ${id}`);
}

let h: Harness;
before(async () => {
  h = await startHarness({ codex: true });
});
after(async () => {
  await h?.close();
});

describe('the patch canvas', () => {
  it('dragging on empty canvas selects what the box touches; the wheel pans; Ctrl + wheel zooms; double click still adds', async () => {
    const { page, errors } = await openKit(h);
    await waitCompiled(page);
    const start = await emptyPointNear(page, 'osc1');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.box.x + start.box.width / 2, start.box.y + start.box.height / 2, {
      steps: 6,
    });
    await page.mouse.up();
    assert.ok(
      (await kit(page, k => k.selection.value)).includes('osc1'),
      'the box selected osc1 without any key held',
    );
    // Scrolling pans (it does not zoom).
    const t0 = await transform(page);
    await page.mouse.move(start.x, start.y);
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(250);
    const t1 = await transform(page);
    assert.ok(Math.abs(t1.y - t0.y) > 50, `the view moved up (${t0.y} → ${t1.y})`);
    assert.equal(t1.k, t0.k);
    // Ctrl (⌘ on a Mac) + wheel zooms, the way a pinch does.
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -300);
    await page.keyboard.up('Control');
    await page.waitForTimeout(250);
    assert.ok((await transform(page)).k > t1.k, 'zoomed in');
    // Double click on empty canvas still opens the module search there.
    const empty = await emptyPointNear(page, 'osc1');
    await page.mouse.dblclick(empty.x, empty.y);
    await page.waitForSelector('[data-testid=palette-search]');
    assert.deepEqual(errors, []);
    await page.close();
  });
});

describe('attachments and the conversation', () => {
  it('the selection rides along as chips; × leaves one out; the request aims at what is attached', async () => {
    const { page, errors } = await openKit(h);
    await waitCompiled(page);
    await page.locator('.vue-flow__node[data-id="osc1"] header').click();
    await page.keyboard.down('Shift');
    await page.locator('.vue-flow__node[data-id="filter1"] header').click();
    await page.keyboard.up('Shift');
    await page.waitForSelector('[data-testid=ai-attachments] [data-attachment=osc1]');
    await page.waitForSelector('[data-testid=ai-attachments] [data-attachment=filter1]');
    // Leave the oscillator out of this request (it stays selected).
    await page.click('[data-testid=ai-attachments] [data-attachment=osc1] .x');
    await page.waitForSelector('[data-testid=ai-attachments] [data-attachment=osc1]', {
      state: 'detached',
    });
    assert.ok((await kit(page, k => k.selection.value)).includes('osc1'));
    // Backspace in the empty prompt leaves the last one out too; a new selection brings them back.
    await page.keyboard.press('Control+k');
    await page.keyboard.press('Backspace');
    await page.waitForSelector('[data-testid=ai-attachments]', { state: 'detached' });
    await page.keyboard.press('Escape'); // out of the prompt
    await page.keyboard.press('Escape'); // nothing selected
    assert.deepEqual(await kit(page, k => k.selection.value), []);
    await page.locator('.vue-flow__node[data-id="filter1"] header').click();
    await page.waitForSelector('[data-testid=ai-attachments] [data-attachment=filter1]');
    await page.keyboard.press('Control+k');
    await page.keyboard.type('more resonance');
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      () => (window as any).__kit.requests.history.value.at(-1)?.status === 'applied',
    );
    const line = await kit(page, k => k.requests.history.value.at(-1));
    assert.deepEqual(
      line.attached.map((a: { id: string }) => a.id),
      ['filter1'],
    );
    await page.waitForSelector('[data-testid=ai-result] [data-testid=ai-attached]');
    assert.deepEqual(errors, []);
    await page.close();
  });

  it('the conversation survives a reload; opening another patch folds it away as earlier', async () => {
    const { page, errors } = await openKit(h);
    await waitCompiled(page);
    await page.keyboard.press('Control+k');
    await page.keyboard.type('longer release');
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      () => (window as any).__kit.requests.history.value.at(-1)?.status === 'applied',
    );
    await page.keyboard.press('Control+k');
    await page.keyboard.type('more');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => {
      const o = (window as any).__kit.requests.history.value.at(-1);
      return o?.text === 'more' && o.status === 'applied';
    });
    assert.deepEqual(
      await kit(page, k => k.requests.history.value.map((o: { route: string }) => o.route)),
      ['llm', 'llm'],
    );
    const followUp = String(
      h
        .codex!.records()
        .filter(r => r.scenario === 'parameter-edit')
        .at(-1)!.text,
    );
    assert.match(followUp, /more$/);
    const starts = h.codex!.sent('turn/start').slice(-2) as Array<{ params: { threadId: string } }>;
    assert.equal(
      starts[1]!.params.threadId,
      starts[0]!.params.threadId,
      'a follow-up continues the same LLM conversation',
    );
    assert.equal(await kit(page, k => k.doc.value.nodes.aenv1.values.release), 1.2);
    // Reload (keep the storage this time): the patch and its conversation come back.
    await page.evaluate(() => {
      (window as any).__kit.requests.persist();
      (window as any).__kit.saveNow();
      sessionStorage.setItem('kit-e2e-keep', '1');
    });
    await reloadKit(page);
    await page.waitForFunction(
      () => (window as any).__kit?.requests?.history.value.length === 2,
      null,
      { timeout: 60000 },
    );
    assert.deepEqual(
      await kit(page, k => k.requests.history.value.map((o: { text: string }) => o.text)),
      ['longer release', 'more'],
    );
    await page.waitForSelector('[data-testid=ai-history] >> text=longer release');
    // Another patch: a new conversation; the old lines fold away, marked as unseen by the AI.
    await page.click('[data-testid=start-overlay]').catch(() => undefined);
    await page.keyboard.press('Control+Alt+KeyN');
    await page.waitForSelector('[data-testid=start-screen]');
    await page.click('[data-work=acid]');
    await page.waitForSelector('[data-testid=start-screen]', { state: 'detached' });
    await page.waitForSelector('[data-testid=ai-earlier]');
    assert.equal(await kit(page, k => k.requests.history.value.length), 0);
    assert.match(
      await page.locator('[data-testid=ai-earlier]').innerText(),
      /2 requests \(the AI does not see these\)/,
    );
    assert.deepEqual(errors, []);
    await page.close();
  });
});

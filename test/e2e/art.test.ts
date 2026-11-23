// The Art view in the page. The person starts the icon from the work, pans its window and
// undoes it, and the shelf lines the work up with the example works. While the AI (the
// scripted fake Codex) makes the cover match the icon, the person keeps working: panning
// the icon, both land and one undo takes back only the AI's request; changing the cover's
// letters, the AI's first edit is refused, and it reads again and leaves them as they are.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { openKit, startHarness, waitCompiled, type Harness } from './harness.ts';

type Layer = Record<string, any>;
const layers = (page: Page, board: 'icon' | 'cover'): Promise<Layer[]> =>
  page.evaluate(b => (window as any).__kit.doc.value.art?.[b]?.layers ?? [], board);
const find = async (page: Page, board: 'icon' | 'cover', kind: string) =>
  (await layers(page, board)).find(l => l.kind === kind)!;

/** Drag across the middle of the board: pans the window there. */
async function pan(page: Page, dx: number, dy: number) {
  const box = (await page.locator('[data-testid=art-overlay]').boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await page.mouse.up();
}

async function until(test: () => boolean, ms = 30000) {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

/** The bass with an icon and a cover started from it, in the Art view. */
async function withArt(page: Page) {
  await waitCompiled(page);
  await page.click('[data-testid=view-art]');
  await page.click('[data-testid=art-start-specimen]');
  await page.click('[data-testid=art-board-cover]');
  await page.click('[data-testid=art-start-pattern]');
  await page.waitForFunction(() => (window as any).__kit.doc.value.art?.cover);
}

/** Send a request to the AI and wait until it is done. */
async function ask(page: Page, text: string, meanwhile: () => Promise<void>) {
  await page.waitForFunction(() => (window as any).__kit.bridge.codexReady, null, {
    timeout: 30000,
  });
  const reads = h.codex!.mcpCalls().filter(c => c.tool === 'kit_get_art').length;
  const input = page.locator('[data-testid=ai-input]');
  await input.fill(text);
  await input.press('Enter');
  // The AI has read the art; it thinks for a few seconds before it edits.
  await until(() => h.codex!.mcpCalls().filter(c => c.tool === 'kit_get_art').length > reads);
  await meanwhile();
  await page.waitForFunction(
    t => {
      const o = (window as any).__kit.requests.history.value.at(-1);
      return o && o.text === t && !o.live && o.status !== 'thinking';
    },
    text,
    { timeout: 60000 },
  );
  return page.evaluate(() => (window as any).__kit.requests.history.value.at(-1));
}

let h: Harness;
before(async () => {
  h = await startHarness({ codex: true });
});
after(async () => {
  await h?.close();
});

describe('the art in the page', () => {
  it('the person starts the icon from the work, pans its window and undoes; the shelf lines it up', async () => {
    const { page, errors } = await openKit(h);
    await waitCompiled(page);
    await page.click('[data-testid=view-art]');
    await page.waitForSelector('[data-testid=art-empty]');
    await page.click('[data-testid=art-start-specimen]');
    assert.deepEqual(
      (await layers(page, 'icon')).map(l => l.kind),
      ['ground', 'window'],
    );
    const start = await find(page, 'icon', 'window');
    await pan(page, 60, 40);
    const panned = await find(page, 'icon', 'window');
    assert.notDeepEqual(panned.focus, start.focus);
    // One drag is one step.
    await page.locator('[data-testid=art-stage]').focus();
    await page.keyboard.press('Control+z');
    assert.deepEqual((await find(page, 'icon', 'window')).focus, start.focus);
    // The shelf: the work first, then the example works.
    const shelf = page.locator('[data-testid=shelf-icon]');
    assert.equal(await shelf.first().getAttribute('data-work'), 'own');
    assert.ok((await shelf.count()) > 1);
    assert.deepEqual(errors, []);
  });

  it('the AI makes the cover match the icon while the person pans the icon; one undo takes back only the AI', async () => {
    const { page, errors } = await openKit(h);
    await withArt(page);
    const cover = await layers(page, 'cover');
    const read = await find(page, 'icon', 'window');
    let panned: Layer | undefined;
    const done = await ask(page, 'Make the cover match the icon', async () => {
      await page.click('[data-testid=art-board-icon]');
      await pan(page, 60, 40);
      panned = await find(page, 'icon', 'window');
    });
    assert.match(done.reply, /The cover now wears the icon's ground and its window/);
    // The AI's window on the cover looks where the icon's did when it read it; the person's pan stays.
    const window = await find(page, 'cover', 'window');
    assert.deepEqual(window.rect, { x: 900, y: 150, w: 600, h: 600 });
    assert.deepEqual(window.focus, read.focus);
    assert.notDeepEqual(panned!.focus, read.focus);
    assert.deepEqual((await find(page, 'icon', 'window')).focus, panned!.focus);
    // The AI's request is one step.
    await page.locator('[data-testid=art-stage]').focus();
    await page.keyboard.press('Control+z');
    assert.deepEqual(await layers(page, 'cover'), cover);
    assert.deepEqual((await find(page, 'icon', 'window')).focus, panned!.focus);
    assert.deepEqual(errors, []);
  });

  it('when the person changes the letters meanwhile, the AI reads again and leaves them as they are', async () => {
    const { page, errors } = await openKit(h);
    await withArt(page);
    const done = await ask(page, 'Make the cover match the icon', async () => {
      await page.click('[data-testid=art-layer-mark1] button.name');
      const text = page.locator('[data-testid=art-text]');
      await text.fill('MINE');
      await text.press('Enter');
    });
    const calls = h.codex!.mcpCalls();
    const refused = calls.filter(c => c.tool === 'kit_apply_ops').at(-2)!;
    assert.match(refused.text, /the work's cover \(mark1\) was changed by the person/);
    assert.match(done.reply, /I left mark1 as you made it/);
    const mark = (await layers(page, 'cover')).find(l => l.id === 'mark1')!;
    assert.equal(mark.text, 'MINE');
    assert.deepEqual((await find(page, 'cover', 'window')).rect, {
      x: 900,
      y: 150,
      w: 600,
      h: 600,
    });
    assert.deepEqual(errors, []);
  });
});

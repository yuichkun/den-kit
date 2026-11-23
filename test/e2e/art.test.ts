// The work's icon and cover in the editor. By hand in the Art view: start a surface from the
// look, drag and size what is on it, change words, place a symbol; each gesture is one undo
// step and the art is saved with the work. With the (fake) model on the real tool path: it reads
// what the person made with kit_get_art, changes only the surface asked about with the same
// operations, the person edits its result by hand, one ⌘Z takes a request back, and an edit it
// made from a read older than the person's change is refused until it reads again.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import {
  openKit,
  reloadKit,
  startAudio,
  startHarness,
  waitCompiled,
  type Harness,
} from './harness.ts';

const kit = (page: Page, fn: (k: any) => unknown): Promise<any> =>
  page.evaluate(`(${fn.toString()})(window.__kit)`);
const art = (page: Page) => kit(page, k => JSON.parse(JSON.stringify(k.doc.value.art ?? null)));
const labels = (page: Page, n: number) =>
  kit(page, k => k.history.entries().map((t: any) => `${t.author.kind}: ${t.label}`)).then(
    (all: string[]) => all.slice(-n),
  );

/** Drag on the open surface, in its own pixels (1280×720 for the cover). */
async function drag(page: Page, x: number, y: number, dx: number, dy: number) {
  const sheet = (await page.locator('[data-testid=art-sheet]').boundingBox())!;
  const k = sheet.width / (await kit(page, k => (k.seeing.value.art?.on === 'icon' ? 512 : 1280)));
  const px = sheet.x + x * k,
    py = sheet.y + y * k;
  await page.mouse.move(px, py);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(px + (dx * k * i) / 8, py + (dy * k * i) / 8);
  await page.mouse.up();
}

async function ask(page: Page, text: string) {
  await page.keyboard.press('Control+k');
  await page.fill('[data-testid=ai-input]', text);
  await page.press('[data-testid=ai-input]', 'Enter');
}
async function answered(page: Page, text: string) {
  await page.waitForFunction(
    t => {
      const o = (window as any).__kit.requests.history.value.at(-1);
      return o && o.text === t && !o.live && o.status !== 'working' && o.status !== 'thinking';
    },
    text,
    { timeout: 60000 },
  );
  return kit(page, k => {
    const o = k.requests.history.value.at(-1);
    return { status: o.status, label: o.label, steps: o.steps };
  });
}

let h: Harness;
before(async () => {
  h = await startHarness({ codex: true });
});
after(async () => {
  await h?.close();
});

describe("the work's art", () => {
  it(
    'is made by hand in the Art view, one undo step per gesture, and kept with the work',
    { timeout: 120000 },
    async () => {
      const { page, errors } = await openKit(h);
      await waitCompiled(page);
      await page.click('[data-testid=view-art]');
      await page.click('[data-testid=art-cover]');
      await page.click('[data-testid=art-from-look]');
      let a = await art(page);
      assert.deepEqual(a.cover.order, ['title', 'rule', 'symbol1']);
      assert.deepEqual(a.cover.elements.title.rect, { x: 96, y: 300, w: 720, h: 280 });
      assert.equal(a.icon, undefined, 'starting the cover leaves the icon alone');
      // Click the title and drag it: one step.
      await drag(page, 300, 500, 80, -120);
      a = await art(page);
      assert.deepEqual(a.cover.elements.title.rect, { x: 176, y: 180, w: 720, h: 280 });
      assert.deepEqual(await labels(page, 2), [
        'human: Start the cover from the look',
        'human: Move title on the cover',
      ]);
      await page.fill('[data-testid=art-text]', 'NIGHT BASS');
      assert.equal((await art(page)).cover.elements.title.text, 'NIGHT BASS');
      // A symbol of one of the work's modules on the icon, then a thicker line.
      await page.click('[data-testid=art-icon]');
      // Esc closes the symbol maker without placing anything.
      await page.click('[data-testid=art-add-symbol]');
      await page.keyboard.press('Escape');
      await page.waitForSelector('[data-testid=symbol-maker]', { state: 'detached' });
      assert.equal((await art(page)).icon, undefined);
      await page.click('[data-testid=art-add-symbol]');
      await page.click('[data-testid=symbol-place]');
      a = await art(page);
      const symbol = a.icon.elements.symbol1;
      assert.equal(symbol.kind, 'symbol');
      const types = await kit(page, k =>
        Object.fromEntries(Object.values<any>(k.doc.value.nodes).map(n => [n.id, n.type])),
      );
      assert.equal(symbol.module.type, types[symbol.node]);
      await page.fill('[data-testid=art-symbol-weight]', '9');
      assert.equal((await art(page)).icon.elements.symbol1.weight, 9);
      // ⌘Z takes back the line, then the symbol; the cover stays.
      await page.click('[data-testid=art-sheet]', { position: { x: 4, y: 4 } });
      await page.keyboard.press('Control+z');
      assert.notEqual((await art(page)).icon.elements.symbol1.weight, 9);
      await page.keyboard.press('Control+z');
      assert.equal((await art(page)).icon, undefined);
      assert.equal((await art(page)).cover.elements.title.text, 'NIGHT BASS');
      // Saved with the work.
      await page.evaluate(() => sessionStorage.setItem('kit-e2e-keep', '1'));
      await kit(page, k => k.saveNow());
      await reloadKit(page);
      await page.waitForFunction(() => (window as any).__kit !== undefined);
      await startAudio(page);
      a = await art(page);
      assert.equal(a.cover.elements.title.text, 'NIGHT BASS');
      assert.deepEqual(a.cover.elements.title.rect, { x: 176, y: 180, w: 720, h: 280 });
      assert.deepEqual(errors, []);
      await page.close();
    },
  );

  it(
    'is handed to the AI and back: it reads what the person made, changes only the surface asked about, in place',
    { timeout: 180000 },
    async () => {
      const { page, errors } = await openKit(h);
      await waitCompiled(page);
      await page.waitForFunction(() => (window as any).__kit.bridge.codexReady, null, {
        timeout: 30000,
      });
      await page.click('[data-testid=view-art]');
      await page.click('[data-testid=art-icon]');
      await page.click('[data-testid=art-from-look]');
      await page.click('[data-testid=art-cover]');
      await page.click('[data-testid=art-from-look]');
      await drag(page, 300, 500, 0, -60);
      const handMade = await art(page);
      assert.equal(handMade.cover.elements.title.rect.y, 240);

      // "More room on the left of the cover": the cover moves right, the icon is as it was.
      const room = 'カバーだけ左をもっと空けて';
      await ask(page, room);
      const r1 = await answered(page, room);
      assert.equal(r1.status, 'applied', JSON.stringify(r1));
      let a = await art(page);
      for (const id of handMade.cover.order)
        assert.equal(a.cover.elements[id].rect.x, handMade.cover.elements[id].rect.x + 120, id);
      assert.equal(a.cover.elements.title.rect.y, 240, "the person's move stays");
      assert.deepEqual(a.icon, handMade.icon);
      assert.match((await labels(page, 1))[0], /^ai-llm: /);
      // The model read the person's art and what they did by hand.
      const read = h
        .codex!.mcpCalls()
        .filter(c => c.tool === 'kit_get_art')
        .at(-1)!;
      assert.match(read.text, /The person has the cover open/);
      assert.match(read.text, / {2}- title: \{.*"y":240/);
      assert.match(read.text, /title on the cover \(added it, place\)/);
      // It looked at the cover it changed: a picture of the surface as drawn.
      assert.deepEqual(r1.steps, [
        'read the icon and cover',
        'cover: place title, place rule, place symbol1 ✓',
        'looked at the cover',
      ]);
      const look = h
        .codex!.mcpCalls()
        .filter(c => c.tool === 'kit_look')
        .at(-1)!;
      assert.match(look.text, /^Looked at the cover \(1280×720\), drawn as it is now\./);
      assert.deepEqual(look.types, ['text', 'image']);
      assert.equal(look.images[0]!.mimeType, 'image/png');
      assert.match(look.images[0]!.prefix, /^iVBORw0KGgo/);

      // The person goes on with what the AI changed: the same pieces, by hand.
      const moved = a.cover.elements.title.rect;
      await drag(page, moved.x + 200, moved.y + 150, 40, 0);
      a = await art(page);
      assert.equal(a.cover.elements.title.rect.x, moved.x + 40);
      assert.equal((await labels(page, 1))[0], 'human: Move title on the cover');

      // "Make the icon bolder": the icon only; one ⌘Z takes the request back.
      const cover = JSON.stringify(a.cover);
      const bolder = 'make the icon bolder';
      await ask(page, bolder);
      assert.equal((await answered(page, bolder)).status, 'applied');
      a = await art(page);
      assert.equal(a.icon.elements.symbol1.weight, 9.5);
      assert.equal(JSON.stringify(a.cover), cover);
      await page.click('[data-testid=art-sheet]', { position: { x: 4, y: 4 } });
      await page.keyboard.press('Control+z');
      assert.equal((await art(page)).icon.elements.symbol1.weight, 6);

      // The person drags the title after the AI read the art: its edit from the old read is
      // refused; it reads again and moves the title from where the person put it.
      const before = (await art(page)).cover.elements.title.rect;
      const pause = 'move the cover title up after a pause';
      await ask(page, pause);
      await page.waitForFunction(() =>
        ((window as any).__kit.requests.history.value.at(-1)?.steps ?? []).includes(
          'read the icon and cover',
        ),
      );
      await drag(page, before.x + 200, before.y + 150, 0, 100);
      const r3 = await answered(page, pause);
      assert.deepEqual(r3.steps, [
        'read the icon and cover',
        'cover: place title — not applied',
        'read the icon and cover',
        'cover: place title ✓',
      ]);
      const refused = h
        .codex!.mcpCalls()
        .filter(c => c.tool === 'kit_apply_ops' && !c.success)
        .at(-1)!;
      assert.match(refused.text, /title on the cover \(rect\) was changed by the person/);
      assert.match(refused.text, /Call kit_get_art to see the icon and cover as it is now/);
      assert.equal((await art(page)).cover.elements.title.rect.y, before.y + 100 - 80);
      assert.deepEqual(errors, []);
      assert.deepEqual(h.codex!.violations(), []);
      await page.close();
    },
  );
});

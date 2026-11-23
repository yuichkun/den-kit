// The passing-on prototype (prototype/remix) on the development server, as people
// use it in one browser: an author shares Acid Line; the first person moves a
// control with the mouse, shakes the settings, records a phrase with the computer
// keys and passes it on with their words; someone else only sends a word back;
// the next person hears every version, changes the inside in den-kit's editor and
// passes that on as operations that the third person's page compiles and plays;
// the author's inbox holds what came back, and the author's two choices apply.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { BrowserContext, Page } from 'playwright';
import { startHarness, type Harness } from './harness.ts';

type Remix = {
  kit: {
    compileStatus: { value: string };
    engine: { running: boolean; outAnalyser: AnalyserNode | null };
    doc: { value: { nodes: Record<string, { type: string; values: Record<string, unknown> }> } };
    noteOn(note: number, velocity?: number): void;
    noteOff(note: number): void;
  };
};

let h: Harness;
let ctx: BrowserContext;
const problems: string[] = [];

async function open(url: string, name: string): Promise<Page> {
  const page = await ctx.newPage();
  page.on('pageerror', e => problems.push(`${name}: ${e}`));
  page.on('response', r => {
    if (r.status() >= 400) problems.push(`${name}: ${r.status()} ${r.url()}`);
  });
  await page.goto(url);
  return page;
}

async function play(page: Page) {
  await page.click('[data-testid=start-audio]');
  await page.waitForFunction(
    () => {
      const r = (window as unknown as { __remix: Remix }).__remix;
      return r.kit.compileStatus.value === 'ok' && r.kit.engine.running;
    },
    null,
    { timeout: 120000 },
  );
}

/** The output's loudest sample while a note plays. */
function peak(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const { kit } = (window as unknown as { __remix: Remix }).__remix;
    kit.noteOn(40, 110);
    await new Promise(r => setTimeout(r, 300));
    const a = kit.engine.outAnalyser!;
    const data = new Float32Array(a.fftSize);
    let max = 0;
    for (let i = 0; i < 10; i++) {
      a.getFloatTimeDomainData(data);
      for (const s of data) max = Math.max(max, Math.abs(s));
      await new Promise(r => setTimeout(r, 20));
    }
    kit.noteOff(40);
    return max;
  });
}

const texts = (page: Page, selector: string) => page.locator(selector).allTextContents();
const value = (page: Page, node: string) =>
  page.evaluate(
    n => (window as unknown as { __remix: Remix }).__remix.kit.doc.value.nodes[n]!.values.value,
    node,
  );

before(async () => {
  h = await startHarness({ bridge: false });
  ctx = await h.browser.newContext({ viewport: { width: 1440, height: 900 } });
});
after(async () => {
  await h?.close();
});

describe('passing a work on (prototype)', () => {
  let original = '';
  let first = '';
  let second = '';

  it('the first person makes Acid Line theirs and passes it on with their words', async () => {
    const page = await open(new URL('/prototype/remix/', h.url).href, 'author');
    await page.click('[data-testid=home-share]');
    original = new URL((await page.getAttribute('[data-testid=home-open]', 'href'))!, page.url())
      .href;
    await page.click('[data-testid=home-open]');
    await page.waitForSelector('[data-testid=journey]', { timeout: 60000 });
    await play(page);
    assert.ok((await peak(page)) > 0.01, 'the original sounds');

    // A real drag on CUTOFF.
    const box = (await page.locator('dk-knob').first().boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 80, { steps: 8 });
    await page.mouse.up();
    const dragged = await texts(page, '[data-testid=your-lines] li');
    assert.equal(dragged.length, 1);
    assert.match(dragged[0]!, /^CUTOFF 340 Hz → /);

    // Shaking moves every knob a little, without building the sound again.
    await page.click('[data-testid=shake]');
    await page.click('[data-testid=candidate-1]');
    assert.equal((await texts(page, '[data-testid=your-lines] li')).length, 6);
    assert.equal(
      await page.evaluate(
        () => (window as unknown as { __remix: Remix }).__remix.kit.compileStatus.value,
      ),
      'ok',
    );
    await page.click('[data-testid=shake-done]');

    await page.click('[data-testid=record]');
    for (const key of ['a', 's', 'd', 'f', 'g']) {
      await page.keyboard.down(key);
      await page.waitForTimeout(100);
      await page.keyboard.up(key);
      await page.waitForTimeout(40);
    }
    await page.click('[data-testid=record-stop]');
    assert.match((await page.textContent('[data-testid=play-yours]'))!, /5 notes/);

    await page.fill('[data-testid=me]', 'Mika');
    await page.getByRole('button', { name: 'Thank Owl' }).click();
    assert.equal(await page.inputValue('[data-testid=words]'), 'Thanks, Owl! ');
    assert.equal(
      await page.textContent('[data-testid=credit]'),
      'Acid Line by Owl, passed on by Mika',
    );
    await page.click('[data-testid=pass]');
    first = await page.inputValue('[data-testid=made-link]');
    assert.ok(first.length < 2000, `a short link (${first.length} characters)`);
    assert.equal(await page.locator('[data-testid=sent]').count(), 1);
    await page.close();

    // Someone else who got Owl's link only sends a word back.
    const other = await open(original, 'other');
    await other.waitForSelector('[data-testid=journey]', { timeout: 60000 });
    await other.fill('[data-testid=me]', 'Pico');
    await other.fill('[data-testid=words]', 'Love it as it is.');
    await other.click('[data-testid=send-only]');
    await other.waitForSelector('[data-testid=sent]');
    assert.equal(await other.locator('[data-testid=made-link]').count(), 0);
    await other.close();
  });

  it('the next person hears every version, and changes the inside in den-kit', async () => {
    const page = await open(first, 'second');
    await page.waitForSelector('[data-testid=journey]', { timeout: 60000 });
    assert.equal(await page.locator('[data-testid=journey] > li').count(), 2);
    assert.equal((await texts(page, '[data-testid=version-1] .lines li')).length, 6);
    assert.deepEqual(await texts(page, '[data-testid=others] a'), ['Pico · words']);
    await play(page);
    await page.click('[data-testid=listen-0]');
    assert.equal(await value(page, 'kcut'), 340);
    await page.click('[data-testid=hear-yours]');
    assert.notEqual(await value(page, 'kcut'), 340);

    await page.click('[data-testid=open-editor]');
    await page.waitForSelector('[data-testid=remix-panel]', { timeout: 90000 });
    await page.click('[data-testid=start-overlay]', { force: true });
    assert.deepEqual(await texts(page, '[data-testid=remix-lines] li'), ['Nothing yet']);
    // A room between the line and the output, as someone would patch it in the editor.
    const committed = await page.evaluate(() => {
      const kit = (
        window as unknown as {
          __kit: { commit(i: unknown[], o: unknown): { ok: boolean } };
        }
      ).__kit;
      return kit.commit(
        [
          {
            op: 'addNode',
            node: {
              id: 'room9',
              type: 'den.algorithmicReverb',
              label: 'Room',
              pos: { x: 900, y: 500 },
            },
          },
          {
            op: 'connect',
            from: { node: 'gain1', port: 'out' },
            to: { node: 'room9', port: 'left' },
          },
          {
            op: 'connect',
            from: { node: 'gain1', port: 'out' },
            to: { node: 'room9', port: 'right' },
          },
          {
            op: 'connect',
            from: { node: 'room9', port: 'left' },
            to: { node: 'out1', port: 'left' },
            replace: true,
          },
          {
            op: 'connect',
            from: { node: 'room9', port: 'right' },
            to: { node: 'out1', port: 'right' },
          },
        ],
        { label: 'Add a room' },
      ).ok;
    });
    assert.ok(committed);
    assert.deepEqual(await texts(page, '[data-testid=remix-lines] li'), [
      'Added Room',
      'Rewired 5 cables',
    ]);
    await page.click('[data-testid=remix-back]');
    await page.waitForSelector('[data-testid=journey]', { timeout: 60000 });
    assert.deepEqual(await texts(page, '[data-testid=your-lines] li'), [
      'Added Room',
      'Rewired 5 cables',
    ]);
    await page.fill('[data-testid=me]', 'Juniper');
    await page.fill('[data-testid=words]', 'I put it in a room.');
    await page.click('[data-testid=pass]');
    second = await page.inputValue('[data-testid=made-link]');
    await page.close();

    const third = await open(second, 'third');
    await third.waitForSelector('[data-testid=journey]', { timeout: 60000 });
    assert.equal(await third.locator('[data-testid=journey] > li').count(), 3);
    await play(third);
    assert.equal(
      await third.evaluate(
        () => (window as unknown as { __remix: Remix }).__remix.kit.doc.value.nodes.room9?.type,
      ),
      'den.algorithmicReverb',
    );
    assert.ok((await peak(third)) > 0.01, 'the version with the room sounds');
    await third.close();
  });

  it("the author's inbox holds what came back, and the author's choices apply", async () => {
    const page = await open(new URL('/prototype/remix/#inbox', h.url).href, 'inbox');
    await page.waitForSelector('[data-testid=inbox]');
    assert.deepEqual(await texts(page, '[data-testid^=returned-] .who strong'), [
      'Juniper',
      'Pico',
      'Mika',
    ]);
    assert.match(
      (await page.locator('[data-testid^=returned-]', { hasText: 'Juniper' }).textContent())!,
      /via Mika/,
    );
    await page.locator('[data-testid=allow-inside]').uncheck();
    await page
      .locator('[data-testid^=returned-]', { hasText: 'Pico' })
      .locator('[data-testid=returned-hide]')
      .click();
    await page.goto(second);
    await page.reload();
    await page.waitForSelector('[data-testid=journey]', { timeout: 60000 });
    assert.equal(await page.locator('[data-testid=open-editor]').count(), 0);
    assert.equal(await page.locator('[data-testid=inside-kept]').count(), 1);
    assert.equal(await page.locator('[data-testid=others]').count(), 0);
    await page.close();
    assert.deepEqual(problems, []);
  });
});

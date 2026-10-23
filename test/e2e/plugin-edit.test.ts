// U3 in the browser: building a plugin screen by hand. Adding things from the
// keyboard, editing text in place, aligning, grouping, stacking, undo; pictures
// dropped onto the plugin become assets and travel inside an export; custom
// parts draw, and a broken or endless one is stopped without taking the page
// down; a part that handles the mouse moves controls in one undo step per
// press; decorations never block the controls under them; the look and skins
// change from the inspector; the start screen starts a work in another work's look.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { openKit, startHarness, waitCompiled, type Harness } from './harness.ts';

const kit = (page: Page, fn: (k: any) => unknown): Promise<any> =>
  page.evaluate(`(${fn.toString()})(window.__kit)`);
interface ElementInfo {
  id: string;
  kind: string;
  rect: { x: number; y: number; w: number; h: number };
  text?: string;
}
const els = (page: Page): Promise<ElementInfo[]> =>
  kit(page, k =>
    Object.values<any>(k.doc.value.ui.elements).map((e: any) => ({
      id: e.id,
      kind: e.kind,
      rect: e.rect,
      text: e.text,
    })),
  );
/** A 2×2 red PNG as bytes. */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR42mP4z8DwH4QZYAwAR8oH+Rq28akAAAAASUVORK5CYII=';

let h: Harness;
before(async () => {
  h = await startHarness({ bridge: false });
});
after(async () => {
  await h?.close();
});

async function pluginEdit(page: Page) {
  await page.keyboard.press('Control+Alt+KeyE');
  await page.waitForSelector('[data-testid=plugin-view]');
  await page.keyboard.press('Control+KeyE');
  await page.waitForSelector('[data-testid=plugin-edit].active');
}

describe('building the plugin screen by hand', () => {
  it('adds, edits, aligns, groups and stacks from the keyboard; every step undoes', async () => {
    const { page, errors } = await openKit(h);
    await waitCompiled(page);
    await pluginEdit(page);
    // Shift+Space adds: type to find, Enter to place; a new text opens for typing.
    await page.keyboard.press('Shift+Space');
    await page.waitForSelector('[data-testid=insert-menu]');
    await page.keyboard.type('text');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.text-edit');
    await page.keyboard.press('ControlOrMeta+KeyA');
    await page.keyboard.type('Hello');
    await page.keyboard.press('Control+Enter');
    await page.waitForSelector('.text-edit', { state: 'detached' });
    let list = await els(page);
    assert.deepEqual(
      list.map(e => [e.kind, e.text]),
      [['text', 'Hello']],
    );
    assert.equal(await page.locator('[data-element=text1]').innerText(), 'Hello');
    for (const name of ['rect', 'ellip']) {
      await page.keyboard.press('Shift+Space');
      await page.keyboard.type(name);
      await page.keyboard.press('Enter');
      await page.waitForSelector('[data-testid=insert-menu]', { state: 'detached' });
    }
    list = await els(page);
    assert.deepEqual(
      list.map(e => e.kind),
      ['text', 'shape', 'shape'],
    );
    // Everything starts in the middle; spread them out with arrows (Shift: 10 px) and ⌥+arrows to resize.
    await page.click('[data-shield=shape2]');
    for (let i = 0; i < 12; i++) await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Alt+ArrowDown');
    const shape2 = (await els(page)).find(e => e.id === 'shape2')!.rect;
    assert.deepEqual([shape2.x - list[2]!.rect.x, shape2.h - list[2]!.rect.h], [120, 1]);
    // ⌘A then ⌥A: all left edges line up; ⌘Z puts them back.
    await page.keyboard.press('Control+KeyA');
    await page.keyboard.press('Alt+KeyA');
    const lefts = new Set((await els(page)).map(e => e.rect.x));
    assert.equal(lefts.size, 1, JSON.stringify([...lefts]));
    await page.keyboard.press('Control+KeyZ');
    assert.ok(new Set((await els(page)).map(e => e.rect.x)).size > 1);
    // ⌘G groups: a click on one member selects them all; ⌥-click reaches inside; ⇧⌘G ungroups.
    await page.keyboard.press('Control+KeyA');
    await page.keyboard.press('Control+KeyG');
    const groups = await kit(page, k => k.doc.value.ui.groups);
    assert.equal(Object.keys(groups).length, 1);
    await page.keyboard.press('Escape');
    await page.click('[data-shield=shape2]'); // the one not covered by the others
    assert.equal(
      await kit(page, k => k.selection.value.length),
      (Object.values(groups)[0] as string[]).length,
    );
    await page.click('[data-shield=shape2]', { modifiers: ['Alt'] });
    assert.deepEqual(await kit(page, k => k.selection.value), ['shape2']);
    // Stacking: ⌥⌘[ to the back, ⌥⌘] to the front (shape2 starts in front).
    await page.keyboard.press('Control+Alt+BracketLeft');
    assert.equal(await kit(page, k => k.doc.value.ui.order[0]), 'shape2');
    await page.keyboard.press('Control+Alt+BracketRight');
    assert.equal(await kit(page, k => k.doc.value.ui.order.at(-1)), 'shape2');
    await page.keyboard.press('Control+Shift+KeyG');
    assert.deepEqual(await kit(page, k => k.doc.value.ui.groups), {});
    // Delete removes decorations; undo brings them back with their text.
    await page.keyboard.press('Control+KeyA');
    await page.keyboard.press('Delete');
    assert.equal((await els(page)).length, 0);
    await page.keyboard.press('Control+KeyZ');
    assert.equal((await els(page)).length, 3);
    assert.equal(await page.locator('[data-element=text1]').innerText(), 'Hello');
    assert.deepEqual(errors, []);
    await page.close();
  });

  it('a dropped picture becomes an asset and an image; it travels inside an export and comes back on import', async () => {
    const { page, errors } = await openKit(h);
    await waitCompiled(page);
    await pluginEdit(page);
    const stage = await page.locator('.stage').boundingBox();
    await page.evaluate(
      ({ png, x, y }) => {
        const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
        const file = new File([bytes], 'dot.png', { type: 'image/png' });
        const dt = new DataTransfer();
        dt.items.add(file);
        const target = document.querySelector('.stage')!;
        target.dispatchEvent(
          new DragEvent('dragover', {
            dataTransfer: dt,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }),
        );
        target.dispatchEvent(
          new DragEvent('drop', {
            dataTransfer: dt,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }),
        );
      },
      { png: PNG, x: stage!.x + stage!.width / 2, y: stage!.y + stage!.height / 2 },
    );
    await page.waitForFunction(() =>
      Object.values((window as any).__kit.doc.value.ui.elements).some(
        (e: any) => e.kind === 'image',
      ),
    );
    const asset = await kit(
      page,
      k =>
        Object.entries<any>(k.doc.value.files)
          .filter(([p]) => p.startsWith('assets/'))
          .map(([id, f]) => ({
            id,
            name: id.split('/').at(-1),
            mime: f.type,
            width: f.width,
            height: f.height,
            source: f.source,
          }))[0],
    );
    assert.equal(asset.id, 'assets/dot.png');
    assert.deepEqual(
      [asset.name, asset.mime, asset.width, asset.height],
      ['dot.png', 'image/png', 2, 2],
    );
    await page.waitForFunction(() =>
      (document.querySelector('[data-kind=image] img') as HTMLImageElement | null)?.src.startsWith(
        'blob:',
      ),
    );
    // A damaged picture is refused with a reason, not kept as an empty gap.
    await page.evaluate(
      ({ x, y }) => {
        const broken = Uint8Array.from(
          atob(
            'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8DwnwEJMDGgAQAj8wED/vOZ2gAAAABJRU5ErkJggg==',
          ),
          c => c.charCodeAt(0),
        );
        const dt = new DataTransfer();
        dt.items.add(new File([broken], 'broken.png', { type: 'image/png' }));
        document.querySelector('.stage')!.dispatchEvent(
          new DragEvent('drop', {
            dataTransfer: dt,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }),
        );
      },
      { x: stage!.x + 40, y: stage!.y + 40 },
    );
    await page.waitForSelector('[data-testid=toast]:has-text("could not be read as a picture")');
    assert.equal(
      await kit(
        page,
        k =>
          Object.entries<any>(k.doc.value.files)
            .filter(([p]) => p.startsWith('assets/'))
            .map(([id, f]) => ({
              id,
              name: id.split('/').at(-1),
              mime: f.type,
              width: f.width,
              height: f.height,
              source: f.source,
            })).length,
      ),
      1,
    );
    // The asset panel lists it; a licence can be noted.
    await page.click(`[data-asset="${asset.id}"]`);
    await page.fill('[data-testid=asset-detail] [data-field=license]', 'Own work');
    await page.keyboard.press('Enter');
    assert.equal(
      await kit(
        page,
        k =>
          Object.entries<any>(k.doc.value.files)
            .filter(([p]) => p.startsWith('assets/'))
            .map(([id, f]) => ({
              id,
              name: id.split('/').at(-1),
              mime: f.type,
              width: f.width,
              height: f.height,
              source: f.source,
            }))[0].source?.license,
      ),
      'Own work',
    );
    // The work file carries the bytes; a fresh page (its own storage) imports them back.
    const file: number[] = await kit(page, async k => Array.from(await k.exportWork()));
    const { page: other } = await openKit(h);
    assert.equal(
      await other.evaluate(bytes => (window as any).__kit.importWork(new Uint8Array(bytes)), file),
      true,
    );
    await other.keyboard.press('Control+Alt+KeyE');
    await other.waitForFunction(
      () =>
        (
          document.querySelector('[data-kind=image] img') as HTMLImageElement | null
        )?.src.startsWith('blob:'),
      null,
      { timeout: 10000 },
    );
    assert.deepEqual(errors, []);
    await page.close();
    await other.close();
  });

  it('canvases draw in a worker; an error shows in the canvas, an endless loop is stopped, the page keeps working', async () => {
    const { page, errors } = await openKit(h);
    await waitCompiled(page);
    await pluginEdit(page);
    await page.keyboard.press('Shift+Space');
    // Its old name still finds it.
    await page.keyboard.type('custom');
    await page.waitForSelector('[data-testid=insert-menu] .item.current[data-insert=canvas]');
    await page.fill('[data-testid=insert-search]', 'canvas');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-element=canvas1] canvas');
    // Enter opens the code; a throwing draw shows its message in the canvas.
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-testid=canvas-editor]');
    await page.fill(
      '[data-testid=canvas-source]',
      'export default function draw(ctx, f) { throw new Error("boom " + Math.round(f.w)); }',
    );
    await page.click('[data-testid=canvas-apply]');
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-element=canvas1] [data-canvas-error]')
          ?.getAttribute('data-canvas-error')
          ?.includes('boom 220'),
      null,
      { timeout: 10000 },
    );
    // An endless loop: stopped after the time limit, with a message; the editor still answers.
    await kit(page, k =>
      k.commit([
        {
          op: 'updateElement',
          id: 'canvas1',
          set: { code: 'export default function draw() { for (;;) {} }' },
        },
      ]),
    );
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-element=canvas1] [data-canvas-error]')
          ?.getAttribute('data-canvas-error')
          ?.includes('Stopped'),
      null,
      { timeout: 10000 },
    );
    await page.keyboard.press('Shift+Space');
    await page.waitForSelector('[data-testid=insert-menu]');
    await page.keyboard.press('Escape');
    // A good canvas again: the error goes away.
    await kit(page, k =>
      k.commit([
        {
          op: 'updateElement',
          id: 'canvas1',
          set: {
            code: 'export default (ctx, f) => { ctx.fillStyle = f.color("accent"); ctx.fillRect(0, 0, f.w * f.norm("nope"), f.h); };',
          },
        },
      ]),
    );
    await page.waitForFunction(
      () => !document.querySelector('[data-element=canvas1] [data-canvas-error]'),
      null,
      { timeout: 10000 },
    );
    assert.deepEqual(errors, []);
    await page.close();
  });

  it('decorations never block the controls under them while playing; lamps follow their switch', async () => {
    const { page, errors } = await openKit(h);
    await waitCompiled(page);
    await kit(page, k =>
      k.commit([
        {
          op: 'addNode',
          node: {
            id: 'kres',
            type: 'ui.knob',
            label: 'Res',
            pos: { x: -300, y: 0 },
            panel: { x: 40, y: 40, w: 120, h: 140 },
            config: { min: 0.5, max: 8, scale: 'linear', unit: '' },
            values: { value: 1 },
          },
        },
        {
          op: 'connect',
          from: { node: 'kres', port: 'out' },
          to: { node: 'filter1', port: 'resonance' },
        },
        {
          op: 'addNode',
          node: {
            id: 'sw1',
            type: 'ui.toggle',
            label: 'On',
            pos: { x: -300, y: 200 },
            panel: { x: 200, y: 40, w: 90, h: 50 },
          },
        },
        {
          op: 'addElement',
          element: {
            kind: 'shape',
            shape: 'rect',
            rect: { x: 20, y: 20, w: 300, h: 200 },
            style: { fill: [{ kind: 'color', color: '#ffffff22' }] },
          },
        },
        {
          op: 'addElement',
          element: { kind: 'led', bind: 'sw1', rect: { x: 300, y: 50, w: 14, h: 14 } },
        },
      ]),
    );
    await page.keyboard.press('Control+Alt+KeyE');
    const knob = page.locator('[data-widget=kres] dk-knob');
    await knob.waitFor();
    const b = (await knob.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - 10);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - 70, { steps: 5 });
    await page.mouse.up();
    assert.ok(
      (await kit(page, k => k.doc.value.nodes.kres.values.value)) > 1,
      'the knob under the rectangle turned',
    );
    assert.equal(await page.locator('[data-element=led1] .led.lit').count(), 0);
    await page.click('[data-widget=sw1] dk-toggle');
    await page.waitForSelector('[data-element=led1] .led.lit');
    assert.deepEqual(errors, []);
    await page.close();
  });

  it('a canvas that handles the mouse moves controls: one press is one undo step; the wheel too; editing still selects it', async () => {
    const { page, errors } = await openKit(h);
    await waitCompiled(page);
    const PART = `export default {
  draw(ctx, f) {
    ctx.clearRect(0, 0, f.w, f.h);
    ctx.fillStyle = f.color('accent');
    ctx.fillRect(0, 0, f.w * f.norm('kq'), 10);
    if (f.pointer.over) f.cursor(f.pointer.down ? 'grabbing' : 'grab');
  },
  pointer(e, f) {
    if (e.type === 'down' || (e.type === 'move' && f.pointer.down)) { f.setNorm('kq', e.x / f.w); f.setNorm('kg', 1 - e.y / f.h); }
    if (e.type === 'wheel') f.set('kq', f.value('kq') - e.dy * 0.002);
  },
};`;
    // Two knobs that are in the patch but not on the plugin: the part is their face.
    await kit(page, (k: any) =>
      k.commit([
        {
          op: 'addNode',
          node: {
            id: 'kq',
            type: 'ui.knob',
            label: 'Q',
            pos: { x: -300, y: 0 },
            config: { min: 0.5, max: 8, scale: 'linear', unit: '' },
            values: { value: 1 },
          },
        },
        {
          op: 'connect',
          from: { node: 'kq', port: 'out' },
          to: { node: 'filter1', port: 'resonance' },
        },
        {
          op: 'addNode',
          node: {
            id: 'kg',
            type: 'ui.knob',
            label: 'G',
            pos: { x: -300, y: 200 },
            config: { min: 0, max: 1, scale: 'linear', unit: '' },
            values: { value: 0.5 },
          },
        },
      ]),
    );
    await page.evaluate(
      code =>
        (window as any).__kit.commit([
          {
            op: 'addElement',
            element: { kind: 'canvas', code, rect: { x: 40, y: 40, w: 300, h: 200 } },
          },
        ]),
      PART,
    );
    await page.keyboard.press('Control+Alt+KeyE');
    await page.waitForSelector('[data-element=canvas1] .canvas-box[data-interactive]');
    const values = () =>
      kit(page, (k: any) => [k.doc.value.nodes.kq.values.value, k.doc.value.nodes.kg.values.value]);
    const b = (await page.locator('[data-element=canvas1] .canvas-box').boundingBox())!;
    // Hovering: the part chose its own cursor.
    await page.mouse.move(b.x + b.width * 0.25, b.y + b.height * 0.5);
    await page.waitForFunction(
      () =>
        (document.querySelector('[data-element=canvas1] .canvas-box') as HTMLElement).style
          .cursor === 'grab',
    );
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.75, b.y + b.height * 0.25, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction(
      () => Math.abs((window as any).__kit.doc.value.nodes.kg.values.value - 0.75) < 0.03,
    );
    const [q, g] = await values();
    assert.ok(Math.abs(q - (0.5 + 0.75 * 7.5)) < 0.15, `Q follows across (${q})`);
    assert.ok(Math.abs(g - 0.75) < 0.03, `G follows up (${g})`);
    // The press moved two knobs, eight times: one ⌘Z takes it all back, ⇧⌘Z brings it again.
    await page.keyboard.press('Control+KeyZ');
    assert.deepEqual(await values(), [1, 0.5]);
    await page.keyboard.press('Control+Shift+KeyZ');
    assert.deepEqual(await values(), [q, g]);
    // Three wheel notches in a row are one step too.
    for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 100);
    await page.waitForFunction(
      q0 => Math.abs((window as any).__kit.doc.value.nodes.kq.values.value - (q0 - 0.6)) < 1e-6,
      q,
    );
    await page.waitForTimeout(600);
    await page.keyboard.press('Control+KeyZ');
    assert.deepEqual(await values(), [q, g]);
    // Right after an undo or a redo the part may not have had a frame yet: a wheel turn still starts from the value as it is now.
    await page.keyboard.press('Control+KeyZ');
    assert.deepEqual(await values(), [1, 0.5]);
    await page.evaluate(
      () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))),
    ); // the part has seen the undo
    await page.evaluate(async () => {
      (window as any).__kit.redo();
      await Promise.resolve(); // the page catches up, as between two input events, but no frame goes to the part
      const box = document.querySelector('[data-element=canvas1] .canvas-box') as HTMLElement;
      const r = box.getBoundingClientRect();
      for (let i = 0; i < 3; i++)
        box.dispatchEvent(
          new WheelEvent('wheel', {
            deltaY: 100,
            clientX: r.left + 20,
            clientY: r.top + 20,
            bubbles: true,
            cancelable: true,
          }),
        );
    });
    await page.waitForFunction(
      q0 => Math.abs((window as any).__kit.doc.value.nodes.kq.values.value - (q0 - 0.6)) < 1e-6,
      q,
    );
    await page.waitForTimeout(600);
    await page.keyboard.press('Control+KeyZ');
    assert.deepEqual(await values(), [q, g]);
    // Editing: the part is a box to select and move, not a control.
    await page.keyboard.press('Control+KeyE');
    await page.waitForSelector('[data-testid=plugin-edit].active');
    await page.mouse.click(b.x + b.width * 0.5, b.y + b.height * 0.5);
    assert.deepEqual(await kit(page, (k: any) => k.selection.value), ['canvas1']);
    assert.deepEqual(await values(), [q, g]);
    assert.deepEqual(errors, []);
    await page.close();
  });

  it('a work opens with every control showing its value (faders, switches, knobs)', async () => {
    const { page, errors } = await openKit(h);
    await waitCompiled(page);
    const open = async (id: string) => {
      await page.keyboard.press('Control+Alt+KeyN');
      await page.waitForSelector('[data-testid=start-screen]');
      await page.click(`[data-work=${id}]`);
      await page.waitForSelector('[data-testid=start-screen]', { state: 'detached' });
      if (!(await page.$('[data-testid=plugin-view]')))
        await page.keyboard.press('Control+Alt+KeyE');
      await page.waitForSelector('[data-testid=plugin-view]');
    };
    await open('lofi');
    assert.equal(await page.locator('[data-widget=fbits] dk-slider').getAttribute('value'), '8');
    assert.match(
      await page.locator('[data-widget=frate] dk-slider .value').innerText(),
      /^11\.0 kHz$/,
    );
    await open('fuzz');
    assert.equal(await page.locator('[data-widget=fs1] dk-toggle').getAttribute('value'), 'true');
    await page.waitForSelector('[data-widget=fs1] dk-toggle .fs.on');
    await open('tapeecho');
    await page.waitForSelector('[data-widget=thiss] dk-toggle .sw.on');
    assert.match(
      (await page.locator('[data-widget=ktime] dk-knob').getAttribute('value')) ?? '',
      /^0\.32$/,
    );
    assert.deepEqual(errors, []);
    await page.close();
  });

  it("the look and the skins change from the inspector; the start screen starts a work in another work's look", async () => {
    const { page, errors } = await openKit(h);
    await waitCompiled(page);
    await pluginEdit(page);
    // Nothing selected: the inspector shows the plugin's look.
    const accent = page
      .locator('[data-testid=plugin-inspector] .row', { hasText: 'accent' })
      .locator('input[type=text]');
    await accent.fill('#39ff14');
    await accent.press('Enter');
    assert.equal(await kit(page, k => k.doc.value.ui.look.tokens.accent), '#39ff14');
    assert.equal(
      await page.evaluate(() =>
        getComputedStyle(document.querySelector('[data-testid=plugin-window]')!)
          .getPropertyValue('--dk-accent')
          .trim(),
      ),
      '#39ff14',
    );
    // The field shows what the patch has, so ⌘Z / ⇧⌘Z work on the patch from right there (as in a design tool).
    await page.keyboard.press('Control+KeyZ');
    assert.equal(await kit(page, k => k.doc.value.ui.look.tokens.accent), undefined);
    assert.equal(await accent.inputValue(), '');
    await page.keyboard.press('Control+Shift+KeyZ');
    assert.equal(await kit(page, k => k.doc.value.ui.look.tokens.accent), '#39ff14');
    // Esc leaves the field: the keys go back to the plugin view.
    await page.keyboard.press('Escape');
    assert.equal(
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.testid),
      'plugin-view',
    );
    await page.keyboard.press('Control+KeyZ');
    assert.equal(await kit(page, k => k.doc.value.ui.look.tokens.accent), undefined);
    // Start screen: a work, then Tab to the looks and pick another work's look.
    await page.keyboard.press('Control+Alt+KeyN');
    await page.waitForSelector('[data-testid=start-screen]');
    await page.keyboard.press('ArrowDown'); // to the works (the first is picked)
    await page.keyboard.press('Tab'); // to the looks
    await page.keyboard.press('ArrowRight'); // Acid Line's look
    await page.keyboard.press('ArrowRight'); // Afterglow's look (a sunset photo)
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-testid=start-screen]', { state: 'detached' });
    assert.equal(await kit(page, k => k.doc.value.name), 'Acid Line (Afterglow look)');
    assert.equal(await kit(page, k => k.doc.value.ui.look.tokens.accent), '#ffb36b');
    assert.ok(
      await kit(page, k => !!k.doc.value.files['assets/den-kit/sunset-sky.jpg']),
      'the look brings its picture',
    );
    assert.ok(
      await kit(page, k => Object.keys(k.doc.value.ui.elements).includes('text1')),
      'the layout stays',
    );
    await page.keyboard.press('Control+KeyZ');
    assert.notEqual(
      await kit(page, k => k.doc.value.name),
      'Acid Line (Afterglow look)',
      'starting is one undo step',
    );
    assert.deepEqual(errors, []);
    await page.close();
  });

  it("ready-made controls behave by den-kit's rules: a knob drags 200 px for its range, takes the wheel and keys, resets on double-click; a slider never jumps; each gesture is one undo step", async () => {
    const { page, errors } = await openKit(h);
    await waitCompiled(page);
    await kit(page, k =>
      k.commit([
        {
          op: 'addNode',
          node: {
            id: 'bk',
            type: 'ui.knob',
            label: 'BK',
            pos: { x: -300, y: 0 },
            panel: { x: 40, y: 40, w: 120, h: 140 },
            config: { min: 0, max: 100, scale: 'linear', unit: '' },
            values: { value: 50 },
          },
        },
        {
          op: 'addNode',
          node: {
            id: 'bs',
            type: 'ui.slider',
            label: 'BS',
            pos: { x: -300, y: 200 },
            panel: { x: 200, y: 40, w: 50, h: 240 },
            config: { min: 0, max: 100, scale: 'linear', unit: '' },
            values: { value: 50 },
          },
        },
      ]),
    );
    await page.keyboard.press('Control+Alt+KeyE');
    const knob = page.locator('[data-widget=bk] dk-knob');
    await knob.waitFor();
    const value = (id: string): Promise<number> =>
      page.evaluate(id => (window as any).__kit.doc.value.nodes[id].values.value, id);
    const near = async (id: string, v: number) =>
      page.waitForFunction(
        ([id, v]) => Math.abs((window as any).__kit.doc.value.nodes[id].values.value - v) < 0.6,
        [id, v] as const,
        { timeout: 5000 },
      );
    const steps = () => kit(page, k => k.history.size);
    const b = (await knob.boundingBox())!;
    let size = await steps();
    // Rule 1: 40 px up on screen (however the plugin is scaled) is 20% of the range, wherever it is grabbed.
    for (const grab of [0.3, 0.6]) {
      const start = await value('bk');
      await page.mouse.move(b.x + b.width / 2, b.y + b.height * grab);
      await page.mouse.down();
      for (const dy of [10, 20, 30, 40])
        await page.mouse.move(b.x + b.width / 2, b.y + b.height * grab - dy);
      await page.mouse.up();
      await near('bk', Math.min(100, start + 20));
      assert.equal(await steps(), ++size, 'one drag is one undo step');
    }
    // Rule 4: keys (1%, Shift 10%, Home and End); rule 3: a wheel notch is 1%; rule 2: a double-click is the default.
    await kit(page, k => k.commit([{ op: 'setValue', node: 'bk', port: 'value', value: 50 }]));
    await knob.focus();
    await page.keyboard.press('ArrowUp');
    await near('bk', 51);
    await page.keyboard.press('Shift+ArrowUp');
    await near('bk', 61);
    await page.keyboard.press('Home');
    await near('bk', 0);
    await page.keyboard.press('End');
    await near('bk', 100);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.wheel(0, 100);
    await near('bk', 99);
    await knob.dblclick();
    await near('bk', Number(await knob.getAttribute('default')));
    // Rule 5: clicking a slider somewhere else does not move it; dragging moves it from where it was.
    const slider = page.locator('[data-widget=bs] dk-slider .track');
    const s = (await slider.boundingBox())!;
    size = await steps();
    await page.mouse.click(s.x + s.width / 2, s.y + 4);
    await page.waitForTimeout(200);
    assert.equal(await value('bs'), 50, 'a click does not jump');
    await page.mouse.move(s.x + s.width / 2, s.y + s.height - 4);
    await page.mouse.down();
    await page.mouse.move(s.x + s.width / 2, s.y + s.height - 4 - s.height / 4, { steps: 4 });
    await page.mouse.up();
    await near('bs', 75);
    assert.equal(await steps(), size + 1, 'the drag is one undo step');
    await kit(page, k => k.undo());
    assert.equal(await value('bs'), 50);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

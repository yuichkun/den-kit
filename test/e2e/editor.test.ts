// Editor flows driven through the real UI (mouse and keyboard).
import { writeZip } from '../../src/work/zip.ts';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { openKit, startHarness, waitCompiled, type Harness } from './harness.ts';

let h: Harness;
before(async () => {
  h = await startHarness();
});
after(async () => {
  await h?.close();
});

// Run fn(window.__kit) in the page (serialized; no closures over test variables).
const kit = (page: Page, fn: (k: any) => unknown): Promise<any> =>
  page.evaluate(`(${fn.toString()})(window.__kit)`);
// Order-independent document snapshot (undo restores content; record key order may differ).
const snapshot = (page: Page) =>
  kit(page, k => {
    const sort = (v: any): any =>
      Array.isArray(v)
        ? v.map(sort)
        : v && typeof v === 'object'
          ? Object.fromEntries(
              Object.keys(v)
                .sort()
                .map(key => [key, sort(v[key])]),
            )
          : v;
    return JSON.stringify(sort({ n: k.doc.value.nodes, e: k.doc.value.edges }));
  });
const nodeCount = (page: Page) => kit(page, k => Object.keys(k.doc.value.nodes).length);
const edgeCount = (page: Page) => kit(page, k => Object.keys(k.doc.value.edges).length);

async function fresh() {
  const { page, errors } = await openKit(h);
  await waitCompiled(page);
  return { page, errors };
}
async function handle(page: Page, node: string, port: string, type: 'source' | 'target') {
  const el = page.locator(
    `.vue-flow__node[data-id="${node}"] .vue-flow__handle[data-handleid="${port}"].${type}`,
  );
  await el.waitFor();
  const box = (await el.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
async function dragBetween(page: Page, a: { x: number; y: number }, b: { x: number; y: number }) {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let k = 1; k <= 12; k++)
    await page.mouse.move(a.x + ((b.x - a.x) * k) / 12, a.y + ((b.y - a.y) * k) / 12);
  await page.mouse.up();
}

describe('patch editor', () => {
  it('adds modules from the docked palette (click and drag) and from the search popup', async () => {
    const { page, errors } = await fresh();
    const n0 = await nodeCount(page);
    await page.click('.grid-palette .catgrid button:has-text("Filter")');
    await page.click('.grid-palette .tile[data-type="den.characterFilter"]');
    assert.equal(await nodeCount(page), n0 + 1);
    assert.equal(
      await kit(page, k => k.doc.value.nodes[k.selection.value[0]].type),
      'den.characterFilter',
    );
    await page
      .locator('.grid-palette .tile[data-type="den.characterFilter"]')
      .dragTo(page.locator('[data-testid=patch-view]'), { targetPosition: { x: 200, y: 500 } });
    assert.equal(await nodeCount(page), n0 + 2);
    // Search popup: Tab on the canvas, type, Enter.
    await page.locator('[data-testid=patch-view]').click({ position: { x: 20, y: 20 } });
    await page.keyboard.press('Tab');
    await page.fill('[data-testid=palette-search]', 'reverb');
    await page.keyboard.press('Enter');
    assert.equal(await nodeCount(page), n0 + 3);
    assert.ok(
      await kit(page, k =>
        Object.values<any>(k.doc.value.nodes).some((n: any) => n.type === 'den.algorithmicReverb'),
      ),
    );
    // Singletons are disabled in the palette.
    await page.click('.grid-palette .catgrid button:has-text("I/O")');
    assert.ok(await page.locator('.grid-palette .tile[data-type="kit.out"].disabled').count());
    assert.deepEqual(errors, []);
    await page.close();
  });

  it('patches by dragging between ports; cycles are refused; replacing an input is one undo step', async () => {
    const { page } = await fresh();
    await kit(page, k =>
      k.commit([
        { op: 'addNode', node: { id: 'lfo9', type: 'den.lfo', pos: { x: 0, y: 700 } } },
        { op: 'addNode', node: { id: 'gain9', type: 'kit.gain', pos: { x: 300, y: 700 } } },
      ]),
    );
    await page.evaluate(`window.__kit.loadEpoch.value++`);
    await page.waitForTimeout(500);
    const e0 = await edgeCount(page);
    await dragBetween(
      page,
      await handle(page, 'lfo9', 'out', 'source'),
      await handle(page, 'gain9', 'in', 'target'),
    );
    assert.equal(await edgeCount(page), e0 + 1);
    assert.ok(
      await kit(page, k =>
        Object.values<any>(k.doc.value.edges).some(
          (e: any) => e.from.node === 'lfo9' && e.to.node === 'gain9',
        ),
      ),
    );
    // gain9 → lfo9.rate would close a loop without History: refused, nothing changes.
    await dragBetween(
      page,
      await handle(page, 'gain9', 'out', 'source'),
      await handle(page, 'lfo9', 'rate', 'target'),
    );
    assert.equal(await edgeCount(page), e0 + 1);
    // Drop onto an occupied input: replaces in one transaction; undo restores the original cable.
    const before = await snapshot(page);
    await dragBetween(
      page,
      await handle(page, 'osc1', 'out', 'source'),
      await handle(page, 'gain9', 'in', 'target'),
    );
    assert.ok(
      await kit(page, k =>
        Object.values<any>(k.doc.value.edges).some(
          (e: any) => e.from.node === 'osc1' && e.to.node === 'gain9',
        ),
      ),
    );
    await page.keyboard.press('Control+z');
    assert.equal(await snapshot(page), before);
    await page.close();
  });

  it('deletes, copies/pastes and moves with the keyboard and mouse; undo/redo restore exactly', async () => {
    const { page } = await fresh();
    const doc0 = await snapshot(page);
    await page.locator('.vue-flow__node[data-id="filter1"] header').click();
    assert.deepEqual(await kit(page, k => k.selection.value), ['filter1']);
    await page.keyboard.press('Delete');
    assert.equal(await kit(page, k => k.doc.value.nodes.filter1), undefined);
    assert.equal((await waitCompiled(page)).status, 'ok'); // still compiles (osc no longer reaches Out → silence is fine)
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    assert.equal(await snapshot(page), doc0);
    // Copy/paste the filter: new id, same type and values, no cable to outside nodes.
    await page.locator('.vue-flow__node[data-id="filter1"] header').click();
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    const pasted = await kit(page, k => k.selection.value[0]);
    assert.notEqual(pasted, 'filter1');
    assert.equal(await kit(page, k => k.doc.value.nodes[k.selection.value[0]].type), 'den.filter');
    // Move by dragging the header: one undo step.
    const size0 = await kit(page, k => k.history.size);
    const header = page.locator(`.vue-flow__node[data-id="${pasted}"] header`);
    const box = (await header.boundingBox())!;
    await dragBetween(page, { x: box.x + 20, y: box.y + 8 }, { x: box.x + 220, y: box.y + 128 });
    assert.equal(await kit(page, k => k.history.size), size0 + 1);
    const moved = await kit(page, k => k.doc.value.nodes[k.selection.value[0]].pos);
    assert.ok(moved.x !== 0 || moved.y !== 0);
    await page.close();
  });

  it('draws each module where the work puts it, from the first frame; a dragged one lands on the grid', async () => {
    // Every place each module is drawn at, as the page shows it.
    const { page } = await openKit(h, {
      initScript: `window.__places = {};
        new MutationObserver(() => {
          for (const n of document.querySelectorAll('.vue-flow__node')) {
            const seen = (window.__places[n.dataset.id] ??= []);
            if (seen.at(-1) !== n.style.transform) seen.push(n.style.transform);
          }
        }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });`,
    });
    await waitCompiled(page);
    const nodes: Array<{ id: string; x: number; y: number }> = await kit(page, k =>
      Object.values<any>(k.doc.value.nodes).map(n => ({ id: n.id, ...n.pos })),
    );
    const between = nodes.find(n => n.x % 12 || n.y % 12);
    // The starter's layout puts modules between points of the grid.
    assert.ok(between);
    const places = await page.evaluate(() => (window as any).__places);
    for (const n of nodes) assert.deepEqual(places[n.id], [`translate(${n.x}px, ${n.y}px)`], n.id);
    const header = page.locator(`.vue-flow__node[data-id="${between.id}"] header`);
    const box = (await header.boundingBox())!;
    await dragBetween(page, { x: box.x + 20, y: box.y + 8 }, { x: box.x + 85, y: box.y + 47 });
    const pos = await page.evaluate(
      id => (window as any).__kit.doc.value.nodes[id].pos,
      between.id,
    );
    assert.notDeepEqual(pos, { x: between.x, y: between.y });
    assert.deepEqual([pos.x % 12, pos.y % 12], [0, 0]);
    assert.equal(
      await page
        .locator(`.vue-flow__node[data-id="${between.id}"]`)
        .evaluate(n => (n as HTMLElement).style.transform),
      `translate(${pos.x}px, ${pos.y}px)`,
    );
    await page.close();
  });

  it("fits the patch in view as the modules are drawn with den-kit's fonts, also when the fonts come late", async () => {
    const { page } = await openKit(h, { holdFonts: 3000 });
    // The modules are drawn before the font of their titles (in the default theme) arrives.
    await page.waitForSelector('.vue-flow__node');
    assert.ok(await page.evaluate(() => !document.fonts.check('700 13px "Schibsted Grotesk"')));
    const view = () =>
      page.evaluate(
        () => document.querySelector<HTMLElement>('.vue-flow__transformationpane')!.style.transform,
      );
    await page.waitForFunction(() => {
      const t = document.querySelector<HTMLElement>('.vue-flow__transformationpane')?.style
        .transform;
      return !!t && t !== 'translate(0px, 0px) scale(1)';
    });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const opened = await view();
    // Shift+1 fits the modules again, with the sizes they have now.
    await page.keyboard.press('Shift+Digit1');
    await page.waitForTimeout(600);
    assert.equal(await view(), opened);
    await page.close();
  });

  it("draws every cable to its ports when den-kit's fonts come late, in the patch and inside a part", async () => {
    // A work with a part of three modules.
    const { page: first } = await fresh();
    for (const [i, id] of ['osc1', 'filter1', 'vca1'].entries())
      await first.click(`.vue-flow__node[data-id="${id}"] header`, {
        modifiers: i ? ['Shift'] : [],
      });
    await first.keyboard.press('Control+KeyG');
    await first.waitForSelector('[data-testid=toast]:has-text("Made a part")');
    const use: string = await kit(first, k => k.selection.value[0]);
    await kit(first, k => k.saveNow());
    const work = await first.evaluate(() => localStorage.getItem('den-kit:editor:work'));
    await first.close();
    // The work opened with every font file held back, in a theme whose font changes the width
    // of a short title.
    const open = async () =>
      (
        await openKit(h, {
          holdFonts: 6000,
          initScript: `localStorage.setItem('den-kit:editor:work', ${JSON.stringify(work)});
            localStorage.setItem('den-kit:theme', 'plate-light');`,
        })
      ).page;
    // The font of the modules' titles in that theme has not arrived yet.
    const titleFontLate = (p: Page) =>
      p.evaluate(() => !document.fonts.check('600 13px "Inter Tight"'));
    // The cables shown that do not start and end at their ports, once the fonts are in.
    const offPorts = async (p: Page): Promise<string[]> => {
      await p.evaluate(() => document.fonts.ready.then(() => undefined));
      await p.waitForTimeout(300);
      return kit(p, k => {
        const off: string[] = [];
        for (const g of document.querySelectorAll<SVGGElement>('.vue-flow__edge')) {
          const e = k.doc.value.edges[g.dataset.id!];
          const path = g.querySelector<SVGPathElement>('path.cable');
          if (!e || !path) continue;
          const port = (node: string, id: string, type: string) =>
            document
              .querySelector(
                `.vue-flow__node[data-id="${node}"] .vue-flow__handle.${type}[data-handleid="${id}"]`,
              )!
              .getBoundingClientRect();
          const at = (length: number) => {
            const p = path.getPointAtLength(length);
            return new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM()!);
          };
          const from = port(e.from.node, e.from.port, 'source');
          const to = port(e.to.node, e.to.port, 'target');
          const start = at(0);
          const end = at(path.getTotalLength());
          const startGap = Math.hypot(start.x - from.right, start.y - (from.top + from.height / 2));
          // Between modules side by side, a cable ends in a short arrow before the port.
          const endGap = g.querySelector('.kit-edge.adjacent')
            ? 0
            : Math.hypot(end.x - to.left, end.y - (to.top + to.height / 2));
          if (startGap > 0.5 || endGap > 0.5)
            off.push(
              `${e.from.node}.${e.from.port} → ${e.to.node}.${e.to.port}: ${startGap.toFixed(1)} px, ${endGap.toFixed(1)} px`,
            );
        }
        return off;
      });
    };
    // The patch, drawn before the fonts arrive.
    const page = await open();
    await page.waitForSelector(`.vue-flow__node[data-id="${use}"]`);
    assert.ok(await titleFontLate(page));
    assert.deepEqual(await offPorts(page), []);
    await page.close();
    // Inside the part, gone into before the fonts arrive.
    const inside = await open();
    // Not a double-click: the use is clicked once it is in view, which is once the fonts are in.
    assert.ok(await inside.evaluate(id => (window as any).__kit.enterPart(id), use));
    await inside.waitForSelector('[data-testid=part-crumbs]');
    assert.ok(await titleFontLate(inside));
    assert.deepEqual(await offPorts(inside), []);
    await inside.close();
  });

  it('turning a face knob changes the AudioParam value without recompiling, as one undo step', async () => {
    const { page } = await fresh();
    const started = await kit(page, k => k.compiler.stats.started);
    const size0 = await kit(page, k => k.history.size);
    const knob = page.locator('.vue-flow__node[data-id="filter1"] .grid-knob.big svg').first();
    const box = (await knob.boundingBox())!;
    await dragBetween(
      page,
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      { x: box.x + box.width / 2, y: box.y - 60 },
    );
    const res = await kit(page, k => k.doc.value.nodes.filter1.values.resonance);
    assert.ok(res > 0.9, `resonance ${res}`);
    assert.equal(await kit(page, k => k.history.size), size0 + 1);
    await page.waitForTimeout(200);
    assert.equal(await kit(page, k => k.compiler.stats.started), started);
    await page.close();
  });

  it('exposes an input to the plugin and plays it from there; theme and layout edits are undoable', async () => {
    const { page } = await fresh();
    await page.locator('.vue-flow__node[data-id="cut1"] header').click();
    await page.click('[data-expose="hz"]');
    const knobId = await kit(
      page,
      k => Object.values<any>(k.doc.value.nodes).find((n: any) => n.type === 'ui.knob')?.id,
    );
    assert.ok(knobId);
    assert.ok(
      await kit(page, k =>
        Object.values<any>(k.doc.value.edges).some(
          (e: any) => e.to.node === 'cut1' && e.to.port === 'hz',
        ),
      ),
    );
    assert.equal((await waitCompiled(page)).status, 'ok');
    await page.click('[data-testid=view-plugin]');
    const widget = page.locator(`[data-widget="${knobId}"] dk-knob`);
    // Drag the dial that handles pointerdown, after its shadow DOM is visible.
    // The host also contains the label and value rows.
    const dial = widget.locator('.dial');
    await dial.waitFor({ state: 'visible' });
    await dial.hover(); // waits for the scaled plugin layout and pointer target to settle
    const before = await kit(
      page,
      k =>
        Object.values<any>(k.doc.value.nodes).find((n: any) => n.type === 'ui.knob').values.value,
    );
    const box = (await dial.boundingBox())!;
    await dragBetween(
      page,
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      { x: box.x + box.width / 2, y: box.y - 40 },
    );
    const after = await kit(
      page,
      k =>
        Object.values<any>(k.doc.value.nodes).find((n: any) => n.type === 'ui.knob').values.value,
    );
    assert.ok(after > before, `${before} → ${after}`);
    await page.selectOption('[data-testid=plugin-theme]', 'neon');
    assert.equal(await kit(page, k => k.doc.value.panel.theme), 'neon');
    // Edit layout: drag the widget.
    await page.click('[data-testid=plugin-edit]');
    const cell = page.locator(`[data-widget="${knobId}"]`);
    const cb = (await cell.boundingBox())!;
    await dragBetween(page, { x: cb.x + 10, y: cb.y + 10 }, { x: cb.x + 130, y: cb.y + 50 });
    const rect = await kit(
      page,
      k => Object.values<any>(k.doc.value.nodes).find((n: any) => n.type === 'ui.knob').panel,
    );
    assert.ok(rect.x >= 100, JSON.stringify(rect));
    await page.keyboard.press('Control+z');
    assert.ok(
      (
        await kit(
          page,
          k => Object.values<any>(k.doc.value.nodes).find((n: any) => n.type === 'ui.knob').panel,
        )
      ).x < 100,
    );
    await page.close();
  });

  it('codebox: edit in the editor, see a type error at its line, fix it and hear it compile', async () => {
    const { page } = await fresh();
    await kit(page, k =>
      k.commit([
        { op: 'addNode', node: { id: 'box1', type: 'kit.codebox', pos: { x: 0, y: 600 } } },
        { op: 'connect', from: { node: 'gain1', port: 'out' }, to: { node: 'box1', port: 'in' } },
        {
          op: 'connect',
          from: { node: 'box1', port: 'out' },
          to: { node: 'out1', port: 'left' },
          replace: true,
        },
      ]),
    );
    assert.equal((await waitCompiled(page)).status, 'ok', 'the default codebox template compiles');
    await page.evaluate(`window.__kit.loadEpoch.value++`);
    await page.waitForTimeout(400);
    await page.locator('.vue-flow__node[data-id="box1"] button.code').click();
    const source = page.locator('[data-testid=codebox-source]');
    await source.fill(
      "import { defineSubgraph, f32, type Node } from '@unworklet/core';\nexport default defineSubgraph((config: { sampleRate: number }) => ({\n  tick(i: { in: Node<'f32'> }) {\n    return { out: i.in.mul('loud') };\n  },\n}));\n",
    );
    // The code is coloured (keywords, strings), and the colours are the text being edited.
    await page.waitForSelector('[data-testid=codebox-editor] .paint .hljs-keyword');
    assert.equal(
      await page.locator('[data-testid=codebox-editor] .paint').evaluate(e => e.textContent),
      `${await source.inputValue()}\n`,
    );
    await page.click('[data-testid=codebox-editor] button.primary');
    assert.equal((await waitCompiled(page)).status, 'error');
    await page.locator('[data-testid=codebox-issue]').first().waitFor();
    assert.match(await page.locator('[data-testid=codebox-issue]').first().innerText(), /L4/);
    await source.fill(
      "import { defineSubgraph, type Node } from '@unworklet/core';\nexport default defineSubgraph((config: { sampleRate: number }) => ({\n  tick(i: { in: Node<'f32'> }) {\n    return { out: i.in.mul(2).tanh().mul(0.5) };\n  },\n}));\n",
    );
    await page.click('[data-testid=codebox-editor] button.primary');
    assert.equal((await waitCompiled(page)).status, 'ok');
    assert.match(await kit(page, k => k.generated.value.source), /tanh\(\)/);
    await page.close();
  });

  it('import refuses broken files with a reason; export → import round-trips; code view highlights the selection', async () => {
    const { page } = await fresh();
    const newer = writeZip([
      {
        path: 'work.json',
        data: new TextEncoder().encode('{"format":"den-kit/work","version":99}'),
      },
    ]);
    await page.setInputFiles('[data-testid=import-file]', {
      name: 'bad.denkit',
      mimeType: 'application/zip',
      buffer: Buffer.from(newer),
    });
    await page.waitForFunction(() =>
      (window as any).__kit.toasts.value.some((t: { text: string }) =>
        /newer den-kit/.test(t.text),
      ),
    );
    await page.setInputFiles('[data-testid=import-file]', {
      name: 'old.denkit.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"schema":"den-kit/patch","version":4}'),
    });
    await page.waitForFunction(() =>
      (window as any).__kit.toasts.value.some((t: { text: string }) =>
        /not a den-kit work file/.test(t.text),
      ),
    );
    const exported: number[] = await kit(page, async k => Array.from(await k.exportWork()));
    await kit(page, k => k.loadStarter('chorus'));
    await page.setInputFiles('[data-testid=import-file]', {
      name: 'bass.denkit',
      mimeType: 'application/zip',
      buffer: Buffer.from(exported),
    });
    await page.waitForFunction(() => (window as any).__kit.doc.value.name === 'Bass');
    await page.locator('.vue-flow__node[data-id="filter1"] header').click();
    await page.click('[data-testid=view-code]');
    const hl = page.locator('[data-testid=code-view] .line.hl');
    await hl.first().waitFor();
    assert.match(await hl.first().innerText(), /filter1/);
    // The generated processor is coloured, line by line.
    assert.ok((await page.locator('[data-testid=code-view] .line .hljs-keyword').count()) > 10);
    await page.close();
  });
  it('a work opens in one window: a second window says so and saves nothing; once the first closes it opens again', async () => {
    const context = await h.browser.newContext();
    const a = await context.newPage();
    await a.goto(h.url);
    await waitCompiled(a);
    assert.equal(await kit(a, k => k.commit([{ op: 'setName', name: 'from a' }]).ok), true);
    await kit(a, k => k.saveNow());
    const b = await context.newPage();
    await b.goto(h.url);
    await b.waitForSelector('[data-testid=work-refused]');
    assert.match(
      (await b.textContent('[data-testid=work-refused]')) ?? '',
      /“from a” is open in another den-kit window/,
    );
    // The first window keeps the work; the second wrote nothing over it.
    assert.equal(await kit(a, k => k.commit([{ op: 'setName', name: 'still a' }]).ok), true);
    await kit(a, k => k.saveNow());
    await b.waitForTimeout(1200);
    await a.close();
    const c = await context.newPage();
    await c.goto(h.url);
    await waitCompiled(c);
    assert.equal(await kit(c, k => k.doc.value.name), 'still a');
    assert.equal(await c.$('[data-testid=work-refused]'), null);
    await context.close();
  });
});

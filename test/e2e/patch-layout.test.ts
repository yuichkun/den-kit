// The showcase works as they open, in each of den-kit's themes: no module on the patch is drawn
// taller than layout.ts estimates (the size that lays works out and places new modules), and
// no module covers another.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { THEMES } from '../../src/editor/theme.ts';
import { WORKS } from '../../src/screen/showcase/index.ts';
import { catalog } from '../../src/sound/blocks/index.ts';
import { moduleBox } from '../../src/work/layout.ts';
import type { PatchDocument } from '../../src/work/schema.ts';
import { openKit, startHarness, waitCompiled, type Harness } from './harness.ts';

let h: Harness;
before(async () => {
  h = await startHarness({ bridge: false });
});
after(async () => {
  await h?.close();
});

async function openWork(page: Page, id: string) {
  await page.keyboard.press('Control+Alt+KeyN');
  await page.waitForSelector('[data-testid=start-screen]');
  await page.click(`[data-work=${id}]`);
  await page.waitForSelector('[data-testid=start-screen]', { state: 'detached' });
  await waitCompiled(page);
}
async function useTheme(page: Page, id: string) {
  await page.click('[data-testid=desktop-settings-open]');
  await page.selectOption('[data-testid=settings-theme]', id);
  await page.keyboard.press('Escape');
  await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, id);
  // Lay the page out in the theme, so that its fonts load, and wait for them.
  await page.evaluate(async () => {
    document.body.getBoundingClientRect();
    await document.fonts.ready;
    await new Promise(requestAnimationFrame);
  });
}
/** Each module on the patch: where the work puts it, its size as drawn, and its estimate. */
async function modules(page: Page) {
  const { doc, sizes } = await page.evaluate(() => ({
    doc: (window as any).__kit.doc.value as PatchDocument,
    sizes: [...document.querySelectorAll<HTMLElement>('.vue-flow__node')].map(n => {
      const mod = n.querySelector<HTMLElement>('.mod')!;
      return { id: n.dataset.id!, w: mod.offsetWidth, h: mod.offsetHeight };
    }),
  }));
  return sizes.map(s => {
    const node = doc.nodes[s.id]!;
    const connected = new Set(
      Object.values(doc.edges)
        .filter(e => e.to.node === s.id)
        .map(e => e.to.port),
    );
    return { ...s, ...node.pos, type: node.type, estimate: moduleBox(catalog, node, connected) };
  });
}

describe('the patch of each showcase work', () => {
  it("draws no module taller than its estimate, and none over another, in each of den-kit's themes", async () => {
    const { page, errors } = await openKit(h);
    await waitCompiled(page);
    for (const work of WORKS) {
      await openWork(page, work.id);
      for (const theme of THEMES) {
        await useTheme(page, theme.id);
        const mods = await modules(page);
        assert.ok(mods.length > 3, `${work.id}: the patch is drawn`);
        const where = `${work.title} in ${theme.name}`;
        for (const m of mods)
          assert.ok(
            m.h <= m.estimate.height,
            `${where}: ${m.id} (${m.type}) is ${m.h} px tall, estimated ${m.estimate.height} px`,
          );
        for (const [i, a] of mods.entries())
          for (const b of mods.slice(i + 1))
            assert.ok(
              a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y,
              `${where}: ${a.id} and ${b.id} overlap`,
            );
      }
    }
    assert.deepEqual(errors, []);
    await page.close();
  });
});

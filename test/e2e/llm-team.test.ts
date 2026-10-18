// U8 in the page: the (fake) lead lands the controls both sides share, starts a
// sound member and a screen member that work at the same time with den-kit's
// real tools; the person sees a lane per member and an outline in each one's
// colour on what it just changed; an edit outside a member's scope is refused;
// the lead waits for the reports and finishes; one ⌘Z takes all of it back.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { openKit, startHarness, waitCompiled, type Harness } from './harness.ts';

const kit = (page: Page, fn: (k: any) => unknown): Promise<any> =>
  page.evaluate(`(${fn.toString()})(window.__kit)`);

let h: Harness;
before(async () => {
  h = await startHarness({ codex: true });
});
after(async () => {
  await h?.close();
});

describe('an LLM request with members', () => {
  it(
    'the lead and two members build sound and screen at once; lanes and outlines show who works where; one ⌘Z undoes all',
    { timeout: 180000 },
    async () => {
      const { page, errors } = await openKit(h);
      await waitCompiled(page);
      await page.waitForFunction(() => (window as any).__kit.bridge.codexReady, null, {
        timeout: 30000,
      });
      const before = await kit(page, k =>
        JSON.stringify({
          ui: k.doc.value.ui,
          nodes: Object.keys(k.doc.value.nodes).sort(),
          edges: Object.keys(k.doc.value.edges).length,
        }),
      );
      await page.keyboard.press('Control+k');
      await page.keyboard.type('acid team please');
      await page.keyboard.press('Shift+Enter');
      // Both lanes, working at the same time.
      await page.waitForSelector('[data-testid=ai-lanes] [data-member=m1][data-status=working]', {
        timeout: 30000,
      });
      await page.waitForSelector('[data-testid=ai-lanes] [data-member=m2]', { timeout: 30000 });
      assert.match(await page.locator('[data-member=m1] .lane-scope').innerText(), /sound/);
      assert.match(await page.locator('[data-member=m2] .lane-scope').innerText(), /screen/);
      // What a member just changed is outlined with its name.
      await page.waitForSelector('[data-touched-by=Sound]', { timeout: 30000 });
      await page.waitForFunction(
        () => {
          const o = (window as any).__kit.requests.history.value.at(-1);
          return o && o.text === 'acid team please' && !o.live && o.status !== 'thinking';
        },
        null,
        { timeout: 120000 },
      );
      const line = await kit(page, k => {
        const o = k.requests.history.value.at(-1);
        return {
          status: o.status,
          label: o.label,
          steps: o.steps,
          agents: o.agents,
          tokens: o.tokens,
        };
      });
      assert.equal(line.status, 'applied', JSON.stringify(line));
      assert.equal(line.label, 'Built an acid bass and a neon screen');
      assert.deepEqual(
        line.agents.map((a: any) => [a.id, a.name, a.status]),
        [
          ['m1', 'Sound', 'done'],
          ['m2', 'Screen', 'done'],
        ],
      );
      assert.equal(line.tokens, 6400 + 8600 + 3300);
      assert.ok(line.steps.includes('members: Sound, Screen'), line.steps.join(' | '));
      // What landed: the seam, the sound member's edits, the screen member's look and title; not the sound member's look edit.
      const doc = await kit(page, k => k.doc.value);
      assert.equal(doc.nodes.filter1.values.resonance, 3);
      assert.ok(doc.nodes.lfo2);
      assert.equal(doc.ui.look.tokens.accent, '#39ff14');
      assert.ok(Object.values<any>(doc.ui.elements).some(e => e.text === 'ACID'));
      // The sound member's edit outside its scope was refused and it said so to the lead.
      const refused = h
        .codex!.replies()
        .find(r =>
          /outside your scope: the look belongs to the whole screen/.test(JSON.stringify(r)),
        );
      assert.ok(refused, 'the look edit by the sound member was refused');
      // Three conversations: the lead with the lead's tools, two members without them.
      const starts = h
        .codex!.sent('thread/start')
        .map(m => (m.params as any).dynamicTools.map((t: any) => t.name));
      assert.equal(starts.length, 3);
      assert.ok(starts[0].includes('kit_delegate'));
      assert.ok(!starts[1].includes('kit_delegate') && !starts[2].includes('kit_delegate'));
      // One ⌘Z: the lead's and both members' edits go together.
      await page.locator('[data-testid=ai-input]').blur();
      await page.keyboard.press('Control+z');
      assert.equal(
        await kit(page, k =>
          JSON.stringify({
            ui: k.doc.value.ui,
            nodes: Object.keys(k.doc.value.nodes).sort(),
            edges: Object.keys(k.doc.value.edges).length,
          }),
        ),
        before,
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(h.codex!.violations(), []);
      await page.close();
    },
  );
});

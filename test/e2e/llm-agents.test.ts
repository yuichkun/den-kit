// Sub-agents in the page: the (fake) runtime's request AI lands the controls both
// sides share and starts a sound sub-agent and a screen sub-agent that work at the
// same time with den-kit's real tools, reached through the bridge's MCP server; the
// person sees a lane per sub-agent and an outline with its name on what it just
// changed; an edit outside a sub-agent's scope is refused; one ⌘Z takes all of it back.
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

describe("an LLM request with the runtime's sub-agents", () => {
  it(
    'two sub-agents build sound and screen at once, each in its scope; lanes and outlines show who works where; one ⌘Z undoes all',
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
      // Both lanes, working at the same time, named as the sub-agents named themselves.
      const lane = (name: string) =>
        page.locator('[data-testid=ai-lanes] .lane', {
          has: page.locator('.lane-name', { hasText: name }),
        });
      await lane('Sound').locator('xpath=self::*[@data-status="working"]').waitFor({
        timeout: 30000,
      });
      await lane('Screen').waitFor({ timeout: 30000 });
      // Each lane shows the scope its sub-agent claims (a moment after the lane starts working).
      await lane('Sound').locator('.lane-scope', { hasText: /sound/ }).waitFor({ timeout: 30000 });
      await lane('Screen')
        .locator('.lane-scope', { hasText: /screen/ })
        .waitFor({ timeout: 30000 });
      // What a sub-agent just changed is outlined with its name.
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
        line.agents.map((a: any) => [a.name, a.status]),
        [
          ['Sound', 'done'],
          ['Screen', 'done'],
        ],
      );
      assert.equal(line.tokens, 6400 + 8600 + 3300);
      assert.ok(
        line.steps.includes('started sound') && line.steps.includes('started screen'),
        line.steps.join(' | '),
      );
      // What landed: the seam, the sound sub-agent's edits, the screen sub-agent's look and title;
      // not the sound sub-agent's look edit, which was outside its scope.
      const doc = await kit(page, k => k.doc.value);
      assert.equal(doc.nodes.filter1.values.resonance, 3);
      assert.ok(doc.nodes.lfo2);
      assert.equal(doc.ui.look.tokens.accent, '#39ff14');
      assert.ok(Object.values<any>(doc.ui.elements).some(e => e.text === 'ACID'));
      const sessions = h.codex!.mcpSessions();
      const sound = line.agents.find((a: any) => a.name === 'Sound').id;
      assert.ok(
        h
          .codex!.mcpCalls()
          .some(
            c =>
              c.thread === sound &&
              c.tool === 'kit_apply_ops' &&
              !c.success &&
              /outside your scope/.test(c.text),
          ),
        'the look edit by the sound sub-agent was refused',
      );
      // One conversation den-kit started; the sub-agents are the runtime's, each with its own MCP session.
      assert.equal(h.codex!.sent('thread/start').length, 1);
      assert.equal(sessions.length, 3);
      // One ⌘Z: the request's and both sub-agents' edits go together.
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

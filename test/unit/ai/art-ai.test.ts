// The AI and a work's art: kit_get_art shows each board as data, the tools take the
// art ops, and an edit of a layer the person changed after the AI read it is not
// applied and sends the AI back to kit_get_art; after reading again it lands.
import { describe, expect, it } from 'vite-plus/test';
import { LlmWorkspace, type WorkspaceDeps } from '../../../src/ai/llm-workspace.ts';
import { KIT_TOOLS } from '../../../src/ai/llm-spec.ts';
import { analyse } from '../../../src/sound/analysis.ts';
import { catalog } from '../../../src/sound/blocks/index.ts';
import { startArt } from '../../../src/work/art.ts';
import { History, commit, type Author } from '../../../src/work/history.ts';
import { applyIntents } from '../../../src/work/ops.ts';
import type { PatchDocument } from '../../../src/work/schema.ts';
import { starter } from '../../../src/work/starters.ts';

const AI: Author = { kind: 'ai-llm', take: 'take1' };

/** A bass with an icon and a cover, and a workspace that lands the AI's edits as the editor does. */
function workspace(made = true) {
  const history = new History();
  const base = starter('bass', catalog);
  const state: { live: PatchDocument } = {
    live: made
      ? applyIntents(
          base,
          [
            { op: 'setArt', board: 'icon', layers: startArt(base, catalog, 'specimen', 'icon') },
            { op: 'setArt', board: 'cover', layers: startArt(base, catalog, 'pattern', 'cover') },
          ],
          catalog,
        ).doc
      : base,
  };
  const deps: WorkspaceDeps = {
    catalog,
    images: false,
    read: () => state.live,
    land: (intents, label, seen) => {
      const r = commit(history, state.live, intents, catalog, { author: AI, seen, label });
      if (!r.ok) return { ok: false, message: r.error.message };
      state.live = r.doc;
      return { ok: true };
    },
    compile: async () => ({ ok: true, ms: 1 }),
    render: async () => {
      const s = new Float32Array(4800);
      return { report: analyse([s, s], 48000), renderMs: 1 };
    },
    look: async doc => ({
      issues: [],
      png: null,
      width: doc.panel.width,
      height: doc.panel.height,
      ms: 1,
    }),
  };
  /** The person edits the work by hand. */
  const person = (intents: Parameters<typeof commit>[2]) => {
    const r = commit(history, state.live, intents, catalog);
    if (!r.ok) throw r.error;
    state.live = r.doc;
  };
  return { ws: new LlmWorkspace(deps), state, person };
}

describe('the AI and the art', () => {
  it('the tools teach the art: a tool to read it, and the art ops in kit_apply_ops', () => {
    expect(KIT_TOOLS.some(t => t.name === 'kit_get_art')).toBe(true);
    const apply = KIT_TOOLS.find(t => t.name === 'kit_apply_ops')!;
    for (const op of [
      'setArt',
      'addArtLayer',
      'updateArtLayer',
      'removeArtLayer',
      'arrangeArtLayer',
    ])
      expect(JSON.stringify(apply.inputSchema), op).toContain(op);
  });

  it('kit_get_art shows each board as layers, or that it is not made yet', async () => {
    const none = await workspace(false).ws.call('kit_get_art', {});
    expect(none.success).toBe(true);
    expect(none.text).toMatch(/icon \(512×512\): not made yet/);
    const { ws, state } = workspace();
    const r = await ws.call('kit_get_art', {});
    expect(r.text).toContain(
      `cover (1600×900), bottom to top:\n${JSON.stringify(state.live.art!.cover!.layers)}`,
    );
  });

  it('an edit of what the person changed after the AI read is not applied; after reading again it lands', async () => {
    const { ws, state, person } = workspace();
    await ws.call('kit_get_art', {});
    person([{ op: 'updateArtLayer', board: 'cover', id: 'mark1', set: { text: 'Mine' } }]);
    const refused = await ws.call('kit_apply_ops', {
      ops: [{ op: 'updateArtLayer', board: 'cover', id: 'mark1', set: { text: 'Theirs' } }],
    });
    expect(refused.success).toBe(false);
    expect(refused.text).toMatch(/the work's cover \(mark1\) was changed by the person/);
    expect(refused.text).toContain('Call kit_get_art');
    expect(state.live.art!.cover!.layers.find(l => l.id === 'mark1')).toMatchObject({
      text: 'Mine',
    });
    // Read again: what the person changed is now seen, and an edit around it lands.
    await ws.call('kit_get_art', {});
    const landed = await ws.call('kit_apply_ops', {
      ops: [{ op: 'updateArtLayer', board: 'cover', id: 'pattern1', set: { scale: 2 } }],
    });
    expect(landed.success, landed.text).toBe(true);
    const cover = state.live.art!.cover!.layers;
    expect(cover.find(l => l.id === 'pattern1')).toMatchObject({ scale: 2 });
    expect(cover.find(l => l.id === 'mark1')).toMatchObject({ text: 'Mine' });
  });
});

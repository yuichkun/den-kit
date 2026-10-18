// My parts and the LLM: kit_list_blocks lists the person's saved parts with
// their inputs, parameters and outputs; placeMyPart brings one in (named, and
// wired in the same call), landing with the ids it tried; an unknown one is
// refused with the list; kit_get_patch says where a part came from.
import { describe, expect, it } from 'vite-plus/test';
import { LlmWorkspace, type WorkspaceDeps } from '../../../src/ai/llm-workspace.ts';
import { KIT_TOOLS, developerInstructions } from '../../../src/ai/llm-spec.ts';
import { catalog } from '../../../src/blocks/index.ts';
import { emptyLibrary, saveToLibrary, type Library } from '../../../src/core/library.ts';
import { applyIntents, type Intent } from '../../../src/core/ops.ts';
import { starter } from '../../../src/core/starters.ts';
import { validate } from '../../../src/core/validate.ts';
import { analyse } from '../../../src/core/analysis.ts';
import { checkPlugin } from '../../../src/plugin/checks.ts';

/** My parts holding "Tone" (the bass's oscillator and filter, with a description). */
function shelf(): Library {
  const doc = applyIntents(
    starter('bass', catalog),
    [
      { op: 'makePart', ids: ['osc1', 'filter1'], name: 'Tone' },
      { op: 'updatePart', part: 'tone', doc: 'A saw through a lowpass.' },
    ],
    catalog,
  ).doc;
  return saveToLibrary(emptyLibrary(), doc, 'tone').library;
}
function workspace(library: Library) {
  const state = { live: starter('pad', catalog), landed: [] as Intent[][] };
  const deps: WorkspaceDeps = {
    catalog,
    images: false,
    read: () => state.live,
    myParts: () => library,
    land: intents => {
      state.live = applyIntents(state.live, intents, catalog).doc;
      state.landed.push(intents);
      return { ok: true };
    },
    compile: async () => ({ ok: true, ms: 1 }),
    render: async () => {
      const s = new Float32Array(4800).map((_, i) => Math.sin(i / 20) * 0.3);
      return { report: analyse([s, s], 48000), renderMs: 1 };
    },
    look: async doc => ({
      issues: checkPlugin(doc, catalog),
      png: null,
      width: doc.panel.width,
      height: doc.panel.height,
      ms: 1,
    }),
  };
  return { ws: new LlmWorkspace(deps), state };
}

describe('My parts and the LLM', () => {
  it('the rules and the tools mention My parts; the block list shows them with their ports', async () => {
    expect(developerInstructions('')).toMatch(/My parts are the person's own saved parts/);
    const apply = KIT_TOOLS.find(t => t.name === 'kit_apply_ops')!;
    expect(apply.description).toContain('"op":"placeMyPart"');
    expect(JSON.stringify(apply.inputSchema)).toContain('placeMyPart');
    const { ws } = workspace(shelf());
    const list = await ws.call('kit_list_blocks', {});
    expect(list.text).toMatch(/My parts \(the person's saved parts/);
    expect(list.text).toMatch(
      /tone — Tone \(v1\): A saw through a lowpass\. Inputs: .*cutoff.*\. Parameters: resonance\. Outputs: out\./,
    );
    // A category list stays about module types.
    expect((await ws.call('kit_list_blocks', { category: 'filter' })).text).not.toMatch(/My parts/);
    // Nothing saved: no section.
    expect((await workspace(emptyLibrary()).ws.call('kit_list_blocks', {})).text).not.toMatch(
      /My parts/,
    );
  });
  it('placeMyPart brings a part in (named and wired in the same call); it lands with the ids it tried and says where it came from', async () => {
    const { ws, state } = workspace(shelf());
    const r = await ws.call('kit_apply_ops', {
      ops: [
        { op: 'placeMyPart', id: 'tone', node: 'lead1' },
        { op: 'addNode', node: { id: 'pitch9', type: 'kit.value', values: { value: 220 } } },
        {
          op: 'connect',
          from: { node: 'pitch9', port: 'out' },
          to: { node: 'lead1', port: 'frequency' },
        },
        {
          op: 'connect',
          from: { node: 'lead1', port: 'out' },
          to: { node: 'out1', port: 'right' },
          replace: true,
        },
      ],
    });
    expect(r.success).toBe(true);
    expect(r.text).toMatch(/new ids: lead1, pitch9/);
    const use = state.live.nodes.lead1!;
    expect(use.type).toBe('kit.part');
    expect(state.live.parts[use.part!]!.from).toMatchObject({ id: 'tone', version: 1 });
    expect(validate(state.live, catalog).issues.filter(i => i.severity === 'error')).toEqual([]);
    // What landed is what was tried: the import carried its ids.
    const landed = state.landed[0]!.find(i => i.op === 'importPart') as Extract<
      Intent,
      { op: 'importPart' }
    >;
    expect(landed.ids?.parts).toBeDefined();
    expect(landed.node).toBe('lead1');
    const patch = await ws.call('kit_get_patch', {});
    expect(patch.text).toMatch(/\(from My parts: tone v1\)/);
  });
  it('an unknown My part is refused with the ones there are; nothing lands', async () => {
    const { ws, state } = workspace(shelf());
    const before = state.live;
    const r = await ws.call('kit_apply_ops', { ops: [{ op: 'placeMyPart', id: 'rain' }] });
    expect(r.success).toBe(false);
    expect(r.text).toMatch(/There is no "rain" in My parts\. My parts: tone/);
    expect(state.live).toBe(before);
    const none = await workspace(emptyLibrary()).ws.call('kit_apply_ops', {
      ops: [{ op: 'placeMyPart', id: 'tone' }],
    });
    expect(none.text).toMatch(/none yet/);
  });
});

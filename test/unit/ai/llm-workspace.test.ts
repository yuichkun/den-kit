// The LLM's tools run against the live patch: an edit is tried on a copy, and
// only one that validates and compiles lands (as one step); a failing edit
// lands nothing and says why. What the tools report, and what lands.
import { describe, expect, it } from 'vite-plus/test';
import { catalog } from '../../../src/sound/blocks/index.ts';
import { starter } from '../../../src/work/starters.ts';
import { applyIntents, type Intent } from '../../../src/work/ops.ts';
import { clone, type PatchDocument } from '../../../src/work/schema.ts';
import { LlmWorkspace, type WorkspaceDeps } from '../../../src/ai/llm-workspace.ts';
import {
  KIT_TOOLS,
  KIT_TOOL_NAMES,
  LEAD_TOOLS,
  developerInstructions,
} from '../../../src/ai/llm-spec.ts';
import type { RenderRequest } from '../../../src/sound/compile/protocol.ts';
import { analyse } from '../../../src/sound/analysis.ts';
import { checkPlugin } from '../../../src/screen/checks.ts';

function workspace(extra: Partial<WorkspaceDeps> = {}, doc = starter('bass', catalog)) {
  const renders: Array<Omit<RenderRequest, 'id' | 'kind'>> = [];
  const compiles: string[] = [];
  const landed: Array<{ intents: Intent[]; label: string }> = [];
  const state = { live: doc };
  const deps: WorkspaceDeps = {
    catalog,
    images: false,
    read: () => state.live,
    land: (intents, label) => {
      try {
        state.live = applyIntents(state.live, intents, catalog).doc;
        landed.push({ intents, label });
        return { ok: true };
      } catch (error) {
        return { ok: false, message: (error as Error).message };
      }
    },
    compile: async g => {
      compiles.push(g.hash);
      return { ok: true, ms: 420 };
    },
    render: async r => {
      renders.push(r);
      const s = new Float32Array(48000).map((_, i) => Math.sin(i / 20) * 0.3);
      return { report: analyse([s, s], 48000), renderMs: 10 };
    },
    look: async doc => ({
      issues: checkPlugin(doc, catalog),
      png: new Uint8Array([137, 80, 78, 71]),
      width: doc.panel.width,
      height: doc.panel.height,
      ms: 5,
    }),
    ...extra,
  };
  return { ws: new LlmWorkspace(deps), renders, compiles, landed, state };
}

const BOX = [
  { op: 'addNode', node: { id: 'box1', type: 'kit.codebox' } },
  { op: 'connect', from: { node: 'gain1', port: 'out' }, to: { node: 'box1', port: 'in' } },
  {
    op: 'connect',
    from: { node: 'box1', port: 'out' },
    to: { node: 'out1', port: 'left' },
    replace: true,
  },
];

describe('tool specs', () => {
  it('every tool has a JSON schema object and the instructions mention them; nothing asks the user to choose', () => {
    for (const t of KIT_TOOLS) {
      expect(t.inputSchema.type).toBe('object');
      expect(t.description.length).toBeGreaterThan(20);
    }
    const text = developerInstructions('den.lfo — LFO (modulation): …');
    for (const name of ['kit_get_patch', 'kit_apply_ops', 'kit_listen', 'kit_finish'])
      expect(text).toContain(name);
    expect(text).toMatch(/Never ask the user to choose/);
    expect(text).toMatch(/lands on the live patch at once/);
    // Every tool den-kit runs: everyone's and the lead's (U8).
    expect(KIT_TOOL_NAMES.size).toBe(KIT_TOOLS.length + LEAD_TOOLS.length);
    for (const t of LEAD_TOOLS) {
      expect(t.inputSchema.type).toBe('object');
      expect(KIT_TOOL_NAMES.has(t.name)).toBe(true);
    }
    expect(KIT_TOOL_NAMES.has('kit_ask')).toBe(false);
  });
});

describe('LlmWorkspace', () => {
  it('kit_get_patch describes the live patch: modules, cables and problems', async () => {
    const { ws, state } = workspace();
    const r = await ws.call('kit_get_patch', {});
    expect(r.success).toBe(true);
    expect(r.text).toContain('"id": "filter1"');
    expect(r.text).toContain('osc1.out -> filter1.input');
    // What the user changed is what the model reads next.
    state.live = applyIntents(
      state.live,
      [{ op: 'setLabel', node: 'filter1', label: 'Tone' }],
      catalog,
    ).doc;
    expect((await ws.call('kit_get_patch', {})).text).toContain('"label": "Tone"');
  });

  it('lists and describes module types; unknown types get suggestions', async () => {
    const { ws } = workspace();
    expect((await ws.call('kit_list_blocks', { category: 'modulation' })).text).toContain(
      'den.lfo',
    );
    const lfo = await ws.call('kit_describe_block', { type: 'den.lfo' });
    expect(lfo.text).toContain('"rate"');
    const bad = await ws.call('kit_describe_block', { type: 'den.lfoo' });
    expect(bad.success).toBe(false);
    expect((await ws.call('kit_list_blocks', { category: 'nope' })).success).toBe(false);
  });

  it('kit_apply_ops is checked on a copy, compiled, then lands on the live patch at once as one step', async () => {
    const { ws, compiles, landed, state } = workspace();
    const r = await ws.call('kit_apply_ops', {
      ops: [
        { op: 'addNode', node: { type: 'den.lfo', values: { rate: 4 } } },
        {
          op: 'connect',
          from: { node: 'lfo1', port: 'out' },
          to: { node: 'cut1', port: 'octaves' },
          replace: true,
        },
        { op: 'setValue', node: 'filter1', port: 'resonance', value: 3 },
      ],
    });
    expect(r.success).toBe(true);
    expect(r.text).toMatch(/Applied 3 edits \(new ids: lfo1\); it is live now\. Compiled OK/);
    expect(compiles).toHaveLength(1);
    expect(landed).toHaveLength(1);
    expect(ws.landed).toBe(1);
    // The new module lands with the id it was checked with, placed next to what it feeds (not at 0,0).
    const added = landed[0]!.intents.find(
      (i): i is Extract<Intent, { op: 'addNode' }> => i.op === 'addNode',
    )!;
    expect(added.node.id).toBe('lfo1');
    expect(state.live.nodes.lfo1).toBeDefined();
    expect(state.live.nodes.lfo1!.pos).not.toEqual({ x: 0, y: 0 });
    expect(state.live.nodes.filter1!.values.resonance).toBe(3);
    expect(ws.steps.join(' ')).toMatch(/\+ lfo1.*✓/);
  });

  it('a rejected edit lands nothing and says which one and why', async () => {
    const { ws, landed, state } = workspace();
    const before = JSON.stringify(state.live);
    const r = await ws.call('kit_apply_ops', {
      ops: [
        { op: 'setValue', node: 'filter1', port: 'resonance', value: 3 },
        {
          op: 'connect',
          from: { node: 'nope', port: 'out' },
          to: { node: 'filter1', port: 'input' },
        },
      ],
    });
    expect(r.success).toBe(false);
    expect(r.text).toMatch(/Edit #2/);
    expect((await ws.call('kit_apply_ops', { ops: 'x' })).success).toBe(false);
    expect(JSON.stringify(state.live)).toBe(before);
    expect(landed).toEqual([]);
    expect(ws.landed).toBe(0);
  });

  it('an edit that does not compile lands nothing; the problems (with codebox lines) go back', async () => {
    let fail = false;
    const { ws, state } = workspace({
      compile: async () =>
        fail
          ? {
              ok: false,
              message: 'Fix the codebox errors.',
              issues: [
                {
                  severity: 'error',
                  code: 'ts',
                  message: "Property 'tanhh' does not exist",
                  node: 'box1',
                  line: 2,
                },
              ],
            }
          : { ok: true, ms: 1 },
    });
    expect((await ws.call('kit_apply_ops', { ops: BOX })).success).toBe(true);
    fail = true;
    const code =
      "import { defineSubgraph, type Node } from '@unworklet/core';\nexport default defineSubgraph(() => ({ tick(i: { in: Node<'f32'> }) { return { out: i.in.tanhh() }; } }));";
    const r = await ws.call('kit_write_codebox', {
      node: 'box1',
      code,
      inputs: [{ id: 'in', type: 'signal' }],
      outputs: [{ id: 'out', type: 'signal' }],
    });
    expect(r.success).toBe(false);
    expect(r.text).toMatch(/would not compile.*@box1:2.*Nothing was applied/s);
    expect(state.live.nodes.box1!.code ?? '').not.toContain('tanhh');
    expect(ws.steps.at(-1)).toMatch(/not applied$/);
  });

  it('a new validation error blocks the edit; problems the patch already had do not', async () => {
    const { ws, state } = workspace();
    // An edit that creates an error (a voice signal straight into the global output) is refused.
    const bad = await ws.call('kit_apply_ops', {
      ops: [
        { op: 'connect', from: { node: 'osc1', port: 'out' }, to: { node: 'out1', port: 'right' } },
      ],
    });
    expect(bad.success).toBe(false);
    expect(bad.text).toMatch(/would not validate/);
    // A patch that is already broken (an unknown module) still takes unrelated edits.
    const broken: PatchDocument = clone(state.live);
    broken.nodes.ghost1 = {
      id: 'ghost1',
      type: 'den.gone',
      pos: { x: 0, y: 0 },
      config: {},
      values: {},
    };
    state.live = broken;
    const ok = await ws.call('kit_apply_ops', {
      ops: [{ op: 'setValue', node: 'filter1', port: 'resonance', value: 2 }],
    });
    expect(ok.success).toBe(true);
    expect(ok.text).toMatch(/still has problems from before/);
    expect(state.live.nodes.filter1!.values.resonance).toBe(2);
  });

  it('when the live patch changed so the edit no longer fits, nothing lands and it is told to read again', async () => {
    const { ws } = workspace({
      land: () => ({ ok: false, message: 'Node "cut1" does not exist.' }),
    });
    const r = await ws.call('kit_apply_ops', {
      ops: [{ op: 'setValue', node: 'cut1', port: 'hz', value: 500 }],
    });
    expect(r.success).toBe(false);
    expect(r.text).toMatch(/Not applied: Node "cut1" does not exist\..*kit_get_patch/);
    expect(ws.landed).toBe(0);
  });

  it('kit_write_codebox needs an existing codebox', async () => {
    const { ws } = workspace();
    expect(
      (await ws.call('kit_write_codebox', { node: 'box9', code: '', inputs: [], outputs: [] }))
        .text,
    ).toMatch(/Add one first/);
    expect(
      (await ws.call('kit_write_codebox', { node: 'filter1', code: '', inputs: [], outputs: [] }))
        .text,
    ).toMatch(/not a codebox/);
  });

  it('kit_listen renders the live patch with the right phrase (or test input for effects)', async () => {
    const { ws, renders } = workspace();
    const r = await ws.call('kit_listen', { phrase: 'chord', seconds: 3 });
    expect(r.success).toBe(true);
    expect(r.text).toMatch(/peak/);
    expect(renders[0]!.seconds).toBe(3);
    expect(renders[0]!.events.length).toBeGreaterThan(0);
    expect(renders[0]!.input).toBeUndefined();
    const fx = workspace({}, starter('chorus', catalog));
    await fx.ws.call('kit_listen', { phrase: 'drums' });
    expect(fx.renders[0]!.input).toBe('drums');
    expect(fx.renders[0]!.events).toEqual([]);
  });

  it('an image is attached only when the model accepts images', async () => {
    const png = new Uint8Array([137, 80, 78, 71]);
    const { ws } = workspace({
      images: true,
      render: async () => ({ report: analyse([new Float32Array(100)], 48000), png, renderMs: 1 }),
    });
    expect((await ws.call('kit_listen', {})).imageDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('kit_finish keeps the summary; asking the user is not a tool; unknown tools and thrown errors become failures', async () => {
    const { ws } = workspace({
      render: async () => {
        throw new Error('worker died');
      },
    });
    expect(
      (await ws.call('kit_finish', { summary: 'Added an LFO to wobble the filter' })).success,
    ).toBe(true);
    expect(ws.summary).toBe('Added an LFO to wobble the filter');
    expect((await ws.call('kit_ask', { question: 'Which?', options: ['A', 'B'] })).success).toBe(
      false,
    );
    expect((await ws.call('kit_rm_rf', {})).success).toBe(false);
    const failed = await ws.call('kit_listen', {});
    expect(failed.success).toBe(false);
    expect(failed.text).toMatch(/worker died/);
  });

  it('screen edits: read the plugin, look things up, build it; only the sound recompiles (the screen never does)', async () => {
    const { ws, compiles, landed, state } = workspace();
    expect((await ws.call('kit_get_plugin', {})).text).toMatch(
      /Problems found by the checks:\n - Check: The plugin is empty/,
    );
    expect((await ws.call('kit_get_patch', {})).text).toMatch(
      /The plugin screen \(640×360\): 0 controls and 0 decorations — kit_get_plugin shows it\./,
    );
    expect((await ws.call('kit_get_plugin', {})).text).toContain('(nothing yet)');
    expect((await ws.call('kit_ui_reference', { topic: 'skins', control: 'knob' })).text).toContain(
      'chicken',
    );
    // A control for an input compiles (it drives the sound); a look and a title do not.
    const control = await ws.call('kit_apply_ops', {
      ops: [{ op: 'addControl', for: { node: 'filter1', port: 'resonance' }, label: 'Res' }],
    });
    expect(control.success).toBe(true);
    expect(control.text).toMatch(/new ids: knob1.*Compiled OK/);
    expect(compiles).toHaveLength(1);
    const look = await ws.call('kit_apply_ops', {
      ops: [
        {
          op: 'setLook',
          look: {
            tokens: { accent: '#39ff14' },
            background: [{ kind: 'image', asset: 'sc-brushed-metal', fit: 'tile', size: 256 }],
          },
        },
        {
          op: 'addElement',
          element: {
            kind: 'text',
            text: 'ACID',
            rect: { x: 24, y: 16, w: 300, h: 48 },
            textStyle: { font: 'oswald', size: 40, color: 'fg' },
          },
        },
        {
          op: 'setStyle',
          node: 'knob1',
          style: { skin: { name: 'cap', params: { shape: 'chicken' } } },
        },
      ],
    });
    expect(look.success).toBe(true);
    expect(look.text).toMatch(/The sound is unchanged/);
    expect(compiles).toHaveLength(1);
    expect(state.live.assets['sc-brushed-metal']).toBeDefined();
    expect(state.live.ui.elements.text1).toMatchObject({ kind: 'text', text: 'ACID' });
    expect(landed.at(-1)!.label).toMatch(/look: tokens, background, \+ text “ACID”, style knob1/);
    expect((await ws.call('kit_get_plugin', {})).text).toMatch(
      /"id":"knob1","control":"knob","label":"Res".*"skin":"cap \(own: shape \\"chicken\\"\)"/,
    );
  });

  it("a refused screen edit names the model's own edit, even when pictures were added before it", async () => {
    const { ws, landed } = workspace();
    const r = await ws.call('kit_apply_ops', {
      ops: [
        {
          op: 'setLook',
          look: { background: [{ kind: 'image', asset: 'sc-wood', fit: 'cover' }] },
        },
        {
          op: 'addElement',
          element: { kind: 'text', text: 'x', rect: { x: 0, y: 0, w: 0, h: 10 } },
        },
      ],
    });
    expect(r.success).toBe(false);
    expect(r.text).toMatch(/^Edit #2 \(\{"op":"addElement"/);
    expect(r.text).toMatch(/positive width and height/);
    expect(landed).toHaveLength(0);
  });

  it('kit_look reports what to fix (with the picture for image models); after screen edits kit_finish asks once to look first', async () => {
    const { ws } = workspace({ images: true });
    await ws.call('kit_apply_ops', {
      ops: [
        {
          op: 'addControl',
          for: { node: 'filter1', port: 'resonance' },
          label: 'Res',
          panel: { x: 20, y: 20, w: 84, h: 96 },
        },
        {
          op: 'addControl',
          for: { node: 'aenv1', port: 'release' },
          label: 'Release',
          panel: { x: 60, y: 30, w: 84, h: 96 },
        },
      ],
    });
    const nudge = await ws.call('kit_finish', { summary: 'done' });
    expect(nudge.success).toBe(false);
    expect(nudge.text).toMatch(/Call kit_look/);
    const seen = await ws.call('kit_look', {});
    expect(seen.text).toMatch(
      /1 thing to fix \(1 serious\):\n- Problem: knob1 \("Res"\) and knob2 \("Release"\) overlap/,
    );
    expect(seen.imageDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(ws.steps.at(-1)).toBe('looked at the screen (1 to fix)');
    expect((await ws.call('kit_finish', { summary: 'done' })).success).toBe(true);
    // Without image support no picture goes back; the reminder comes only once per request.
    const plain = workspace({ images: false });
    await plain.ws.call('kit_apply_ops', {
      ops: [{ op: 'setLook', look: { tokens: { accent: '#ff0000' } } }],
    });
    expect((await plain.ws.call('kit_finish', { summary: 'x' })).success).toBe(false);
    expect((await plain.ws.call('kit_finish', { summary: 'x' })).success).toBe(true);
    expect((await plain.ws.call('kit_look', {})).imageDataUrl).toBeUndefined();
  });

  it('kit_view_picture: a picture of the patch (or a bundled one) with its main colours; the picture itself only for image models', async () => {
    const seen = {
      png: new Uint8Array([137, 80, 78, 71]),
      width: 1024,
      height: 1024,
      palette: [
        { color: '#5a3a22', share: 0.6 },
        { color: '#8a5a32', share: 0.4 },
      ],
    };
    const { ws } = workspace({
      images: true,
      viewPicture: async id => (id === 'sc-wood' ? seen : null),
    });
    const r = await ws.call('kit_view_picture', { id: 'sc-wood' });
    expect(r.success).toBe(true);
    expect(r.text).toMatch(
      /^Picture sc-wood Warm mid-brown wood grain.*: 1024×1024\. Main colours: #5a3a22 \(60%\), #8a5a32 \(40%\)\. The picture is attached\./,
    );
    expect(r.imageDataUrl).toMatch(/^data:image\/png;base64,/);
    const missing = await ws.call('kit_view_picture', { id: 'my-photo' });
    expect(missing.success).toBe(false);
    expect(missing.text).toMatch(/No picture "my-photo"\. This patch has no pictures\./);
    const plain = workspace({ images: false, viewPicture: async () => seen });
    expect(
      (await plain.ws.call('kit_view_picture', { id: 'sc-wood' })).imageDataUrl,
    ).toBeUndefined();
  });

  it('one edit that adds decorations, controls and a group lands with the same ids it was tried with', async () => {
    const { ws, state } = workspace();
    const r = await ws.call('kit_apply_ops', {
      ops: [
        {
          op: 'addElement',
          element: { kind: 'text', text: 'TITLE', rect: { x: 20, y: 10, w: 200, h: 30 } },
        },
        {
          op: 'addControl',
          for: { node: 'filter1', port: 'resonance' },
          label: 'Res',
          panel: { x: 20, y: 60, w: 84, h: 96 },
        },
        {
          op: 'addElement',
          element: { kind: 'shape', shape: 'rect', rect: { x: 10, y: 50, w: 120, h: 120 } },
        },
        { op: 'group', ids: ['text1', 'shape1'] },
      ],
    });
    expect(r.success).toBe(true);
    expect(r.text).toMatch(/new ids: text1, knob1, shape1, group1/);
    expect(Object.keys(state.live.ui.elements).sort()).toEqual(['shape1', 'text1']);
    expect(state.live.nodes.knob1!.type).toBe('ui.knob');
    expect(state.live.ui.groups.group1).toEqual(['text1', 'shape1']);
  });
});

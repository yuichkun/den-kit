// The LLM's tools run against a draft: what they report, that rejected edits
// change nothing, and that the live patch is never touched.
import { describe, expect, it } from 'vitest';
import { catalog } from '../../../src/blocks/index.ts';
import { starter } from '../../../src/core/starters.ts';
import { DraftWorkspace, type WorkspaceDeps } from '../../../src/ai/llm-workspace.ts';
import { KIT_TOOLS, KIT_TOOL_NAMES, developerInstructions } from '../../../src/ai/llm-spec.ts';
import type { RenderRequest } from '../../../src/compile/protocol.ts';
import { analyse } from '../../../src/core/analysis.ts';

function workspace(extra: Partial<WorkspaceDeps> = {}, doc = starter('bass', catalog)) {
  const renders: Array<Omit<RenderRequest, 'id' | 'kind'>> = [];
  const compiles: string[] = [];
  const deps: WorkspaceDeps = {
    catalog, images: false,
    compile: async g => { compiles.push(g.hash); return { ok: true, ms: 420 }; },
    render: async r => { renders.push(r); const s = new Float32Array(48000).map((_, i) => Math.sin(i / 20) * 0.3); return { report: analyse([s, s], 48000), renderMs: 10 }; },
    ...extra,
  };
  return { ws: new DraftWorkspace(doc, deps), renders, compiles, live: doc };
}

describe('tool specs', () => {
  it('every tool has a JSON schema object and the instructions mention them', () => {
    for (const t of KIT_TOOLS) { expect(t.inputSchema.type).toBe('object'); expect(t.description.length).toBeGreaterThan(20); }
    const text = developerInstructions('den.lfo — LFO (modulation): …');
    for (const name of ['kit_get_patch', 'kit_apply_ops', 'kit_listen', 'kit_finish']) expect(text).toContain(name);
    expect(KIT_TOOL_NAMES.size).toBe(KIT_TOOLS.length);
  });
});

describe('DraftWorkspace', () => {
  it('kit_get_patch describes modules, cables and problems', async () => {
    const { ws } = workspace();
    const r = await ws.call('kit_get_patch', {});
    expect(r.success).toBe(true);
    expect(r.text).toContain('"id": "filter1"');
    expect(r.text).toContain('osc1.out -> filter1.input');
  });

  it('lists and describes module types; unknown types get suggestions', async () => {
    const { ws } = workspace();
    expect((await ws.call('kit_list_blocks', { category: 'modulation' })).text).toContain('den.lfo');
    const lfo = await ws.call('kit_describe_block', { type: 'den.lfo' });
    expect(lfo.text).toContain('"rate"');
    const bad = await ws.call('kit_describe_block', { type: 'den.lfoo' });
    expect(bad.success).toBe(false);
    expect((await ws.call('kit_list_blocks', { category: 'nope' })).success).toBe(false);
  });

  it('kit_apply_ops edits the draft only, compiles it, and records a step', async () => {
    const { ws, compiles, live } = workspace();
    const before = JSON.stringify(live);
    const r = await ws.call('kit_apply_ops', { ops: [
      { op: 'addNode', node: { id: 'lfo2', type: 'den.lfo', values: { rate: 4 } } },
      { op: 'setValue', node: 'filter1', port: 'resonance', value: 3 },
    ] });
    expect(r.success).toBe(true);
    expect(r.text).toMatch(/Applied 2 edits.*Compiled OK/s);
    expect(ws.draft.nodes.lfo2).toBeDefined();
    expect(JSON.stringify(live)).toBe(before);
    expect(compiles).toHaveLength(1);
    expect(ws.steps.join(' ')).toMatch(/\+ lfo2/);
    expect(ws.changed).toBe(true);
  });

  it('a rejected edit applies nothing and says which one and why', async () => {
    const { ws } = workspace();
    const r = await ws.call('kit_apply_ops', { ops: [
      { op: 'setValue', node: 'filter1', port: 'resonance', value: 3 },
      { op: 'connect', from: { node: 'nope', port: 'out' }, to: { node: 'filter1', port: 'input' } },
    ] });
    expect(r.success).toBe(false);
    expect(r.text).toMatch(/Edit #2/);
    expect(ws.draft.nodes.filter1!.values.resonance).toBe(0.707);
    expect((await ws.call('kit_apply_ops', { ops: 'x' })).success).toBe(false);
    expect(ws.changed).toBe(false);
  });

  it('compile problems come back as text (the edit stays so the LLM can fix it)', async () => {
    const { ws } = workspace({ compile: async () => ({ ok: false, message: 'Fix the codebox errors.', issues: [{ severity: 'error', code: 'ts', message: "Property 'tanhh' does not exist", node: 'box1', line: 2 }] }) });
    await ws.call('kit_apply_ops', { ops: [{ op: 'addNode', node: { id: 'box1', type: 'kit.codebox' } }, { op: 'connect', from: { node: 'gain1', port: 'out' }, to: { node: 'box1', port: 'in' } }, { op: 'connect', from: { node: 'box1', port: 'out' }, to: { node: 'out1', port: 'left' }, replace: true }] });
    const code = "import { defineSubgraph, type Node } from '@unworklet/core';\nexport default defineSubgraph(() => ({ tick(i: { in: Node<'f32'> }) { return { out: i.in.tanhh() }; } }));";
    const r = await ws.call('kit_write_codebox', { node: 'box1', code, inputs: [{ id: 'in', type: 'signal' }], outputs: [{ id: 'out', type: 'signal' }] });
    expect(r.success).toBe(true);
    expect(r.text).toMatch(/does not compile.*@box1:2/s);
  });

  it('kit_write_codebox needs an existing codebox', async () => {
    const { ws } = workspace();
    expect((await ws.call('kit_write_codebox', { node: 'box9', code: '', inputs: [], outputs: [] })).text).toMatch(/Add one first/);
    expect((await ws.call('kit_write_codebox', { node: 'filter1', code: '', inputs: [], outputs: [] })).text).toMatch(/not a codebox/);
  });

  it('kit_listen renders the right phrase (or test input for effects) and reports metrics', async () => {
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
    const { ws } = workspace({ images: true, render: async () => ({ report: analyse([new Float32Array(100)], 48000), png, renderMs: 1 }) });
    expect((await ws.call('kit_listen', {})).imageDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('kit_finish keeps the summary; unknown tools and thrown errors become failures', async () => {
    const { ws } = workspace({ render: async () => { throw new Error('worker died'); } });
    expect((await ws.call('kit_finish', { summary: 'LFOでフィルターを揺らしました' })).success).toBe(true);
    expect(ws.summary).toBe('LFOでフィルターを揺らしました');
    expect((await ws.call('kit_rm_rf', {})).success).toBe(false);
    const failed = await ws.call('kit_listen', {});
    expect(failed.success).toBe(false);
    expect(failed.text).toMatch(/worker died/);
  });
});

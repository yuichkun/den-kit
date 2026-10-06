// The LLM tool loop with real code generation, compilation and offline
// rendering (Node), as an LLM would drive it: add an LFO wobbling the cutoff,
// listen, then a codebox with a mistake, fix it, listen again.
import { beforeAll, describe, expect, it } from 'vitest';
import { compile } from '@unworklet/core';
import { renderOffline } from '@unworklet/offline';
import { catalog } from '../../src/blocks/index.ts';
import { starter } from '../../src/core/starters.ts';
import { evaluate, EvaluationError } from '../../src/compile/evaluate.ts';
import { analyse, testSignal } from '../../src/core/analysis.ts';
import { DraftWorkspace } from '../../src/ai/llm-workspace.ts';
import { rebase } from '../../src/core/rebase.ts';
import { applyIntents } from '../../src/core/ops.ts';
import { attributeError } from '../../src/compile/compile-errors.ts';
import { compileInputs } from '../../src/compile/compile-client.ts';
import { loadRegistry } from '../helpers/registry.ts';

let registry: Record<string, unknown>;
beforeAll(async () => { registry = await loadRegistry(); });

function realWorkspace(doc = starter('bass', catalog)) {
  return new DraftWorkspace(doc, {
    catalog, images: false,
    compile: async (g, doc) => {
      const started = performance.now();
      try { await compile(evaluate(g.source, registry).processor, { sampleRate: 48000 }); return { ok: true, ms: performance.now() - started }; }
      catch (error) {
        // Same attribution as the compile worker: codebox lines map back onto the codebox.
        const e = error as EvaluationError;
        const boxes = compileInputs(doc, g).codeboxes.map(b => ({ node: b.node, line: b.line, lines: b.code.split('\n').length + 1 }));
        return { ok: false, message: e.message, issues: attributeError(e.message, Object.keys(doc.nodes), { node: e.node, line: e.line, codeboxes: boxes }) };
      }
    },
    render: async r => {
      const { processor } = evaluate(r.source, registry);
      const params = Object.fromEntries(Object.entries(r.params).map(([k, v]) => [k, [v]]));
      const result = await renderOffline(processor, { sampleRate: 48000, duration: r.seconds, params, events: r.events, inputs: r.input ? { main: testSignal(r.input, r.seconds, 48000) } : undefined });
      return { report: analyse(result.outputs.main as Float32Array[], 48000, { ...r.notes, broken: result.diagnostics.scrubbedSamples }), renderMs: 0 };
    },
  });
}

describe('LLM tool loop (real compile and render)', () => {
  it('wobble the cutoff with an LFO, listen, and land the draft on the live patch', async () => {
    const live = starter('bass', catalog);
    const ws = realWorkspace(live);
    const edit = await ws.call('kit_apply_ops', { ops: [
      { op: 'addNode', node: { id: 'lfo2', type: 'den.lfo', values: { rate: 5 } } },
      { op: 'addNode', node: { id: 'wob1', type: 'kit.mul', values: { b: 1.5 } } },
      { op: 'addNode', node: { id: 'sum2', type: 'kit.add' } },
      { op: 'connect', from: { node: 'lfo2', port: 'out' }, to: { node: 'wob1', port: 'a' } },
      { op: 'connect', from: { node: 'fdepth1', port: 'out' }, to: { node: 'sum2', port: 'a' } },
      { op: 'connect', from: { node: 'wob1', port: 'out' }, to: { node: 'sum2', port: 'b' } },
      { op: 'connect', from: { node: 'sum2', port: 'out' }, to: { node: 'cut1', port: 'octaves' }, replace: true },
    ] });
    expect(edit.text).toMatch(/Compiled OK/);
    const heard = await ws.call('kit_listen', { phrase: 'bass', seconds: 2 });
    expect(heard.success).toBe(true);
    expect(heard.text).not.toMatch(/Silent|Broken/);
    // Land it: nothing changed live meanwhile, so the result equals the draft.
    const r = rebase(ws.base, ws.draft, live, catalog);
    expect(r.conflicts).toEqual([]);
    const landed = applyIntents(live, r.intents, catalog).doc;
    expect(Object.values(landed.edges).find(e => e.to.node === 'cut1' && e.to.port === 'octaves')!.from.node).toBe('sum2');
  }, 120000);

  it('a codebox with a mistake reports where; the fix compiles and sounds', async () => {
    const ws = realWorkspace();
    await ws.call('kit_apply_ops', { ops: [
      { op: 'addNode', node: { id: 'box1', type: 'kit.codebox' } },
      { op: 'connect', from: { node: 'gain1', port: 'out' }, to: { node: 'box1', port: 'in' } },
      { op: 'connect', from: { node: 'box1', port: 'out' }, to: { node: 'out1', port: 'left' }, replace: true },
    ] });
    const broken = await ws.call('kit_write_codebox', { node: 'box1', code: "import { defineSubgraph, type Node } from '@unworklet/core';\nexport default defineSubgraph(() => ({ tick(i: { in: Node<'f32'> }) { return { out: i.in.mul( } } }));", inputs: [{ id: 'in', type: 'signal' }], outputs: [{ id: 'out', type: 'signal' }] });
    expect(broken.text).toMatch(/does not compile/);
    expect(broken.text).toMatch(/box1/);
    const fixed = await ws.call('kit_write_codebox', { node: 'box1', code: "import { defineSubgraph, type Node } from '@unworklet/core';\nexport default defineSubgraph(() => ({ tick(i: { in: Node<'f32'>; drive: Node<'f32'> }) { return { out: i.in.mul(i.drive).tanh() }; } }));", inputs: [{ id: 'in', type: 'signal' }, { id: 'drive', type: 'signal' }], outputs: [{ id: 'out', type: 'signal' }] });
    expect(fixed.text).toMatch(/Compiled OK/);
    await ws.call('kit_apply_ops', { ops: [{ op: 'setValue', node: 'box1', port: 'drive', value: 3 }] });
    const heard = await ws.call('kit_listen', { phrase: 'bass', seconds: 1.5 });
    expect(heard.text).not.toMatch(/Silent|Broken/);
  }, 120000);

  it('an effect patch is heard through its test input', async () => {
    const ws = realWorkspace(starter('chorus', catalog));
    const heard = await ws.call('kit_listen', { phrase: 'drums', seconds: 1 });
    expect(heard.success).toBe(true);
    expect(heard.text).not.toMatch(/Silent/);
  }, 120000);
});

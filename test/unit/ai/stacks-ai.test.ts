// LLM tools preserve copies, spread and estimated load without expanding nodes.
import { describe, expect, it } from 'vitest';
import { LlmWorkspace, type WorkspaceDeps } from '../../../src/ai/llm-workspace.ts';
import { KIT_TOOLS, developerInstructions } from '../../../src/ai/llm-spec.ts';
import { catalog } from '../../../src/blocks/index.ts';
import { applyIntents, type Intent } from '../../../src/core/ops.ts';
import { starter } from '../../../src/core/starters.ts';
import { validate } from '../../../src/core/validate.ts';
import { analyse } from '../../../src/core/analysis.ts';
import { checkPlugin } from '../../../src/plugin/checks.ts';

describe('the LLM and copies', () => {
  it('the tools and the rules teach copies; the block list leaves out what expansion makes', async () => {
    const apply = KIT_TOOLS.find(t => t.name === 'kit_apply_ops')!;
    for (const op of ['setCount', 'setSpread']) {
      expect(apply.description).toContain(`"op":"${op}"`);
      expect(JSON.stringify(apply.inputSchema)).toContain(op);
    }
    expect(JSON.stringify(apply.inputSchema)).toContain('"count"');
    const rules = developerInstructions('');
    expect(rules).toMatch(/Copies \(×N: many of the same\)/);
    expect(rules).toMatch(/under about 60% of one core/);
    const ws = new LlmWorkspace(deps().deps);
    const list = await ws.call('kit_list_blocks', {});
    expect(list.text).toContain('kit.splay');
    expect(list.text).toContain('kit.copy ');
    expect(list.text).toContain('kit.part');
    for (const hidden of ['kit.stackSum', 'kit.stackGate', 'kit.splayN', 'kit.copyConst']) expect(list.text).not.toContain(hidden);
  });
  it('kit_apply_ops stacks and spreads; kit_get_patch shows ×N, the spread and the load; a broken spread is refused with the reason', async () => {
    const { deps: d, state } = deps();
    const ws = new LlmWorkspace(d);
    const ok = await ws.call('kit_apply_ops', { ops: [
      { op: 'setCount', node: 'filter1', count: 6 },
      { op: 'setSpread', node: 'filter1', port: 'resonance', spread: { kind: 'random', amount: 1, seed: 4 } },
      { op: 'addNode', node: { id: 'noise1', type: 'den.seededNoise', count: 3 } },
    ] });
    expect(ok.success).toBe(true);
    expect(state.live.nodes.filter1).toMatchObject({ count: 6, spread: { resonance: { kind: 'random', amount: 1, seed: 4 } } });
    const patch = await ws.call('kit_get_patch', {});
    expect(patch.text).toMatch(/Estimated load: .* of one core/);
    expect(patch.text).toMatch(/filter1: Lowpass ×6/);
    expect(patch.text).toMatch(/copies spread: random ±1/);
    expect(patch.text).toMatch(/"count": 6/);
    const bad = await ws.call('kit_apply_ops', { ops: [{ op: 'setSpread', node: 'filter1', port: 'input', spread: { kind: 'range', amount: 1 } }] });
    expect(bad.success).toBe(false);
    expect(bad.text).toMatch(/cannot differ between copies/);
    const out = await ws.call('kit_apply_ops', { ops: [{ op: 'setCount', node: 'out1', count: 2 }] });
    expect(out.success).toBe(false);
    expect(out.text).toMatch(/cannot run as copies/);
    expect(state.live.nodes.out1!.count).toBeUndefined();
  });
});

function deps() {
  const state = { live: starter('bass', catalog) };
  const deps: WorkspaceDeps = {
    catalog, images: false, read: () => state.live,
    land: (intents: Intent[]) => { state.live = applyIntents(state.live, intents, catalog).doc; return { ok: true }; },
    compile: async () => ({ ok: true, ms: 1 }),
    render: async () => { const s = new Float32Array(4800).map((_, i) => Math.sin(i / 20) * 0.3); return { report: analyse([s, s], 48000), renderMs: 1 }; },
    look: async doc => ({ issues: checkPlugin(doc, catalog), png: null, width: doc.panel.width, height: doc.panel.height, ms: 1 }),
  };
  return { deps, state };
}

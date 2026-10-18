// Faces and the LLM: the tools and rules teach faces; in one call the model can
// give a part its own face and put it on the plugin (putFace sees the new face);
// a face on something that is not a use is refused with what putFace takes.
import { describe, expect, it } from 'vite-plus/test';
import { LlmWorkspace, type WorkspaceDeps } from '../../../src/ai/llm-workspace.ts';
import { KIT_TOOLS, developerInstructions } from '../../../src/ai/llm-spec.ts';
import { catalog } from '../../../src/blocks/index.ts';
import { faceGroup } from '../../../src/core/face.ts';
import { applyIntents, type Intent } from '../../../src/core/ops.ts';
import { starter } from '../../../src/core/starters.ts';
import { validate } from '../../../src/core/validate.ts';
import { analyse } from '../../../src/core/analysis.ts';
import { checkPlugin } from '../../../src/plugin/checks.ts';

function workspace() {
  const state = { live: applyIntents(starter('bass', catalog), [{ op: 'makePart', ids: ['cut1', 'filter1'], name: 'Tone' }], catalog).doc };
  const deps: WorkspaceDeps = {
    catalog, images: false, read: () => state.live,
    land: (intents: Intent[]) => { state.live = applyIntents(state.live, intents, catalog).doc; return { ok: true }; },
    compile: async () => ({ ok: true, ms: 1 }),
    render: async () => { const s = new Float32Array(4800).map((_, i) => Math.sin(i / 20) * 0.3); return { report: analyse([s, s], 48000), renderMs: 1 }; },
    look: async doc => ({ issues: checkPlugin(doc, catalog), png: null, width: doc.panel.width, height: doc.panel.height, ms: 1 }),
  };
  return { ws: new LlmWorkspace(deps), state };
}

describe('faces and the LLM', () => {
  it('the tools and the rules teach faces', () => {
    const apply = KIT_TOOLS.find(t => t.name === 'kit_apply_ops')!;
    expect(apply.description).toContain('"op":"putFace"');
    expect(apply.description).toMatch(/"face":\{"width"/);
    expect(JSON.stringify(apply.inputSchema)).toContain('putFace');
    expect(developerInstructions('')).toMatch(/A part can have a face/);
    expect(apply.description).toContain('"op":"makeScreenPart"');
    expect(JSON.stringify(apply.inputSchema)).toContain('makeScreenPart');
  });
  it('gives a part its own face and puts it on the plugin in one call; kit_get_patch says so', async () => {
    const { ws, state } = workspace();
    const r = await ws.call('kit_apply_ops', { ops: [
      { op: 'updatePart', part: 'tone', face: { width: 220, height: 140, controls: [{ param: 'resonance', type: 'ui.knob', rect: { x: 12, y: 30, w: 84, h: 96 }, label: 'Peak' }], elements: [{ kind: 'text', text: 'TONE', rect: { x: 12, y: 6, w: 196, h: 20 } }] } },
      { op: 'putFace', node: 'tone1', at: { x: 300, y: 40 } },
    ] });
    expect(r.success).toBe(true);
    const group = state.live.ui.groups[faceGroup('tone1')]!;
    expect(group).toHaveLength(2);
    const knob = group.map(id => state.live.nodes[id]).find(n => n?.type === 'ui.knob')!;
    expect(knob).toMatchObject({ label: 'Peak', panel: { x: 312, y: 70, w: 84, h: 96 } });
    expect(Object.values(state.live.edges).some(e => e.from.node === knob.id && e.to.node === 'tone1' && e.to.port === 'resonance')).toBe(true);
    expect(validate(state.live, catalog).issues.filter(i => i.severity === 'error')).toEqual([]);
    expect((await ws.call('kit_get_patch', {})).text).toMatch(/Face: its own \(1 control, 1 decoration, 220×140\)/);
    // Again: replaced in place, not doubled.
    expect((await ws.call('kit_apply_ops', { ops: [{ op: 'putFace', node: 'tone1' }] })).success).toBe(true);
    expect(Object.values(state.live.nodes).filter(n => n.label === 'Peak')).toHaveLength(1);
  });
  it('makes a screen part of decorations on the plugin (no sound; they become its face), in one call with the decorations', async () => {
    const { ws, state } = workspace();
    const r = await ws.call('kit_apply_ops', { ops: [
      { op: 'addElement', element: { kind: 'shape', id: 'plate1', shape: 'rect', rect: { x: 20, y: 20, w: 200, h: 60 } } },
      { op: 'addElement', element: { kind: 'text', id: 'word1', text: 'NEBULA', rect: { x: 30, y: 30, w: 120, h: 24 } } },
      { op: 'makeScreenPart', ids: ['plate1', 'word1'] },
    ] });
    expect(r.success).toBe(true);
    expect(r.text).toMatch(/nebula1 is the screen part “Nebula” \(part nebula\)/);
    expect(state.live.parts.nebula).toMatchObject({ name: 'Nebula', params: [], face: { width: 200, height: 60, controls: [] } });
    expect(state.live.ui.groups[faceGroup('nebula1')]).toEqual(['plate1', 'word1']);
    expect(validate(state.live, catalog).issues.filter(i => i.severity === 'error')).toEqual([]);
    expect((await ws.call('kit_get_patch', {})).text).toMatch(/Nebula[\s\S]*Face: its own \(0 controls, 2 decorations, 200×60\)/);
    // Nothing that can be on a screen: refused with what it takes.
    const before = state.live;
    const bad = await ws.call('kit_apply_ops', { ops: [{ op: 'makeScreenPart', ids: ['osc1'] }] });
    expect(bad.success).toBe(false);
    expect(bad.text).toMatch(/Select decorations on the plugin[\s\S]*makeScreenPart is/);
    expect(state.live).toBe(before);
  });
  it('a face for something that is not a use, or a face that does not check, is refused; nothing lands', async () => {
    const { ws, state } = workspace();
    const before = state.live;
    const r = await ws.call('kit_apply_ops', { ops: [{ op: 'putFace', node: 'osc1' }] });
    expect(r.success).toBe(false);
    expect(r.text).toMatch(/is not a use of a part[\s\S]*putFace is/);
    const bad = await ws.call('kit_apply_ops', { ops: [{ op: 'updatePart', part: 'tone', face: { width: 100, height: 100, controls: [{ param: 'frequency', type: 'ui.knob', rect: { x: 0, y: 0, w: 84, h: 96 } }], elements: [] } }] });
    expect(bad.success).toBe(false);
    expect(bad.text).toMatch(/not one of its parameters/);
    expect(state.live).toBe(before);
  });
});

// Copies (×N) and the AI: fast-path words set a count on the selection
// ("7本重ねて", "stack 8", "もっと重ねて"), spread its main free knob
// ("ばらつかせて", "detune it") or make the copies the same again; nothing is
// guessed without a selection. The LLM gets setCount / setSpread, the rules for
// copies, sees ×N, the spreads and the estimated load, and never the nodes that
// expansion makes.
import { beforeEach, describe, expect, it } from 'vitest';
import { FastPath } from '../../../src/ai/fast-path.ts';
import { parseRequest, readNumber } from '../../../src/ai/lexicon.ts';
import { LlmWorkspace, type WorkspaceDeps } from '../../../src/ai/llm-workspace.ts';
import { KIT_TOOLS, developerInstructions } from '../../../src/ai/llm-spec.ts';
import { KitSession } from '../../../src/editor/session.ts';
import { catalog } from '../../../src/blocks/index.ts';
import { applyIntents, type Intent } from '../../../src/core/ops.ts';
import { MAX_COUNT } from '../../../src/core/schema.ts';
import { starter } from '../../../src/core/starters.ts';
import { validate } from '../../../src/core/validate.ts';
import { analyse } from '../../../src/core/analysis.ts';
import { checkPlugin } from '../../../src/plugin/checks.ts';
import { stubBridge } from '../../helpers/fake-bridge.ts';
import { scriptedAnswerer } from '../../fakes/jev/scripted.ts';

const makeSession = () => new KitSession({
  storage: null,
  createWorker: () => ({ postMessage() {}, terminate() {}, onmessage: null, onerror: null, onmessageerror: null }) as never,
  engine: { setParam() {}, unload() {}, running: false } as never,
});

describe('the words', () => {
  it.each([
    ['7本重ねて', 7], ['8個並べて', 8], ['十六本重ねて', 16], ['三十二個に増やして', 32], ['×32にして', 32], ['x8', 8], ['５つ重ねて', 5],
    ['stack 7', 7], ['stack it 12 times', 12], ['16 copies', 16], ['layer it 3 deep', 3],
    ['重ねるのをやめて', 1], ['一本に戻して', 1], ['unstack it', 1],
  ])('%s → ×%i', (text, count) => {
    const lex = parseRequest(text);
    expect(lex.items).toEqual([expect.objectContaining({ kind: 'stack', count })]);
    expect(lex.full).toBe(true);
  });
  it.each([
    ['もっと重ねて', { more: true }], ['more copies', { more: true }],
    ['ばらつかせて', { spread: 'more' }], ['デチューンして', { spread: 'more' }], ['detune it', { spread: 'more' }], ['spread them out', { spread: 'more' }],
    ['ばらつきを減らして', { spread: 'less' }], ['less detune', { spread: 'less' }],
    ['ばらつきをなくして', { spread: 'off' }], ['no spread', { spread: 'off' }],
  ])('%s', (text, item) => {
    const lex = parseRequest(text);
    expect(lex.items).toEqual([expect.objectContaining({ kind: 'stack', ...item })]);
  });
  it('numbers in kanji', () => {
    expect([readNumber('七'), readNumber('十'), readNumber('十六'), readNumber('三十二'), readNumber('百二十八'), readNumber('64'), readNumber('x')]).toEqual([7, 10, 16, 32, 128, 64, undefined]);
  });
  it('other requests are not about copies', () => {
    for (const text of ['リリース長く', 'リバーブを足して', 'more bass', 'mix 2', '2倍にして', '音量を3dB増やして', 'リリースを2秒に増やして', 'max out the cutoff', 'xy pad']) {
      expect(parseRequest(text).items.some(i => i.kind === 'stack'), text).toBe(false);
    }
  });
});

describe('the fast path with copies', () => {
  let session: KitSession, fast: FastPath;
  beforeEach(() => {
    session = makeSession();
    session.loadStarter('bass');
    session.bridge = stubBridge(scriptedAnswerer({}), 'off').bridge;
    fast = new FastPath(session);
  });
  it('「8本重ねて」 stacks the selection (one ⌘Z takes it back); without one, or on something that cannot be stacked, it says what to do', async () => {
    const before = session.doc.value;
    const none = await fast.run('8本重ねて');
    expect(none.status).toBe('nothing');
    expect(none.message).toMatch(/Select the module or part to stack/);
    session.select(['voice1']);
    const voice = await fast.run('8本重ねて');
    expect(voice.status).toBe('nothing');
    expect(voice.message).toMatch(/cannot run as copies/);
    session.select(['osc1']);
    const stacked = await fast.run('8本重ねて');
    expect(stacked.status).toBe('applied');
    expect(session.doc.value.nodes.osc1!.count).toBe(8);
    const more = await fast.run('もっと重ねて');
    expect(more.status).toBe('applied');
    expect(session.doc.value.nodes.osc1!.count).toBe(16);
    const huge = await fast.run('stack 500');
    expect(huge.status).toBe('applied');
    expect(session.doc.value.nodes.osc1!.count).toBe(MAX_COUNT);
    const one = await fast.run('重ねるのをやめて');
    expect(one.status).toBe('applied');
    expect(session.doc.value.nodes.osc1!.count).toBeUndefined();
    for (let i = 0; i < 4; i++) session.undo();
    expect({ ...session.doc.value, revision: 0 }).toEqual({ ...before, revision: 0 });
  });
  it('「4本重ねてばらつかせて」 stacks and spreads the main free knob; more and less scale the spread, and it can be taken away', async () => {
    session.select(['filter1']);
    const r = await fast.run('4本重ねてばらつかせて');
    expect(r.status).toBe('applied');
    const node = () => session.doc.value.nodes.filter1!;
    expect(node().count).toBe(4);
    // The cutoff comes from a cable, so the free knob is the resonance.
    expect(Object.keys(node().spread ?? {})).toEqual(['resonance']);
    const first = node().spread!.resonance!.amount!;
    expect(first).toBeGreaterThan(0);
    await fast.run('もっとばらつかせて');
    expect(node().spread!.resonance!.amount!).toBeCloseTo(first * 1.6, 2);
    await fast.run('ばらつきを減らして');
    expect(node().spread!.resonance!.amount!).toBeLessThan(first * 1.6);
    await fast.run('ばらつきをなくして');
    expect(node().spread).toBeUndefined();
    const nothing = await fast.run('ばらつきを減らして');
    expect(nothing.status).toBe('nothing');
  });
  it('spreading a single module asks to stack it first', async () => {
    session.select(['filter1']);
    const r = await fast.run('ばらつかせて');
    expect(r.status).toBe('nothing');
    expect(r.message).toMatch(/stack it first/);
  });
  it('「パーツにして8本重ねて」 makes a part of the selection and stacks the new part', async () => {
    session.select(['osc1', 'filter1']);
    const r = await fast.run('パーツにして8本重ねて');
    expect(r.status).toBe('applied');
    const use = Object.values(session.doc.value.nodes).find(n => n.type === 'kit.part')!;
    expect(use.count).toBe(8);
    expect(validate(session.doc.value, catalog).issues.filter(i => i.severity === 'error')).toEqual([]);
  });
});

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

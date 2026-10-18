// ×N: a node (or a part) running as several copies side by side. Expansion
// makes the copies, joins thick and thin cables by the rules (1:1, to every copy,
// summed ×1/√N into one), spreads knob values, gives random modules their own
// seeds, and keeps knobs that are the same in every copy one AudioParam.
import { describe, expect, it } from 'vite-plus/test';
import { catalog } from '../../../src/blocks/index.ts';
import { currentValues, generate } from '../../../src/core/codegen.ts';
import { describePatch } from '../../../src/core/describe.ts';
import { applyIntents, applyResolvedOps, invertAll, isStructural, OpError, type Intent, type ResolvedOp } from '../../../src/core/ops.ts';
import { expandedId, flatten, MAX_EXPANDED } from '../../../src/core/parts.ts';
import { documentHash, parseDocument, serializeDocument } from '../../../src/core/persistence.ts';
import { emptyDocument, MAX_COUNT, type PatchDocument } from '../../../src/core/schema.ts';
import { checkSpread, describeSpread, position, random01, spreadValue, stackable } from '../../../src/core/stacks.ts';
import { validate } from '../../../src/core/validate.ts';

const apply = (doc: PatchDocument, ...intents: Intent[]) => applyIntents(doc, intents, catalog);
const failure = (fn: () => unknown): OpError => { try { fn(); } catch (error) { if (error instanceof OpError) return error; throw error; } throw new Error('expected an OpError'); };
const same = (a: PatchDocument, b: PatchDocument) => expect({ ...a, revision: 0 }).toEqual({ ...b, revision: 0 });
function undoes(before: PatchDocument, r: { doc: PatchDocument; ops: ResolvedOp[] }) { same(applyResolvedOps(r.doc, invertAll(r.ops)), before); }
const edgesOf = (doc: PatchDocument) => Object.values(doc.edges).map(e => `${e.from.node}.${e.from.port}>${e.to.node}.${e.to.port}`).sort();
const port = (type: string, id: string) => catalog.input({ id: 'x', type, pos: { x: 0, y: 0 }, config: {}, values: {} }, id)!;

/** Noise → band-pass → Out; the noise and the filter run as `n` copies. */
function rain(n = 4) {
  return apply(emptyDocument('rain'),
    { op: 'addNode', node: { id: 'noise1', type: 'den.seededNoise', count: n } },
    { op: 'addNode', node: { id: 'svf1', type: 'den.stateVariableFilter', count: n, values: { cutoffHz: 1000, q: 4 } } },
    { op: 'addNode', node: { id: 'out1', type: 'kit.out' } },
    { op: 'connect', from: { node: 'noise1', port: 'out' }, to: { node: 'svf1', port: 'input' } },
    { op: 'connect', from: { node: 'svf1', port: 'bandpass' }, to: { node: 'out1', port: 'left' } },
  ).doc;
}

describe('the rules of a stack', () => {
  it('what can run as copies: modules, math, codeboxes, History, parts and the copy number; not IO, controls or Splay', () => {
    for (const type of ['den.oscillator', 'kit.mul', 'kit.codebox', 'kit.history', 'kit.part', 'kit.copy']) expect(stackable(catalog, type), type).toBe(true);
    for (const type of ['kit.voiceIn', 'kit.voiceMix', 'kit.out', 'kit.audioIn', 'ui.knob', 'kit.comment', 'kit.splay', 'kit.stackSum', 'kit.partIn', 'nope.missing']) expect(stackable(catalog, type), type).toBe(false);
  });
  it('spreads: range evenly around the knob, random fixed by the seed, harmonic multiples, each its own; octaves on a frequency knob; always in range', () => {
    const q = port('den.stateVariableFilter', 'q'), cutoff = port('den.stateVariableFilter', 'cutoffHz');
    expect([0, 1, 2].map(k => position(k, 3))).toEqual([-1, 0, 1]);
    expect(position(0, 1)).toBe(0);
    expect([0, 1, 2].map(k => spreadValue(4, { kind: 'range', amount: 2 }, k, 3, q))).toEqual([2, 4, 6]);
    expect([0, 1].map(k => spreadValue(1000, { kind: 'range', amount: 1 }, k, 2, cutoff))).toEqual([500, 2000]);
    expect([0, 1, 2].map(k => spreadValue(200, { kind: 'harmonic' }, k, 3, cutoff))).toEqual([200, 400, 600]);
    expect([0, 1, 2].map(k => spreadValue(4, { kind: 'each', values: [1, 9] }, k, 3, q))).toEqual([1, 9, 4]);
    // Clamped to what the knob accepts.
    expect(spreadValue(9, { kind: 'range', amount: 5 }, 1, 2, q)).toBe(10);
    expect(spreadValue(20000, { kind: 'harmonic' }, 3, 4, cutoff)).toBe(21600);
    // Random: the same every time for a seed, another seed gives other values, more copies keep the earlier ones.
    const r = (seed: number, n: number) => Array.from({ length: n }, (_, k) => spreadValue(4, { kind: 'random', amount: 3, seed }, k, n, q));
    expect(r(1, 4)).toEqual(r(1, 4));
    expect(r(2, 4)).not.toEqual(r(1, 4));
    expect(r(1, 8).slice(0, 4)).toEqual(r(1, 4));
    for (const v of r(7, 64)) expect(v >= 1 && v <= 7).toBe(true);
    for (let k = 0; k < 200; k++) { const x = random01(k, [k]); expect(x >= 0 && x < 1).toBe(true); }
  });
  it('a spread is checked: unknown kinds, bad numbers and too many values are refused; amounts and values are pulled into range', () => {
    const q = port('den.stateVariableFilter', 'q'), cutoff = port('den.stateVariableFilter', 'cutoffHz');
    expect(checkSpread(null, q)).toMatch(/kind/);
    expect(checkSpread({ kind: 'sideways' }, q)).toMatch(/kind must be one of/);
    expect(checkSpread({ kind: 'range', amount: Number.NaN }, q)).toMatch(/finite/);
    expect(checkSpread({ kind: 'random', amount: 1, seed: 1.5 }, q)).toMatch(/seed/);
    expect(checkSpread({ kind: 'each', values: [1, 'x'] }, q)).toMatch(/finite/);
    expect(checkSpread({ kind: 'each', values: new Array(MAX_COUNT + 1).fill(1) }, q)).toMatch(/up to/);
    expect(checkSpread({ kind: 'range', amount: 99 }, cutoff)).toEqual({ kind: 'range', amount: 10 });
    expect(checkSpread({ kind: 'each', values: [0, 50] }, q)).toEqual({ kind: 'each', values: [0.5, 10] });
    expect(checkSpread({ kind: 'random' }, q)).toEqual({ kind: 'random', amount: 0, seed: 1 });
    expect(describeSpread({ kind: 'range', amount: 0.5 }, cutoff)).toBe('range ±0.5 oct');
  });
});

describe('expanding copies', () => {
  it('makes n copies (id_k), joins thick to thick one to one, and sums a thick cable into a thin input ×1/√n', () => {
    const flat = flatten(rain(3), catalog);
    expect(Object.keys(flat.doc.nodes).sort()).toEqual(['noise1_0', 'noise1_1', 'noise1_2', 'out1', 'svf1_0', 'svf1_1', 'svf1_2', 'svf1_bandpass$sum']);
    expect(edgesOf(flat.doc)).toEqual([
      'noise1_0.out>svf1_0.input', 'noise1_1.out>svf1_1.input', 'noise1_2.out>svf1_2.input',
      'svf1_0.bandpass>svf1_bandpass$sum.in0', 'svf1_1.bandpass>svf1_bandpass$sum.in1', 'svf1_2.bandpass>svf1_bandpass$sum.in2',
      'svf1_bandpass$sum.out>out1.left',
    ]);
    expect(flat.doc.nodes['svf1_bandpass$sum']!).toMatchObject({ type: 'kit.stackSum', config: { n: 3 } });
    expect(flat.origin.svf1_2).toEqual(['svf1']);
    const g = generate(rain(3), catalog);
    expect(g.issues.filter(i => i.severity === 'error')).toEqual([]);
    expect(g.source).toContain(`.mul(f32(${1 / Math.sqrt(3)}))`);
  });
  it('a thin cable goes to every copy', () => {
    const doc = apply(emptyDocument('thin'),
      { op: 'addNode', node: { id: 'lfo1', type: 'den.lfo' } },
      { op: 'addNode', node: { id: 'osc1', type: 'den.oscillator', count: 3 } },
      { op: 'addNode', node: { id: 'cut1', type: 'kit.cutoffMod', count: 3 } },
      { op: 'addNode', node: { id: 'out1', type: 'kit.out' } },
      { op: 'connect', from: { node: 'lfo1', port: 'out' }, to: { node: 'cut1', port: 'octaves' } },
      { op: 'connect', from: { node: 'cut1', port: 'out' }, to: { node: 'osc1', port: 'frequency' } },
      { op: 'connect', from: { node: 'osc1', port: 'out' }, to: { node: 'out1', port: 'left' } },
    ).doc;
    const flat = flatten(doc, catalog).doc;
    expect(edgesOf(flat).filter(e => e.startsWith('lfo1'))).toEqual(['lfo1.out>cut1_0.octaves', 'lfo1.out>cut1_1.octaves', 'lfo1.out>cut1_2.octaves']);
    expect(edgesOf(flat).filter(e => e.startsWith('cut1'))).toEqual(['cut1_0.out>osc1_0.frequency', 'cut1_1.out>osc1_1.frequency', 'cut1_2.out>osc1_2.frequency']);
  });
  it('different counts on both sides: copy k takes copy k mod n, with a warning', () => {
    const doc = apply(rain(4), { op: 'setCount', node: 'noise1', count: 3 }).doc;
    const v = validate(doc, catalog);
    expect(v.issues.find(i => i.code === 'stack-mismatch')).toMatchObject({ severity: 'warning', node: 'svf1', port: 'input' });
    expect(edgesOf(v.flat.doc).filter(e => e.startsWith('noise1'))).toEqual(['noise1_0.out>svf1_0.input', 'noise1_0.out>svf1_3.input', 'noise1_1.out>svf1_1.input', 'noise1_2.out>svf1_2.input']);
  });
  it('copies of a random module get their own seeds (the same every time); single nodes keep theirs', () => {
    const seeds = (doc: PatchDocument) => Object.values(flatten(doc, catalog).doc.nodes).filter(n => n.type === 'den.seededNoise').map(n => n.config.seed);
    const a = seeds(rain(4));
    expect(new Set(a).size).toBe(4);
    expect(seeds(rain(4))).toEqual(a);
    for (const s of a) expect(Number.isInteger(s) && (s as number) >= 1 && (s as number) <= 2147483646).toBe(true);
    const single = apply(rain(4), { op: 'setCount', node: 'noise1', count: 1 }, { op: 'setCount', node: 'svf1', count: 1 }).doc;
    expect(flatten(single, catalog).expanded).toBe(false);
    expect(single.nodes.noise1!.config.seed).toBe(1);
  });
  it('knobs that are the same in every copy are one AudioParam; a spread knob is one per copy, and turning either reaches every copy without recompiling', () => {
    const doc = apply(rain(4), { op: 'setSpread', node: 'svf1', port: 'cutoffHz', spread: { kind: 'range', amount: 1 } }).doc;
    const g = generate(doc, catalog);
    const names = g.params.map(p => p.name).sort();
    expect(names).toEqual(['svf1_0_cutoffHz', 'svf1_1_cutoffHz', 'svf1_2_cutoffHz', 'svf1_3_cutoffHz', 'svf1_q']);
    expect([0, 1, 2, 3].map(k => Math.round(g.values[`svf1_${k}_cutoffHz`]!))).toEqual([500, 794, 1260, 2000]);
    expect(g.values.svf1_q).toBe(4);
    // The knob's own value is the centre: turning it moves every copy.
    const turned = apply(doc, { op: 'setValue', node: 'svf1', port: 'cutoffHz', value: 2000 }, { op: 'setValue', node: 'svf1', port: 'q', value: 2 });
    expect(turned.ops.some(isStructural)).toBe(false);
    expect(generate(turned.doc, catalog).hash).toBe(g.hash);
    const sent = currentValues(turned.doc, catalog, g);
    expect([0, 1, 2, 3].map(k => Math.round(sent[`svf1_${k}_cutoffHz`]!))).toEqual([1000, 1587, 2520, 4000]);
    expect(sent.svf1_q).toBe(2);
    // How it spreads (amount, kind, seed, values) is values too; which knobs spread is not.
    for (const spread of [{ kind: 'range' as const, amount: 2 }, { kind: 'random' as const, amount: 1, seed: 3 }, { kind: 'harmonic' as const }, { kind: 'each' as const, values: [100, 200] }]) {
      const r = apply(doc, { op: 'setSpread', node: 'svf1', port: 'cutoffHz', spread });
      expect(r.ops.some(isStructural), spread.kind).toBe(false);
      expect(generate(r.doc, catalog).hash).toBe(g.hash);
    }
    expect(currentValues(apply(doc, { op: 'setSpread', node: 'svf1', port: 'cutoffHz', spread: { kind: 'each', values: [100, 200] } }).doc, catalog, g)).toMatchObject({ svf1_0_cutoffHz: 100, svf1_1_cutoffHz: 200, svf1_2_cutoffHz: 1000, svf1_3_cutoffHz: 1000 });
    expect(apply(doc, { op: 'setSpread', node: 'svf1', port: 'q', spread: { kind: 'range', amount: 1 } }).ops.some(isStructural)).toBe(true);
    expect(apply(doc, { op: 'setSpread', node: 'svf1', port: 'cutoffHz', spread: null }).ops.some(isStructural)).toBe(true);
    expect(apply(doc, { op: 'setCount', node: 'svf1', count: 5 }).ops.some(isStructural)).toBe(true);
  });
  it('a cable into a spread knob: each copy gets what the cable brings, moved by the spread (×2^oct on a log knob, + on others), live', () => {
    const doc = apply(rain(4),
      { op: 'addNode', node: { id: 'k1', type: 'ui.knob', panel: { x: 0, y: 0, w: 84, h: 96 }, config: { min: 100, max: 8000, scale: 'log', unit: 'Hz' }, values: { value: 1000 } } },
      { op: 'addNode', node: { id: 'k2', type: 'ui.knob', panel: { x: 90, y: 0, w: 84, h: 96 }, config: { min: 0.5, max: 10, scale: 'linear', unit: '' }, values: { value: 2 } } },
      { op: 'connect', from: { node: 'k1', port: 'out' }, to: { node: 'svf1', port: 'cutoffHz' } },
      { op: 'connect', from: { node: 'k2', port: 'out' }, to: { node: 'svf1', port: 'q' } },
      { op: 'setSpread', node: 'svf1', port: 'cutoffHz', spread: { kind: 'range', amount: 1 } },
      { op: 'setSpread', node: 'svf1', port: 'q', spread: { kind: 'range', amount: 0.6 } },
    ).doc;
    const flat = flatten(doc, catalog).doc;
    const into = (k: number, port: string) => Object.values(flat.edges).find(e => e.to.node === `svf1_${k}` && e.to.port === port)!.from.node;
    const shape = (k: number, port: string) => flat.nodes[into(k, port)]!;
    // Copy 0 sits an octave below the knob, copy 3 an octave above; q from −0.6 to +0.6.
    expect(shape(0, 'cutoffHz')).toMatchObject({ type: 'kit.scale', values: { scale: 0.5, offset: 0 } });
    expect(shape(3, 'cutoffHz').values).toEqual({ scale: 2, offset: 0 });
    expect(shape(0, 'q').values).toEqual({ scale: 1, offset: -0.6 });
    expect(shape(3, 'q').values.offset).toBeCloseTo(0.6, 9);
    for (let k = 0; k < 4; k++) expect(Object.values(flat.edges).some(e => e.from.node === 'k1' && e.to.node === into(k, 'cutoffHz'))).toBe(true);
    // The amounts are AudioParams: a new amount plays without recompiling.
    const g = generate(doc, catalog);
    const wider = apply(doc, { op: 'setSpread', node: 'svf1', port: 'cutoffHz', spread: { kind: 'range', amount: 2 } });
    expect(wider.ops.some(isStructural)).toBe(false);
    const next = currentValues(wider.doc, catalog, g);
    expect(next[`${into(3, 'cutoffHz')}_scale`]).toBe(4);
    expect(generate(wider.doc, catalog).hash).toBe(g.hash);
  });
  it('harmonics multiply what comes in; drawn values keep their distance from the knob\'s own value; a spread on a wired part parameter moves each copy inside', () => {
    const doc = apply(rain(3),
      { op: 'addNode', node: { id: 'k1', type: 'ui.knob', panel: { x: 0, y: 0, w: 84, h: 96 }, config: { min: 100, max: 8000, scale: 'log', unit: 'Hz' }, values: { value: 500 } } },
      { op: 'connect', from: { node: 'k1', port: 'out' }, to: { node: 'svf1', port: 'cutoffHz' } },
      { op: 'setSpread', node: 'svf1', port: 'cutoffHz', spread: { kind: 'harmonic' } },
    ).doc;
    const flat = flatten(doc, catalog).doc;
    const scaleOf = (d: PatchDocument, k: number, node = 'svf1', port = 'cutoffHz') => d.nodes[Object.values(d.edges).find(e => e.to.node === `${node}_${k}` && e.to.port === port)!.from.node]!.values;
    expect([0, 1, 2].map(k => scaleOf(flat, k).scale)).toEqual([1, 2, 3]);
    const drawn = flatten(apply(doc, { op: 'setSpread', node: 'svf1', port: 'cutoffHz', spread: { kind: 'each', values: [1000, 2000, 4000] } }).doc, catalog).doc; // the knob's own value is 1000
    expect([0, 1, 2].map(k => scaleOf(drawn, k).scale)).toEqual([1, 2, 4]);
    // A part ×3 whose parameter takes a knob: the spread moves what reaches each copy's knob inside.
    const part = apply(emptyDocument('p'),
      { op: 'addNode', node: { id: 'lfo1', type: 'den.lfo' } }, { op: 'addNode', node: { id: 'out1', type: 'kit.out' } },
      { op: 'connect', from: { node: 'lfo1', port: 'out' }, to: { node: 'out1', port: 'left' } },
      { op: 'makePart', ids: ['lfo1'], name: 'Wob', id: 'wob', node: 'wob1' },
    ).doc;
    const wired = apply(part,
      { op: 'setCount', node: 'wob1', count: 3 },
      { op: 'addNode', node: { id: 'k9', type: 'ui.knob', panel: { x: 0, y: 0, w: 84, h: 96 }, config: { min: 0.1, max: 20, scale: 'log', unit: 'Hz' }, values: { value: 2 } } },
      { op: 'connect', from: { node: 'k9', port: 'out' }, to: { node: 'wob1', port: 'rate' } },
      { op: 'setSpread', node: 'wob1', port: 'rate', spread: { kind: 'range', amount: 1 } },
    ).doc;
    const f = flatten(wired, catalog).doc;
    const rateInto = (k: number) => Object.values(f.edges).find(e => e.to.node === `wob1_${k}_lfo1` && e.to.port === 'rate')!.from.node;
    expect([0, 1, 2].map(k => f.nodes[rateInto(k)]!.values.scale)).toEqual([0.5, 1, 2]);
    expect(validate(wired, catalog).issues.filter(i => i.severity === 'error')).toEqual([]);
  });
  it('a gate from copies into a single input is on while any copy is; into Voice Mix done, when all of them are', () => {
    const doc = apply(emptyDocument('gates'),
      { op: 'addNode', node: { id: 'voice1', type: 'kit.voiceIn' } },
      { op: 'addNode', node: { id: 'env1', type: 'den.envelope', count: 3 } },
      { op: 'addNode', node: { id: 'osc1', type: 'den.oscillator' } },
      { op: 'addNode', node: { id: 'vca1', type: 'kit.mul' } },
      { op: 'addNode', node: { id: 'mix1', type: 'kit.voiceMix' } },
      { op: 'addNode', node: { id: 'out1', type: 'kit.out' } },
      { op: 'connect', from: { node: 'voice1', port: 'pitch' }, to: { node: 'osc1', port: 'frequency' } },
      { op: 'connect', from: { node: 'osc1', port: 'out' }, to: { node: 'vca1', port: 'a' } },
      { op: 'connect', from: { node: 'env1', port: 'level' }, to: { node: 'vca1', port: 'b' } },
      { op: 'connect', from: { node: 'vca1', port: 'out' }, to: { node: 'mix1', port: 'in' } },
      { op: 'connect', from: { node: 'env1', port: 'done' }, to: { node: 'mix1', port: 'done' } },
      { op: 'connect', from: { node: 'mix1', port: 'out' }, to: { node: 'out1', port: 'left' } },
    ).doc;
    const flat = flatten(doc, catalog).doc;
    expect(flat.nodes['env1_done$all']).toMatchObject({ type: 'kit.stackGate', config: { n: 3, mode: 'all' } });
    expect(flat.nodes['env1_level$sum']).toMatchObject({ type: 'kit.stackSum' });
    const g = generate(doc, catalog);
    expect(g.issues.filter(i => i.severity === 'error')).toEqual([]);
    expect(g.source).toMatch(/\.and\(/);
  });
  it('Splay takes every copy of a thick cable (a thin one sits in the middle)', () => {
    const doc = apply(rain(5),
      { op: 'addNode', node: { id: 'splay1', type: 'kit.splay' } },
      { op: 'connect', from: { node: 'svf1', port: 'bandpass' }, to: { node: 'splay1', port: 'in' } },
      { op: 'connect', from: { node: 'splay1', port: 'left' }, to: { node: 'out1', port: 'left' }, replace: true },
      { op: 'connect', from: { node: 'splay1', port: 'right' }, to: { node: 'out1', port: 'right' } },
    ).doc;
    const flat = flatten(doc, catalog).doc;
    expect(flat.nodes.splay1).toMatchObject({ type: 'kit.splayN', config: { n: 5 } });
    expect(edgesOf(flat).filter(e => e.includes('splay1.in'))).toHaveLength(5);
    const g = generate(doc, catalog);
    expect(g.issues.filter(i => i.severity === 'error')).toEqual([]);
    expect(g.params.map(p => p.name)).toContain('splay1_width');
    // A thin cable: Splay is a centred pan (no expansion needed).
    const thin = apply(doc, { op: 'setCount', node: 'svf1', count: 1 }, { op: 'setCount', node: 'noise1', count: 1 }).doc;
    expect(flatten(thin, catalog).expanded).toBe(false);
    expect(generate(thin, catalog).source).toContain(`mul(f32(${Math.SQRT1_2}))`);
  });
  it('Copy number reads each copy\'s place: inside a stacked part, in a stack of its own, or 0 of 1 alone', () => {
    const base = apply(emptyDocument('copies'),
      { op: 'addNode', node: { id: 'copy1', type: 'kit.copy', count: 3 } },
      { op: 'addNode', node: { id: 'osc1', type: 'den.oscillator', count: 3 } },
      { op: 'addNode', node: { id: 'scale1', type: 'kit.scale', count: 3, values: { scale: 100, offset: 200 } } },
      { op: 'addNode', node: { id: 'out1', type: 'kit.out' } },
      { op: 'connect', from: { node: 'copy1', port: 'index' }, to: { node: 'scale1', port: 'in' } },
      { op: 'connect', from: { node: 'scale1', port: 'out' }, to: { node: 'osc1', port: 'frequency' } },
      { op: 'connect', from: { node: 'osc1', port: 'out' }, to: { node: 'out1', port: 'left' } },
    ).doc;
    const flat = flatten(base, catalog).doc;
    expect([0, 1, 2].map(k => flat.nodes[`copy1_${k}`]!.config)).toEqual([0, 1, 2].map(k => ({ index: k, count: 3, position: k - 1, random: expect.any(Number) })));
    expect(new Set([0, 1, 2].map(k => flat.nodes[`copy1_${k}`]!.config.random)).size).toBe(3);
    // In a part used ×4 the copy number is the use's.
    const parted = apply(apply(base, { op: 'setCount', node: 'copy1', count: 1 }, { op: 'setCount', node: 'osc1', count: 1 }, { op: 'setCount', node: 'scale1', count: 1 }).doc, { op: 'makePart', ids: ['copy1', 'scale1', 'osc1'], name: 'Partial' });
    const doc = apply(parted.doc, { op: 'setCount', node: parted.created[0]!, count: 4 }).doc;
    const use = parted.created[0]!;
    const inner = flatten(doc, catalog).doc;
    expect([0, 1, 2, 3].map(k => inner.nodes[`${use}_${k}_copy1`]!.config.index)).toEqual([0, 1, 2, 3]);
    expect(inner.nodes[`${use}_0_copy1`]!.type).toBe('kit.copyConst');
    expect(generate(doc, catalog).issues.filter(i => i.severity === 'error')).toEqual([]);
    // Alone: its own prim, index 0 of 1.
    expect(generate(apply(base, { op: 'setCount', node: 'copy1', count: 1 }, { op: 'setCount', node: 'osc1', count: 1 }, { op: 'setCount', node: 'scale1', count: 1 }).doc, catalog).source).toMatch(/index: f32\(0\), count: f32\(1\)/);
  });
});

describe('parts as copies', () => {
  /** A drop (noise → band-pass, its cutoff a parameter) used ×4 into Out. */
  function drops(n = 4) {
    const made = apply(apply(rain(1), { op: 'setCount', node: 'noise1', count: 1 }, { op: 'setCount', node: 'svf1', count: 1 }).doc, { op: 'makePart', ids: ['noise1', 'svf1'], name: 'Drop' });
    const use = made.created[0]!;
    return { doc: apply(made.doc, { op: 'setCount', node: use, count: n }).doc, use };
  }
  it('a part used ×n expands each copy inside (use_k_node), its outputs make a thick cable, and a spread parameter differs per copy', () => {
    const { doc, use } = drops(4);
    const param = doc.parts.drop!.params.find(p => p.port === 'cutoffHz')!.id;
    const spread = apply(doc, { op: 'setSpread', node: use, port: param, spread: { kind: 'range', amount: 1 } }).doc;
    const flat = flatten(spread, catalog);
    expect(Object.keys(flat.doc.nodes).filter(id => id.startsWith(`${use}_`)).sort()).toEqual([0, 1, 2, 3].flatMap(k => [`${use}_${k}_noise1`, `${use}_${k}_svf1`]).concat(`${use}_bandpass$sum`).sort());
    expect(flat.origin[`${use}_2_svf1`]).toEqual([use, 'svf1']);
    const g = generate(spread, catalog);
    expect(g.issues.filter(i => i.severity === 'error')).toEqual([]);
    expect([0, 1, 2, 3].map(k => Math.round(g.values[`${use}_${k}_svf1_cutoffHz`]!))).toEqual([500, 794, 1260, 2000]);
    // q (a parameter too) is not spread: one AudioParam named as if there were one copy.
    expect(g.params.filter(p => p.port === 'q').map(p => p.name)).toEqual([`${use}_svf1_q`]);
    // Turning the use's parameters moves every copy (the spread one around its new centre).
    const sent = currentValues(apply(spread, { op: 'setValue', node: use, port: param, value: 2000 }, { op: 'setValue', node: use, port: 'q', value: 8 }).doc, catalog, g);
    expect(Math.round(sent[`${use}_0_svf1_cutoffHz`]!)).toBe(1000);
    expect(sent[`${use}_svf1_q`]).toBe(8);
    // The view from inside the first copy, for the patch view.
    expect(expandedId(spread, [use], 'svf1', catalog)).toBe(`${use}_0_svf1`);
  });
  it('hearing a stacked part alone sums its copies', () => {
    const { doc, use } = drops(3);
    const flat = flatten(doc, catalog, { solo: [use] }).doc;
    expect(flat.nodes.soloLSum).toMatchObject({ type: 'kit.stackSum', config: { n: 3 } });
    expect(edgesOf(flat).filter(e => e.endsWith('>out1.left'))).toEqual(['soloLSum.out>out1.left']);
    expect(generate(doc, catalog, { solo: [use] }).issues.filter(i => i.severity === 'error')).toEqual([]);
  });
  it('a stacked use cannot be unpacked until it is ×1; detaching keeps its count', () => {
    const { doc, use } = drops(3);
    expect(failure(() => apply(doc, { op: 'unpackPart', node: use })).code).toBe('stacked');
    const second = apply(doc, { op: 'addNode', node: { type: 'kit.part', part: 'drop' } }).doc;
    const detached = apply(second, { op: 'detachPart', node: use }).doc;
    expect(detached.nodes[use]!.count).toBe(3);
  });
  it('a parameter that goes away takes its spread with it', () => {
    const { doc, use } = drops(3);
    const param = doc.parts.drop!.params.find(p => p.port === 'cutoffHz')!.id;
    const spread = apply(doc, { op: 'setSpread', node: use, port: param, spread: { kind: 'random', amount: 1 } }).doc;
    const r = apply(spread, { op: 'removeParam', part: 'drop', id: param });
    expect(r.doc.nodes[use]!.spread).toBeUndefined();
    undoes(spread, r);
  });
});

describe('edits', () => {
  it('setCount and setSpread undo exactly; ×1 removes the count; a spread stays (unused) at ×1', () => {
    const before = rain(4);
    const r = apply(before, { op: 'setCount', node: 'svf1', count: 8 }, { op: 'setSpread', node: 'svf1', port: 'q', spread: { kind: 'harmonic' } });
    expect(r.doc.nodes.svf1).toMatchObject({ count: 8, spread: { q: { kind: 'harmonic' } } });
    undoes(before, r);
    const one = apply(r.doc, { op: 'setCount', node: 'svf1', count: 1 }).doc;
    expect(one.nodes.svf1!.count).toBeUndefined();
    expect(one.nodes.svf1!.spread).toEqual({ q: { kind: 'harmonic' } });
    expect(apply(one, { op: 'setCount', node: 'svf1', count: 1 }).ops).toEqual([]);
  });
  it('refuses what cannot be: copies of Out or a control, a count out of range, a spread on an audio input or a gate, a broken spread', () => {
    const doc = apply(rain(2), { op: 'addNode', node: { id: 'knob1', type: 'ui.knob' } }).doc;
    expect(failure(() => apply(doc, { op: 'setCount', node: 'out1', count: 2 })).code).toBe('not-stackable');
    expect(failure(() => apply(doc, { op: 'setCount', node: 'knob1', count: 2 })).code).toBe('not-stackable');
    for (const count of [0, -1, 1.5, MAX_COUNT + 1, Number.NaN]) expect(failure(() => apply(doc, { op: 'setCount', node: 'svf1', count })).code, String(count)).toBe('bad-value');
    expect(failure(() => apply(doc, { op: 'setCount', node: 'ghost', count: 2 })).code).toBe('unknown-node');
    expect(failure(() => apply(doc, { op: 'setSpread', node: 'svf1', port: 'input', spread: { kind: 'range', amount: 1 } })).code).toBe('not-spreadable');
    expect(failure(() => apply(doc, { op: 'setSpread', node: 'svf1', port: 'reset', spread: { kind: 'range', amount: 1 } })).code).toBe('not-spreadable');
    expect(failure(() => apply(doc, { op: 'setSpread', node: 'svf1', port: 'nope', spread: { kind: 'range', amount: 1 } })).code).toBe('unknown-port');
    expect(failure(() => apply(doc, { op: 'setSpread', node: 'svf1', port: 'q', spread: { kind: 'wobble' } as never })).code).toBe('bad-spread');
    expect(failure(() => apply(doc, { op: 'setSpread', node: 'out1', port: 'left', spread: { kind: 'range' } })).code).toBe('not-stackable');
    expect(failure(() => apply(doc, { op: 'addNode', node: { type: 'kit.voiceMix', count: 2 } })).code).toBe('not-stackable');
    expect(failure(() => apply(doc, { op: 'addNode', node: { type: 'den.oscillator', spread: { frequency: { kind: 'range', amount: 'x' } } as never } })).code).toBe('bad-spread');
    expect(failure(() => apply(doc, { op: 'addNode', node: { type: 'den.oscillator', spread: [] as never } })).code).toBe('bad-spread');
    // A failed edit leaves the patch as it was.
    expect(doc.nodes.svf1!.count).toBe(2);
  });
  it('a config change that removes a knob drops its spread', () => {
    const doc = apply(emptyDocument('mix'), { op: 'addNode', node: { id: 'mix1', type: 'kit.mix', count: 2, config: { channels: 4 } } }, { op: 'setSpread', node: 'mix1', port: 'level4', spread: { kind: 'range', amount: 0.5 } }).doc;
    const r = apply(doc, { op: 'setConfig', node: 'mix1', key: 'channels', value: 2 });
    expect(r.doc.nodes.mix1!.spread).toBeUndefined();
    undoes(doc, r);
  });
});

describe('weight instead of a node count', () => {
  it('the cost is estimated from what the patch expands into; heavy patches warn, ones too big to build are refused', () => {
    const light = validate(rain(4), catalog);
    expect(light.cost.cpu).toBeGreaterThan(0);
    expect(light.cost.cpu).toBeLessThan(0.2);
    expect(light.issues.some(i => i.code === 'heavy' || i.code === 'too-big')).toBe(false);
    // 64 copies of an LFO-swept filter bank: heavy (warning, names what weighs most), still built.
    const heavy = apply(rain(64),
      { op: 'addNode', node: { id: 'lfo1', type: 'den.lfo', count: 64 } },
      { op: 'addNode', node: { id: 'cut1', type: 'kit.cutoffMod', count: 64 } },
      { op: 'connect', from: { node: 'lfo1', port: 'out' }, to: { node: 'cut1', port: 'octaves' } },
      { op: 'connect', from: { node: 'cut1', port: 'out' }, to: { node: 'svf1', port: 'cutoffHz' } },
    ).doc;
    const h = validate(heavy, catalog);
    expect(h.issues.find(i => i.code === 'heavy')).toMatchObject({ severity: 'warning' });
    expect(h.issues.find(i => i.code === 'heavy')!.message).toMatch(/Most of it: .*×64/);
    expect(h.cost.byNode.lfo1).toBeGreaterThan(h.cost.byNode.noise1!);
    expect(generate(heavy, catalog).source).not.toBe('');
    // 128 copies of four delays: far too big; refused before compiling.
    const huge = apply(emptyDocument('huge'),
      ...['d1', 'd2', 'd3', 'd4'].map((id): Intent => ({ op: 'addNode', node: { id, type: 'den.delayFx', count: 128 } })),
      { op: 'addNode', node: { id: 'osc1', type: 'den.oscillator' } },
      { op: 'addNode', node: { id: 'out1', type: 'kit.out' } },
      { op: 'connect', from: { node: 'osc1', port: 'out' }, to: { node: 'd1', port: catalog.inputs({ id: 'd', type: 'den.delayFx', pos: { x: 0, y: 0 }, config: {}, values: {} }).find(p => p.role === 'audio')!.id } },
      ...[['d1', 'd2'], ['d2', 'd3'], ['d3', 'd4']].map(([a, b]): Intent => ({ op: 'connect', from: { node: a!, port: catalog.outputs({ id: 'd', type: 'den.delayFx', pos: { x: 0, y: 0 }, config: {}, values: {} })[0]!.id }, to: { node: b!, port: catalog.inputs({ id: 'd', type: 'den.delayFx', pos: { x: 0, y: 0 }, config: {}, values: {} }).find(p => p.role === 'audio')!.id } })),
      { op: 'connect', from: { node: 'd4', port: catalog.outputs({ id: 'd', type: 'den.delayFx', pos: { x: 0, y: 0 }, config: {}, values: {} })[0]!.id }, to: { node: 'out1', port: 'left' } },
    ).doc;
    const v = validate(huge, catalog);
    expect(v.issues.find(i => i.code === 'too-big')).toMatchObject({ severity: 'error' });
    expect(generate(huge, catalog).source).toBe('');
  });
  it('a part used many times inside parts used many times stops at the cap instead of hanging', () => {
    // Part B (one oscillator) ×64 inside part A, A ×64 in the patch: 4096 copies, past the cap.
    const made = apply(apply(emptyDocument('deep'), { op: 'addNode', node: { id: 'osc1', type: 'den.oscillator' } }, { op: 'addNode', node: { id: 'out1', type: 'kit.out' } }, { op: 'connect', from: { node: 'osc1', port: 'out' }, to: { node: 'out1', port: 'left' } }).doc, { op: 'makePart', ids: ['osc1'], name: 'B' });
    const b = made.created[0]!;
    const outer = apply(apply(made.doc, { op: 'setCount', node: b, count: 64 }).doc, { op: 'makePart', ids: [b], name: 'A' });
    const doc = apply(outer.doc, { op: 'setCount', node: outer.created[0]!, count: 64 }).doc;
    const started = Date.now();
    const v = validate(doc, catalog);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(v.issues.find(i => i.code === 'too-many-nodes')).toMatchObject({ severity: 'error' });
    expect(Object.keys(v.flat.doc.nodes).length).toBeLessThanOrEqual(MAX_EXPANDED + 1);
    expect(generate(doc, catalog).source).toBe('');
  });
});

describe('files and descriptions', () => {
  it('counts and spreads are saved and read back; broken ones are dropped with a reason', () => {
    const doc = apply(rain(4), { op: 'setSpread', node: 'svf1', port: 'cutoffHz', spread: { kind: 'random', amount: 1.5, seed: 9 } }).doc;
    const back = parseDocument(serializeDocument(doc), catalog);
    if (!back.ok) throw new Error(back.error);
    expect(back.report).toEqual([]);
    expect(documentHash(back.doc)).toBe(documentHash(doc));
    const raw = JSON.parse(serializeDocument(doc));
    raw.nodes.noise1.count = 1000;
    raw.nodes.out1.count = 3;
    raw.nodes.svf1.spread = { cutoffHz: { kind: 'wobble' }, input: { kind: 'range', amount: 1 }, q: { kind: 'each', values: [1, 2] }, nope: { kind: 'range' } };
    const read = parseDocument(JSON.stringify(raw), catalog);
    if (!read.ok) throw new Error(read.error);
    expect(read.doc.nodes.noise1!.count).toBeUndefined();
    expect(read.doc.nodes.out1!.count).toBeUndefined();
    expect(read.doc.nodes.svf1!.spread).toEqual({ q: { kind: 'each', values: [1, 2] } });
    expect(read.report.map(i => i.code).sort()).toEqual(['dropped-count', 'dropped-count', 'dropped-spread', 'dropped-spread', 'dropped-spread']);
  });
  it('the AI reads the counts, the spreads and the load', () => {
    const doc = apply(rain(4), { op: 'setSpread', node: 'svf1', port: 'cutoffHz', spread: { kind: 'range', amount: 1 } }).doc;
    const text = describePatch(doc, catalog);
    expect(text).toMatch(/Estimated load: .*CPU of one core/);
    expect(text).toMatch(/thick cable/);
    expect(text).toMatch(/svf1: Multimode SVF ×4/);
    expect(text).toMatch(/cutoffHz=1000Hz \(copies spread: range ±1 oct\)/);
  });
});

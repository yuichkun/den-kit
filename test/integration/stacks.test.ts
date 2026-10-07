// Copies (×N) sound like the same modules built by hand: n copies summed ×1/√n
// into a single input, a harmonic spread, the copy number inside a part used ×n,
// Splay's left and right, random modules that differ per copy, and copies
// inside a voice. Rendered offline; audio is CANDIDATE, never golden.
import { beforeAll, describe, expect, it } from 'vitest';
import { renderOffline } from '@unworklet/offline';
import { catalog } from '../../src/blocks/index.ts';
import { generate } from '../../src/core/codegen.ts';
import { applyIntents, type Intent } from '../../src/core/ops.ts';
import { flatten } from '../../src/core/parts.ts';
import { PHRASES, phraseEvents } from '../../src/core/phrases.ts';
import { emptyDocument, type PatchDocument } from '../../src/core/schema.ts';
import { validate } from '../../src/core/validate.ts';
import { evaluate } from '../../src/compile/evaluate.ts';
import { loadRegistry } from '../helpers/registry.ts';

let registry: Record<string, unknown>;
beforeAll(async () => { registry = await loadRegistry(); });

const apply = (doc: PatchDocument, ...intents: Intent[]) => applyIntents(doc, intents, catalog).doc;
const QUANTA = 400;
async function render(doc: PatchDocument) {
  const g = generate(doc, catalog);
  expect(g.issues.filter(i => i.severity === 'error')).toEqual([]);
  expect(g.source).not.toBe('');
  const { processor } = evaluate(g.source, registry);
  const r = await renderOffline(processor, { sampleRate: 48000, duration: QUANTA * 128 / 48000, events: phraseEvents(PHRASES.bass, QUANTA), params: Object.fromEntries(Object.entries(g.values).map(([k, v]) => [k, [v]])) });
  expect(r.diagnostics.scrubbedSamples).toBe(0);
  return r.outputs.main! as Float32Array[];
}
function difference(a: Float32Array, b: Float32Array) { let max = 0; for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i]! - b[i]!)); return max; }
const peak = (a: Float32Array) => { let max = 0; for (const v of a) max = Math.max(max, Math.abs(v)); return max; };
const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
function correlation(a: Float32Array, b: Float32Array) { let ab = 0, aa = 0, bb = 0; for (let i = 0; i < a.length; i++) { ab += a[i]! * b[i]!; aa += a[i]! ** 2; bb += b[i]! ** 2; } return ab / Math.sqrt(aa * bb); }

/** `sources` (ids already in the patch, all with an `out`-like output port) summed and scaled by 1/√n into Out, by hand. */
function sumByHand(doc: PatchDocument, sources: Array<{ node: string; port: string }>): PatchDocument {
  const intents: Intent[] = [];
  let last = sources[0]!;
  sources.slice(1).forEach((s, i) => {
    intents.push({ op: 'addNode', node: { id: `add${i + 1}`, type: 'kit.add' } }, { op: 'connect', from: last, to: { node: `add${i + 1}`, port: 'a' } }, { op: 'connect', from: s, to: { node: `add${i + 1}`, port: 'b' } });
    last = { node: `add${i + 1}`, port: 'out' };
  });
  intents.push({ op: 'addNode', node: { id: 'gain1', type: 'kit.gain', values: { gain: 1 / Math.sqrt(sources.length) } } }, { op: 'connect', from: last, to: { node: 'gain1', port: 'in' } }, { op: 'connect', from: { node: 'gain1', port: 'out' }, to: { node: 'out1', port: 'left' } });
  return apply(doc, ...intents);
}

describe('copies sound like the same modules built by hand', () => {
  it('noise → band-pass ×3 into Out is three of them summed ×1/√3 (each noise with the seed its copy gets)', async () => {
    const stacked = apply(emptyDocument('rain'),
      { op: 'addNode', node: { id: 'noise1', type: 'den.seededNoise', count: 3 } },
      { op: 'addNode', node: { id: 'svf1', type: 'den.stateVariableFilter', count: 3, values: { cutoffHz: 1200, q: 6 } } },
      { op: 'addNode', node: { id: 'out1', type: 'kit.out' } },
      { op: 'connect', from: { node: 'noise1', port: 'out' }, to: { node: 'svf1', port: 'input' } },
      { op: 'connect', from: { node: 'svf1', port: 'bandpass' }, to: { node: 'out1', port: 'left' } },
    );
    const seeds = [0, 1, 2].map(k => flatten(stacked, catalog).doc.nodes[`noise1_${k}`]!.config.seed as number);
    let byHand = apply(emptyDocument('rain'), { op: 'addNode', node: { id: 'out1', type: 'kit.out' } });
    for (const k of [0, 1, 2]) byHand = apply(byHand,
      { op: 'addNode', node: { id: `noise${k + 1}`, type: 'den.seededNoise', config: { seed: seeds[k]! } } },
      { op: 'addNode', node: { id: `svf${k + 1}`, type: 'den.stateVariableFilter', values: { cutoffHz: 1200, q: 6 } } },
      { op: 'connect', from: { node: `noise${k + 1}`, port: 'out' }, to: { node: `svf${k + 1}`, port: 'input' } },
    );
    byHand = sumByHand(byHand, [1, 2, 3].map(k => ({ node: `svf${k}`, port: 'bandpass' })));
    const a = await render(stacked), b = await render(byHand);
    expect(peak(a[0]!)).toBeGreaterThan(0.01);
    expect(difference(a[0]!, b[0]!)).toBe(0);
  });
  it('a harmonic spread is the knob × 1, 2, 3', async () => {
    const stacked = apply(emptyDocument('organ'),
      { op: 'addNode', node: { id: 'osc1', type: 'den.oscillator', count: 3, config: { waveform: 'sine' }, values: { frequency: 220 }, spread: { frequency: { kind: 'harmonic' } } } },
      { op: 'addNode', node: { id: 'out1', type: 'kit.out' } },
      { op: 'connect', from: { node: 'osc1', port: 'out' }, to: { node: 'out1', port: 'left' } },
    );
    const byHand = sumByHand(apply(emptyDocument('organ'), { op: 'addNode', node: { id: 'out1', type: 'kit.out' } },
      ...[1, 2, 3].map((h): Intent => ({ op: 'addNode', node: { id: `osc${h}`, type: 'den.oscillator', config: { waveform: 'sine' }, values: { frequency: 220 * h } } }))), [1, 2, 3].map(h => ({ node: `osc${h}`, port: 'out' })));
    const a = await render(stacked), b = await render(byHand);
    expect(peak(a[0]!)).toBeGreaterThan(0.1);
    expect(difference(a[0]!, b[0]!)).toBe(0);
  });
  it('the copy number inside a part used ×3 gives each copy its own pitch', async () => {
    const parted = applyIntents(apply(emptyDocument('partials'),
      { op: 'addNode', node: { id: 'copy1', type: 'kit.copy' } },
      { op: 'addNode', node: { id: 'scale1', type: 'kit.scale', values: { scale: 110, offset: 220 } } },
      { op: 'addNode', node: { id: 'osc1', type: 'den.oscillator', config: { waveform: 'sine' } } },
      { op: 'addNode', node: { id: 'out1', type: 'kit.out' } },
      { op: 'connect', from: { node: 'copy1', port: 'index' }, to: { node: 'scale1', port: 'in' } },
      { op: 'connect', from: { node: 'scale1', port: 'out' }, to: { node: 'osc1', port: 'frequency' } },
      { op: 'connect', from: { node: 'osc1', port: 'out' }, to: { node: 'out1', port: 'left' } },
    ), [{ op: 'makePart', ids: ['copy1', 'scale1', 'osc1'], name: 'Partial' }], catalog);
    const stacked = apply(parted.doc, { op: 'setCount', node: parted.created[0]!, count: 3 });
    const byHand = sumByHand(apply(emptyDocument('partials'), { op: 'addNode', node: { id: 'out1', type: 'kit.out' } },
      ...[0, 1, 2].map((k): Intent => ({ op: 'addNode', node: { id: `osc${k + 1}`, type: 'den.oscillator', config: { waveform: 'sine' }, values: { frequency: 220 + 110 * k } } }))), [1, 2, 3].map(k => ({ node: `osc${k}`, port: 'out' })));
    const a = await render(stacked), b = await render(byHand);
    expect(peak(a[0]!)).toBeGreaterThan(0.1);
    expect(difference(a[0]!, b[0]!)).toBe(0);
  });
});

describe('across left and right', () => {
  it('Splay puts the first copy left and the last right (each ×1/√2 for two)', async () => {
    const doc = apply(emptyDocument('splay'),
      { op: 'addNode', node: { id: 'osc1', type: 'den.oscillator', count: 2, config: { waveform: 'sine' }, values: { frequency: 300 }, spread: { frequency: { kind: 'harmonic' } } } },
      { op: 'addNode', node: { id: 'splay1', type: 'kit.splay' } },
      { op: 'addNode', node: { id: 'out1', type: 'kit.out' } },
      { op: 'connect', from: { node: 'osc1', port: 'out' }, to: { node: 'splay1', port: 'in' } },
      { op: 'connect', from: { node: 'splay1', port: 'left' }, to: { node: 'out1', port: 'left' } },
      { op: 'connect', from: { node: 'splay1', port: 'right' }, to: { node: 'out1', port: 'right' } },
    );
    const one = (frequency: number) => apply(emptyDocument('one'),
      { op: 'addNode', node: { id: 'osc1', type: 'den.oscillator', config: { waveform: 'sine' }, values: { frequency } } },
      { op: 'addNode', node: { id: 'gain1', type: 'kit.gain', values: { gain: Math.SQRT1_2 } } },
      { op: 'addNode', node: { id: 'out1', type: 'kit.out' } },
      { op: 'connect', from: { node: 'osc1', port: 'out' }, to: { node: 'gain1', port: 'in' } },
      { op: 'connect', from: { node: 'gain1', port: 'out' }, to: { node: 'out1', port: 'left' } },
    );
    const [l, r] = await render(doc);
    const [low] = await render(one(300)), [high] = await render(one(600));
    expect(difference(l!, low!)).toBeLessThan(1e-6);
    expect(difference(r!, high!)).toBeLessThan(1e-6);
    // width 0: every copy in the middle, both sides the same.
    const middle = await render(apply(doc, { op: 'setValue', node: 'splay1', port: 'width', value: 0 }));
    expect(difference(middle[0]!, middle[1]!)).toBe(0);
    expect(peak(middle[0]!)).toBeGreaterThan(0.1);
  });
  it('copies of a noise each get their own seed: splayed, left and right are unrelated', async () => {
    const doc = apply(emptyDocument('wide'),
      { op: 'addNode', node: { id: 'noise1', type: 'den.seededNoise', count: 2 } },
      { op: 'addNode', node: { id: 'splay1', type: 'kit.splay' } },
      { op: 'addNode', node: { id: 'out1', type: 'kit.out' } },
      { op: 'connect', from: { node: 'noise1', port: 'out' }, to: { node: 'splay1', port: 'in' } },
      { op: 'connect', from: { node: 'splay1', port: 'left' }, to: { node: 'out1', port: 'left' } },
      { op: 'connect', from: { node: 'splay1', port: 'right' }, to: { node: 'out1', port: 'right' } },
    );
    const [l, r] = await render(doc);
    expect(rms(l!)).toBeGreaterThan(0.1);
    expect(Math.abs(correlation(l!, r!))).toBeLessThan(0.05);
  });
});

describe('copies inside a voice (voice stacking)', () => {
  it('a seven-saw stack per voice, detuned by a spread, plays the phrase; its estimated load is reported', async () => {
    const doc = apply(emptyDocument('supersaw'),
      { op: 'addNode', node: { id: 'voice1', type: 'kit.voiceIn', config: { mode: 'poly', capacity: 4 } } },
      { op: 'addNode', node: { id: 'detune1', type: 'kit.pitchMod', count: 7, values: { semitones: 0 }, spread: { semitones: { kind: 'range', amount: 0.25 } } } },
      { op: 'addNode', node: { id: 'osc1', type: 'den.oscillator', count: 7, config: { waveform: 'saw' } } },
      { op: 'addNode', node: { id: 'env1', type: 'den.envelope' } },
      { op: 'addNode', node: { id: 'vca1', type: 'kit.mul' } },
      { op: 'addNode', node: { id: 'mix1', type: 'kit.voiceMix' } },
      { op: 'addNode', node: { id: 'gain1', type: 'kit.gain', values: { gain: 0.2 } } },
      { op: 'addNode', node: { id: 'out1', type: 'kit.out' } },
      { op: 'connect', from: { node: 'voice1', port: 'pitch' }, to: { node: 'detune1', port: 'hz' } },
      { op: 'connect', from: { node: 'detune1', port: 'out' }, to: { node: 'osc1', port: 'frequency' } },
      { op: 'connect', from: { node: 'osc1', port: 'out' }, to: { node: 'vca1', port: 'a' } },
      { op: 'connect', from: { node: 'env1', port: 'level' }, to: { node: 'vca1', port: 'b' } },
      { op: 'connect', from: { node: 'vca1', port: 'out' }, to: { node: 'mix1', port: 'in' } },
      { op: 'connect', from: { node: 'env1', port: 'done' }, to: { node: 'mix1', port: 'done' } },
      { op: 'connect', from: { node: 'mix1', port: 'out' }, to: { node: 'gain1', port: 'in' } },
      { op: 'connect', from: { node: 'gain1', port: 'out' }, to: { node: 'out1', port: 'left' } },
    );
    const v = validate(doc, catalog);
    expect(v.analysis.scope.get('osc1')).toBe('voice');
    expect(v.cost.byNode.osc1).toBeGreaterThan(v.cost.byNode.env1!);
    const stacked = await render(doc);
    const single = await render(apply(doc, { op: 'setCount', node: 'osc1', count: 1 }, { op: 'setCount', node: 'detune1', count: 1 }));
    expect(peak(stacked[0]!)).toBeGreaterThan(0.01);
    // Seven detuned saws are not one saw: they beat against each other.
    expect(difference(stacked[0]!, single[0]!)).toBeGreaterThan(0.01);
  });
});

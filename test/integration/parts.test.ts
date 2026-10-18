// Parts sound like the modules they were made from: a use is expanded into
// ordinary nodes before code generation, so making a part changes nothing in
// the sound, and two uses with their own parameter values are two voices of
// the same definition. Rendered offline; audio is CANDIDATE, never golden.
import { beforeAll, describe, expect, it } from 'vite-plus/test';
import { renderOffline } from '@unworklet/offline';
import { catalog } from '../../src/blocks/index.ts';
import { generate } from '../../src/core/codegen.ts';
import { applyIntents, type Intent } from '../../src/core/ops.ts';
import type { FlattenOptions } from '../../src/core/parts.ts';
import { PHRASES, phraseEvents } from '../../src/core/phrases.ts';
import { emptyDocument, type PatchDocument } from '../../src/core/schema.ts';
import { starter } from '../../src/core/starters.ts';
import { evaluate } from '../../src/compile/evaluate.ts';
import { loadRegistry } from '../helpers/registry.ts';

let registry: Record<string, unknown>;
beforeAll(async () => {
  registry = await loadRegistry();
});

const apply = (doc: PatchDocument, ...intents: Intent[]) => applyIntents(doc, intents, catalog).doc;
const QUANTA = 500;
async function render(doc: PatchDocument, options: FlattenOptions = {}) {
  const g = generate(doc, catalog, options);
  expect(g.issues.filter(i => i.severity === 'error')).toEqual([]);
  expect(g.source).not.toBe('');
  const { processor } = evaluate(g.source, registry);
  const r = await renderOffline(processor, {
    sampleRate: 48000,
    duration: (QUANTA * 128) / 48000,
    events: phraseEvents(PHRASES.bass, QUANTA),
    params: Object.fromEntries(Object.entries(g.values).map(([k, v]) => [k, [v]])),
  });
  expect(r.diagnostics.scrubbedSamples).toBe(0);
  return r.outputs.main! as Float32Array[];
}
function difference(a: Float32Array[], b: Float32Array[]) {
  let max = 0;
  for (const ch of [0, 1])
    for (let i = 0; i < a[ch]!.length; i++) max = Math.max(max, Math.abs(a[ch]![i]! - b[ch]![i]!));
  return max;
}
const peak = (a: Float32Array[]) => {
  let max = 0;
  for (const ch of a) for (const v of ch) max = Math.max(max, Math.abs(v));
  return max;
};

/** Two tones summed: hand-built, or as two uses of one part with their own pitch. */
function pair(withParts: boolean): PatchDocument {
  let doc = apply(
    emptyDocument('pair'),
    {
      op: 'addNode',
      node: {
        id: 'osc1',
        type: 'den.oscillator',
        config: { waveform: 'saw' },
        values: { frequency: 220 },
      },
    },
    {
      op: 'addNode',
      node: { id: 'lp1', type: 'den.filter', values: { cutoff: 900, resonance: 2 } },
    },
    {
      op: 'addNode',
      node: {
        id: 'mix1',
        type: 'kit.mix',
        config: { channels: 2 },
        values: { level1: 0.2, level2: 0.2 },
      },
    },
    { op: 'addNode', node: { id: 'out1', type: 'kit.out' } },
    { op: 'connect', from: { node: 'osc1', port: 'out' }, to: { node: 'lp1', port: 'input' } },
    { op: 'connect', from: { node: 'lp1', port: 'out' }, to: { node: 'mix1', port: 'in1' } },
    { op: 'connect', from: { node: 'mix1', port: 'out' }, to: { node: 'out1', port: 'left' } },
  );
  if (!withParts)
    return apply(
      doc,
      {
        op: 'addNode',
        node: {
          id: 'osc2',
          type: 'den.oscillator',
          config: { waveform: 'saw' },
          values: { frequency: 330 },
        },
      },
      {
        op: 'addNode',
        node: { id: 'lp2', type: 'den.filter', values: { cutoff: 900, resonance: 2 } },
      },
      { op: 'connect', from: { node: 'osc2', port: 'out' }, to: { node: 'lp2', port: 'input' } },
      { op: 'connect', from: { node: 'lp2', port: 'out' }, to: { node: 'mix1', port: 'in2' } },
    );
  doc = apply(doc, { op: 'makePart', ids: ['osc1', 'lp1'], name: 'Tone' });
  return apply(
    doc,
    {
      op: 'addNode',
      node: { id: 'tone2', type: 'kit.part', part: 'tone', values: { frequency: 330 } },
    },
    { op: 'connect', from: { node: 'tone2', port: 'out' }, to: { node: 'mix1', port: 'in2' } },
  );
}

describe('parts sound like the modules they were made from', () => {
  it('the bass with its oscillator, filter and VCA made into a part is sample-identical to the bass', async () => {
    const bass = starter('bass', catalog);
    const parted = apply(bass, { op: 'makePart', ids: ['osc1', 'filter1', 'vca1'], name: 'Tone' });
    const a = await render(bass),
      b = await render(parted);
    expect(peak(a)).toBeGreaterThan(0.001);
    expect(difference(a, b)).toBe(0);
  });
  it('two uses of one part with their own pitch equal the same two chains built by hand', async () => {
    const parted = pair(true);
    expect(parted.parts.tone!.params.map(p => p.id)).toEqual(['frequency', 'cutoff', 'resonance']);
    const a = await render(pair(false)),
      b = await render(parted);
    expect(peak(a)).toBeGreaterThan(0.01);
    expect(difference(a, b)).toBe(0);
    // With the second use at the first one's pitch, it is a different sound.
    const unison = await render(
      apply(parted, { op: 'setValue', node: 'tone2', port: 'frequency', value: 220 }),
    );
    expect(difference(unison, b)).toBeGreaterThan(0.01);
  });
  it('a part inside a part, used twice, still sounds like the hand-built pair', async () => {
    const nested = apply(
      pair(true),
      { op: 'makePart', ids: ['lp1'], name: 'Shape' },
      { op: 'addParam', part: 'tone', node: 'shape1', port: 'cutoff', id: 'bright' },
    );
    expect(difference(await render(pair(false)), await render(nested))).toBe(0);
  });
  it('alone: only the part is heard (its output in place of the mix)', async () => {
    const parted = pair(true);
    const solo = await render(parted, { solo: ['tone2'] });
    const alone = await render(
      apply(
        pair(false),
        { op: 'removeNode', id: 'osc1' },
        { op: 'removeNode', id: 'lp1' },
        { op: 'removeNode', id: 'mix1' },
        { op: 'connect', from: { node: 'lp2', port: 'out' }, to: { node: 'out1', port: 'left' } },
      ),
    );
    expect(peak(solo)).toBeGreaterThan(0.01);
    expect(difference(solo, alone)).toBe(0);
  });
  it('a codebox inside a part used twice is one module with an instance (its own state) per use', async () => {
    let doc = apply(pair(true), {
      op: 'addNode',
      node: { id: 'box1', type: 'kit.codebox', inside: 'tone' },
    });
    const outlet = doc.parts.tone!.outputs[0]!.node;
    doc = apply(
      doc,
      { op: 'connect', from: { node: 'lp1', port: 'out' }, to: { node: 'box1', port: 'in' } },
      {
        op: 'connect',
        from: { node: 'box1', port: 'out' },
        to: { node: outlet, port: 'in' },
        replace: true,
      },
    );
    const out = await render(doc);
    expect(peak(out)).toBeGreaterThan(0.001);
    const g = generate(doc, catalog);
    expect(Object.keys(g.codeboxes)).toEqual(['tone1_box1']);
    expect(g.source.match(/instantiate\(tone1_box1Box, /g)).toHaveLength(2);
  });
});

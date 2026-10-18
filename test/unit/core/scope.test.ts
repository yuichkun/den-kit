import { describe, expect, it } from 'vite-plus/test';
import { catalog } from '../../../src/blocks/index.ts';
import { applyIntents, type Intent } from '../../../src/core/ops.ts';
import { emptyDocument, type PatchDocument } from '../../../src/core/schema.ts';
import { starter } from '../../../src/core/starters.ts';
import { validate } from '../../../src/core/validate.ts';
import { describePatch } from '../../../src/core/describe.ts';
import { parseDocument } from '../../../src/core/persistence.ts';

const build = (...intents: Intent[]) => applyIntents(emptyDocument('t', 't'), intents, catalog).doc;
const node = (id: string, type: string, extra: object = {}): Intent => ({
  op: 'addNode',
  node: { id, type, ...extra },
});
const wire = (a: string, b: string): Intent => ({
  op: 'connect',
  from: { node: a.split('.')[0]!, port: a.split('.')[1]! },
  to: { node: b.split('.')[0]!, port: b.split('.')[1]! },
});
const codes = (doc: PatchDocument) => validate(doc, catalog).issues.map(i => i.code);

describe('A7 voice scope', () => {
  it('per-voice signal straight to Out is an error', () => {
    const doc = build(
      node('voice1', 'kit.voiceIn'),
      node('osc1', 'den.oscillator'),
      node('out1', 'kit.out'),
      wire('voice1.pitch', 'osc1.frequency'),
      wire('osc1.out', 'out1.left'),
    );
    expect(codes(doc)).toContain('voice-to-global');
  });
  it('Voice Mix needs per-voice input and a Voice In', () => {
    const doc = build(
      node('osc1', 'den.oscillator'),
      node('mix1', 'kit.voiceMix'),
      node('out1', 'kit.out'),
      wire('osc1.out', 'mix1.in'),
      wire('mix1.out', 'out1.left'),
    );
    expect(codes(doc)).toEqual(expect.arrayContaining(['mix-not-voice', 'mix-without-voice-in']));
  });
  it('envelopes with implicit note gates join the voice; free LFOs stay global', () => {
    const { analysis } = validate(starter('pad', catalog), catalog);
    expect(analysis.scope.get('fenv1')).toBe('voice');
    expect(analysis.scope.get('aenv1')).toBe('voice');
    expect(analysis.scope.get('lfo1')).toBe('global');
    expect(analysis.scope.get('flfo1')).toBe('global');
    expect(analysis.scope.get('fsum1')).toBe('voice');
    expect(analysis.order.voice[0]).toBe('voice1');
  });
  it('a Voice Mix result may not feed back into the voices without History', () => {
    const doc = build(
      node('voice1', 'kit.voiceIn'),
      node('osc1', 'den.oscillator'),
      node('mix1', 'kit.voiceMix'),
      node('mix2', 'kit.voiceMix'),
      node('g1', 'kit.gain'),
      node('m1', 'kit.mul'),
      node('add1', 'kit.add'),
      node('out1', 'kit.out'),
      wire('voice1.pitch', 'osc1.frequency'),
      wire('osc1.out', 'mix1.in'),
      wire('mix1.out', 'g1.in'),
      wire('voice1.velocity', 'm1.a'),
      wire('g1.out', 'm1.b'),
      wire('m1.out', 'mix2.in'),
      wire('g1.out', 'add1.a'),
      wire('mix2.out', 'add1.b'),
      wire('add1.out', 'out1.left'),
    );
    expect(codes(doc)).toContain('mix-feedback');
    // A real node loop is refused when cabling.
    expect(() => applyIntents(doc, [wire('add1.out', 'osc1.frequency')], catalog)).toThrow(
      /feedback loop|already connected/,
    );
  });
  it('unreachable nodes are reported and the empty patch is quiet', () => {
    const doc = build(node('osc1', 'den.oscillator'), node('out1', 'kit.out'));
    expect(codes(doc)).toEqual(expect.arrayContaining(['not-live', 'out-unconnected']));
    expect(codes(emptyDocument())).toEqual([]);
    expect(codes(build(node('c1', 'kit.comment')))).toEqual([]);
  });
  it('imported documents with cycles, duplicate drivers and duplicate singletons are reported', () => {
    const raw = {
      schema: 'den-kit/patch',
      version: 1,
      name: 'x',
      nodes: {
        a: { id: 'a', type: 'kit.add' },
        b: { id: 'b', type: 'kit.add' },
        o1: { type: 'kit.out' },
        o2: { type: 'kit.out' },
      },
      edges: {
        e1: { from: { node: 'a', port: 'out' }, to: { node: 'b', port: 'a' } },
        e2: { from: { node: 'b', port: 'out' }, to: { node: 'a', port: 'a' } },
        e3: { from: { node: 'b', port: 'out' }, to: { node: 'a', port: 'a' } },
      },
    };
    const parsed = parseDocument(JSON.stringify(raw), catalog);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.report.map(i => i.code)).toContain('dropped-edge');
    const found = codes(parsed.doc);
    expect(found).toEqual(expect.arrayContaining(['cycle', 'duplicate-singleton']));
    expect(validate(parsed.doc, catalog).issues.find(i => i.code === 'cycle')!.message).toMatch(
      /a → b → a|b → a → b/,
    );
  });
  it('describe is compact and mentions scope, knobs and cables', () => {
    const text = describePatch(starter('pad', catalog), catalog);
    expect(text).toContain('poly, 4 voice(s)');
    expect(text).toContain('filter1: Lowpass (per voice)');
    expect(text).toContain('cutoff←cut1.out');
    expect(text).toContain('resonance=0.5');
    expect(text.length).toBeLessThan(4000);
    const huge = applyIntents(
      starter('pad', catalog),
      Array.from({ length: 300 }, (_, k) => node(`v${k}`, 'kit.value')),
      catalog,
    ).doc;
    expect(describePatch(huge, catalog, { maxChars: 3000 }).length).toBeLessThanOrEqual(3000);
  });
});

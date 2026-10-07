// Parts: one definition used in several places. The insides live in the node
// list (inside: part id); validation and code generation expand every use into
// ordinary nodes and say what they find in terms of the patch as drawn.
import { describe, expect, it } from 'vitest';
import { catalog } from '../../../src/blocks/index.ts';
import { generate } from '../../../src/core/codegen.ts';
import { describePatch } from '../../../src/core/describe.ts';
import { History } from '../../../src/core/history.ts';
import { applyIntents, applyResolvedOps, invertAll, isStructural, OpError, type Intent, type ResolvedOp } from '../../../src/core/ops.ts';
import { flatten, MAX_EXPANDED, partIdFor, usesOf } from '../../../src/core/parts.ts';
import { documentHash, parseDocument, serializeDocument } from '../../../src/core/persistence.ts';
import { PATCH_VERSION, type PatchDocument } from '../../../src/core/schema.ts';
import { starter } from '../../../src/core/starters.ts';
import { validate } from '../../../src/core/validate.ts';

const apply = (doc: PatchDocument, ...intents: Intent[]) => applyIntents(doc, intents, catalog);
const failure = (fn: () => unknown): OpError => { try { fn(); } catch (error) { if (error instanceof OpError) return error; throw error; } throw new Error('expected an OpError'); };
const same = (a: PatchDocument, b: PatchDocument) => expect({ ...a, revision: 0 }).toEqual({ ...b, revision: 0 });
/** Every edit undoes exactly. */
function undoes(before: PatchDocument, r: { doc: PatchDocument; ops: ResolvedOp[] }) { same(applyResolvedOps(r.doc, invertAll(r.ops)), before); }
/** The expanded patch, with the part prefixes taken off ids (what the sound is made of). */
function sound(doc: PatchDocument) {
  const flat = validate(doc, catalog).flat.doc;
  const bare = (id: string) => id.split('_').at(-1)!;
  return {
    nodes: Object.values(flat.nodes).map(n => JSON.stringify([bare(n.id), n.type, n.config, n.values])).sort(),
    edges: Object.values(flat.edges).map(e => `${bare(e.from.node)}.${e.from.port}>${bare(e.to.node)}.${e.to.port}`).sort(),
  };
}
const bass = () => starter('bass', catalog);
/** The bass's oscillator, filter and VCA made into a part "Tone" (use tone1). */
const toned = () => apply(bass(), { op: 'makePart', ids: ['osc1', 'filter1', 'vca1'], name: 'Tone' });

describe('making a part from modules', () => {
  it('moves them inside, turns the cables across the edge into inputs and outputs, their free main knobs into parameters, and sounds the same', () => {
    const before = bass();
    const r = toned();
    expect(r.created).toEqual(['tone1']);
    const doc = r.doc, def = doc.parts.tone!;
    expect(def.name).toBe('Tone');
    expect(['osc1', 'filter1', 'vca1'].map(id => doc.nodes[id]!.inside)).toEqual(['tone', 'tone', 'tone']);
    expect(def.inputs.map(p => p.id).sort()).toEqual(['b', 'cutoff', 'frequency']);
    expect(def.outputs.map(p => p.id)).toEqual(['out']);
    expect(def.params).toEqual([{ id: 'resonance', node: 'filter1', port: 'resonance' }]);
    const use = doc.nodes.tone1!;
    expect(use).toMatchObject({ type: 'kit.part', part: 'tone', values: { resonance: 0.707 } });
    expect(catalog.inputs(use).map(p => [p.id, p.role])).toEqual([...def.inputs.map(p => [p.id, 'audio']), ['resonance', 'control']]);
    expect(catalog.outputs(use).map(p => p.id)).toEqual(['out']);
    // Outside, the cables now go to and from the part.
    expect(Object.values(doc.edges).filter(e => e.to.node === 'tone1').map(e => `${e.from.node}.${e.from.port}>${e.to.port}`).sort()).toEqual(['aenv1.level>b', 'cut1.out>cutoff', 'voice1.pitch>frequency']);
    expect(Object.values(doc.edges).filter(e => e.from.node === 'tone1').map(e => `${e.to.node}.${e.to.port}`)).toEqual(['vel1.a']);
    // Nothing changes in the sound: the expanded patch is the patch before.
    expect(sound(doc)).toEqual(sound(before));
    expect(validate(doc, catalog).issues.filter(i => i.severity !== 'info')).toEqual([]);
    const g = generate(doc, catalog), g0 = generate(before, catalog);
    expect(g.source).not.toBe('');
    expect(Object.keys(g.values).length).toBe(Object.keys(g0.values).length);
    for (const [name, value] of Object.entries(g0.values)) expect(g.values[['osc1', 'filter1', 'vca1'].some(n => name.startsWith(`${n}_`)) ? `tone1_${name}` : name]).toBe(value);
    undoes(before, r);
  });
  it('one cable feeding two modules inside becomes one input; a stereo pair out becomes two outputs', () => {
    let doc = apply(bass(),
      { op: 'addNode', node: { id: 'pan1', type: 'kit.pan' } },
      { op: 'connect', from: { node: 'gain1', port: 'out' }, to: { node: 'pan1', port: 'in' } },
      { op: 'connect', from: { node: 'pan1', port: 'left' }, to: { node: 'out1', port: 'left' }, replace: true },
      { op: 'connect', from: { node: 'pan1', port: 'right' }, to: { node: 'out1', port: 'right' } },
    ).doc;
    doc = apply(doc, { op: 'makePart', ids: ['pan1'], name: 'Spread' }).doc;
    expect(doc.parts.spread!.outputs.map(p => p.id)).toEqual(['left', 'right']);
    doc = apply(bass(), { op: 'makePart', ids: ['osc1', 'filter1'], name: 'Pair' }, { op: 'connect', from: { node: 'voice1', port: 'pitch' }, to: { node: 'cut1', port: 'hz' } }).doc;
    const twice = apply(bass(), { op: 'addNode', node: { id: 'osc2', type: 'den.oscillator' } }, { op: 'connect', from: { node: 'voice1', port: 'pitch' }, to: { node: 'osc2', port: 'frequency' } }, { op: 'makePart', ids: ['osc1', 'osc2'], name: 'Two' }).doc;
    expect(twice.parts.two!.inputs.map(p => p.id)).toEqual(['frequency']);
    const inlet = twice.parts.two!.inputs[0]!.node;
    expect(Object.values(twice.edges).filter(e => e.from.node === inlet).map(e => e.to.node).sort()).toEqual(['osc1', 'osc2']);
  });
  it('controls, Voice In and Out stay in the main patch; nothing that can go in is refused with a reason', () => {
    const doc = apply(bass(), { op: 'addNode', node: { id: 'knob1', type: 'ui.knob' } }, { op: 'connect', from: { node: 'knob1', port: 'out' }, to: { node: 'filter1', port: 'resonance' } }).doc;
    const r = apply(doc, { op: 'makePart', ids: ['knob1', 'filter1', 'voice1', 'out1'], name: 'Filter part' });
    expect(r.doc.nodes.knob1!.inside).toBeUndefined();
    expect(r.doc.nodes.voice1!.inside).toBeUndefined();
    expect(r.doc.nodes.filter1!.inside).toBe('filterPart');
    expect(r.doc.parts.filterPart!.inputs.map(p => p.id)).toContain('resonance'); // the knob's cable became an input
    expect(r.doc.parts.filterPart!.params).toEqual([]);
    expect(failure(() => apply(doc, { op: 'makePart', ids: ['knob1', 'out1'] })).code).toBe('nothing-to-part');
    expect(failure(() => apply(doc, { op: 'makePart', ids: [] })).code).toBe('bad-intent');
    expect(failure(() => apply(doc, { op: 'makePart', ids: ['nope'] })).code).toBe('unknown-node');
    expect(failure(() => apply(doc, { op: 'makePart', ids: ['osc1'], id: 'Bad id' })).code).toBe('bad-id');
    const once = apply(doc, { op: 'makePart', ids: ['osc1'], id: 'one' }).doc;
    expect(failure(() => apply(once, { op: 'makePart', ids: ['filter1'], id: 'one' })).code).toBe('duplicate-id');
    expect(failure(() => apply(once, { op: 'makePart', ids: ['filter1'], node: 'gain1' })).code).toBe('duplicate-id');
  });
  it('names: from the modules when none is given, ids from names, never clashing', () => {
    const r = apply(bass(), { op: 'makePart', ids: ['osc1', 'filter1'] });
    expect(r.doc.parts[Object.keys(r.doc.parts)[0]!]!.name).toMatch(/Oscillator|Lowpass/);
    expect(partIdFor({ parts: {} }, 'Rain drop')).toBe('rainDrop');
    expect(partIdFor({ parts: {} }, '雨粒')).toBe('part');
    expect(partIdFor({ parts: { rain: {} as never } }, 'Rain')).toBe('rain2');
    expect(partIdFor({ parts: {} }, '808 kick')).toBe('kick');
  });
});

describe('using a part in several places', () => {
  /** A second use of Tone, heard on the right channel. */
  const two = () => apply(toned().doc, { op: 'addNode', node: { type: 'kit.part', part: 'tone', pos: { x: 0, y: 900 } } }, { op: 'connect', from: { node: 'tone2', port: 'out' }, to: { node: 'out1', port: 'right' } }).doc;
  it('a second use has the same ports and its own parameter values', () => {
    const doc = two();
    expect(usesOf(doc, 'tone').map(n => n.id)).toEqual(['tone1', 'tone2']);
    expect(doc.nodes.tone2!.iface).toEqual(doc.nodes.tone1!.iface);
    expect(doc.nodes.tone2!.values).toEqual({ resonance: 0.707 });
    const flat = validate(doc, catalog).flat.doc;
    expect(Object.keys(flat.nodes).filter(id => id.startsWith('tone2_')).sort()).toEqual(['tone2_filter1', 'tone2_osc1', 'tone2_vca1']);
  });
  it('a parameter changes one use; an edit inside changes every use', () => {
    let doc = apply(two(), { op: 'setValue', node: 'tone2', port: 'resonance', value: 4 }).doc;
    let flat = validate(doc, catalog).flat.doc;
    expect(flat.nodes.tone1_filter1!.values.resonance).toBe(0.707);
    expect(flat.nodes.tone2_filter1!.values.resonance).toBe(4);
    doc = apply(doc, { op: 'setConfig', node: 'osc1', key: 'waveform', value: 'sine' }, { op: 'setValue', node: 'filter1', port: 'cutoff', value: 900 }).doc;
    flat = validate(doc, catalog).flat.doc;
    expect([flat.nodes.tone1_osc1!.config.waveform, flat.nodes.tone2_osc1!.config.waveform]).toEqual(['sine', 'sine']);
    // A knob inside that is not a parameter is shared: it reaches every use's AudioParam without recompiling.
    const g = generate(doc, catalog);
    expect(g.aliases.tone1_resonance).toEqual(['tone1_filter1_resonance']);
    expect(g.aliases.tone2_resonance).toEqual(['tone2_filter1_resonance']);
    expect(g.aliases.osc1_frequency).toEqual(['tone1_osc1_frequency', 'tone2_osc1_frequency']);
    expect(g.params.map(p => p.name)).toEqual(expect.arrayContaining(['tone1_filter1_resonance', 'tone2_filter1_resonance']));
    expect(g.values.tone2_filter1_resonance).toBe(4);
  });
  it('turning a parameter is not structural and merges into one undo step; making a part is one step', () => {
    const doc = two();
    const history = new History();
    let current = doc;
    for (const value of [1, 2, 3]) {
      const r = apply(current, { op: 'setValue', node: 'tone1', port: 'resonance', value });
      expect(r.ops.some(isStructural)).toBe(false);
      history.record({ id: `t${value}`, author: { kind: 'human' }, label: 'Turn', ops: r.ops, at: value, gesture: 'g1', baseRevision: current.revision });
      current = r.doc;
    }
    expect(history.size).toBe(1);
    same(history.undo(current)!.doc, doc);
  });
  it('the last use going takes the part and its insides with it; undo brings everything back', () => {
    const doc = toned().doc;
    const r = apply(doc, { op: 'removeNode', id: 'tone1' });
    expect(r.doc.parts).toEqual({});
    expect(Object.values(r.doc.nodes).some(n => n.inside)).toBe(false);
    expect(r.doc.nodes.osc1).toBeUndefined();
    undoes(doc, r);
    // With two uses, removing one keeps the part.
    expect(apply(two(), { op: 'removeNode', id: 'tone1' }).doc.parts.tone).toBeDefined();
  });
  it('placing refuses what does not fit: a missing part, a part inside itself, controls and singletons inside, part inputs outside', () => {
    const doc = toned().doc;
    expect(failure(() => apply(doc, { op: 'addNode', node: { type: 'kit.part', part: 'nope' } })).code).toBe('unknown-part');
    expect(failure(() => apply(doc, { op: 'addNode', node: { type: 'kit.part' } })).code).toBe('unknown-part');
    expect(failure(() => apply(doc, { op: 'addNode', node: { type: 'kit.part', part: 'tone', inside: 'tone' } })).code).toBe('part-recursion');
    expect(failure(() => apply(doc, { op: 'addNode', node: { type: 'ui.knob', inside: 'tone' } })).code).toBe('not-in-part');
    expect(failure(() => apply(doc, { op: 'addNode', node: { type: 'kit.out', inside: 'tone' } })).code).toBe('singleton');
    expect(failure(() => apply(doc, { op: 'addNode', node: { type: 'kit.audioIn', inside: 'tone' } })).code).toBe('not-in-part');
    expect(failure(() => apply(doc, { op: 'addNode', node: { type: 'kit.partIn' } })).code).toBe('not-in-part');
    expect(failure(() => apply(doc, { op: 'addNode', node: { type: 'den.lfo', inside: 'nope' } })).code).toBe('unknown-part');
    // A part used inside another cannot take that other one in (A in B in A).
    const nested = apply(doc, { op: 'addNode', node: { id: 'inner1', type: 'den.lfo', inside: 'tone' } }, { op: 'makePart', ids: ['inner1'], name: 'Wobble' }).doc;
    expect(nested.nodes.wobble1!.inside).toBe('tone');
    expect(failure(() => apply(nested, { op: 'addNode', node: { type: 'kit.part', part: 'tone', inside: 'wobble' } })).code).toBe('part-recursion');
  });
  it('cables stay inside one part: across the edge is refused with a way out', () => {
    const doc = toned().doc;
    const e = failure(() => apply(doc, { op: 'connect', from: { node: 'voice1', port: 'pitch' }, to: { node: 'filter1', port: 'cutoff' }, replace: true }));
    expect(e.code).toBe('cross-part');
    expect(e.hint).toMatch(/input or output of the part/);
  });
});

describe('editing a part', () => {
  it('a Part input or output added inside becomes a port of every use; removing it drops the port and the cables to it', () => {
    let doc = apply(toned().doc, { op: 'addNode', node: { type: 'kit.part', part: 'tone', pos: { x: 0, y: 900 } } }).doc;
    const base = doc;
    const r = apply(doc, { op: 'addNode', node: { id: 'amIn', type: 'kit.partIn', inside: 'tone', label: 'amount' } });
    doc = r.doc;
    expect(doc.parts.tone!.inputs.at(-1)).toEqual({ id: 'amount', node: 'amIn' });
    expect(catalog.input(doc.nodes.tone1!, 'amount')).toMatchObject({ role: 'audio', label: 'amount' });
    expect(catalog.input(doc.nodes.tone2!, 'amount')).toBeDefined();
    doc = apply(doc, { op: 'connect', from: { node: 'fenv1', port: 'level' }, to: { node: 'tone2', port: 'amount' } }).doc;
    const gone = apply(doc, { op: 'removeNode', id: 'amIn' });
    expect(gone.doc.parts.tone!.inputs.some(p => p.id === 'amount')).toBe(false);
    expect(Object.values(gone.doc.edges).some(e => e.to.node === 'tone2' && e.to.port === 'amount')).toBe(false);
    undoes(doc, gone);
    undoes(base, r);
  });
  it('parameters: add a free knob inside, label it, remove it (values and cables follow); refusals say why', () => {
    let doc = toned().doc;
    expect(failure(() => apply(doc, { op: 'addParam', part: 'tone', node: 'filter1', port: 'reset' })).code).toBe('not-knob'); // follows the notes
    expect(failure(() => apply(doc, { op: 'addParam', part: 'tone', node: 'filter1', port: 'cutoff' })).code).toBe('connected');
    expect(failure(() => apply(doc, { op: 'addParam', part: 'tone', node: 'filter1', port: 'input' })).code).toBe('not-knob');
    expect(failure(() => apply(doc, { op: 'addParam', part: 'tone', node: 'gain1', port: 'gain' })).code).toBe('unknown-node');
    expect(failure(() => apply(doc, { op: 'addParam', part: 'nope', node: 'filter1', port: 'resonance' })).code).toBe('unknown-part');
    expect(failure(() => apply(doc, { op: 'addParam', part: 'tone', node: 'filter1', port: 'nope' })).code).toBe('unknown-port');
    expect(failure(() => apply(doc, { op: 'addParam', part: 'tone', node: 'osc1', port: 'frequency', id: 'resonance' })).code).toBe('connected');
    // Already a parameter: nothing to do.
    expect(apply(doc, { op: 'addParam', part: 'tone', node: 'filter1', port: 'resonance' }).ops).toEqual([]);
    doc = apply(doc, { op: 'disconnect', id: Object.values(doc.edges).find(e => e.to.node === 'tone1' && e.to.port === 'cutoff')!.id }).doc;
    // The inlet still feeds cutoff inside, so it is not free.
    expect(failure(() => apply(doc, { op: 'addParam', part: 'tone', node: 'filter1', port: 'cutoff' })).code).toBe('connected');
    const added = apply(doc, { op: 'addNode', node: { id: 'lvl1', type: 'kit.gain', inside: 'tone' } }, { op: 'addParam', part: 'tone', node: 'lvl1', port: 'gain', id: 'level', label: 'Level' });
    expect(added.doc.nodes.tone1!.values.level).toBe(1);
    expect(catalog.input(added.doc.nodes.tone1!, 'level')).toMatchObject({ label: 'Level', unit: 'gain', min: 0, max: 4 });
    expect(apply(added.doc, { op: 'addParam', part: 'tone', node: 'lvl1', port: 'gain', id: 'level' }).ops).toEqual([]);
    expect(failure(() => apply(added.doc, { op: 'addNode', node: { id: 'lvl2', type: 'kit.gain', inside: 'tone' } }, { op: 'addParam', part: 'tone', node: 'lvl2', port: 'gain', id: 'level' })).code).toBe('bad-id');
    let withCable = apply(added.doc, { op: 'addNode', node: { id: 'lfoX', type: 'den.lfo' } }, { op: 'connect', from: { node: 'lfoX', port: 'out' }, to: { node: 'tone1', port: 'level' } }).doc;
    // A cable into a parameter modulates the knob inside.
    expect(Object.values(validate(withCable, catalog).flat.doc.edges).some(e => e.from.node === 'lfoX' && e.to.node === 'tone1_lvl1' && e.to.port === 'gain')).toBe(true);
    const removed = apply(withCable, { op: 'removeParam', part: 'tone', id: 'level' });
    expect(removed.doc.nodes.tone1!.values.level).toBeUndefined();
    expect(Object.values(removed.doc.edges).some(e => e.to.node === 'tone1' && e.to.port === 'level')).toBe(false);
    undoes(withCable, removed);
    expect(failure(() => apply(withCable, { op: 'removeParam', part: 'tone', id: 'nope' })).code).toBe('unknown-port');
    // A cable into a knob inside that is a parameter: the knob is no longer free, so the parameter goes.
    withCable = apply(withCable, { op: 'addNode', node: { id: 'k2', type: 'kit.value', inside: 'tone' } }, { op: 'connect', from: { node: 'k2', port: 'out' }, to: { node: 'lvl1', port: 'gain' } }).doc;
    expect(withCable.parts.tone!.params.some(p => p.id === 'level')).toBe(false);
  });
  it('rename, describe and relabel; a part needs a name', () => {
    const doc = toned().doc;
    const r = apply(doc, { op: 'updatePart', part: 'tone', name: 'Body', doc: 'The oscillator through the filter.', labels: { resonance: 'Peak', out: 'Sound' } });
    expect(r.doc.parts.tone).toMatchObject({ name: 'Body', doc: 'The oscillator through the filter.' });
    expect(catalog.input(r.doc.nodes.tone1!, 'resonance')!.label).toBe('Peak');
    expect(catalog.output(r.doc.nodes.tone1!, 'out')!.label).toBe('Sound');
    expect(r.ops.some(isStructural)).toBe(false);
    undoes(doc, r);
    expect(failure(() => apply(doc, { op: 'updatePart', part: 'tone', name: '  ' })).code).toBe('bad-value');
    expect(failure(() => apply(doc, { op: 'updatePart', part: 'tone', labels: { nope: 'x' } })).code).toBe('unknown-port');
    expect(apply(r.doc, { op: 'updatePart', part: 'tone', doc: null, labels: { resonance: null } }).doc.parts.tone!.doc).toBeUndefined();
  });
});

describe('unpacking and detaching', () => {
  it('unpacking the only use moves the modules back (same ids, its values, its cables) and the part goes', () => {
    const before = bass();
    let doc = apply(toned().doc, { op: 'setValue', node: 'tone1', port: 'resonance', value: 3 }).doc;
    const r = apply(doc, { op: 'unpackPart', node: 'tone1' });
    expect(r.doc.parts).toEqual({});
    expect(r.created.sort()).toEqual(['filter1', 'osc1', 'vca1']);
    expect(r.doc.nodes.filter1!.inside).toBeUndefined();
    expect(r.doc.nodes.filter1!.values.resonance).toBe(3);
    doc = apply(r.doc, { op: 'setValue', node: 'filter1', port: 'resonance', value: 0.707 }).doc;
    expect(sound(doc)).toEqual(sound(before));
    undoes(apply(toned().doc, { op: 'setValue', node: 'tone1', port: 'resonance', value: 3 }).doc, r);
  });
  it('unpacking one of several uses copies the insides (fresh ids) and leaves the others alone', () => {
    const doc = apply(toned().doc, { op: 'addNode', node: { id: 'tone2', type: 'kit.part', part: 'tone' } }, { op: 'setValue', node: 'tone2', port: 'resonance', value: 2 }).doc;
    const r = apply(doc, { op: 'unpackPart', node: 'tone2' });
    expect(r.doc.parts.tone).toBeDefined();
    expect(r.created).toHaveLength(3);
    for (const id of r.created) { expect(r.doc.nodes[id]!.inside).toBeUndefined(); expect(['osc1', 'filter1', 'vca1']).not.toContain(id); }
    const filter = r.created.map(id => r.doc.nodes[id]!).find(n => n.type === 'den.filter')!;
    expect(filter.values.resonance).toBe(2);
    undoes(doc, r);
    expect(failure(() => apply(doc, { op: 'unpackPart', node: 'osc1' })).code).toBe('not-part');
    expect(failure(() => apply(doc, { op: 'unpackPart', node: 'nope' })).code).toBe('unknown-node');
  });
  it('a cable straight through a part (input to output) survives unpacking', () => {
    let doc = apply(bass(), { op: 'makePart', ids: ['gain1'], name: 'Through' }).doc;
    const inlet = doc.parts.through!.inputs[0]!.node, outlet = doc.parts.through!.outputs[0]!.node;
    doc = apply(doc, { op: 'connect', from: { node: inlet, port: 'out' }, to: { node: outlet, port: 'in' }, replace: true }, { op: 'removeNode', id: 'gain1' }).doc;
    // Expanded: Voice Mix goes straight to Out.
    expect(Object.values(validate(doc, catalog).flat.doc.edges).some(e => e.from.node === 'mix1' && e.to.node === 'out1')).toBe(true);
    const r = apply(doc, { op: 'unpackPart', node: 'through1' });
    expect(Object.values(r.doc.edges).some(e => e.from.node === 'mix1' && e.to.node === 'out1')).toBe(true);
  });
  it('detaching gives one use its own copy: edits inside it leave the others alone; a part used once cannot be detached', () => {
    const doc = apply(toned().doc, { op: 'addNode', node: { id: 'tone2', type: 'kit.part', part: 'tone' } }).doc;
    const r = apply(doc, { op: 'detachPart', node: 'tone2' });
    const own = r.doc.nodes.tone2!.part!;
    expect(own).not.toBe('tone');
    expect(r.doc.parts[own]!.name).toBe('Tone 2');
    const inner = Object.values(r.doc.nodes).filter(n => n.inside === own);
    expect(inner.length).toBe(Object.values(r.doc.nodes).filter(n => n.inside === 'tone').length);
    const osc = inner.find(n => n.type === 'den.oscillator')!;
    const edited = apply(r.doc, { op: 'setConfig', node: osc.id, key: 'waveform', value: 'sine' }).doc;
    const flat = validate(edited, catalog).flat.doc;
    expect(flat.nodes.tone1_osc1!.config.waveform).toBe('saw');
    expect(flat.nodes[`tone2_${osc.id}`]!.config.waveform).toBe('sine');
    expect(byType(r.doc)).toEqual(byType(doc));
    undoes(doc, r);
    expect(failure(() => apply(toned().doc, { op: 'detachPart', node: 'tone1' })).code).toBe('not-shared');
  });
});

describe('parts inside parts', () => {
  const nested = () => apply(toned().doc, { op: 'makePart', ids: ['filter1'], name: 'Inner' });
  it('a part made inside a part sits in it; ids expand along the chain; a parameter of the outer part can stand for one of the inner part', () => {
    const r = nested();
    const doc = r.doc;
    expect(r.created).toEqual(['inner1']);
    expect(doc.nodes.inner1!.inside).toBe('tone');
    expect(doc.nodes.filter1!.inside).toBe('inner');
    // The outer part's parameter followed the knob into the inner part? No: the knob moved, so the outer parameter is gone.
    expect(doc.parts.tone!.params).toEqual([]);
    expect(doc.parts.inner!.params.map(p => p.id)).toEqual(['resonance']);
    const flat = validate(doc, catalog).flat.doc;
    expect(flat.nodes.tone1_inner1_filter1).toBeDefined();
    expect(sound(doc)).toEqual(sound(bass()));
    const p = apply(doc, { op: 'addParam', part: 'tone', node: 'inner1', port: 'resonance', id: 'peak' }, { op: 'setValue', node: 'tone1', port: 'peak', value: 5 }).doc;
    const g = generate(p, catalog);
    expect(g.values.tone1_inner1_filter1_resonance).toBe(5);
    expect(g.aliases.tone1_peak).toEqual(['tone1_inner1_filter1_resonance']);
    // The inner use's own value is overridden by the outer parameter: turning it does nothing here.
    expect(g.aliases.inner1_resonance).toBeUndefined();
  });
  it('a definition used in itself (a broken file) is reported, never expanded forever; deep nesting stops at the cap', () => {
    const doc = nested().doc;
    const broken: PatchDocument = { ...doc, nodes: { ...doc.nodes, loop1: { id: 'loop1', type: 'kit.part', part: 'tone', inside: 'inner', pos: { x: 0, y: 0 }, config: {}, values: {} } } };
    const v = validate(broken, catalog);
    expect(v.issues.find(i => i.code === 'part-recursion')).toMatchObject({ severity: 'error', node: 'tone1' });
    // 10 levels of a part used 3 times: far past the cap, cut short with an error.
    let big = apply(bass(), { op: 'makePart', ids: ['osc1'], id: 'p0' }).doc;
    for (let k = 1; k <= 7; k++) {
      const use = Object.values(big.nodes).find(n => n.part === `p${k - 1}` && !n.inside)!;
      big = apply(big, { op: 'addNode', node: { type: 'kit.part', part: `p${k - 1}` } }, { op: 'addNode', node: { type: 'kit.part', part: `p${k - 1}` } }).doc;
      big = apply(big, { op: 'makePart', ids: Object.values(big.nodes).filter(n => n.part === `p${k - 1}` && !n.inside).map(n => n.id).concat(use.id), id: `p${k}` }).doc;
    }
    const t = performance.now();
    const vb = validate(big, catalog);
    expect(performance.now() - t).toBeLessThan(3000);
    expect(Object.keys(vb.flat.doc.nodes).length).toBeLessThanOrEqual(MAX_EXPANDED + 40);
    expect(vb.issues.some(i => i.code === 'too-many-nodes')).toBe(true);
  });
});

describe('what the checks and the compiler say, in terms of the patch as drawn', () => {
  it('a problem inside a part is shown on the use, with the path inside, said once per use', () => {
    let doc = apply(toned().doc, { op: 'addNode', node: { id: 'box1', type: 'kit.codebox', inside: 'tone', code: '' } }, { op: 'connect', from: { node: 'filter1', port: 'out' }, to: { node: 'box1', port: 'in' } }).doc;
    const issue = validate(doc, catalog).issues.find(i => i.code === 'codebox-empty')!;
    expect(issue).toMatchObject({ severity: 'error', node: 'tone1', path: ['tone1', 'box1'] });
    doc = apply(doc, { op: 'addNode', node: { id: 'tone2', type: 'kit.part', part: 'tone' } }).doc;
    const empties = validate(doc, catalog).issues.filter(i => i.code === 'codebox-empty');
    expect(empties.map(i => i.node).sort()).toEqual(['tone1', 'tone2']);
    const live = validate(doc, catalog).issues.find(i => i.code === 'not-live' && i.path?.at(-1) === 'box1')!;
    expect(live.message).toMatch(/box1 \(in tone\d\)/);
    expect(generate(doc, catalog).source).toBe('');
  });
  it('the analysis on the main patch: a part runs per voice when anything in it does', () => {
    const v = validate(toned().doc, catalog);
    expect(v.analysis.scope.get('tone1')).toBe('voice');
    expect(v.analysis.live.has('tone1')).toBe(true);
    expect(v.flatAnalysis.scope.get('tone1_osc1')).toBe('voice');
  });
  it('a codebox inside a part compiles once per use, with its source carried for type checking', () => {
    const doc = apply(toned().doc, { op: 'addNode', node: { id: 'box1', type: 'kit.codebox', inside: 'tone' } }, { op: 'disconnect', id: Object.values(toned().doc.edges).find(e => e.from.node === 'vca1')!.id }, { op: 'connect', from: { node: 'vca1', port: 'out' }, to: { node: 'box1', port: 'in' } }).doc;
    const outlet = doc.parts.tone!.outputs[0]!.node;
    const fixed = apply(doc, { op: 'connect', from: { node: 'box1', port: 'out' }, to: { node: outlet, port: 'in' }, replace: true }, { op: 'addNode', node: { id: 'tone2', type: 'kit.part', part: 'tone' } }, { op: 'connect', from: { node: 'tone2', port: 'out' }, to: { node: 'out1', port: 'right' } }).doc;
    const g = generate(fixed, catalog);
    expect(g.source).not.toBe('');
    expect(Object.keys(g.boxes).sort()).toEqual(['tone1_box1', 'tone2_box1']);
    expect(g.boxes.tone1_box1!.code).toBe(fixed.nodes.box1!.code);
    expect(g.nodes).toEqual(expect.arrayContaining(['tone1_box1', 'out1']));
    expect(Object.keys(g.codeboxes).sort()).toEqual(['tone1_box1', 'tone2_box1']);
  });
  it('broken references in a document are reported, not thrown: a missing part, cables across parts, a dangling cable', () => {
    const doc = toned().doc;
    const broken: PatchDocument = {
      ...doc,
      nodes: { ...doc.nodes, ghost1: { id: 'ghost1', type: 'kit.part', part: 'gone', pos: { x: 0, y: 0 }, config: {}, values: {} } },
      edges: { ...doc.edges, x1: { id: 'x1', from: { node: 'voice1', port: 'pitch' }, to: { node: 'filter1', port: 'cutoff' } }, x2: { id: 'x2', from: { node: 'nope', port: 'out' }, to: { node: 'gain1', port: 'in' } } },
    };
    const codes = validate(broken, catalog).issues.map(i => i.code);
    expect(codes).toEqual(expect.arrayContaining(['unknown-part', 'cross-part', 'dangling-edge']));
    expect(generate(broken, catalog).source).toBe('');
  });
});

describe('hearing a part alone', () => {
  it('its first output goes to Out instead of what normally does; a part that runs per voice is summed first', () => {
    const doc = toned().doc;
    const flat = flatten(doc, catalog, { solo: ['tone1'] }).doc;
    const intoOut = Object.values(flat.edges).filter(e => e.to.node === 'out1');
    expect(intoOut.map(e => e.from.node)).toEqual(['soloLMix']);
    expect(Object.values(flat.edges).find(e => e.to.node === 'soloLMix')!.from.node).toBe('tone1_vca1');
    const g = generate(doc, catalog, { solo: ['tone1'] });
    expect(g.source).not.toBe('');
    expect(g.issues.filter(i => i.severity === 'error')).toEqual([]);
    // Gone, or silent inside: said plainly, the rest plays.
    expect(validate(doc, catalog, { solo: ['nope'] }).issues.some(i => i.code === 'solo-missing')).toBe(true);
  });
  it('a global part goes straight to Out', () => {
    const doc = apply(bass(), { op: 'makePart', ids: ['gain1'], name: 'Level' }).doc;
    const flat = flatten(doc, catalog, { solo: ['level1'] }).doc;
    expect(Object.values(flat.edges).filter(e => e.to.node === 'out1').map(e => e.from.node)).toEqual(['level1_gain1']);
  });
});

describe('saving and loading parts', () => {
  it('round trip: the file has the parts but not the worked-out ports; reading it back gives the same patch', () => {
    const doc = nestedDoc();
    const text = serializeDocument(doc);
    const data = JSON.parse(text);
    expect(data.version).toBe(PATCH_VERSION);
    expect(Object.keys(data.parts).sort()).toEqual(['inner', 'tone']);
    expect(Object.values(data.nodes).some(n => (n as { iface?: unknown }).iface)).toBe(false);
    const read = parseDocument(text, catalog);
    if (!read.ok) throw new Error(read.error);
    expect(read.report).toEqual([]);
    expect(documentHash(read.doc)).toBe(documentHash(doc));
  });
  it('a damaged parts section is repaired and reported: bad ids, unreadable parameters, nodes of a missing part, cables across parts, unused parts', () => {
    const data = JSON.parse(serializeDocument(nestedDoc()));
    data.parts['Bad id'] = { name: 'x', inputs: [], outputs: [], params: [] };
    data.parts.tone.params.push({ id: 7 }, { id: 'ok', node: 'osc1', port: 'nope' });
    data.parts.unused = { name: 'Unused', inputs: [], outputs: [], params: [] };
    data.nodes.lost1 = { id: 'lost1', type: 'den.lfo', inside: 'vanished', pos: { x: 0, y: 0 } };
    data.edges.across = { id: 'across', from: { node: 'voice1', port: 'pitch' }, to: { node: 'osc1', port: 'frequency' } };
    data.nodes.tone1.values.ghost = 3;
    const read = parseDocument(JSON.stringify(data), catalog);
    if (!read.ok) throw new Error(read.error);
    const codes = read.report.map(i => i.code);
    expect(codes).toEqual(expect.arrayContaining(['dropped-part', 'dropped-param', 'dropped-node', 'dropped-edge', 'dropped-value']));
    expect(read.doc.parts['Bad id']).toBeUndefined();
    expect(read.doc.parts.unused).toBeUndefined();
    expect(read.doc.nodes.lost1).toBeUndefined();
    expect(read.doc.parts.tone!.params.some(p => p.id === 'ok')).toBe(false);
    expect(validate(read.doc, catalog).issues.filter(i => i.severity === 'error')).toEqual([]);
    expect(parseDocument(JSON.stringify({ ...data, parts: 'nope' }), catalog)).toMatchObject({ ok: true });
  });
  it('version 2 files (no parts) still load', () => {
    const data = JSON.parse(serializeDocument(bass()));
    data.version = 2; delete data.parts;
    const read = parseDocument(JSON.stringify(data), catalog);
    expect(read.ok && read.doc.parts).toEqual({});
  });
  it('describe tells the AI what each part is, where it is used and what is inside', () => {
    const text = describePatch(nestedDoc(), catalog);
    expect(text).toMatch(/tone1.*Part "Tone"/);
    expect(text).toMatch(/Part tone "Tone"/);
    expect(text).toMatch(/inner1.*Part "Inner"/);
  });
});

function nestedDoc() { return apply(toned().doc, { op: 'makePart', ids: ['filter1'], name: 'Inner' }).doc; }
/** The expanded patch by node type (ids aside): what a detached copy must keep. */
function byType(doc: PatchDocument) {
  const flat = validate(doc, catalog).flat.doc;
  const type = (id: string) => flat.nodes[id]!.type;
  return {
    nodes: Object.values(flat.nodes).map(n => JSON.stringify([n.type, n.config, n.values])).sort(),
    edges: Object.values(flat.edges).map(e => `${type(e.from.node)}.${e.from.port}>${type(e.to.node)}.${e.to.port}`).sort(),
  };
}

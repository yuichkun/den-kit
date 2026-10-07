// A part parameter's own knob range: a part built from math blocks (whose knobs
// go ±1e6) can show "Detune 0–1 st". The range is checked against the knob it
// turns, shown by the part's interface (so the use's knob, its face and the
// AI's steps all use it), kept in files and My parts, and can be changed or
// dropped later.
import { describe, expect, it } from 'vitest';
import { catalog } from '../../../src/blocks/index.ts';
import { describePatch } from '../../../src/core/describe.ts';
import { faceOf } from '../../../src/core/face.ts';
import { bundleHash, checkBundle, extractBundle } from '../../../src/core/library.ts';
import { applyIntents, applyResolvedOps, invertAll, OpError, type Intent } from '../../../src/core/ops.ts';
import { partInterface } from '../../../src/core/parts.ts';
import { parseDocument, serializeDocument } from '../../../src/core/persistence.ts';
import { emptyDocument, type PatchDocument } from '../../../src/core/schema.ts';
import { faceIntents } from '../../../src/plugin/faces.ts';

const apply = (doc: PatchDocument, ...intents: Intent[]) => applyIntents(doc, intents, catalog);
const failure = (fn: () => unknown): Error => { try { fn(); } catch (error) { return error as Error; } throw new Error('expected a failure'); };
/** A part Saw: a Multiply (detune amount × copy position), a lowpass and a compare, used once (saw1); its one parameter is the lowpass's cutoff. */
function saw(): PatchDocument {
  const made = apply(emptyDocument(),
    { op: 'addNode', node: { id: 'amt1', type: 'kit.mul' } },
    { op: 'addNode', node: { id: 'lp1', type: 'den.filter' } },
    { op: 'addNode', node: { id: 'gate1', type: 'kit.compare' } },
    { op: 'makePart', ids: ['amt1', 'lp1', 'gate1'], name: 'Saw', id: 'saw', node: 'saw1' },
  ).doc;
  return apply(made, ...made.parts.saw!.params.map((p): Intent => ({ op: 'removeParam', part: 'saw', id: p.id })), { op: 'addParam', part: 'saw', node: 'lp1', port: 'cutoff', id: 'cutoff' }).doc;
}
const param = (doc: PatchDocument, id: string) => partInterface(doc, catalog, doc.parts.saw!).inputs.find(p => p.id === id)!;

describe('a parameter\'s own range', () => {
  it('shows on the part: its knob, its face and the plugin control turn over that range in that unit', () => {
    const doc = apply(saw(), { op: 'addParam', part: 'saw', node: 'amt1', port: 'b', id: 'detune', label: 'Detune', range: { min: 0, max: 1, unit: 'st' } }).doc;
    expect(doc.parts.saw!.params.find(p => p.id === 'detune')).toMatchObject({ range: { min: 0, max: 1, unit: 'st' } });
    expect(param(doc, 'detune')).toMatchObject({ uiMin: 0, uiMax: 1, unit: 'st', min: -1e6, max: 1e6 });
    const face = faceOf(doc.parts.saw!, catalog.inputs(doc.nodes.saw1!));
    expect(face.controls.some(c => c.param === 'detune')).toBe(true);
    const on = apply(doc, ...faceIntents(doc, catalog, 'saw1').intents).doc;
    const knob = Object.values(on.nodes).find(n => n.type === 'ui.knob' && Object.values(on.edges).some(e => e.from.node === n.id && e.to.port === 'detune'))!;
    expect(knob.config).toMatchObject({ min: 0, max: 1, unit: 'st', scale: 'linear' });
    expect(describePatch(doc, catalog)).toMatch(/detune=amt1\.b "Detune" \(0–1 st\)/);
  });
  it('a log range on a frequency knob, inside its limits', () => {
    const doc = apply(saw(), { op: 'updatePart', part: 'saw', ranges: { cutoff: { min: 200, max: 4000, scale: 'log' } } }).doc;
    expect(param(doc, 'cutoff')).toMatchObject({ uiMin: 200, uiMax: 4000, scale: 'log', unit: 'Hz' });
  });
  it.each([
    ['max not above min', 'cutoff', { min: 1, max: 1 }, /max must be above its min/],
    ['not numbers', 'cutoff', { min: 'a', max: 2 }, /min must be a number/],
    ['outside the knob inside', 'cutoff', { min: 5, max: 30000 }, /goes from 20 to 20000/],
    ['a log range from zero', 'b', { min: 0, max: 100, scale: 'log' }, /log range must start above 0/],
    ['an unknown unit', 'cutoff', { min: 20, max: 200, unit: 'furlongs' }, /range unit is one of/],
    ['not an object', 'cutoff', [1, 2], /range is \{min, max/],
  ])('refuses %s (the patch unchanged)', (_name, id, range, message) => {
    const doc = apply(saw(), { op: 'addParam', part: 'saw', node: 'amt1', port: 'b', id: 'b' }).doc;
    const e = failure(() => apply(doc, { op: 'updatePart', part: 'saw', ranges: { [id]: range as never } }));
    expect(e).toBeInstanceOf(OpError);
    expect(e.message).toMatch(message);
  });
  it('given again on a knob that is already a parameter, the label and range go on it', () => {
    const doc = apply(saw(), { op: 'addParam', part: 'saw', node: 'lp1', port: 'cutoff', label: 'Tone', range: { min: 100, max: 8000, scale: 'log' } }).doc;
    expect(doc.parts.saw!.params).toEqual([{ id: 'cutoff', node: 'lp1', port: 'cutoff', label: 'Tone', range: { min: 100, max: 8000, scale: 'log' } }]);
  });
  it('an on/off parameter has no range; an unknown parameter is named', () => {
    const doc = apply(saw(), { op: 'addParam', part: 'saw', node: 'gate1', port: 'b', id: 'edge' }).doc;
    expect(failure(() => apply(doc, { op: 'updatePart', part: 'saw', ranges: { nope: { min: 0, max: 1 } } })).message).toMatch(/no parameter "nope"/);
    const reset = apply(emptyDocument(), { op: 'addNode', node: { id: 'env1', type: 'den.envelope' } }, { op: 'addNode', node: { id: 'v1', type: 'kit.value' } }, { op: 'makePart', ids: ['env1', 'v1'], name: 'Env', id: 'env', node: 'env9' }).doc;
    const port = catalog.inputs(reset.nodes.env1!).find(p => p.type === 'gate' && !p.binding);
    if (port) expect(failure(() => apply(reset, { op: 'addParam', part: 'env', node: 'env1', port: port.id, range: { min: 0, max: 1 } }))).toBeInstanceOf(OpError);
  });
  it('changed and dropped with updatePart; each is one undo step', () => {
    const base = apply(saw(), { op: 'addParam', part: 'saw', node: 'amt1', port: 'b', id: 'detune', range: { min: 0, max: 1, unit: 'st' } }).doc;
    const wider = apply(base, { op: 'updatePart', part: 'saw', ranges: { detune: { min: 0, max: 2, unit: 'st' } } });
    expect(param(wider.doc, 'detune')).toMatchObject({ uiMax: 2 });
    const plain = apply(wider.doc, { op: 'updatePart', part: 'saw', ranges: { detune: null } });
    expect(plain.doc.parts.saw!.params.find(p => p.id === 'detune')!.range).toBeUndefined();
    expect(param(plain.doc, 'detune')).toMatchObject({ uiMin: -2, uiMax: 2 }); // the Multiply's own
    expect(param(plain.doc, 'detune').unit).toBeUndefined();
    expect(applyResolvedOps(plain.doc, invertAll(plain.ops)).parts).toEqual(wider.doc.parts);
  });
});

describe('ranges in files and My parts', () => {
  const ranged = () => apply(saw(), { op: 'addParam', part: 'saw', node: 'amt1', port: 'b', id: 'detune', range: { min: 0, max: 1, unit: 'st' } }).doc;
  it('kept by a file; a range that cannot be read is dropped with a reason (the parameter stays); one beyond the knob is kept inside it', () => {
    const doc = ranged();
    const back = parseDocument(serializeDocument(doc), catalog);
    if (!back.ok) throw new Error(back.error);
    expect(back.report).toEqual([]);
    expect(back.doc.parts.saw!.params).toEqual(doc.parts.saw!.params);
    const raw = JSON.parse(serializeDocument(doc));
    raw.parts.saw.params.find((p: { id: string }) => p.id === 'detune').range = { min: 3, max: 1 };
    raw.parts.saw.params.find((p: { id: string }) => p.id === 'cutoff').range = { min: -5, max: 1e9 };
    const read = parseDocument(JSON.stringify(raw), catalog);
    if (!read.ok) throw new Error(read.error);
    expect(read.report.map(i => i.code)).toEqual(['dropped-range']);
    expect(read.doc.parts.saw!.params.find(p => p.id === 'detune')).not.toHaveProperty('range');
    expect(param(read.doc, 'cutoff')).toMatchObject({ uiMin: 20, uiMax: 20000 });
  });
  it('carried by My parts, and part of what a version is', () => {
    const doc = ranged();
    const bundle = extractBundle(doc, 'saw');
    const checked = checkBundle(JSON.parse(JSON.stringify(bundle)), catalog);
    if (typeof checked === 'string') throw new Error(checked);
    expect(checked.part.params.find(p => p.id === 'detune')!.range).toEqual({ min: 0, max: 1, unit: 'st' });
    const other = apply(doc, { op: 'updatePart', part: 'saw', ranges: { detune: { min: 0, max: 3, unit: 'st' } } }).doc;
    expect(bundleHash(extractBundle(other, 'saw'))).not.toBe(bundleHash(bundle));
  });
});

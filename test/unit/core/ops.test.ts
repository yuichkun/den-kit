import { describe, expect, it } from 'vitest';
import { catalog } from '../../../src/blocks/index.ts';
import { applyIntents, applyResolvedOps, invertAll, OpError, type Intent } from '../../../src/core/ops.ts';
import { emptyDocument, type PatchDocument } from '../../../src/core/schema.ts';
import { starter } from '../../../src/core/starters.ts';
import { validate } from '../../../src/core/validate.ts';

const apply = (doc: PatchDocument, ...intents: Intent[]) => applyIntents(doc, intents, catalog);
const failure = (fn: () => unknown) => { try { fn(); } catch (e) { if (e instanceof OpError) return e; throw e; } throw new Error('expected OpError'); };
const base = () => apply(emptyDocument('t', 't'),
  { op: 'addNode', node: { id: 'osc1', type: 'den.oscillator' } },
  { op: 'addNode', node: { id: 'filter1', type: 'den.filter' } },
  { op: 'addNode', node: { id: 'out1', type: 'kit.out' } },
).doc;

describe('ops: rejection keeps the document untouched', () => {
  it('A1 unknown node type', () => {
    const doc = base(); const before = JSON.stringify(doc);
    const e = failure(() => apply(doc, { op: 'addNode', node: { type: 'den.nope' } }));
    expect(e.code).toBe('unknown-type'); expect(JSON.stringify(doc)).toBe(before);
  });
  it('A2 duplicate and invalid ids', () => {
    expect(failure(() => apply(base(), { op: 'addNode', node: { id: 'osc1', type: 'den.oscillator' } })).code).toBe('duplicate-id');
    expect(failure(() => apply(base(), { op: 'addNode', node: { id: '1bad', type: 'den.oscillator' } })).code).toBe('bad-id');
    expect(failure(() => apply(base(), { op: 'addNode', node: { id: 'a_b', type: 'den.oscillator' } })).code).toBe('bad-id');
  });
  it('A3 cables to missing nodes or ports name the valid choices', () => {
    const e1 = failure(() => apply(base(), { op: 'connect', from: { node: 'ghost', port: 'out' }, to: { node: 'filter1', port: 'input' } }));
    expect(e1.code).toBe('unknown-node'); expect(e1.hint).toContain('osc1');
    const e2 = failure(() => apply(base(), { op: 'connect', from: { node: 'osc1', port: 'nope' }, to: { node: 'filter1', port: 'input' } }));
    expect(e2.code).toBe('unknown-port'); expect(e2.hint).toContain('out');
    const e3 = failure(() => apply(base(), { op: 'connect', from: { node: 'osc1', port: 'out' }, to: { node: 'filter1', port: 'nope' } }));
    expect(e3.hint).toContain('cutoff');
  });
  it('A5 second driver needs replace', () => {
    let doc = apply(base(), { op: 'addNode', node: { id: 'osc2', type: 'den.oscillator' } }, { op: 'connect', from: { node: 'osc1', port: 'out' }, to: { node: 'filter1', port: 'input' } }).doc;
    expect(failure(() => apply(doc, { op: 'connect', from: { node: 'osc2', port: 'out' }, to: { node: 'filter1', port: 'input' } })).code).toBe('input-taken');
    doc = apply(doc, { op: 'connect', from: { node: 'osc2', port: 'out' }, to: { node: 'filter1', port: 'input' }, replace: true }).doc;
    expect(Object.values(doc.edges).filter(e => e.to.node === 'filter1')).toHaveLength(1);
    expect(Object.values(doc.edges)[0]!.from.node).toBe('osc2');
  });
  it('connect is idempotent', () => {
    const doc = apply(base(), { op: 'connect', from: { node: 'osc1', port: 'out' }, to: { node: 'filter1', port: 'input' } }).doc;
    const again = apply(doc, { op: 'connect', from: { node: 'osc1', port: 'out' }, to: { node: 'filter1', port: 'input' } });
    expect(again.ops).toEqual([]);
  });
  it('A6 loops need History', () => {
    const doc = apply(base(), { op: 'addNode', node: { id: 'add1', type: 'kit.add' } }, { op: 'addNode', node: { id: 'hist1', type: 'kit.history' } },
      { op: 'connect', from: { node: 'osc1', port: 'out' }, to: { node: 'add1', port: 'a' } },
      { op: 'connect', from: { node: 'add1', port: 'out' }, to: { node: 'filter1', port: 'input' } }).doc;
    const e = failure(() => apply(doc, { op: 'connect', from: { node: 'filter1', port: 'out' }, to: { node: 'add1', port: 'b' } }));
    expect(e.code).toBe('cycle'); expect(e.hint).toContain('History');
    expect(failure(() => apply(doc, { op: 'connect', from: { node: 'add1', port: 'out' }, to: { node: 'add1', port: 'b' } })).code).toBe('cycle');
    const ok = apply(doc, { op: 'connect', from: { node: 'filter1', port: 'out' }, to: { node: 'hist1', port: 'in' } }, { op: 'connect', from: { node: 'hist1', port: 'out' }, to: { node: 'add1', port: 'b' } });
    expect(Object.keys(ok.doc.edges)).toHaveLength(4);
  });
  it('A10 NaN, Infinity and out-of-range values are refused; UI drags clamp', () => {
    const doc = base();
    for (const value of [NaN, Infinity, -Infinity]) expect(failure(() => apply(doc, { op: 'setValue', node: 'filter1', port: 'cutoff', value })).code).toBe('bad-value');
    expect(failure(() => apply(doc, { op: 'setValue', node: 'filter1', port: 'cutoff', value: 50000 })).code).toBe('out-of-range');
    expect(apply(doc, { op: 'setValue', node: 'filter1', port: 'cutoff', value: 50000, clamp: true }).doc.nodes.filter1!.values.cutoff).toBe(20000);
    expect(failure(() => apply(doc, { op: 'setValue', node: 'filter1', port: 'reset', value: 0.5 })).code).toBe('bad-value');
    expect(failure(() => apply(doc, { op: 'addNode', node: { type: 'den.filter', values: { cutoff: -5 } } })).code).toBe('bad-value');
  });
  it('bad config is refused with the valid keys', () => {
    expect(failure(() => apply(base(), { op: 'setConfig', node: 'osc1', key: 'waveform', value: 'square' })).code).toBe('bad-config');
    const e = failure(() => apply(base(), { op: 'setConfig', node: 'osc1', key: 'shape', value: 'saw' }));
    expect(e.hint).toContain('waveform');
    expect(failure(() => apply(base(), { op: 'addNode', node: { type: 'kit.voiceIn', config: { capacity: 99 } } })).code).toBe('bad-config');
  });
  it('A13 a failing op rolls back the whole transaction', () => {
    const doc = base(); const before = JSON.stringify(doc);
    const e = failure(() => apply(doc, { op: 'addNode', node: { id: 'gain1', type: 'kit.gain' } }, { op: 'connect', from: { node: 'osc1', port: 'out' }, to: { node: 'gain1', port: 'in' } }, { op: 'setValue', node: 'gain1', port: 'gain', value: 99 }));
    expect(e.index).toBe(2);
    expect(JSON.stringify(doc)).toBe(before);
  });
  it('malformed intents are refused, not thrown as TypeErrors', () => {
    expect(failure(() => apply(base(), null as unknown as Intent)).code).toBe('bad-intent');
    expect(failure(() => apply(base(), { op: 'explode' } as unknown as Intent)).code).toBe('bad-intent');
    expect(failure(() => apply(base(), { op: 'connect' } as unknown as Intent)).code).toBe('bad-intent');
    expect(failure(() => apply(base(), { op: 'addNode', node: {} } as unknown as Intent)).code).toBe('bad-intent');
    expect(failure(() => apply(base(), { op: 'move', node: 'osc1', pos: { x: NaN, y: 0 } })).code).toBe('bad-value');
  });
  it('singletons', () => {
    expect(failure(() => apply(base(), { op: 'addNode', node: { type: 'kit.out' } })).code).toBe('singleton');
  });
  it('A15 removing a node removes its cables; undo restores node, cables, values and panel', () => {
    let doc = apply(base(), { op: 'connect', from: { node: 'osc1', port: 'out' }, to: { node: 'filter1', port: 'input' } }, { op: 'connect', from: { node: 'filter1', port: 'out' }, to: { node: 'out1', port: 'left' } }, { op: 'setValue', node: 'filter1', port: 'cutoff', value: 777 }).doc;
    const before = doc;
    const r = apply(doc, { op: 'removeNode', id: 'filter1' });
    expect(Object.keys(r.doc.edges)).toHaveLength(0);
    doc = applyResolvedOps(r.doc, invertAll(r.ops));
    expect({ ...doc, revision: 0 }).toEqual({ ...before, revision: 0 });
  });
  it('config changes that remove ports drop the affected cables (and undo brings them back)', () => {
    let doc = apply(base(), { op: 'addNode', node: { id: 'mixer1', type: 'kit.mix', config: { channels: 4 } } }, { op: 'connect', from: { node: 'osc1', port: 'out' }, to: { node: 'mixer1', port: 'in4' } }).doc;
    const r = apply(doc, { op: 'setConfig', node: 'mixer1', key: 'channels', value: 2 });
    expect(Object.keys(r.doc.edges)).toHaveLength(0);
    doc = applyResolvedOps(r.doc, invertAll(r.ops));
    expect(Object.keys(doc.edges)).toHaveLength(1);
  });
  it('codebox port changes drop cables to vanished ports', () => {
    const doc = apply(base(), { op: 'addNode', node: { id: 'box1', type: 'kit.codebox', code: 'x' } }, { op: 'connect', from: { node: 'osc1', port: 'out' }, to: { node: 'box1', port: 'in' } }).doc;
    const r = apply(doc, { op: 'setCode', node: 'box1', code: 'y', ports: { inputs: [{ id: 'x', type: 'signal' }], outputs: [{ id: 'out', type: 'signal' }] } });
    expect(Object.keys(r.doc.edges)).toHaveLength(0);
    expect(failure(() => apply(doc, { op: 'setCode', node: 'box1', code: 'y', ports: { inputs: [{ id: 'a', type: 'signal' }, { id: 'a', type: 'signal' }], outputs: [] } })).code).toBe('bad-ports');
    expect(failure(() => apply(doc, { op: 'setCode', node: 'osc1', code: 'y' })).code).toBe('not-codebox');
  });
  it('only widgets can be placed on the panel', () => {
    expect(failure(() => apply(base(), { op: 'setPanel', node: 'osc1', panel: { x: 0, y: 0, w: 10, h: 10 } })).code).toBe('not-widget');
    const doc = apply(base(), { op: 'addNode', node: { id: 'knob1', type: 'ui.knob' } }).doc;
    expect(apply(doc, { op: 'setPanel', node: 'knob1', panel: { x: 1, y: 2, w: 60, h: 80 } }).doc.nodes.knob1!.panel).toEqual({ x: 1, y: 2, w: 60, h: 80 });
    expect(failure(() => apply(doc, { op: 'setPanel', node: 'knob1', panel: { x: 1, y: 2, w: 0, h: 80 } })).code).toBe('bad-panel');
  });
});

describe('A11 property: random edits always invert exactly and never throw anything but OpError', () => {
  it('10k seeded steps', () => {
    let seed = 42;
    const rand = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
    const types = catalog.list().filter(d => !d.singleton).map(d => d.type);
    let doc = starter('pad', catalog);
    let applied = 0;
    for (let step = 0; step < 10000; step++) {
      if (!Object.keys(doc.nodes).length) doc = starter('pad', catalog);
      const nodes = Object.values(doc.nodes);
      const node = pick(nodes);
      const other = pick(nodes);
      const outs = catalog.outputs(other), ins = catalog.inputs(node);
      const parts = Object.keys(doc.parts);
      const intent: Intent = pick([
        () => ({ op: 'addNode', node: { type: pick(types), pos: { x: rand() * 1000, y: rand() * 1000 } } }),
        // Parts: made from a few modules, unpacked, detached, used again, edited inside.
        () => ({ op: 'makePart', ids: [node.id, other.id, pick(nodes).id].slice(0, 1 + Math.floor(rand() * 3)) }),
        () => ({ op: 'unpackPart', node: node.id }),
        () => ({ op: 'detachPart', node: node.id }),
        () => ({ op: 'addNode', node: { type: rand() < 0.5 ? 'kit.part' : pick(types), part: parts.length ? pick(parts) : 'nope', inside: parts.length && rand() < 0.7 ? pick(parts) : undefined, pos: { x: 0, y: 0 } } }),
        () => ({ op: 'addParam', part: parts.length ? pick(parts) : 'nope', node: node.id, port: ins.length ? pick(ins).id : 'x' }),
        () => ({ op: 'removeParam', part: parts.length ? pick(parts) : 'nope', id: ins.length ? pick(ins).id : 'x' }),
        () => ({ op: 'removeNode', id: node.id }),
        () => ({ op: 'connect', from: { node: other.id, port: outs.length ? pick(outs).id : 'out' }, to: { node: node.id, port: ins.length ? pick(ins).id : 'in' }, replace: rand() < 0.5 }),
        () => ({ op: 'disconnect', id: pick(Object.keys(doc.edges).concat('e999')) }),
        () => ({ op: 'setValue', node: node.id, port: ins.length ? pick(ins).id : 'x', value: rand() < 0.1 ? NaN : (rand() - 0.5) * 100, clamp: rand() < 0.5 }),
        () => ({ op: 'move', node: node.id, pos: { x: rand() * 100, y: rand() * 100 } }),
        () => ({ op: 'setConfig', node: node.id, key: catalog.find(node.type)?.config[0]?.id ?? 'x', value: pick(['saw', 'sine', 2, 4, true, 'poly']) }),
      ] as Array<() => Intent>)();
      try {
        const r = applyIntents(doc, [intent], catalog);
        const back = applyResolvedOps(r.doc, invertAll(r.ops));
        expect({ ...back, revision: 0 }).toEqual({ ...doc, revision: 0 });
        expect(r.doc.revision).toBe(doc.revision + 1);
        doc = r.doc; applied++;
        validate(doc, catalog);
      } catch (error) {
        if (!(error instanceof OpError)) throw error;
      }
      if (Object.keys(doc.nodes).length > 120) doc = starter('pad', catalog);
    }
    expect(applied).toBeGreaterThan(3000);
  }, 30_000);
});

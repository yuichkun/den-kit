// The session with copies (×N): turning a stacked node's knob reaches every
// copy's AudioParam (a spread knob's copies move around its new centre), and so
// does dragging how it spreads, without recompiling; changing the count or which
// knobs spread recompiles. The estimated load follows the count.
import { describe, expect, it } from 'vite-plus/test';
import { KitSession } from '../../../src/editor/session.ts';
import { applyIntents } from '../../../src/work/ops.ts';
import { emptyDocument } from '../../../src/work/schema.ts';
import { catalog } from '../../../src/sound/blocks/index.ts';

/** Noise ×4 → band-pass ×4 (cutoff spread ±1 octave) → Out. */
function makeSession() {
  const set: Array<[string, number]> = [];
  const session = new KitSession({
    storage: null,
    createWorker: () =>
      ({
        postMessage() {},
        terminate() {},
        onmessage: null,
        onerror: null,
        onmessageerror: null,
      }) as never,
    engine: {
      setParam: (name: string, value: number) => set.push([name, value]),
      setAssets() {},
      unload() {},
      running: false,
    } as never,
  });
  const doc = applyIntents(
    emptyDocument('rain'),
    [
      { op: 'addNode', node: { id: 'noise1', type: 'den.seededNoise', count: 4 } },
      {
        op: 'addNode',
        node: {
          id: 'svf1',
          type: 'den.stateVariableFilter',
          count: 4,
          values: { cutoffHz: 1000, q: 4 },
          spread: { cutoffHz: { kind: 'range', amount: 1 } },
        },
      },
      { op: 'addNode', node: { id: 'out1', type: 'kit.out' } },
      { op: 'connect', from: { node: 'noise1', port: 'out' }, to: { node: 'svf1', port: 'input' } },
      {
        op: 'connect',
        from: { node: 'svf1', port: 'bandpass' },
        to: { node: 'out1', port: 'left' },
      },
    ],
    catalog,
  ).doc;
  session.replace(doc, 'Rain', false);
  return { session, set };
}
const cutoffs = (values: Record<string, number>) =>
  [0, 1, 2, 3].map(k => Math.round(values[`svf1_${k}_cutoffHz`]!));

describe('knobs of copies, without recompiling', () => {
  it('turning the centre of a spread knob moves every copy; a knob the same in every copy is one AudioParam', () => {
    const { session, set } = makeSession();
    const hash = session.generated.value.hash;
    expect(cutoffs(session.generated.value.values)).toEqual([500, 794, 1260, 2000]);
    set.length = 0;
    session.commit([{ op: 'setValue', node: 'svf1', port: 'cutoffHz', value: 2000 }]);
    expect(set.map(([n]) => n).sort()).toEqual([
      'svf1_0_cutoffHz',
      'svf1_1_cutoffHz',
      'svf1_2_cutoffHz',
      'svf1_3_cutoffHz',
    ]);
    expect(cutoffs(session.generated.value.values)).toEqual([1000, 1587, 2520, 4000]);
    set.length = 0;
    session.commit([{ op: 'setValue', node: 'svf1', port: 'q', value: 2 }]);
    expect(set).toEqual([['svf1_q', 2]]);
    expect(session.generated.value.hash).toBe(hash);
  });
  it("dragging how a knob spreads (amount, kind, one copy's value) sends values only; which knob spreads, or the count, recompiles", () => {
    const { session, set } = makeSession();
    const hash = session.generated.value.hash;
    set.length = 0;
    session.commit([
      { op: 'setSpread', node: 'svf1', port: 'cutoffHz', spread: { kind: 'range', amount: 2 } },
    ]);
    expect(cutoffs(session.generated.value.values)).toEqual([250, 630, 1587, 4000]);
    expect(set).toHaveLength(4);
    session.commit([
      {
        op: 'setSpread',
        node: 'svf1',
        port: 'cutoffHz',
        spread: { kind: 'each', values: [300, 600, 900, 1200] },
      },
    ]);
    expect(cutoffs(session.generated.value.values)).toEqual([300, 600, 900, 1200]);
    session.commit([
      { op: 'setSpread', node: 'svf1', port: 'cutoffHz', spread: { kind: 'harmonic' } },
    ]);
    expect(cutoffs(session.generated.value.values)).toEqual([1000, 2000, 3000, 4000]);
    expect(session.generated.value.hash).toBe(hash);
    // Nothing moved, nothing sent.
    set.length = 0;
    session.commit([{ op: 'move', node: 'svf1', pos: { x: 40, y: 40 } }]);
    expect(set).toEqual([]);
    session.commit([
      { op: 'setSpread', node: 'svf1', port: 'q', spread: { kind: 'range', amount: 1 } },
    ]);
    expect(session.generated.value.hash).not.toBe(hash);
    const spreadQ = session.generated.value.hash;
    session.commit([{ op: 'setCount', node: 'svf1', count: 6 }]);
    expect(session.generated.value.hash).not.toBe(spreadQ);
    // Undo walks back through all of it.
    for (let i = 0; i < 6; i++) session.undo();
    expect(session.generated.value.hash).toBe(hash);
    expect(cutoffs(session.generated.value.values)).toEqual([500, 794, 1260, 2000]);
  });
  it('the estimated load follows the count', () => {
    const { session } = makeSession();
    const four = session.validation.value.cost.cpu;
    session.commit([
      { op: 'setCount', node: 'svf1', count: 32 },
      { op: 'setCount', node: 'noise1', count: 32 },
    ]);
    expect(session.validation.value.cost.cpu).toBeGreaterThan(four * 6);
    expect(session.validation.value.cost.byNode.svf1).toBeGreaterThan(
      session.validation.value.cost.byNode.noise1!,
    );
  });
});

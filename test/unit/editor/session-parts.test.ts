// The session with parts: going inside and out (the path survives undo or is
// cut back), a knob turn on a use or inside a part reaching exactly the
// AudioParams it stands for without recompiling, hearing one part alone.
import { describe, expect, it } from 'vite-plus/test';
import { KitSession } from '../../../src/editor/session.ts';
import { starter } from '../../../src/core/starters.ts';
import { catalog } from '../../../src/blocks/index.ts';

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
      unload() {},
      running: false,
    } as never,
  });
  session.replace(starter('bass', catalog), 'Bass', false);
  return { session, set };
}
/** The bass's oscillator, filter and VCA as part Tone, used twice (tone1 in the voice, tone2 on the right channel). */
function withParts() {
  const s = makeSession();
  const r = s.session.commit([{ op: 'makePart', ids: ['osc1', 'filter1', 'vca1'], name: 'Tone' }]);
  if (!r.ok) throw r.error;
  const r2 = s.session.commit([
    { op: 'addNode', node: { id: 'tone2', type: 'kit.part', part: 'tone' } },
    { op: 'connect', from: { node: 'tone2', port: 'out' }, to: { node: 'out1', port: 'right' } },
  ]);
  if (!r2.ok) throw r2.error;
  return s;
}

describe('going inside parts', () => {
  it('enter a use, go deeper, come out; the use you came out of is selected', () => {
    const { session } = withParts();
    expect(session.enterPart('osc1')).toBe(false); // not a part
    expect(session.enterPart('tone1')).toBe(true);
    expect(session.scope.value).toBe('tone');
    expect(session.enterPart('tone2')).toBe(false); // not inside Tone
    const r = session.commit([{ op: 'makePart', ids: ['filter1'], name: 'Inner' }]);
    expect(r.ok).toBe(true);
    expect(session.doc.value.nodes.inner1!.inside).toBe('tone');
    expect(session.enterPart('inner1')).toBe(true);
    expect(session.partPath.value).toEqual(['tone1', 'inner1']);
    expect(session.scope.value).toBe('inner');
    session.leavePart();
    expect(session.partPath.value).toEqual(['tone1']);
    expect(session.selection.value).toEqual(['inner1']);
    session.leavePart(Infinity);
    expect(session.partPath.value).toEqual([]);
    expect(session.selection.value).toEqual(['tone1']);
    session.leavePart(); // nothing to leave
    expect(session.partPath.value).toEqual([]);
  });
  it('an undo that takes away the part you are in brings the view back out; loading a patch starts outside', () => {
    const { session } = makeSession();
    session.commit([{ op: 'makePart', ids: ['osc1', 'filter1'], name: 'Tone' }]);
    session.enterPart('tone1');
    session.undo();
    expect(session.partPath.value).toEqual([]);
    session.redo();
    session.enterPart('tone1');
    session.replace(starter('pad', catalog), 'Pad');
    expect(session.partPath.value).toEqual([]);
  });
});

describe('knobs reach the AudioParams they stand for, without recompiling', () => {
  it('a parameter of one use sets only that use; a shared knob inside sets every use; a knob a parameter stands for sets nothing', () => {
    const { session, set } = withParts();
    const hash = session.generated.value.hash;
    set.length = 0;
    session.commit([{ op: 'setValue', node: 'tone2', port: 'resonance', value: 3 }]);
    expect(set).toEqual([['tone2_filter1_resonance', 3]]);
    expect(session.generated.value.values.tone2_filter1_resonance).toBe(3);
    expect(session.generated.value.values.tone1_filter1_resonance).toBe(0.707);
    set.length = 0;
    session.commit([
      {
        op: 'disconnect',
        id: Object.values(session.doc.value.edges).find(
          e => e.to.node === 'filter1' && e.to.port === 'cutoff',
        )!.id,
      },
    ]);
    const after = session.generated.value.hash;
    expect(after).not.toBe(hash); // a cable: structural
    set.length = 0;
    session.commit([{ op: 'setValue', node: 'filter1', port: 'cutoff', value: 700 }]);
    expect(set.map(([n]) => n).sort()).toEqual(['tone1_filter1_cutoff', 'tone2_filter1_cutoff']);
    expect(session.generated.value.hash).toBe(after);
    set.length = 0;
    session.commit([{ op: 'setValue', node: 'filter1', port: 'resonance', value: 6 }]); // the parameter's default: the uses keep theirs
    expect(set.filter(([n]) => n.startsWith('tone'))).toEqual([]);
    expect(session.generated.value.values.tone2_filter1_resonance).toBe(3);
  });
});

describe('hearing one part alone', () => {
  it('solo recompiles with only that part on Out; a solo whose part goes away ends by itself', () => {
    const { session } = withParts();
    const normal = session.generated.value.source;
    session.setSolo(['tone2']);
    expect(session.generated.value.source).not.toBe(normal);
    expect(session.generated.value.source).toContain('tone2_vca1');
    expect(session.generated.value.source).not.toContain('tone1_vca1');
    session.commit([{ op: 'removeNode', id: 'tone2' }]);
    expect(session.solo.value).toBeNull();
    session.setSolo(null);
    expect(session.solo.value).toBeNull();
  });
});

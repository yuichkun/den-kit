// Every operation type, one by one: a change that fits applies and undoes to
// exactly what was there; one that does not fit is refused as a whole, says
// why, and leaves the work as it was.
import { describe, expect, it } from 'vite-plus/test';
import { catalog } from '../../../src/sound/blocks/index.ts';
import { extractBundle } from '../../../src/work/library.ts';
import {
  applyIntents,
  applyResolvedOps,
  invertAll,
  OpError,
  type Intent,
} from '../../../src/work/ops.ts';
import type { PatchDocument } from '../../../src/work/schema.ts';
import { starter } from '../../../src/work/starters.ts';

const HASH = `sha256-${'d'.repeat(64)}`;
const apply = (doc: PatchDocument, intents: Intent[]) => applyIntents(doc, intents, catalog).doc;

/** The bass starter with a knob, a text and a picture on the plugin, and a part made of the filter section. */
function base(): PatchDocument {
  return apply(starter('bass', catalog), [
    {
      op: 'addNode',
      node: { id: 'knob1', type: 'ui.knob', panel: { x: 10, y: 10, w: 80, h: 90 } },
    },
    {
      op: 'addNode',
      node: { id: 'knob2', type: 'ui.knob', panel: { x: 100, y: 10, w: 80, h: 90 } },
    },
    {
      op: 'addElement',
      element: { id: 'title1', kind: 'text', text: 'Bass', rect: { x: 10, y: 120, w: 100, h: 20 } },
    },
    {
      op: 'addAsset',
      asset: { id: 'assets/dot.png', name: 'dot.png', mime: 'image/png', bytes: 10, hash: HASH },
    },
    { op: 'addNode', node: { id: 'osc9', type: 'den.oscillator' } },
    { op: 'addNode', node: { id: 'gain9', type: 'kit.gain' } },
    { op: 'connect', from: { node: 'osc9', port: 'out' }, to: { node: 'gain9', port: 'in' } },
    { op: 'makePart', ids: ['osc9', 'gain9'], name: 'Tone', id: 'tone', node: 'tone1' },
  ]);
}

interface Case {
  /** Changes that fit, applied to the base. */
  ok: (doc: PatchDocument) => Intent[];
  /** A change that does not fit. */
  bad: (doc: PatchDocument) => Intent[];
}
const CASES: Record<Intent['op'], Case> = {
  addNode: {
    ok: () => [{ op: 'addNode', node: { id: 'lfo9', type: 'den.lfo' } }],
    bad: () => [{ op: 'addNode', node: { type: 'den.nope' } }],
  },
  removeNode: {
    ok: () => [{ op: 'removeNode', id: 'filter1' }],
    bad: () => [{ op: 'removeNode', id: 'nope' }],
  },
  connect: {
    ok: () => [
      {
        op: 'connect',
        from: { node: 'osc1', port: 'out' },
        to: { node: 'gain1', port: 'in' },
        replace: true,
      },
    ],
    bad: () => [
      { op: 'connect', from: { node: 'osc1', port: 'nope' }, to: { node: 'gain1', port: 'in' } },
    ],
  },
  disconnect: {
    ok: () => [{ op: 'disconnect', id: 'e5' }],
    bad: () => [{ op: 'disconnect', id: 'e999' }],
  },
  disconnectInput: {
    ok: () => [{ op: 'disconnectInput', to: { node: 'filter1', port: 'input' } }],
    bad: () => [{ op: 'disconnectInput', to: { node: 'nope', port: 'input' } }],
  },
  setValue: {
    ok: () => [{ op: 'setValue', node: 'filter1', port: 'resonance', value: 3 }],
    bad: () => [{ op: 'setValue', node: 'filter1', port: 'resonance', value: 99 }],
  },
  setConfig: {
    ok: () => [{ op: 'setConfig', node: 'osc1', key: 'waveform', value: 'sine' }],
    bad: () => [{ op: 'setConfig', node: 'osc1', key: 'waveform', value: 'square-ish' }],
  },
  setCode: {
    ok: d => [
      { op: 'addNode', node: { id: 'box1', type: 'kit.codebox' } },
      { op: 'setCode', node: 'box1', code: (d.nodes.box1?.code ?? '') + '\n// tuned\n' },
    ],
    bad: () => [{ op: 'setCode', node: 'filter1', code: 'x' }],
  },
  move: {
    ok: () => [{ op: 'move', node: 'osc1', pos: { x: 5, y: 7 } }],
    bad: () => [{ op: 'move', node: 'osc1', pos: { x: Number.NaN, y: 0 } }],
  },
  setLabel: {
    ok: () => [{ op: 'setLabel', node: 'osc1', label: 'Saw' }],
    bad: () => [{ op: 'setLabel', node: 'nope', label: 'x' }],
  },
  setText: {
    ok: () => [
      { op: 'addNode', node: { id: 'note1', type: 'kit.comment' } },
      { op: 'setText', node: 'note1', text: 'Turn this' },
    ],
    bad: () => [{ op: 'setText', node: 'osc1', text: 'not a comment' }],
  },
  setPanel: {
    ok: () => [{ op: 'setPanel', node: 'knob1', panel: { x: 30, y: 30, w: 80, h: 90 } }],
    bad: () => [{ op: 'setPanel', node: 'osc1', panel: { x: 0, y: 0, w: 10, h: 10 } }],
  },
  setName: {
    ok: () => [{ op: 'setName', name: 'Deep bass' }],
    bad: () => [{ op: 'setName', name: 5 as unknown as string }],
  },
  setTheme: {
    ok: () => [{ op: 'setTheme', theme: 'paper' }],
    bad: () => [{ op: 'setTheme', theme: 'plaid' as 'paper' }],
  },
  addElement: {
    ok: () => [
      { op: 'addElement', element: { kind: 'shape', rect: { x: 0, y: 0, w: 40, h: 40 } } },
    ],
    bad: () => [
      {
        op: 'addElement',
        element: { kind: 'image', asset: 'assets/none.png', rect: { x: 0, y: 0, w: 4, h: 4 } },
      },
    ],
  },
  removeElement: {
    ok: () => [{ op: 'removeElement', id: 'title1' }],
    bad: () => [{ op: 'removeElement', id: 'nope' }],
  },
  updateElement: {
    ok: () => [{ op: 'updateElement', id: 'title1', set: { text: 'Deep' } }],
    bad: () => [{ op: 'updateElement', id: 'title1', set: { textStyle: { color: 'url(x)' } } }],
  },
  setRect: {
    ok: () => [{ op: 'setRect', id: 'title1', rect: { x: 1, y: 2, w: 50, h: 20 } }],
    bad: () => [{ op: 'setRect', id: 'nope', rect: { x: 1, y: 2, w: 50, h: 20 } }],
  },
  setStyle: {
    ok: () => [{ op: 'setStyle', node: 'knob1', style: { skin: { name: 'ring' } } }],
    bad: () => [{ op: 'setStyle', node: 'osc1', style: { skin: { name: 'ring' } } }],
  },
  arrange: {
    ok: () => [{ op: 'arrange', ids: ['knob1'], to: 'front' }],
    bad: () => [{ op: 'arrange', ids: ['nope'], to: 'front' }],
  },
  group: {
    ok: () => [{ op: 'group', ids: ['knob1', 'title1'] }],
    bad: () => [{ op: 'group', ids: ['knob1'] }],
  },
  ungroup: {
    ok: () => [
      { op: 'group', ids: ['knob1', 'title1'], id: 'g1' },
      { op: 'ungroup', id: 'g1' },
    ],
    bad: () => [{ op: 'ungroup', id: 'nope' }],
  },
  setLook: {
    ok: () => [{ op: 'setLook', look: { tokens: { accent: '#ff8800' } } }],
    bad: () => [{ op: 'setLook', look: { tokens: { accent: 'url(http://evil)' } } }],
  },
  setPanelSize: {
    ok: () => [{ op: 'setPanelSize', width: 500, height: 300 }],
    bad: () => [{ op: 'setPanelSize', width: Number.NaN, height: 300 }],
  },
  addAsset: {
    ok: () => [
      {
        op: 'addAsset',
        asset: {
          id: 'assets/kick.wav',
          name: 'kick.wav',
          mime: 'audio/wav',
          bytes: 44,
          hash: `sha256-${'e'.repeat(64)}`,
        },
      },
    ],
    bad: () => [
      {
        op: 'addAsset',
        asset: { id: 'kick.wav', name: 'kick.wav', mime: 'audio/wav', bytes: 44, hash: HASH },
      },
    ],
  },
  updateAsset: {
    ok: () => [{ op: 'updateAsset', id: 'assets/dot.png', set: { source: { license: 'CC0' } } }],
    bad: () => [{ op: 'updateAsset', id: 'assets/none.png', set: { source: null } }],
  },
  removeAsset: {
    ok: () => [{ op: 'removeAsset', id: 'assets/dot.png' }],
    bad: () => [{ op: 'removeAsset', id: 'assets/none.png' }],
  },
  setUnderlay: {
    ok: () => [
      { op: 'setUnderlay', underlay: { asset: 'assets/dot.png', opacity: 0.5, visible: true } },
    ],
    bad: () => [
      { op: 'setUnderlay', underlay: { asset: 'assets/none.png', opacity: 0.5, visible: true } },
    ],
  },
  setBrief: {
    ok: () => [{ op: 'setBrief', brief: 'A dark bass with one big knob.' }],
    bad: () => [{ op: 'setBrief', brief: 'x'.repeat(100_000) }],
  },
  setNetwork: {
    ok: () => [
      {
        op: 'setNetwork',
        network: [{ origin: 'https://api.example.com', reason: 'Live weather for the display' }],
      },
    ],
    bad: () => [
      {
        op: 'setNetwork',
        network: [{ origin: 'http://api.example.com/path', reason: 'not an https origin' }],
      },
    ],
  },
  setProjectFiles: {
    ok: () => [{ op: 'setProjectFiles', files: { 'src/parts/meter.ts': 'export default 1;\n' } }],
    bad: () => [{ op: 'setProjectFiles', files: { 'node_modules/x.js': 'x' } }],
  },
  makePart: {
    ok: () => [{ op: 'makePart', ids: ['filter1'], name: 'Lowpass' }],
    bad: () => [{ op: 'makePart', ids: ['nope'] }],
  },
  unpackPart: {
    ok: () => [{ op: 'unpackPart', node: 'tone1' }],
    bad: () => [{ op: 'unpackPart', node: 'osc1' }],
  },
  detachPart: {
    ok: () => [
      { op: 'addNode', node: { id: 'tone2', type: 'kit.part', part: 'tone' } },
      { op: 'detachPart', node: 'tone2', name: 'My tone' },
    ],
    bad: () => [{ op: 'detachPart', node: 'osc1' }],
  },
  updatePart: {
    ok: () => [{ op: 'updatePart', part: 'tone', name: 'Tone 2', doc: 'A sine and its level.' }],
    bad: () => [{ op: 'updatePart', part: 'nope', name: 'x' }],
  },
  importPart: {
    ok: d => [{ op: 'importPart', bundle: extractBundle(d, 'tone') }],
    bad: () => [{ op: 'importPart', bundle: { nope: true } }],
  },
  replacePart: {
    ok: d => {
      const bundle = extractBundle(d, 'tone');
      bundle.part = { ...bundle.part, name: 'Replaced' };
      return [{ op: 'replacePart', part: 'tone', bundle }];
    },
    bad: () => [{ op: 'replacePart', part: 'nope', bundle: {} }],
  },
  addParam: {
    ok: () => [{ op: 'addParam', part: 'tone', node: 'osc9', port: 'frequency', label: 'Pitch' }],
    bad: () => [{ op: 'addParam', part: 'tone', node: 'osc9', port: 'nope' }],
  },
  removeParam: {
    ok: d => {
      const id = d.parts.tone!.params[0]?.id;
      return id
        ? [{ op: 'removeParam', part: 'tone', id }]
        : [
            { op: 'addParam', part: 'tone', node: 'osc9', port: 'frequency', id: 'pitch' },
            { op: 'removeParam', part: 'tone', id: 'pitch' },
          ];
    },
    bad: () => [{ op: 'removeParam', part: 'tone', id: 'nope' }],
  },
  setCount: {
    ok: () => [{ op: 'setCount', node: 'osc1', count: 4 }],
    bad: () => [{ op: 'setCount', node: 'osc1', count: 100_000 }],
  },
  setSpread: {
    ok: () => [
      { op: 'setCount', node: 'osc1', count: 4 },
      { op: 'setSpread', node: 'osc1', port: 'frequency', spread: { kind: 'range', amount: 0.1 } },
    ],
    bad: () => [
      { op: 'setSpread', node: 'osc1', port: 'frequency', spread: { kind: 'wobbly' as 'range' } },
    ],
  },
};

const same = (a: PatchDocument, b: PatchDocument) =>
  expect({ ...a, revision: 0 }).toEqual({ ...b, revision: 0 });

describe('every operation type', () => {
  it.each(Object.keys(CASES) as Array<Intent['op']>)(
    '%s: fits and undoes exactly; or is refused whole',
    op => {
      const doc = base();
      const before = structuredClone(doc);
      const c = CASES[op];
      const r = applyIntents(doc, c.ok(doc), catalog);
      expect(r.ops.length, `${op} changed nothing`).toBeGreaterThan(0);
      same(applyResolvedOps(r.doc, invertAll(r.ops)), doc);
      let error: unknown;
      try {
        applyIntents(doc, c.bad(doc), catalog);
      } catch (e) {
        error = e;
      }
      expect(error, `${op} was not refused`).toBeInstanceOf(OpError);
      expect((error as OpError).message.length).toBeGreaterThan(0);
      expect(doc).toEqual(before);
    },
  );

  it('a refused operation in a list takes the whole list back with it', () => {
    const doc = base();
    const before = structuredClone(doc);
    expect(() =>
      applyIntents(
        doc,
        [
          { op: 'setName', name: 'Half done' },
          { op: 'addNode', node: { id: 'lfo9', type: 'den.lfo' } },
          { op: 'removeNode', id: 'nope' },
        ],
        catalog,
      ),
    ).toThrow(OpError);
    expect(doc).toEqual(before);
  });
});

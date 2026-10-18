// Faces: a part's own screen. Without one a part shows a default face (its name
// over a knob per parameter); a face goes on the plugin for one use as controls
// wired to that use's parameters and decorations, grouped, and putting it again
// replaces it in place; controls and decorations on the plugin become the
// part's face, and the other uses on the plugin follow. Faces are checked,
// saved with the patch and carried by My parts.
import { describe, expect, it } from 'vite-plus/test';
import { catalog } from '../../../src/blocks/index.ts';
import { generate } from '../../../src/core/codegen.ts';
import { checkFace, defaultFace, describeFace, faceGroup } from '../../../src/core/face.ts';
import { checkBundle, extractBundle } from '../../../src/core/library.ts';
import {
  applyIntents,
  applyResolvedOps,
  invertAll,
  OpError,
  type Intent,
} from '../../../src/core/ops.ts';
import { documentHash, parseDocument, serializeDocument } from '../../../src/core/persistence.ts';
import type { PartFace, PatchDocument } from '../../../src/core/schema.ts';
import { starter } from '../../../src/core/starters.ts';
import { UiCheckError } from '../../../src/core/ui.ts';
import { validate } from '../../../src/core/validate.ts';
import { describePatch } from '../../../src/core/describe.ts';
import {
  FaceError,
  faceFromPlugin,
  faceIntents,
  faceOnPlugin,
  screenFace,
} from '../../../src/plugin/faces.ts';
import { KitSession } from '../../../src/editor/session.ts';
import { stackOrder } from '../../../src/core/ui.ts';
import { checkPlugin } from '../../../src/plugin/checks.ts';
import { SHOWCASE_ASSETS } from '../../../src/showcase/assets.ts';

const apply = (doc: PatchDocument, ...intents: Intent[]) => applyIntents(doc, intents, catalog);
const failure = (fn: () => unknown): Error => {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected a failure');
};
/** The bass with cut1 (cutoff knob) and filter1 as part Tone (parameters hz and resonance), used once (tone1). */
const toned = () =>
  apply(starter('bass', catalog), { op: 'makePart', ids: ['cut1', 'filter1'], name: 'Tone' }).doc;
const put = (doc: PatchDocument, use = 'tone1', at?: { x: number; y: number }) =>
  apply(doc, ...faceIntents(doc, catalog, use, { at }).intents);

describe('the default face', () => {
  it('its name over a knob per parameter, in a frame', () => {
    const doc = toned();
    const face = defaultFace(doc.parts.tone!, catalog.inputs(doc.nodes.tone1!));
    expect(face.controls.map(c => [c.param, c.type])).toEqual([
      ['hz', 'ui.knob'],
      ['resonance', 'ui.knob'],
    ]);
    expect(face.elements.find(e => e.kind === 'text')).toMatchObject({ text: 'Tone' });
    for (const c of face.controls)
      expect(c.rect.x + c.rect.w <= face.width && c.rect.y + c.rect.h <= face.height).toBe(true);
    expect(describeFace(doc.parts.tone!, catalog.inputs(doc.nodes.tone1!))).toMatch(
      /the default \(2 controls under its name/,
    );
  });
});

describe('putting a face on the plugin', () => {
  it("makes controls wired to the use's parameters (with their ranges and values) and its decorations, in one group, in free space", () => {
    const doc = apply(toned(), { op: 'setValue', node: 'tone1', port: 'resonance', value: 3 }).doc;
    const r = faceIntents(doc, catalog, 'tone1');
    expect(r.placed).toBe(true);
    const after = apply(doc, ...r.intents).doc;
    const members = faceOnPlugin(after, 'tone1');
    expect(after.ui.groups[faceGroup('tone1')]).toEqual(members);
    const knobs = members.map(id => after.nodes[id]).filter(n => n?.type === 'ui.knob');
    expect(knobs).toHaveLength(2);
    const reso = knobs.find(k =>
      Object.values(after.edges).some(
        e => e.from.node === k!.id && e.to.node === 'tone1' && e.to.port === 'resonance',
      ),
    )!;
    expect(reso.values.value).toBe(3);
    expect(reso.config).toMatchObject({ min: 0.5, max: 10 });
    expect(members.some(id => after.ui.elements[id]?.kind === 'text')).toBe(true);
    // The knob drives the part: still one cable per input, and it compiles.
    expect(validate(after, catalog).issues.filter(i => i.severity === 'error')).toEqual([]);
    expect(generate(after, catalog).source).not.toBe('');
  });
  it('stacks as a plugin is drawn: its frame under its controls, its words and lamps over them; a seconds knob turns from 1 ms', () => {
    const doc = apply(toned(), {
      op: 'updatePart',
      part: 'tone',
      face: {
        width: 200,
        height: 140,
        controls: [{ param: 'resonance', type: 'ui.knob', rect: { x: 10, y: 30, w: 84, h: 96 } }],
        elements: [
          {
            id: 'lamp',
            kind: 'led',
            bind: '@level',
            color: 'accent',
            threshold: 0.5,
            rect: { x: 180, y: 6, w: 10, h: 10 },
          },
          { id: 'name', kind: 'text', text: 'TONE', rect: { x: 10, y: 6, w: 100, h: 20 } },
          {
            id: 'frame',
            kind: 'shape',
            shape: 'rect',
            rect: { x: 0, y: 0, w: 200, h: 140 },
            style: { fill: [{ kind: 'color', color: 'track' }] },
          },
        ],
      },
    }).doc;
    const on = put(doc, 'tone1', { x: 20, y: 20 }).doc;
    const order = stackOrder(
      on.ui,
      Object.values(on.nodes)
        .filter(n => n.panel)
        .map(n => n.id),
    );
    const at = (kind: string) =>
      order.findIndex(id => (on.ui.elements[id]?.kind ?? on.nodes[id]?.type) === kind);
    expect(at('shape')).toBeLessThan(at('ui.knob'));
    expect(at('text')).toBeGreaterThan(at('ui.knob'));
    expect(at('led')).toBeGreaterThan(at('ui.knob'));
    expect(checkPlugin(on, catalog).filter(i => i.code === 'covered')).toEqual([]);
    // A seconds knob (log, from 0 inside) turns from 1 ms on the face, so its useful range is not squeezed.
    const env = apply(starter('bass', catalog), {
      op: 'makePart',
      ids: ['aenv1'],
      name: 'Amp',
    }).doc;
    const use = Object.values(env.nodes).find(n => n.type === 'kit.part')!.id;
    const onEnv = put(env, use).doc;
    const decayKnob = Object.values(onEnv.nodes).find(
      n =>
        n.type === 'ui.knob' &&
        Object.values(onEnv.edges).some(e => e.from.node === n.id && e.to.port === 'decay'),
    )!;
    expect(decayKnob.config).toMatchObject({ min: 0.001, scale: 'log', unit: 's' });
  });
  it('putting it again replaces it where it is (no duplicates); undo takes it off in one step', () => {
    const doc = toned();
    const once = put(doc, 'tone1', { x: 200, y: 40 });
    const first = faceOnPlugin(once.doc, 'tone1');
    const again = put(once.doc);
    const second = faceOnPlugin(again.doc, 'tone1');
    expect(second).toHaveLength(first.length);
    const rect = (d: PatchDocument, ids: string[]) =>
      ids
        .map(id => d.ui.elements[id]?.rect ?? d.nodes[id]!.panel!)
        .reduce((m, r) => ({ x: Math.min(m.x, r.x), y: Math.min(m.y, r.y) }), {
          x: Infinity,
          y: Infinity,
        });
    expect(rect(again.doc, second)).toEqual({ x: 200, y: 40 });
    expect(Object.values(again.doc.nodes).filter(n => n.type === 'ui.knob')).toHaveLength(
      Object.values(doc.nodes).filter(n => n.type === 'ui.knob').length + 2,
    );
    expect({ ...applyResolvedOps(once.doc, invertAll(once.ops)), revision: 0 }).toEqual({
      ...doc,
      revision: 0,
    });
  });
  it('refuses a node that is not a use, and a use inside a part (controls live in the main patch)', () => {
    const doc = apply(toned(), { op: 'makePart', ids: ['tone1'], name: 'Outer' }).doc;
    expect(failure(() => faceIntents(doc, catalog, 'osc1'))).toBeInstanceOf(FaceError);
    expect(failure(() => faceIntents(doc, catalog, 'tone1')).message).toMatch(/inside a part/);
  });
});

describe('a face from the plugin', () => {
  it("controls wired to the parameters and the decorations around them become the part's face; binds follow the controls", () => {
    let doc = put(toned(), 'tone1', { x: 100, y: 100 }).doc;
    const members = faceOnPlugin(doc, 'tone1');
    const knob = members.find(id => doc.nodes[id]?.type === 'ui.knob')!;
    doc = apply(doc, {
      op: 'addElement',
      element: {
        kind: 'text',
        id: 'readout1',
        text: 'RES {value}',
        bind: knob,
        rect: { x: 100, y: 230, w: 120, h: 20 },
      },
    }).doc;
    const taken = faceFromPlugin(doc, catalog, 'tone1', [...members, 'readout1', 'out1']);
    expect(taken.face.controls.map(c => c.param).sort()).toEqual(['hz', 'resonance']);
    const param = Object.values(doc.edges).find(e => e.from.node === knob)!.to.port;
    expect(
      taken.face.elements.find(e => e.kind === 'text' && e.text === 'RES {value}'),
    ).toMatchObject({ bind: param });
    expect(Math.min(...taken.face.controls.map(c => c.rect.x))).toBeGreaterThanOrEqual(0);
    // Saved on the part, it checks.
    const saved = apply(doc, { op: 'updatePart', part: 'tone', face: taken.face }).doc;
    expect(saved.parts.tone!.face!.controls).toHaveLength(2);
    expect(describeFace(saved.parts.tone!, catalog.inputs(saved.nodes.tone1!))).toMatch(
      /its own \(2 controls, \d+ decorations/,
    );
    expect(describePatch(saved, catalog)).toMatch(/Face: its own/);
  });
  it('nothing usable selected is refused with what to select', () => {
    const doc = toned();
    expect(failure(() => faceFromPlugin(doc, catalog, 'tone1', ['out1'])).message).toMatch(
      /Select controls wired to Tone's parameters/,
    );
  });
});

describe('checking a face', () => {
  const ok = (doc: PatchDocument): PartFace =>
    defaultFace(doc.parts.tone!, catalog.inputs(doc.nodes.tone1!));
  it.each([
    [
      'a control for something that is not a parameter',
      (f: PartFace) => {
        f.controls[0]!.param = 'frequency';
      },
      /not one of its parameters/,
    ],
    [
      'a switch for a number',
      (f: PartFace) => {
        f.controls[0]!.type = 'ui.toggle';
      },
      /takes a number/,
    ],
    [
      'two controls for one parameter',
      (f: PartFace) => {
        f.controls.push({ ...f.controls[0]! });
      },
      /two controls/,
    ],
    [
      'no size',
      (f: PartFace) => {
        f.width = 0;
      },
      /width must be/,
    ],
    [
      'a broken rect',
      (f: PartFace) => {
        f.controls[0]!.rect = { x: 0, y: 0, w: -1, h: 4 };
      },
      /positive width/,
    ],
    [
      'a text bound to nothing',
      (f: PartFace) => {
        f.elements.push({
          id: 'x1',
          kind: 'text',
          text: '{value}',
          bind: 'ghost',
          rect: { x: 0, y: 0, w: 10, h: 10 },
        });
      },
      /No control "ghost"/,
    ],
  ])('refuses %s', (_name, spoil, message) => {
    const doc = toned();
    const face = structuredClone(ok(doc));
    spoil(face);
    const e = failure(() =>
      checkFace(face, doc.parts.tone!, catalog.inputs(doc.nodes.tone1!), { assets: doc.assets }),
    );
    expect(e).toBeInstanceOf(UiCheckError);
    expect(e.message).toMatch(message);
    // Through an edit: refused, the patch unchanged.
    expect(failure(() => apply(doc, { op: 'updatePart', part: 'tone', face }))).toBeInstanceOf(
      OpError,
    );
  });
  it('null goes back to the default face', () => {
    const doc = apply(toned(), { op: 'updatePart', part: 'tone', face: ok(toned()) }).doc;
    expect(
      apply(doc, { op: 'updatePart', part: 'tone', face: null }).doc.parts.tone!.face,
    ).toBeUndefined();
  });
});

describe('faces in files and My parts', () => {
  it('saved with the patch; a broken face in a file is dropped with a reason; a face is not part of the sound', () => {
    const doc = toned();
    const face = defaultFace(doc.parts.tone!, catalog.inputs(doc.nodes.tone1!));
    const r = apply(doc, { op: 'updatePart', part: 'tone', face });
    expect(generate(r.doc, catalog).hash).toBe(generate(doc, catalog).hash);
    const back = parseDocument(serializeDocument(r.doc), catalog);
    if (!back.ok) throw new Error(back.error);
    expect(back.report).toEqual([]);
    expect(documentHash(back.doc)).toBe(documentHash(r.doc));
    const raw = JSON.parse(serializeDocument(r.doc));
    raw.parts.tone.face.controls[0].type = 'ui.toggle';
    const read = parseDocument(JSON.stringify(raw), catalog);
    if (!read.ok) throw new Error(read.error);
    expect(read.doc.parts.tone!.face).toBeUndefined();
    expect(read.report.map(i => i.code)).toContain('dropped-face');
  });
  it('a bundle carries the face; placed in another patch it goes on the plugin there', () => {
    const doc = toned();
    const face = defaultFace(doc.parts.tone!, catalog.inputs(doc.nodes.tone1!));
    face.width += 40;
    const withFace = apply(doc, { op: 'updatePart', part: 'tone', face }).doc;
    const bundle = extractBundle(withFace, 'tone');
    const checked = checkBundle(bundle, catalog);
    if (typeof checked === 'string') throw new Error(checked);
    expect(checked.part.face?.width).toBe(face.width);
    const elsewhere = apply(starter('pad', catalog), {
      op: 'importPart',
      bundle: checked,
      node: 'tone9',
    }).doc;
    const on = put(elsewhere, 'tone9').doc;
    expect(faceOnPlugin(on, 'tone9').length).toBeGreaterThanOrEqual(3);
  });
});

describe('faces in the session', () => {
  const makeSession = () => {
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
      engine: { setParam() {}, unload() {}, running: false } as never,
    });
    session.replace(toned(), 'Tone', false);
    return session;
  };
  it('saving a face from one use puts it on the other uses whose face is on the plugin, in one undo step', () => {
    const session = makeSession();
    expect(
      session.commit([{ op: 'addNode', node: { id: 'tone2', type: 'kit.part', part: 'tone' } }]).ok,
    ).toBe(true);
    expect(session.putFace('tone1', { x: 20, y: 20 }).ok).toBe(true);
    expect(session.putFace('tone2', { x: 20, y: 200 }).ok).toBe(true);
    const doc = session.doc.value;
    const members = faceOnPlugin(doc, 'tone1');
    // Keep only the resonance knob (and the frame) in tone1's face.
    const reso = members.find(id =>
      Object.values(doc.edges).some(e => e.from.node === id && e.to.port === 'resonance'),
    )!;
    const frame = members.find(id => doc.ui.elements[id]?.kind === 'shape')!;
    const before = session.doc.value;
    const r = session.saveFace('tone1', [reso, frame]);
    expect(r).toMatchObject({
      ok: true,
      message: expect.stringMatching(/Tone's face: 1 control, 1 decoration; updated on tone2/),
    });
    const after = session.doc.value;
    expect(after.parts.tone!.face!.controls.map(c => c.param)).toEqual(['resonance']);
    expect(faceOnPlugin(after, 'tone2').filter(id => after.nodes[id]).length).toBe(1);
    expect(faceOnPlugin(after, 'tone1').sort()).toEqual([reso, frame].sort());
    session.undo();
    expect({ ...session.doc.value, revision: 0 }).toEqual({ ...before, revision: 0 });
    expect(session.putFace('osc1')).toEqual({
      ok: false,
      message: '"osc1" is not a use of a part.',
    });
    expect(session.saveFace('tone1', [])).toMatchObject({ ok: false });
  });
});

describe('decorations that follow controls', () => {
  it('a text showing a control that is not on the face keeps its words; a bare readout and a lamp of it are left out (and not grouped)', () => {
    let doc = put(toned(), 'tone1', { x: 100, y: 100 }).doc;
    const members = faceOnPlugin(doc, 'tone1');
    doc = apply(
      doc,
      {
        op: 'addNode',
        node: {
          id: 'knob9',
          type: 'ui.knob',
          label: 'Drive',
          panel: { x: 400, y: 20, w: 84, h: 96 },
        },
      },
      {
        op: 'addElement',
        element: {
          kind: 'text',
          id: 'words1',
          text: 'DRIVE  {value} dB',
          bind: 'knob9',
          rect: { x: 100, y: 240, w: 120, h: 20 },
        },
      },
      {
        op: 'addElement',
        element: {
          kind: 'text',
          id: 'readout1',
          text: '{value}',
          bind: 'knob9',
          rect: { x: 100, y: 262, w: 60, h: 20 },
        },
      },
      {
        op: 'addElement',
        element: {
          kind: 'led',
          id: 'lamp1',
          bind: 'knob9',
          rect: { x: 230, y: 240, w: 12, h: 12 },
        },
      },
      {
        op: 'addElement',
        element: {
          kind: 'led',
          id: 'level1',
          bind: '@level',
          rect: { x: 250, y: 240, w: 12, h: 12 },
        },
      },
    ).doc;
    const taken = faceFromPlugin(doc, catalog, 'tone1', [
      ...members,
      'words1',
      'readout1',
      'lamp1',
      'level1',
    ]);
    const texts = taken.face.elements
      .filter(e => e.kind === 'text')
      .map(e => [e.text, 'bind' in e ? e.bind : undefined]);
    expect(texts).toContainEqual(['DRIVE dB', undefined]);
    expect(texts.some(([t]) => t === '{value}')).toBe(false);
    expect(taken.face.elements.filter(e => e.kind === 'led').map(e => e.bind)).toEqual(['@level']);
    expect(taken.members).toEqual(expect.arrayContaining(['words1', 'level1']));
    expect(taken.members).not.toContain('readout1');
    expect(taken.members).not.toContain('lamp1');
    expect(taken.notes.join(' ')).toMatch(
      /readout of Drive was left out[\s\S]*lamp of Drive was left out/,
    );
    // What is kept checks as the part's face.
    expect(() => apply(doc, { op: 'updatePart', part: 'tone', face: taken.face })).not.toThrow();
  });
});

describe("a screen part's face", () => {
  const decorated = () =>
    apply(
      starter('bass', catalog),
      { op: 'addAsset', asset: SHOWCASE_ASSETS['sc-screw']! },
      {
        op: 'addNode',
        node: {
          id: 'knob1',
          type: 'ui.knob',
          label: 'Rain',
          panel: { x: 20, y: 20, w: 84, h: 96 },
        },
      },
      {
        op: 'addElement',
        element: {
          kind: 'shape',
          id: 'plate1',
          shape: 'rect',
          rect: { x: 100, y: 50, w: 200, h: 80 },
        },
      },
      {
        op: 'addElement',
        element: {
          kind: 'image',
          id: 'screw1',
          asset: 'sc-screw',
          rect: { x: 104, y: 54, w: 16, h: 16 },
        },
      },
      {
        op: 'addElement',
        element: {
          kind: 'text',
          id: 'word1',
          text: 'RAIN {value}',
          bind: 'knob1',
          rect: { x: 120, y: 60, w: 160, h: 20 },
        },
      },
      {
        op: 'addElement',
        element: {
          kind: 'text',
          id: 'readout1',
          text: '{value}',
          bind: 'knob1',
          rect: { x: 120, y: 84, w: 60, h: 20 },
        },
      },
      {
        op: 'addElement',
        element: {
          kind: 'led',
          id: 'lamp1',
          bind: 'knob1',
          rect: { x: 280, y: 140, w: 12, h: 12 },
        },
      },
      {
        op: 'addElement',
        element: {
          kind: 'led',
          id: 'meter1',
          bind: '@level',
          rect: { x: 110, y: 110, w: 12, h: 12 },
        },
      },
    ).doc;
  it('decorations as they are, relative to what is kept; no controls; words without the values; the level lamp stays', () => {
    const doc = decorated();
    const r = screenFace(doc, [
      'plate1',
      'screw1',
      'word1',
      'readout1',
      'lamp1',
      'meter1',
      'knob1',
    ]);
    expect(r.face).toMatchObject({ width: 200, height: 80, controls: [] });
    expect(r.face.elements.map(e => [e.kind, e.rect.x, e.rect.y])).toEqual([
      ['shape', 0, 0],
      ['image', 4, 4],
      ['text', 20, 10],
      ['led', 10, 60],
    ]);
    expect(r.face.elements[2]).toEqual({
      id: 'e3',
      kind: 'text',
      text: 'RAIN',
      rect: { x: 20, y: 10, w: 160, h: 20 },
    });
    expect(r.members).toEqual(['plate1', 'screw1', 'word1', 'meter1']);
    expect(r.notes).toHaveLength(3);
  });
  it('nothing usable is refused with what to select', () => {
    const doc = decorated();
    expect(failure(() => screenFace(doc, ['knob1'])).message).toMatch(
      /Select decorations on the plugin/,
    );
    expect(failure(() => screenFace(doc, ['lamp1', 'readout1'])).message).toMatch(
      /Nothing selected can be on a screen part: The lamp of Rain was left out/,
    );
    expect(failure(() => screenFace(doc, []))).toBeInstanceOf(FaceError);
  });
});

describe("a face's pictures", () => {
  const logo = 'a0123456789abcde';
  const withPictures = () =>
    apply(
      toned(),
      { op: 'addAsset', asset: SHOWCASE_ASSETS['sc-wood']! },
      {
        op: 'addAsset',
        asset: {
          id: logo,
          name: 'logo.png',
          mime: 'image/png',
          bytes: 1200,
          width: 64,
          height: 32,
        },
      },
      {
        op: 'updatePart',
        part: 'tone',
        face: {
          width: 240,
          height: 140,
          controls: [
            { param: 'resonance', type: 'ui.knob', rect: { x: 140, y: 30, w: 84, h: 96 } },
          ],
          elements: [
            {
              id: 'wood',
              kind: 'image',
              asset: 'sc-wood',
              fit: 'cover',
              rect: { x: 0, y: 0, w: 240, h: 140 },
            },
            {
              id: 'logo',
              kind: 'image',
              asset: logo,
              fit: 'contain',
              rect: { x: 10, y: 10, w: 64, h: 32 },
            },
            {
              id: 'plate',
              kind: 'shape',
              shape: 'rect',
              rect: { x: 10, y: 50, w: 100, h: 60 },
              style: { fill: [{ kind: 'image', asset: logo, fit: 'cover' }] },
            },
          ],
        },
      },
    ).doc;
  it('a picture a face uses cannot be removed from the patch', () => {
    const e = failure(() => apply(withPictures(), { op: 'removeAsset', id: logo }));
    expect(e).toBeInstanceOf(OpError);
    expect(e.message).toMatch(/used by Tone's face/);
  });
  it('a bundle carries them; placed in another patch they come in with the part (one undo), and its face shows them', () => {
    const bundle = extractBundle(withPictures(), 'tone');
    expect(Object.keys(bundle.assets ?? {}).sort()).toEqual([logo, 'sc-wood'].sort());
    const checked = checkBundle(JSON.parse(JSON.stringify(bundle)), catalog);
    if (typeof checked === 'string') throw new Error(checked);
    const pad = starter('pad', catalog);
    const placed = apply(pad, { op: 'importPart', bundle: checked, node: 'tone9' });
    expect(placed.doc.assets[logo]).toMatchObject({ name: 'logo.png' });
    expect({ ...applyResolvedOps(placed.doc, invertAll(placed.ops)), revision: 0 }).toEqual({
      ...pad,
      revision: 0,
    });
    const on = put(placed.doc, 'tone9');
    const kinds = faceOnPlugin(on.doc, 'tone9').map(
      id => on.doc.ui.elements[id]?.kind ?? on.doc.nodes[id]!.type,
    );
    expect(kinds.sort()).toEqual(['image', 'image', 'shape', 'ui.knob']);
    // A picture whose description cannot be read stays behind (said when the face is put on the plugin).
    const raw = JSON.parse(JSON.stringify(bundle));
    raw.assets[logo].mime = 'application/x-nope';
    const lenient = checkBundle(raw, catalog);
    if (typeof lenient === 'string') throw new Error(lenient);
    expect(Object.keys(lenient.assets ?? {})).toEqual(['sc-wood']);
  });
  it("putting a face whose pictures this patch lacks: den-kit's own come in, others leave out what uses them, with a note", () => {
    const raw = JSON.parse(serializeDocument(withPictures()));
    delete raw.assets['sc-wood'];
    delete raw.assets[logo];
    const read = parseDocument(JSON.stringify(raw), catalog);
    if (!read.ok) throw new Error(read.error);
    expect(read.doc.parts.tone!.face!.elements).toHaveLength(3);
    expect(read.report.map(i => i.code)).toContain('face-reference');
    const made = faceIntents(read.doc, catalog, 'tone1');
    expect(
      made.intents.filter(i => i.op === 'addAsset').map(i => i.op === 'addAsset' && i.asset.id),
    ).toEqual(['sc-wood']);
    const on = apply(read.doc, ...made.intents).doc;
    const kinds = faceOnPlugin(on, 'tone1').map(
      id => on.ui.elements[id]?.kind ?? on.nodes[id]!.type,
    );
    expect(kinds.sort()).toEqual(['image', 'ui.knob']);
    expect(made.notes.join(' ')).toMatch(
      /picture of the face was left out: its picture \("a0123456789abcde"\) is not in this patch[\s\S]*decoration of the face was left out/,
    );
  });
});

describe('a face of one thing', () => {
  it('is still a group (other groups need two); it stays through unrelated removals, undo and files, and goes with its last member', () => {
    const doc = apply(
      toned(),
      {
        op: 'addNode',
        node: { id: 'knob5', type: 'ui.knob', panel: { x: 20, y: 20, w: 84, h: 96 } },
      },
      {
        op: 'addElement',
        element: { kind: 'text', id: 'note1', text: 'hi', rect: { x: 300, y: 20, w: 40, h: 20 } },
      },
    ).doc;
    expect(failure(() => apply(doc, { op: 'group', ids: ['knob5'] })).message).toMatch(
      /two or more/,
    );
    expect(failure(() => apply(doc, { op: 'group', ids: ['knob5'], id: 'solo1' })).message).toMatch(
      /two or more/,
    );
    const one = apply(doc, { op: 'group', ids: ['knob5'], id: faceGroup('tone1') }).doc;
    expect(one.ui.groups[faceGroup('tone1')]).toEqual(['knob5']);
    const later = apply(one, { op: 'removeElement', id: 'note1' }).doc;
    expect(later.ui.groups[faceGroup('tone1')]).toEqual(['knob5']);
    const back = parseDocument(serializeDocument(later), catalog);
    if (!back.ok) throw new Error(back.error);
    expect(back.doc.ui.groups[faceGroup('tone1')]).toEqual(['knob5']);
    expect(
      apply(later, { op: 'removeNode', id: 'knob5' }).doc.ui.groups[faceGroup('tone1')],
    ).toBeUndefined();
    // A file's group of one that is not a face is dropped.
    const raw = JSON.parse(serializeDocument(later));
    raw.ui.groups = { lonely1: ['knob5'], [faceGroup('tone1')]: ['knob5'] };
    const read = parseDocument(JSON.stringify(raw), catalog);
    if (!read.ok) throw new Error(read.error);
    expect(Object.keys(read.doc.ui.groups)).toEqual([faceGroup('tone1')]);
  });
  it('a face that loses all but one thing stays a face; an ordinary group that does dissolves', () => {
    const doc = put(toned(), 'tone1', { x: 20, y: 20 }).doc;
    const members = faceOnPlugin(doc, 'tone1');
    const [keep, ...rest] = members;
    const left = apply(
      doc,
      ...rest.map(id =>
        doc.nodes[id]
          ? ({ op: 'removeNode', id } as Intent)
          : ({ op: 'removeElement', id } as Intent),
      ),
    ).doc;
    expect(left.ui.groups[faceGroup('tone1')]).toEqual([keep]);
    const plain = apply(
      doc,
      { op: 'ungroup', id: faceGroup('tone1') },
      { op: 'group', ids: members.slice(0, 2), id: 'group7' },
    ).doc;
    const second = members[1]!;
    expect(
      apply(
        plain,
        plain.nodes[second]
          ? { op: 'removeNode', id: second }
          : { op: 'removeElement', id: second },
      ).doc.ui.groups.group7,
    ).toBeUndefined();
  });
});

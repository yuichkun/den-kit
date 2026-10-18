// Screen parts in the session: decorations on the plugin become a part that is
// only a screen (it adds nothing to the sound), kept in My parts with its
// pictures and put on another plugin at once when placed there (not when placed
// inside a part); My parts files carry the pictures' bytes; a face of one
// control stays a face.
import { describe, expect, it } from 'vite-plus/test';
import { KitSession, MY_PARTS_KEY, type StorageLike } from '../../../src/editor/session.ts';
import { starter } from '../../../src/core/starters.ts';
import { catalog } from '../../../src/blocks/index.ts';
import { generate } from '../../../src/core/codegen.ts';
import { faceGroup } from '../../../src/core/face.ts';
import { libraryAssets, parseLibrary, serializeLibrary } from '../../../src/core/library.ts';
import { parseDocument, serializeDocument } from '../../../src/core/persistence.ts';
import { validate } from '../../../src/core/validate.ts';
import { faceOnPlugin } from '../../../src/plugin/faces.ts';
import { AssetStore } from '../../../src/plugin/asset-store.ts';
import { SHOWCASE_ASSETS } from '../../../src/showcase/assets.ts';

function memoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: key => {
      data.delete(key);
    },
  };
}
function makeSession(storage: StorageLike, assets = new AssetStore(null)) {
  const session = new KitSession({
    storage,
    assets,
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
  session.replace(starter('bass', catalog), 'Bass', false);
  return session;
}
const LOGO = 'a0123456789abcde';
/** A plate with a screw, a word that shows a knob, a readout and a lamp of it, and a level lamp. */
function decorate(session: KitSession) {
  const r = session.commit([
    { op: 'addAsset', asset: SHOWCASE_ASSETS['sc-screw']! },
    {
      op: 'addAsset',
      asset: { id: LOGO, name: 'logo.png', mime: 'image/png', bytes: 68, width: 1, height: 1 },
    },
    {
      op: 'addNode',
      node: { id: 'knob1', type: 'ui.knob', label: 'Rain', panel: { x: 20, y: 20, w: 84, h: 96 } },
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
      element: { kind: 'image', id: 'logo1', asset: LOGO, rect: { x: 260, y: 54, w: 32, h: 16 } },
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
      element: { kind: 'led', id: 'lamp1', bind: 'knob1', rect: { x: 280, y: 140, w: 12, h: 12 } },
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
  ]);
  if (!r.ok) throw r.error;
}
const ALL = ['plate1', 'screw1', 'logo1', 'word1', 'readout1', 'lamp1', 'meter1', 'knob1'];
// 1×1 transparent PNG.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

describe('screen parts', () => {
  it('decorations become a part that is only a screen: one undo, nothing added to the sound, its face is what was selected', () => {
    const session = makeSession(memoryStorage());
    decorate(session);
    const before = session.doc.value;
    const sound = generate(before, catalog).hash;
    const r = session.makeScreenPart(ALL, 'Rain Logo');
    expect(r).toMatchObject({
      ok: true,
      use: 'rainLogo1',
      message: expect.stringMatching(
        /Made the screen part “Rain Logo” \(rainLogo1\)[\s\S]*readout of Rain was left out[\s\S]*lamp of Rain was left out/,
      ),
    });
    const doc = session.doc.value;
    const def = doc.parts.rainLogo!;
    expect(def).toMatchObject({ name: 'Rain Logo', inputs: [], outputs: [], params: [] });
    expect(def.face!.controls).toEqual([]);
    expect(def.face!.elements.map(e => e.kind)).toEqual(['shape', 'image', 'image', 'text', 'led']);
    expect(doc.ui.groups[faceGroup('rainLogo1')]).toEqual([
      'plate1',
      'screw1',
      'logo1',
      'word1',
      'meter1',
    ]);
    expect(faceOnPlugin(doc, 'rainLogo1')).toHaveLength(5);
    // The decorations stay as they were on this plugin (the word still shows the knob here).
    expect(doc.ui.elements.word1).toEqual(before.ui.elements.word1);
    expect(generate(doc, catalog).hash).toBe(sound);
    expect(validate(doc, catalog).issues.filter(i => i.severity === 'error')).toEqual([]);
    session.undo();
    expect({ ...session.doc.value, revision: 0 }).toEqual({ ...before, revision: 0 });
  });
  it('without decorations it says what to select, and nothing changes', () => {
    const session = makeSession(memoryStorage());
    decorate(session);
    const before = session.doc.value;
    expect(session.makeScreenPart(['knob1'])).toEqual({
      ok: false,
      message: expect.stringMatching(/Select decorations on the plugin/),
    });
    expect(session.makeScreenPart(['lamp1'])).toEqual({
      ok: false,
      message: expect.stringMatching(/Nothing selected can be on a screen part/),
    });
    expect(session.makeScreenPart(['nope'])).toMatchObject({ ok: false });
    expect(session.doc.value).toBe(before);
  });
  it('kept in My parts with its pictures; placed on another plugin its face goes there at once (one undo), but not inside a part', () => {
    const storage = memoryStorage();
    const session = makeSession(storage);
    decorate(session);
    expect(session.makeScreenPart(ALL, 'Rain Logo').ok).toBe(true);
    expect(session.saveToMyParts('rainLogo')).toMatchObject({ ok: true });
    const saved = session.myParts.value.parts.rainLogo!;
    expect(Object.keys(saved.versions[0]!.bundle.assets ?? {}).sort()).toEqual(
      [LOGO, 'sc-screw'].sort(),
    );
    expect(saved.versions[0]!.bundle.nodes).toEqual({});
    // Another patch (another tab: the same storage).
    const other = makeSession(storage);
    other.replace(starter('pad', catalog), 'Pad', false);
    const before = other.doc.value;
    const placed = other.placeMyPart('rainLogo');
    if (!placed.ok) throw new Error(placed.message);
    const use = placed.created[0]!;
    const doc = other.doc.value;
    const face = faceOnPlugin(doc, use);
    expect(face.map(id => doc.ui.elements[id]?.kind).sort()).toEqual([
      'image',
      'image',
      'led',
      'shape',
      'text',
    ]);
    expect(Object.keys(doc.assets).sort()).toEqual([LOGO, 'sc-screw'].sort());
    expect(Object.values(doc.ui.elements).find(e => e.kind === 'text')).toMatchObject({
      text: 'RAIN',
    });
    other.undo();
    expect({ ...other.doc.value, revision: 0 }).toEqual({ ...before, revision: 0 });
    // Inside a part there is no plugin to put it on.
    const made = other.commit([{ op: 'makePart', ids: ['filter1'], name: 'Holder' }]);
    if (!made.ok) throw made.error;
    const inside = other.placeMyPart('rainLogo', { inside: 'holder' });
    expect(inside.ok).toBe(true);
    expect(Object.keys(other.doc.value.ui.elements)).toEqual([]);
  });
  it("a My parts file carries the pictures' bytes; read back, they go into this browser's store; broken bytes are said and left out", async () => {
    const session = makeSession(memoryStorage());
    decorate(session);
    // Without a name it is named after its first words.
    expect(session.makeScreenPart(['word1', 'plate1'])).toMatchObject({ ok: true, use: 'rain1' });
    expect(session.doc.value.parts.rain!.name).toBe('Rain');
    expect(session.makeScreenPart(['meter1'])).toMatchObject({ ok: true, use: 'screen1' });
    session.undo();
    session.undo();
    expect(session.makeScreenPart(ALL, 'Rain Logo').ok).toBe(true);
    session.saveToMyParts('rainLogo');
    // In a browser the bytes come from the store; here the file is made with them directly.
    expect(
      libraryAssets(session.myParts.value)
        .map(a => a.id)
        .sort(),
    ).toEqual([LOGO, 'sc-screw'].sort());
    const text = serializeLibrary(session.myParts.value, undefined, { assetData: { [LOGO]: PNG } });
    const read = parseLibrary(text, catalog);
    if (!read.ok) throw new Error(read.error);
    expect(read.assetData).toEqual({ [LOGO]: PNG });
    expect(read.library.parts.rainLogo!.versions[0]!.bundle.assets?.[LOGO]).not.toHaveProperty(
      'data',
    );
    // Another machine: imported, the bytes land in its store and the picture shows.
    const store = new AssetStore(null);
    const elsewhere = makeSession(memoryStorage(), store);
    expect(elsewhere.importMyParts(text)).toMatchObject({
      ok: true,
      message: 'My parts: added 1.',
    });
    await expect.poll(async () => (await store.get(LOGO))?.size ?? 0).toBeGreaterThan(0);
    // Bytes that are not what they say are dropped with a reason (once), the part still comes in.
    const raw = JSON.parse(text);
    raw.parts.rainLogo.versions[0].bundle.assets[LOGO].data = 'data:image/jpeg;base64,AAAA';
    raw.parts.rainLogo.versions.push({ ...raw.parts.rainLogo.versions[0], version: 2 });
    const spoiled = parseLibrary(JSON.stringify(raw), catalog);
    if (!spoiled.ok) throw new Error(spoiled.error);
    expect(spoiled.assetData).toEqual({});
    expect(spoiled.report.filter(i => i.code === 'dropped-asset-data')).toHaveLength(1);
    expect(spoiled.library.parts.rainLogo!.versions).toHaveLength(2);
  });
});

describe('a face of one control in the session', () => {
  it('saved from one knob, the face is that knob: kept through other edits and the autosave', () => {
    const storage = memoryStorage();
    const session = makeSession(storage);
    expect(session.commit([{ op: 'makePart', ids: ['cut1', 'filter1'], name: 'Tone' }]).ok).toBe(
      true,
    );
    expect(session.putFace('tone1', { x: 20, y: 20 }).ok).toBe(true);
    const doc = session.doc.value;
    const reso = faceOnPlugin(doc, 'tone1').find(id =>
      Object.values(doc.edges).some(e => e.from.node === id && e.to.port === 'resonance'),
    )!;
    expect(session.saveFace('tone1', [reso])).toMatchObject({
      ok: true,
      message: expect.stringMatching(/Tone's face: 1 control, 0 decorations/),
    });
    expect(session.doc.value.ui.groups[faceGroup('tone1')]).toEqual([reso]);
    // The rest of the old face is still on the plugin (not part of the face any more); removing it leaves the face alone.
    const rest = Object.keys(session.doc.value.ui.elements);
    expect(rest.length).toBeGreaterThan(0);
    expect(session.commit(rest.map(id => ({ op: 'removeElement' as const, id }))).ok).toBe(true);
    expect(session.doc.value.ui.groups[faceGroup('tone1')]).toEqual([reso]);
    expect(session.myPartStatus('tone').entry).toBeNull();
    // Through a file.
    const back = parseDocument(serializeDocument(session.doc.value), catalog);
    if (!back.ok) throw new Error(back.error);
    expect(back.doc.ui.groups[faceGroup('tone1')]).toEqual([reso]);
    expect(storage.getItem(MY_PARTS_KEY)).toBeNull();
  });
});

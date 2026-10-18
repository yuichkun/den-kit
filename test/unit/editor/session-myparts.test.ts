// My parts in the session: saved to the browser's storage, so another patch
// (or another tab) can place them; a newer version is offered with what changes
// and lands as one undo step; files carry them; a full storage says so and
// loses nothing in the patch.
import { describe, expect, it } from 'vite-plus/test';
import { KitSession, MY_PARTS_KEY, type StorageLike } from '../../../src/editor/session.ts';
import { starter } from '../../../src/core/starters.ts';
import { catalog } from '../../../src/blocks/index.ts';
import { extractBundle, bundleHash, latest } from '../../../src/core/library.ts';

function memoryStorage(): StorageLike & { data: Map<string, string>; full: boolean } {
  const data = new Map<string, string>();
  return {
    data, full: false,
    getItem(key) { return data.get(key) ?? null; },
    setItem(key, value) { if (this.full && key === MY_PARTS_KEY) throw new Error('QuotaExceededError'); data.set(key, value); },
    removeItem(key) { data.delete(key); },
  };
}
function makeSession(storage: StorageLike) {
  const session = new KitSession({
    storage,
    createWorker: () => ({ postMessage() {}, terminate() {}, onmessage: null, onerror: null, onmessageerror: null }) as never,
    engine: { setParam() {}, unload() {}, running: false } as never,
  });
  session.replace(starter('bass', catalog), 'Bass', false);
  return session;
}
/** A session whose bass has its oscillator and filter as part Tone. */
function withTone(storage = memoryStorage()) {
  const session = makeSession(storage);
  const r = session.commit([{ op: 'makePart', ids: ['osc1', 'filter1'], name: 'Tone' }]);
  if (!r.ok) throw r.error;
  return { session, storage, use: r.created[0]! };
}

describe('My parts in the session', () => {
  it('saved in one patch, placed in another (and another tab sees it); placing the same version again adds a use', () => {
    const { session, storage } = withTone();
    const saved = session.saveToMyParts('tone');
    expect(saved).toMatchObject({ ok: true, message: expect.stringMatching(/Saved “Tone” to My parts/) });
    expect(session.doc.value.parts.tone!.from).toMatchObject({ id: 'tone', version: 1 });
    expect(session.saveToMyParts('tone').message).toMatch(/already in My parts \(v1\)/);
    // Another tab, another patch.
    const other = makeSession(storage);
    other.replace(starter('pad', catalog), 'Pad', false);
    expect(Object.keys(other.myParts.value.parts)).toEqual(['tone']);
    const placed = other.placeMyPart('tone', { pos: { x: 0, y: 900 } });
    expect(placed.ok).toBe(true);
    const def = Object.values(other.doc.value.parts).find(p => p.from?.id === 'tone')!;
    expect(def.from!.version).toBe(1);
    const again = other.placeMyPart('tone');
    expect(again.ok).toBe(true);
    expect(Object.values(other.doc.value.parts).filter(p => p.from?.id === 'tone')).toHaveLength(1);
    expect(Object.values(other.doc.value.nodes).filter(n => n.part === def.id)).toHaveLength(2);
    expect(other.placeMyPart('nope')).toEqual({ ok: false, message: 'There is no “nope” in My parts.' });
    // One undo per placing.
    other.undo(); other.undo();
    expect(Object.keys(other.doc.value.parts)).toEqual([]);
  });
  it('a newer version is offered (with what changes and whether it was changed here); updating is one undo step', () => {
    const { session, storage } = withTone();
    session.saveToMyParts('tone');
    const other = makeSession(storage);
    other.placeMyPart('tone');
    const def = Object.values(other.doc.value.parts)[0]!;
    expect(other.myPartStatus(def.id)).toMatchObject({ newer: null, changedHere: false, version: 1 });
    // v2 at home: a new parameter.
    session.commit([{ op: 'addNode', node: { id: 'lfo9', type: 'den.lfo', inside: 'tone' } }, { op: 'addParam', part: 'tone', node: 'lfo9', port: 'rate', label: 'Rate' }]);
    expect(session.saveToMyParts('tone').message).toMatch(/as v2/);
    other.reloadMyParts();
    const status = other.myPartStatus(def.id);
    expect(status.newer?.version).toBe(2);
    expect(status.diff?.params.added).toEqual(['Rate']);
    expect(status.changedHere).toBe(false);
    // Changed here since: said before updating.
    const inner = Object.values(other.doc.value.nodes).find(n => n.inside === def.id && n.type === 'den.oscillator')!;
    other.commit([{ op: 'setConfig', node: inner.id, key: 'waveform', value: 'sine' }]);
    expect(other.myPartStatus(def.id).changedHere).toBe(true);
    const before = other.doc.value;
    expect(other.updateFromMyParts(def.id)).toEqual({ ok: true, message: 'Updated to v2.' });
    expect(bundleHash(extractBundle(other.doc.value, def.id))).toBe(bundleHash(latest(other.myParts.value.parts.tone!).bundle));
    expect(other.myPartStatus(def.id)).toMatchObject({ newer: null, changedHere: false, version: 2 });
    other.undo();
    expect({ ...other.doc.value, revision: 0 }).toEqual({ ...before, revision: 0 });
    expect(other.updateFromMyParts('nope').ok).toBe(false);
  });
  it('files carry My parts; a broken file is refused; removing takes one out', async () => {
    const { session } = withTone();
    session.saveToMyParts('tone');
    const text = await session.exportMyParts();
    const fresh = makeSession(memoryStorage());
    expect(fresh.importMyParts(text)).toMatchObject({ ok: true, message: 'My parts: added 1.' });
    expect(fresh.importMyParts(text)).toMatchObject({ ok: true, message: 'Nothing new in that file.' });
    expect(fresh.importMyParts('not json')).toMatchObject({ ok: false, message: expect.stringMatching(/Not valid JSON/) });
    expect(fresh.removeFromMyParts('tone')).toBe(true);
    expect(fresh.myParts.value.parts).toEqual({});
    expect(fresh.removeFromMyParts('tone')).toBe(false);
  });
  it('a full storage says so; the patch is untouched', () => {
    const { session, storage } = withTone();
    storage.full = true;
    const before = session.doc.value;
    const r = session.saveToMyParts('tone');
    expect(r).toEqual({ ok: false, message: 'My parts could not be saved: the browser storage is full.' });
    expect(session.doc.value).toBe(before);
    expect(session.myParts.value.parts).toEqual({});
    expect(session.toasts.value.some(t => /storage is full/.test(t.text))).toBe(true);
  });
  it('a corrupted My parts record starts empty instead of failing', () => {
    const storage = memoryStorage();
    storage.data.set(MY_PARTS_KEY, '{ broken');
    const session = makeSession(storage);
    expect(session.myParts.value.parts).toEqual({});
  });
});

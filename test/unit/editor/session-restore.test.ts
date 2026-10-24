// Opening the work the editor saved: the same document as when it was saved, its
// revision included; within a session the revision only goes up.
import { describe, expect, it } from 'vite-plus/test';
import { KitSession, type StorageLike } from '../../../src/editor/session.ts';
import { catalog } from '../../../src/sound/blocks/index.ts';
import { starter } from '../../../src/work/starters.ts';

function memoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: key => void data.delete(key),
  };
}
const session = (storage: StorageLike) =>
  new KitSession({
    storage,
    createWorker: () =>
      ({
        postMessage() {},
        terminate() {},
        onmessage: null,
        onerror: null,
        onmessageerror: null,
      }) as never,
    engine: { setParam() {}, setAssets() {}, unload() {}, running: false } as never,
  });

describe('opening the saved work', () => {
  it('gives back the document as it was saved, its revision included', () => {
    const storage = memoryStorage();
    const first = session(storage);
    first.restore('bass');
    for (const value of [0.5, 1, 2])
      first.commit([{ op: 'setValue', node: 'filter1', port: 'resonance', value }]);
    first.saveNow();
    const saved = first.doc.value;
    expect(saved.revision).toBeGreaterThan(3);
    const again = session(storage);
    expect(again.restore('bass')).toBe(true);
    expect(again.doc.value).toEqual(saved);
    // Loading a starter over it is a later revision.
    again.replace({ ...starter('pad', catalog), id: 'other' }, 'Pad');
    expect(again.doc.value.revision).toBe(saved.revision + 1);
  });
});

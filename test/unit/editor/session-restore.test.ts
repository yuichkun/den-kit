// Opening the work the editor saved: the same document as when it was saved, its
// revision included; within a session the revision only goes up.
import { describe, expect, it } from 'vite-plus/test';
import { KitSession, type StorageLike } from '../../../src/editor/session.ts';
import { catalog } from '../../../src/sound/blocks/index.ts';
import { starter } from '../../../src/work/starters.ts';
import { writeWorkFile } from '../../../src/work/work-file.ts';

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

describe('importing a work file', () => {
  it('the work keeps its identity and this window keeps its lock', async () => {
    const storage = memoryStorage();
    const from = session(storage);
    from.restore('bass');
    from.commit([{ op: 'setName', name: 'Elsewhere' }]);
    const file = await writeWorkFile({ ...from.doc.value, id: 'another-work' }, async () => null);
    const here = session(memoryStorage());
    here.restore('bass');
    const id = here.doc.value.id;
    const claims: string[] = [];
    here.lock.claim = async (work: string) => {
      claims.push(work);
      return true;
    };
    expect(await here.importWork(file)).toBe(true);
    expect(here.doc.value.name).toBe('Elsewhere');
    expect(here.doc.value.id).toBe(id);
    expect(claims.filter(c => c !== id)).toEqual([]);
  });
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

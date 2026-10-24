// The Storage of the development host's page: records in localStorage, the contents
// of work files in IndexedDB. A content the database refuses is not reported as kept.
import { describe, expect, it } from 'vite-plus/test';
import { browserStorage } from '../../../desktop/page/storage.ts';

/** A localStorage of its own. */
function records(): globalThis.Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    key: i => [...data.keys()][i] ?? null,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: key => void data.delete(key),
    clear: () => data.clear(),
  };
}

/** An IndexedDB with one object store whose writes fail while `full()` says so. */
function database(full: () => boolean) {
  const data = new Map<string, unknown>();
  type Handlers = Record<string, ((...args: unknown[]) => void) | null | unknown>;
  const later = (fn: () => void) => setTimeout(fn, 0);
  const db = {
    transaction() {
      const tx: Handlers = { error: null };
      const end = (ok: boolean) =>
        later(() => {
          if (ok) (tx.oncomplete as (() => void) | undefined)?.();
          else {
            tx.error = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
            (tx.onerror as (() => void) | undefined)?.();
            (tx.onabort as (() => void) | undefined)?.();
          }
        });
      tx.objectStore = () => ({
        get(key: string) {
          const r: Handlers = {};
          later(() => {
            r.result = data.get(key);
            (r.onsuccess as (() => void) | undefined)?.();
            end(true);
          });
          return r;
        },
        put(value: unknown, key: string) {
          const r: Handlers = {};
          const ok = !full();
          later(() => {
            if (ok) {
              data.set(key, value);
              (r.onsuccess as (() => void) | undefined)?.();
            } else {
              r.error = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
              (r.onerror as (() => void) | undefined)?.();
            }
            end(ok);
          });
          return r;
        },
      });
      return tx;
    },
  };
  return {
    open() {
      const r: Handlers = { result: db };
      later(() => (r.onsuccess as (() => void) | undefined)?.());
      return r;
    },
  } as unknown as IDBFactory;
}

describe("the development host's storage", () => {
  it('a content the database refuses is not reported as kept; once it is kept, another page reads it', async () => {
    let full = true;
    const factory = database(() => full);
    const storage = browserStorage(records(), factory);
    const bytes = new Uint8Array([1, 2, 3]);
    await expect(storage.writeContent('sha256-a', bytes)).rejects.toThrow(/quota/i);
    expect(await browserStorage(records(), factory).readContent('sha256-a')).toBeNull();
    full = false;
    await storage.writeContent('sha256-a', bytes);
    expect(await browserStorage(records(), factory).readContent('sha256-a')).toEqual(bytes);
  });
});

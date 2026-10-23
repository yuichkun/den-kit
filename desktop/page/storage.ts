// The Storage interface (src/host) in the page. In a browser (the dev host):
// records in localStorage and the contents of work files in IndexedDB, both kept
// in the window's own profile on disk; without IndexedDB (a private window)
// contents stay in memory. In the desktop app: the main process's files in the
// app's data folder (desktop/storage.ts).
import type { Storage } from '../../src/host/index.ts';
import type { DesktopAPI } from './api.ts';

const DB = 'den-kit-contents',
  STORE = 'contents';

function openContents(factory: IDBFactory | null): Promise<IDBDatabase | null> {
  if (!factory) return Promise.resolve(null);
  return new Promise(resolve => {
    try {
      const open = factory.open(DB, 1);
      open.onupgradeneeded = () => {
        open.result.createObjectStore(STORE);
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => resolve(null);
      open.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export function browserStorage(
  store: globalThis.Storage = localStorage,
  factory: IDBFactory | null = globalThis.indexedDB ?? null,
): Storage {
  const db = openContents(factory);
  const memory = new Map<string, Uint8Array>();
  const run = async <T>(
    mode: IDBTransactionMode,
    request: (s: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T | undefined> => {
    const d = await db;
    if (!d) return undefined;
    return new Promise(resolve => {
      try {
        const r = request(d.transaction(STORE, mode).objectStore(STORE));
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
  };
  return {
    read: async key => store.getItem(key),
    write: async (key, value) => store.setItem(key, value),
    remove: async key => store.removeItem(key),
    keys: async prefix =>
      Array.from({ length: store.length }, (_, i) => store.key(i)).filter(
        (key): key is string => key !== null && key.startsWith(prefix),
      ),
    async readContent(hash) {
      const known = memory.get(hash);
      if (known) return known;
      const blob = await run<Blob>('readonly', s => s.get(hash) as IDBRequest<Blob>);
      return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
    },
    async writeContent(hash, bytes) {
      memory.set(hash, bytes);
      await run('readwrite', s => s.put(new Blob([bytes as BlobPart]), hash));
    },
  };
}

/** The host's storage in the desktop app: the main process keeps it in the app's data folder. */
export function desktopStorage(shell: Pick<DesktopAPI, 'storage'>): Storage {
  return {
    read: async key => (await shell.storage({ op: 'read', key })) as string | null,
    write: async (key, value) => void (await shell.storage({ op: 'write', key, value })),
    remove: async key => void (await shell.storage({ op: 'remove', key })),
    keys: async prefix => (await shell.storage({ op: 'keys', prefix })) as string[],
    readContent: async hash =>
      (await shell.storage({ op: 'readContent', hash })) as Uint8Array | null,
    writeContent: async (hash, bytes) =>
      void (await shell.storage({ op: 'writeContent', hash, bytes })),
  };
}

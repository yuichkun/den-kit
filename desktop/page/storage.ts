// The Storage interface (src/host) over the page's localStorage, which the app's
// window keeps in its own profile on disk.
import type { Storage } from '../../src/host/index.ts';

export function browserStorage(store: globalThis.Storage = localStorage): Storage {
  return {
    read: async key => store.getItem(key),
    write: async (key, value) => store.setItem(key, value),
    remove: async key => store.removeItem(key),
    keys: async prefix =>
      Array.from({ length: store.length }, (_, i) => store.key(i)).filter(
        (key): key is string => key !== null && key.startsWith(prefix),
      ),
  };
}

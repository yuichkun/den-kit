// The editor's records (the open work's record, the person's saved parts) live in
// the host's storage. The editor reads them all when it starts, so the session can
// open the last work before anything is drawn, and writes each change through at
// once; `flush` waits until every write has reached the host (before the app
// quits or restarts). A write the host refuses is said at once (`failed`), and
// `flush` fails while a record is not kept.
import type { Storage } from '../host/index.ts';
import type { StorageLike } from './session.ts';

export interface HostRecords extends StorageLike {
  /** Settles when every change so far has reached the host's storage; rejects while a record could not be kept. */
  flush(): Promise<void>;
  /** Read a key again (another window changed it). */
  refresh(key: string): Promise<void>;
}

export async function hostRecords(
  storage: Storage,
  prefix: string,
  failed: (key: string) => void = () => undefined,
): Promise<HostRecords> {
  const values = new Map<string, string>();
  try {
    for (const key of await storage.keys(prefix)) {
      const value = await storage.read(key);
      if (value !== null) values.set(key, value);
    }
  } catch {
    /* nothing could be read: the editor starts on a starter */
  }
  // The newest value of each key waits here until it is written; null removes it.
  const pending = new Map<string, string | null>();
  /** Keys whose last write the host refused. */
  const unkept = new Set<string>();
  let writing: Promise<void> = Promise.resolve();
  const drain = () => {
    writing = writing.then(async () => {
      for (const [key, value] of pending) {
        pending.delete(key);
        try {
          if (value === null) await storage.remove(key);
          else await storage.write(key, value);
          unkept.delete(key);
        } catch {
          // The storage keeps the last record it had: say so (the person can export the work).
          unkept.add(key);
          failed(key);
        }
      }
    });
    return writing;
  };
  return {
    getItem: key => values.get(key) ?? null,
    setItem(key, value) {
      values.set(key, value);
      pending.set(key, value);
      void drain();
    },
    removeItem(key) {
      values.delete(key);
      pending.set(key, null);
      void drain();
    },
    flush: async () => {
      while (pending.size) await drain();
      await writing;
      if (unkept.size) throw new Error(`Not saved: ${[...unkept].join(', ')}.`);
    },
    async refresh(key) {
      if (pending.has(key)) return;
      const value = await storage.read(key).catch(() => null);
      if (value === null) values.delete(key);
      else values.set(key, value);
    },
  };
}

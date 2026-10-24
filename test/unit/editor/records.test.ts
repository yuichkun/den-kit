// The editor's records live in the host's storage: read once when the editor
// starts, written through after each change, flushed before the app quits.
import { describe, expect, it } from 'vite-plus/test';
import { hostRecords } from '../../../src/editor/records.ts';
import type { Storage } from '../../../src/host/index.ts';

function storage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const writes: string[] = [];
  let gate: Promise<void> = Promise.resolve();
  const s: Storage & { data: Map<string, string>; writes: string[]; hold(p: Promise<void>): void } =
    {
      data,
      writes,
      hold: p => (gate = p),
      read: async key => data.get(key) ?? null,
      write: async (key, value) => {
        await gate;
        writes.push(key);
        data.set(key, value);
      },
      remove: async key => {
        await gate;
        data.delete(key);
      },
      keys: async prefix => [...data.keys()].filter(k => k.startsWith(prefix)),
      readContent: async () => null,
      writeContent: async () => undefined,
    };
  return s;
}

describe("the editor's records", () => {
  it('a write the host refuses is said at once, and flush fails until the record is kept', async () => {
    const s = storage();
    let full = true;
    const write = s.write;
    s.write = async (key, value) => {
      if (full) throw new Error('QuotaExceededError');
      return write(key, value);
    };
    const failed: string[] = [];
    const records = await hostRecords(s, 'den-kit:', key => failed.push(key));
    records.setItem('den-kit:work', 'newer');
    await expect(records.flush()).rejects.toThrow(/den-kit:work/);
    expect(failed).toEqual(['den-kit:work']);
    full = false;
    records.setItem('den-kit:work', 'newest');
    await records.flush();
    expect(s.data.get('den-kit:work')).toBe('newest');
  });

  it('reads what the host keeps, and writes each change through', async () => {
    const s = storage({ 'den-kit:autosave': 'saved', 'other:key': 'not ours' });
    const records = await hostRecords(s, 'den-kit:');
    expect(records.getItem('den-kit:autosave')).toBe('saved');
    expect(records.getItem('other:key')).toBeNull();
    records.setItem('den-kit:autosave', 'newer');
    expect(records.getItem('den-kit:autosave')).toBe('newer');
    await records.flush();
    expect(s.data.get('den-kit:autosave')).toBe('newer');
    records.removeItem('den-kit:autosave');
    await records.flush();
    expect(s.data.has('den-kit:autosave')).toBe(false);
  });

  it('a slow storage gets the newest value of each key, and flush waits for it', async () => {
    const s = storage();
    let open!: () => void;
    s.hold(new Promise<void>(r => (open = r)));
    const records = await hostRecords(s, 'den-kit:');
    records.setItem('den-kit:autosave', 'one');
    records.setItem('den-kit:autosave', 'two');
    records.setItem('den-kit:autosave', 'three');
    const flushed = records.flush();
    open();
    await flushed;
    expect(s.data.get('den-kit:autosave')).toBe('three');
    expect(s.writes.length).toBeLessThanOrEqual(2);
  });
});

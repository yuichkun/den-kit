// The desktop app's Storage: records and contents as files in the app's data folder.
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { FileStorage } from '../../../desktop/storage.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const store = () => {
  const dir = mkdtempSync(join(tmpdir(), 'den-kit-storage-'));
  dirs.push(dir);
  return { dir, storage: new FileStorage(dir) };
};
const hashOf = (bytes: Uint8Array) => `sha256-${createHash('sha256').update(bytes).digest('hex')}`;

describe('desktop storage', () => {
  it('keeps text records by key, lists them by prefix, and forgets removed ones', () => {
    const { dir, storage } = store();
    storage.write('den-kit:work:a', '{"name":"A"}');
    storage.write('den-kit:work:b/../../x', 'B');
    storage.write('den-kit:conversation:a', 'thread-1');
    expect(storage.read('den-kit:work:a')).toBe('{"name":"A"}');
    expect(storage.read('den-kit:work:b/../../x')).toBe('B');
    expect(storage.keys('den-kit:work:').sort()).toEqual([
      'den-kit:work:a',
      'den-kit:work:b/../../x',
    ]);
    // A key never leaves the records folder.
    expect(readdirSync(dir).sort()).toEqual(['contents', 'records']);
    storage.remove('den-kit:work:a');
    expect(storage.read('den-kit:work:a')).toBeNull();
    // A second instance reads what the first wrote (after a restart).
    expect(new FileStorage(dir).read('den-kit:conversation:a')).toBe('thread-1');
  });

  it('keeps contents by their hash and refuses bytes that do not match it', () => {
    const { storage } = store();
    const bytes = new TextEncoder().encode('kick');
    storage.writeContent(hashOf(bytes), bytes);
    expect(storage.readContent(hashOf(bytes))).toEqual(bytes);
    expect(() => storage.writeContent(hashOf(new Uint8Array([1])), bytes)).toThrow(
      /does not match/,
    );
    expect(() => storage.writeContent('../../etc/passwd', bytes)).toThrow(/Invalid content hash/);
    expect(storage.readContent('../records/x')).toBeNull();
    expect(storage.readContent(hashOf(new Uint8Array([9])))).toBeNull();
  });
});

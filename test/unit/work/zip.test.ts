import { describe, expect, it } from 'vite-plus/test';
import { crc32, readZip, safePath, writeZip, ZipError } from '../../../src/work/zip.ts';

const limits = { maxEntryBytes: 1024, maxTotalBytes: 4096, maxEntries: 10 };
const text = (s: string) => new TextEncoder().encode(s);

describe('the work file container', () => {
  it('reads back exactly what it wrote, in order', () => {
    const entries = [
      { path: 'work.json', data: text('{"a":1}') },
      { path: 'contents/sha256-x', data: new Uint8Array([0, 1, 2, 255]) },
      { path: 'build/index.html', data: text('<!doctype html>') },
    ];
    const back = readZip(writeZip(entries), limits);
    expect(back.map(e => e.path)).toEqual(entries.map(e => e.path));
    back.forEach((e, i) => expect(e.data).toEqual(entries[i]!.data));
  });

  it('computes the standard CRC-32', () => {
    expect(crc32(text('123456789'))).toBe(0xcbf43926);
  });

  it('refuses what is not an archive, or a damaged one', () => {
    expect(() => readZip(text('not a zip at all, just some text'), limits)).toThrow(ZipError);
    const zip = writeZip([{ path: 'a.txt', data: text('hello') }]);
    const flipped = zip.slice();
    flipped[30 + 'a.txt'.length] ^= 0xff; // one byte of the data
    expect(() => readZip(flipped, limits)).toThrow(/does not check out/);
    expect(() => readZip(zip.slice(0, zip.length - 5), limits)).toThrow(ZipError);
  });

  it('refuses entries over the limits before reading them', () => {
    const big = writeZip([{ path: 'big.bin', data: new Uint8Array(2000) }]);
    expect(() => readZip(big, limits)).toThrow(/at most 0 MB|at most/);
    const many = writeZip(
      Array.from({ length: 5 }, (_, i) => ({ path: `f${i}`, data: new Uint8Array(1000) })),
    );
    expect(() => readZip(many, limits)).toThrow(/larger than/);
    const count = writeZip(
      Array.from({ length: 11 }, (_, i) => ({ path: `f${i}`, data: text('') })),
    );
    expect(() => readZip(count, limits)).toThrow(/at most 10/);
  });

  it('an entry with a limit of its own may hold more than the others', () => {
    const zip = writeZip([
      { path: 'work.json', data: new Uint8Array(2000) },
      { path: 'big.bin', data: new Uint8Array(2000) },
    ]);
    const own = { ...limits, maxBytesOf: { 'work.json': 3000 } };
    expect(() => readZip(zip, own)).toThrow(/big\.bin is .* at most/);
    expect(
      readZip(zip.slice(), { ...own, maxBytesOf: { 'work.json': 3000, 'big.bin': 3000 } }),
    ).toHaveLength(2);
  });

  it('refuses paths that leave the archive or appear twice', () => {
    expect(() => readZip(writeZip([{ path: '../evil', data: text('') }]), limits)).toThrow(
      /outside the work/,
    );
    expect(() => readZip(writeZip([{ path: '/etc/passwd', data: text('') }]), limits)).toThrow(
      /outside the work/,
    );
    const twice = writeZip([
      { path: 'a', data: text('1') },
      { path: 'a', data: text('2') },
    ]);
    expect(() => readZip(twice, limits)).toThrow(/twice/);
    expect(safePath('assets/wood.jpg')).toBe(true);
    for (const bad of ['', 'a//b', 'a/./b', 'a\\b', 'a/\u0001'])
      expect(safePath(bad), JSON.stringify(bad)).toBe(false);
  });
});

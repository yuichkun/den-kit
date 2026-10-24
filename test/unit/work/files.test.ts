import { describe, expect, it } from 'vite-plus/test';
import type { Issue } from '../../../src/work/issues.ts';
import {
  WORK_LIMITS,
  checkFile,
  checkPath,
  isText,
  partNames,
  readFiles,
  sha256,
  shippedPath,
  sniff,
  totalBytes,
} from '../../../src/work/files.ts';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const WAV = new Uint8Array(
  [...'RIFF']
    .map(c => c.charCodeAt(0))
    .concat(
      [0, 0, 0, 0],
      [...'WAVE'].map(c => c.charCodeAt(0)),
    ),
);
const text = (s: string) => new TextEncoder().encode(s);

describe("the work's files", () => {
  it('keeps text as text and other files by their SHA-256', async () => {
    const source = await checkFile('src/parts/meter.ts', text('export default 1;\n'), sha256);
    expect(source).toEqual({ ok: true, file: { text: 'export default 1;\n' } });
    const picture = await checkFile('assets/dot.png', PNG, sha256);
    expect(picture.ok).toBe(true);
    if (!picture.ok) return;
    expect(picture.file).toMatchObject({ bytes: PNG.length, type: 'image/png' });
    expect(isText(picture.file)).toBe(false);
    expect((picture.file as { hash: string }).hash).toBe(await sha256(PNG));
    expect(await sha256(new Uint8Array())).toBe(
      'sha256-e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('refuses a file that is not what its name says, for the kinds den-kit reads', async () => {
    const fake = await checkFile('assets/photo.png', text('<script>alert(1)</script>'), sha256);
    expect(fake).toEqual({ ok: false, reason: expect.stringMatching(/named as a PNG picture/) });
    const sound = await checkFile('assets/kick.wav', PNG, sha256);
    expect(sound.ok).toBe(false);
    expect((await checkFile('assets/kick.wav', WAV, sha256)).ok).toBe(true);
    // Files only code in the work reads are data: no check of their contents.
    expect((await checkFile('assets/scene.glb', text('anything'), sha256)).ok).toBe(true);
    expect((await checkFile('src/a.ts', new Uint8Array([0xff, 0xfe, 0]), sha256)).ok).toBe(false);
  });

  it('refuses a file over the size limit before hashing it', async () => {
    const huge = { length: WORK_LIMITS.fileBytes + 1 } as Uint8Array;
    let hashed = false;
    const r = await checkFile('assets/huge.bin', huge, async () => {
      hashed = true;
      return 'x';
    });
    expect(r).toEqual({ ok: false, reason: expect.stringMatching(/at most 100 MB/) });
    expect(hashed).toBe(false);
  });

  it('knows file formats by their first bytes', () => {
    expect(sniff(PNG)).toContain('image/png');
    expect(sniff(WAV)).toContain('audio/wav');
    expect(
      sniff(text('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>')),
    ).toContain('image/svg+xml');
    expect(sniff(text('hello'))).toEqual([]);
  });

  it('keeps paths plain and inside the work', () => {
    expect(checkPath('assets/wood grain.jpg')).toBeNull();
    for (const bad of [
      '../x',
      '/abs',
      'a/../b',
      'node_modules/x/index.js',
      'src/kit/controls.ts',
      '',
    ])
      expect(checkPath(bad), bad).not.toBeNull();
  });

  it('drops broken entries of a record with a reason and keeps the rest', () => {
    const report: Issue[] = [];
    const hash = `sha256-${'a'.repeat(64)}`;
    const files = readFiles(
      {
        'src/parts/a.ts': { text: 'export {}' },
        'assets/a.png': { hash, bytes: 10, type: 'image/png', width: 4, height: 4 },
        'assets/b.png': { hash: 'md5-x', bytes: 10, type: 'image/png' },
        '../escape': { text: 'x' },
        'assets/c.bin': {
          hash,
          bytes: WORK_LIMITS.fileBytes + 1,
          type: 'application/octet-stream',
        },
      },
      report,
    );
    expect(Object.keys(files)).toEqual(['assets/a.png', 'src/parts/a.ts']);
    expect(report.map(r => r.message)).toEqual([
      expect.stringMatching(/^\.\.\/escape/),
      expect.stringMatching(/^assets\/b\.png: its contents are missing/),
      expect.stringMatching(/^assets\/c\.bin: its size/),
    ]);
    expect(partNames(files)).toEqual(['a']);
    expect(totalBytes(files)).toBe(10 + 'export {}'.length);
  });

  it("takes a file den-kit ships only at a path on den-kit's own origin, never another host", () => {
    const report: Issue[] = [];
    const files = readFiles(
      {
        'assets/wood.jpg': { url: '/showcase/wood.jpg', bytes: 10, type: 'image/jpeg' },
        'assets/far.png': { url: '//attacker.example/probe.png', bytes: 10, type: 'image/png' },
        'assets/away.png': { url: 'https://attacker.example/a.png', bytes: 10, type: 'image/png' },
        'assets/up.png': { url: '/showcase/../secret.png', bytes: 10, type: 'image/png' },
      },
      report,
    );
    expect(Object.keys(files)).toEqual(['assets/wood.jpg']);
    expect(report).toHaveLength(3);
    expect(shippedPath('showcase/wood.jpg')).toBe('/showcase/wood.jpg');
    for (const url of ['//attacker.example/probe.png', '/\\attacker.example/x', 'http://x/y'])
      expect(shippedPath(url), url).toBeNull();
  });
});

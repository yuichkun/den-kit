// The work file: what is written comes back as the same work; what is damaged,
// too large or not what it says is refused or left out with a reason, and the
// work still opens.
import { describe, expect, it } from 'vite-plus/test';
import { catalog } from '../../../src/sound/blocks/index.ts';
import { applyIntents } from '../../../src/work/ops.ts';
import { documentHash } from '../../../src/work/persistence.ts';
import { WORK_LIMITS, sha256 } from '../../../src/work/files.ts';
import { starter } from '../../../src/work/starters.ts';
import { readWorkFile, writeWorkFile } from '../../../src/work/work-file.ts';
import { readZip, writeZip } from '../../../src/work/zip.ts';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2]);
const limits = { maxEntryBytes: 1e9, maxTotalBytes: 1e9, maxEntries: 1e5 };

async function work() {
  const hash = await sha256(PNG);
  const doc = applyIntents(
    starter('bass', catalog),
    [
      { op: 'setProjectFiles', files: { 'src/parts/meter.ts': 'export default 1;\n' } },
      {
        op: 'addAsset',
        asset: {
          id: 'assets/dot.png',
          name: 'dot.png',
          mime: 'image/png',
          bytes: PNG.length,
          hash,
        },
      },
      {
        op: 'addAsset',
        asset: {
          id: 'assets/den-kit/wood.jpg',
          name: 'wood.jpg',
          mime: 'image/jpeg',
          bytes: 100,
          url: '/showcase/wood.jpg',
        },
      },
      {
        op: 'addElement',
        element: {
          kind: 'image',
          asset: 'assets/dot.png',
          fit: 'cover',
          rect: { x: 0, y: 0, w: 9, h: 9 },
        },
      },
    ],
    catalog,
  ).doc;
  const contents = new Map([[hash, PNG]]);
  return { doc, hash, contents };
}

describe('the work file', () => {
  it('a written work file reads back as the same work, with its contents', async () => {
    const { doc, hash, contents } = await work();
    const bytes = await writeWorkFile(doc, async h => contents.get(h) ?? null);
    const read = await readWorkFile(bytes, catalog);
    if (!read.ok) throw new Error(read.error);
    expect(read.report).toEqual([]);
    expect(documentHash(read.doc)).toBe(documentHash(doc));
    expect(read.doc.files).toEqual(doc.files);
    expect(read.contents.get(hash)).toEqual(PNG);
    // Files den-kit ships are not carried: they are where they always are.
    expect(readZip(bytes, limits).map(e => e.path)).toEqual(['work.json', `contents/${hash}`]);
  });

  it('carries the playable build beside the record', async () => {
    const { doc, contents } = await work();
    const build = { 'index.html': new TextEncoder().encode('<!doctype html>') };
    const read = await readWorkFile(
      await writeWorkFile(doc, async h => contents.get(h) ?? null, build),
      catalog,
    );
    if (!read.ok) throw new Error(read.error);
    expect(read.build).toEqual(build);
  });

  it("a work whose text takes more than one file's limit in the record reads back, and so does its build's record", async () => {
    // JSON writes each backslash as two: 51 MB of them make a record of more than 100 MB.
    const files = Object.fromEntries(
      Array.from({ length: 51 }, (_, i) => [`src/data${i}.ts`, '\\'.repeat(WORK_LIMITS.textBytes)]),
    );
    const doc = applyIntents(
      starter('bass', catalog),
      [{ op: 'setProjectFiles', files }],
      catalog,
    ).doc;
    const bytes = await writeWorkFile(doc, async () => null);
    expect(readZip(bytes, limits)[0]!.data.length).toBeGreaterThan(WORK_LIMITS.fileBytes);
    const read = await readWorkFile(bytes, catalog);
    if (!read.ok) throw new Error(read.error);
    expect(read.doc.files).toEqual(doc.files);
    // The build's build.json holds the document too.
    const build = { 'build.json': new Uint8Array(WORK_LIMITS.fileBytes + 1) };
    const withBuild = await readWorkFile(
      await writeWorkFile(starter('bass', catalog), async () => null, build),
      catalog,
    );
    if (!withBuild.ok) throw new Error(withBuild.error);
    expect(withBuild.build['build.json']!.length).toBe(WORK_LIMITS.fileBytes + 1);
  }, 60_000);

  it('cannot be written without the contents it names', async () => {
    const { doc } = await work();
    await expect(writeWorkFile(doc, async () => null)).rejects.toThrow(/dot\.png/);
  });

  it('contents that do not hash to their name, or that are not what the file says, are left out with a reason', async () => {
    const { doc, hash, contents } = await work();
    const good = readZip(await writeWorkFile(doc, async h => contents.get(h) ?? null), limits);
    // Damaged on the way: the bytes no longer match their hash.
    const damaged = good.map(e =>
      e.path === `contents/${hash}` ? { ...e, data: new Uint8Array([...PNG.slice(0, -1), 9]) } : e,
    );
    const r1 = await readWorkFile(writeZip(damaged), catalog);
    if (!r1.ok) throw new Error(r1.error);
    expect(r1.doc.files['assets/dot.png']).toBeUndefined();
    expect(r1.report.map(i => i.code)).toEqual(['damaged-content', 'dropped-file']);
    // Its picture element stays, pointing at a picture that is missing (it shows as a gap).
    expect(Object.values(r1.doc.ui.elements).some(e => e.kind === 'image')).toBe(true);
    // A "PNG" whose bytes are HTML: matching its hash, but not what it says.
    const html = new TextEncoder().encode('<script>alert(1)</script>');
    const htmlHash = await sha256(html);
    const record = JSON.parse(new TextDecoder().decode(good[0]!.data));
    record.document.files['assets/dot.png'] = {
      hash: htmlHash,
      bytes: html.length,
      type: 'image/png',
    };
    const r2 = await readWorkFile(
      writeZip([
        { path: 'work.json', data: new TextEncoder().encode(JSON.stringify(record)) },
        { path: `contents/${htmlHash}`, data: html },
      ]),
      catalog,
    );
    if (!r2.ok) throw new Error(r2.error);
    expect(r2.doc.files['assets/dot.png']).toBeUndefined();
    expect(r2.report.map(i => i.message)).toEqual([expect.stringMatching(/not image\/png/)]);
  });

  it('refuses what is not a work file, is damaged as a whole, or comes from a newer den-kit', async () => {
    const { doc, contents } = await work();
    const bytes = await writeWorkFile(doc, async h => contents.get(h) ?? null);
    expect(
      await readWorkFile(new TextEncoder().encode('{"schema":"den-kit/patch"}'), catalog),
    ).toMatchObject({
      ok: false,
    });
    const cut = bytes.slice(0, bytes.length - 30);
    expect(await readWorkFile(cut, catalog)).toMatchObject({ ok: false });
    const entries = readZip(bytes, limits);
    const record = JSON.parse(new TextDecoder().decode(entries[0]!.data));
    record.version = 99;
    const newer = writeZip([
      { path: 'work.json', data: new TextEncoder().encode(JSON.stringify(record)) },
      ...entries.slice(1),
    ]);
    expect(await readWorkFile(newer, catalog)).toEqual({
      ok: false,
      error: expect.stringMatching(/newer den-kit/),
    });
    expect(
      await readWorkFile(writeZip([{ path: 'other.json', data: new Uint8Array() }]), catalog),
    ).toEqual({ ok: false, error: expect.stringMatching(/no work\.json/) });
  });
});

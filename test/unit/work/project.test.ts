import { describe, expect, it } from 'vite-plus/test';
import { catalog } from '../../../src/sound/blocks/index.ts';
import { applyIntents, applyResolvedOps, invertAll, OpError } from '../../../src/work/ops.ts';
import { documentHash, parseDocument, serializeDocument } from '../../../src/work/persistence.ts';
import {
  checkPath as checkProjectPath,
  partNames,
  readFiles,
  textFiles,
  WORK_LIMITS,
} from '../../../src/work/files.ts';
import type { Issue } from '../../../src/work/issues.ts';
import { starter } from '../../../src/work/starters.ts';

const failure = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof OpError) return e;
    throw e;
  }
  throw new Error('expected OpError');
};

describe('screen project: paths and reading', () => {
  it('keeps sources and refuses what the tools or den-kit make', () => {
    expect(checkProjectPath('src/parts/reels.ts')).toBeNull();
    expect(checkProjectPath('package.json')).toBeNull();
    expect(checkProjectPath('.gitignore')).toBeNull();
    expect(checkProjectPath('src/kit/controls.ts')).toContain('made by den-kit');
    for (const bad of ['node_modules/a.js', '.git/HEAD', 'dist/x.js', '../x', 'a/../b', '/abs', ''])
      expect(checkProjectPath(bad), bad).not.toBeNull();
  });
  it('lists the parts the project offers', () => {
    expect(
      partNames({
        'src/parts/reels.ts': { text: '' },
        'src/parts/big-meter.tsx': { text: '' },
        'src/parts/Bad.ts': { text: '' },
        'src/parts/x/y.ts': { text: '' },
        'src/main.ts': { text: '' },
      }),
    ).toEqual(['big-meter', 'reels']);
    expect(partNames({})).toEqual([]);
  });
  it('reading a file drops bad paths, non-text and oversized files with a reason', () => {
    const report: Issue[] = [];
    const files = readFiles(
      {
        'src/a.ts': { text: 'ok' },
        'node_modules/x.js': { text: 'no' },
        'src/b.ts': { text: 3 },
        'big.txt': { text: 'x'.repeat(WORK_LIMITS.textBytes + 1) },
        'src/kit/controls.ts': { text: 'gen' },
      },
      report,
    );
    expect(files).toEqual({ 'src/a.ts': { text: 'ok' } });
    expect(report.map(i => i.code)).toEqual([
      'dropped-file',
      'dropped-file',
      'dropped-file',
      'dropped-file',
    ]);
    expect(readFiles({}, [])).toEqual({});
    expect(readFiles('junk', [])).toEqual({});
  });
});

describe('screen project: setProjectFiles', () => {
  it('writes, changes and deletes files; one undo restores everything', () => {
    const doc = starter('bass', catalog);
    const before = documentHash(doc);
    const r1 = applyIntents(
      doc,
      [{ op: 'setProjectFiles', files: { 'src/parts/a.ts': 'A', 'package.json': '{}' } }],
      catalog,
    );
    expect(textFiles(r1.doc.files)).toEqual({ 'src/parts/a.ts': 'A', 'package.json': '{}' });
    expect(doc.files).toEqual({});
    const r2 = applyIntents(
      r1.doc,
      [{ op: 'setProjectFiles', files: { 'src/parts/a.ts': 'A2', 'package.json': null } }],
      catalog,
    );
    expect(textFiles(r2.doc.files)).toEqual({ 'src/parts/a.ts': 'A2' });
    expect(r2.ops.map(o => o.op)).toEqual(['setFile', 'setFile']);
    const back = applyResolvedOps(r2.doc, invertAll(r2.ops));
    expect(back.files).toEqual(r1.doc.files);
    const empty = applyResolvedOps(r1.doc, invertAll(r1.ops));
    expect(empty.files).toEqual({});
    expect(documentHash(empty)).toBe(before);
  });
  it('the same text again changes nothing', () => {
    const r1 = applyIntents(
      starter('bass', catalog),
      [{ op: 'setProjectFiles', files: { 'a.ts': 'x' } }],
      catalog,
    );
    expect(
      applyIntents(r1.doc, [{ op: 'setProjectFiles', files: { 'a.ts': 'x' } }], catalog).ops,
    ).toEqual([]);
  });
  it('refuses bad paths, generated files, non-text and oversize, leaving the document as it was', () => {
    const doc = starter('bass', catalog);
    expect(
      failure(() =>
        applyIntents(
          doc,
          [{ op: 'setProjectFiles', files: { 'node_modules/x.js': 'x' } }],
          catalog,
        ),
      ).code,
    ).toBe('bad-file');
    expect(
      failure(() =>
        applyIntents(
          doc,
          [{ op: 'setProjectFiles', files: { 'src/kit/controls.ts': 'x' } }],
          catalog,
        ),
      ).code,
    ).toBe('bad-file');
    expect(
      failure(() =>
        applyIntents(
          doc,
          [{ op: 'setProjectFiles', files: { 'a.ts': 5 as unknown as string } }],
          catalog,
        ),
      ).code,
    ).toBe('bad-file');
    expect(
      failure(() =>
        applyIntents(
          doc,
          [{ op: 'setProjectFiles', files: { 'a.ts': 'x'.repeat(WORK_LIMITS.textBytes + 1) } }],
          catalog,
        ),
      ).code,
    ).toBe('too-large');
    const many = Object.fromEntries(
      Array.from({ length: WORK_LIMITS.files + 1 }, (_, i) => [`f${i}.ts`, 'x']),
    );
    expect(
      failure(() => applyIntents(doc, [{ op: 'setProjectFiles', files: many }], catalog)).code,
    ).toBe('too-large');
    expect(
      failure(() =>
        applyIntents(
          doc,
          [{ op: 'setProjectFiles', files: [] as unknown as Record<string, string> }],
          catalog,
        ),
      ).code,
    ).toBe('bad-intent');
    expect(doc.files).toEqual({});
  });
  it('code elements name a part; a bad name is refused', () => {
    const doc = starter('bass', catalog);
    const ok = applyIntents(
      doc,
      [
        {
          op: 'addElement',
          element: {
            kind: 'code',
            part: 'reels',
            rect: { x: 0, y: 0, w: 100, h: 80 },
            props: { speed: 2 },
          },
        },
      ],
      catalog,
    );
    const el = Object.values(ok.doc.ui.elements).find(e => e.kind === 'code');
    expect(el).toMatchObject({ kind: 'code', part: 'reels', props: { speed: 2 } });
    expect(
      failure(() =>
        applyIntents(
          doc,
          [
            {
              op: 'addElement',
              element: { kind: 'code', part: 'Bad Name', rect: { x: 0, y: 0, w: 100, h: 80 } },
            },
          ],
          catalog,
        ),
      ).code,
    ).toBeTruthy();
  });
});

describe("the work's files in the document", () => {
  it('a work with a project and a code part survives export → import', () => {
    let doc = starter('bass', catalog);
    doc = applyIntents(
      doc,
      [
        {
          op: 'setProjectFiles',
          files: { 'src/parts/reels.ts': 'export default 1;\n', 'package.json': '{"name":"x"}\n' },
        },
        {
          op: 'addElement',
          element: {
            kind: 'code',
            part: 'reels',
            rect: { x: 10, y: 10, w: 120, h: 90 },
            props: { color: 'accent', on: true },
          },
        },
      ],
      catalog,
    ).doc;
    const parsed = parseDocument(serializeDocument(doc), catalog);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.report).toEqual([]);
    expect(parsed.doc.files).toEqual(doc.files);
    expect(documentHash(parsed.doc)).toBe(documentHash(doc));
    expect(JSON.parse(serializeDocument(doc)).version).toBe(5);
  });
  it('the project is part of the document hash', () => {
    const doc = starter('bass', catalog);
    const changed = applyIntents(
      doc,
      [{ op: 'setProjectFiles', files: { 'a.ts': 'x' } }],
      catalog,
    ).doc;
    expect(documentHash(changed)).not.toBe(documentHash(doc));
  });
  it('documents from the preview before the file tree are refused with a reason', () => {
    const text = JSON.parse(serializeDocument(starter('bass', catalog)));
    text.version = 4;
    const parsed = parseDocument(JSON.stringify(text), catalog);
    expect(parsed).toEqual({ ok: false, error: expect.stringMatching(/earlier preview/) });
  });
});

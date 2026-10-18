import { describe, expect, it } from 'vite-plus/test';
import { catalog } from '../../../src/blocks/index.ts';
import { documentHash, makeSaveRecord, parseDocument, readSaveRecord, serializeDocument, MAX_FILE_BYTES } from '../../../src/core/persistence.ts';
import { STARTERS, starter } from '../../../src/core/starters.ts';

describe('persistence', () => {
  it('F8 export → import is identical for every starter', () => {
    for (const id of STARTERS) {
      const doc = starter(id, catalog);
      const parsed = parseDocument(serializeDocument(doc), catalog);
      if (!parsed.ok) throw new Error(parsed.error);
      expect(parsed.report).toEqual([]);
      expect(documentHash(parsed.doc)).toBe(documentHash(doc));
    }
  });
  it('F5 refuses non-JSON, wrong schema, huge files and newer versions with a reason', () => {
    expect(parseDocument('{nope', catalog)).toMatchObject({ ok: false, error: expect.stringContaining('Not valid JSON') });
    expect(parseDocument('[]', catalog)).toMatchObject({ ok: false });
    expect(parseDocument(JSON.stringify({ schema: 'other', version: 1 }), catalog)).toMatchObject({ ok: false, error: expect.stringContaining('Not a den-kit patch') });
    expect(parseDocument(JSON.stringify({ schema: 'den-kit/patch', version: 9 }), catalog)).toMatchObject({ ok: false, error: expect.stringContaining('newer den-kit') });
    expect(parseDocument(JSON.stringify({ schema: 'den-kit/patch' }), catalog)).toMatchObject({ ok: false });
    expect(parseDocument('x'.repeat(MAX_FILE_BYTES + 1), catalog)).toMatchObject({ ok: false, error: expect.stringContaining('larger') });
  });
  it('F4 repairs and reports unknown blocks, bad ids, bad values and dangling cables', () => {
    const parsed = parseDocument(JSON.stringify({
      schema: 'den-kit/patch', version: 1, name: 'broken',
      nodes: {
        'bad id': { type: 'den.oscillator', values: { frequency: 'loud', nope: 3 }, config: { waveform: 'saw', junk: { a: 1 } } },
        ghost1: { id: 'ghost1', type: 'den.ghost' },
        f1: { id: 'f1', type: 'den.filter', pos: { x: 'a' } },
        x: 5,
      },
      edges: [{ from: { node: 'bad id', port: 'out' }, to: { node: 'f1', port: 'input' } }, { from: { node: 'zzz', port: 'out' }, to: { node: 'f1', port: 'cutoff' } }, { from: { node: 'f1', port: 'nope' }, to: { node: 'f1', port: 'input' } }, 'junk'],
    }), catalog);
    if (!parsed.ok) throw new Error(parsed.error);
    const codes = parsed.report.map(i => i.code);
    expect(codes).toEqual(expect.arrayContaining(['renamed-node', 'unknown-type', 'dropped-value', 'dropped-config', 'dropped-edge', 'dropped-node']));
    expect(Object.keys(parsed.doc.nodes).sort()).toEqual(['f1', 'ghost1', 'oscillator1']);
    expect(Object.values(parsed.doc.edges)).toEqual([{ id: 'e1', from: { node: 'oscillator1', port: 'out' }, to: { node: 'f1', port: 'input' } }]);
    expect(parsed.doc.nodes.f1!.pos).toEqual({ x: 0, y: 0 });
  });
  it('F1 autosave records detect corruption', () => {
    const record = makeSaveRecord(starter('bass', catalog), 1);
    expect(readSaveRecord(record, catalog).ok).toBe(true);
    expect(readSaveRecord({ ...record, text: record.text.replace('Bass', 'Bas') }, catalog)).toMatchObject({ ok: false, error: expect.stringContaining('checksum') });
    expect(readSaveRecord(null, catalog).ok).toBe(false);
  });
});

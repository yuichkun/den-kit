// My parts: a part saved outside any one patch, placed in another patch (its
// definition comes in, ids made free), saved again as a new version, offered as
// an update with what changes shown first (the uses keep their values), and
// carried in files. Broken bundles and files are refused or repaired with a
// reason, never half-placed.
import { describe, expect, it } from 'vite-plus/test';
import { catalog } from '../../../src/sound/blocks/index.ts';
import { generate } from '../../../src/sound/codegen.ts';
import {
  bundleHash,
  checkBundle,
  describeDiff,
  diffBundles,
  emptyLibrary,
  extractBundle,
  KEEP_VERSIONS,
  latest,
  LIBRARY_SCHEMA,
  mergeLibrary,
  libraryAssets,
  parseLibrary,
  removeFromLibrary,
  saveToLibrary,
  serializeLibrary,
  type Library,
  type PartBundle,
} from '../../../src/work/library.ts';
import {
  applyIntents,
  applyResolvedOps,
  invertAll,
  OpError,
  type Intent,
  type ResolvedOp,
} from '../../../src/work/ops.ts';
import { WORK_LIMITS, totalBytes } from '../../../src/work/files.ts';
import { documentHash, parseDocument, serializeDocument } from '../../../src/work/persistence.ts';
import { clone, emptyDocument, type PatchDocument } from '../../../src/work/schema.ts';
import { starter } from '../../../src/work/starters.ts';
import { validate } from '../../../src/work/validate.ts';

const apply = (doc: PatchDocument, ...intents: Intent[]) => applyIntents(doc, intents, catalog);
const failure = (fn: () => unknown): OpError => {
  try {
    fn();
  } catch (error) {
    if (error instanceof OpError) return error;
    throw error;
  }
  throw new Error('expected an OpError');
};
const same = (a: PatchDocument, b: PatchDocument) =>
  expect({ ...a, revision: 0 }).toEqual({ ...b, revision: 0 });
function undoes(before: PatchDocument, r: { doc: PatchDocument; ops: ResolvedOp[] }) {
  same(applyResolvedOps(r.doc, invertAll(r.ops)), before);
}

/** The bass with its oscillator and filter made into part Tone (use tone1), the filter's cutoff an input and its resonance a parameter. */
const toned = () =>
  apply(starter('bass', catalog), { op: 'makePart', ids: ['osc1', 'filter1'], name: 'Tone' }).doc;
/** Tone with a part Inner (the filter) inside it. */
const nested = () => apply(toned(), { op: 'makePart', ids: ['filter1'], name: 'Inner' }).doc;
/** Save part `id` of `doc` into `lib`, and record it in the patch (as the session does). */
function save(lib: Library, doc: PatchDocument, id: string, now = 1) {
  const r = saveToLibrary(lib, doc, id, now);
  return {
    ...r,
    doc: r.unchanged ? doc : apply(doc, { op: 'updatePart', part: id, from: r.from }).doc,
  };
}
/** A patch with just Out, to place things in. */
const blank = () =>
  apply(emptyDocument('blank'), { op: 'addNode', node: { id: 'out1', type: 'kit.out' } }).doc;
const place = (
  doc: PatchDocument,
  lib: Library,
  id: string,
  extra: Partial<Extract<Intent, { op: 'importPart' }>> = {},
) => {
  const v = latest(lib.parts[id]!);
  return apply(doc, {
    op: 'importPart',
    bundle: v.bundle,
    from: { id, version: v.version, hash: bundleHash(v.bundle) },
    ...extra,
  });
};

const KICK2 = `sha256-${'5'.repeat(64)}`,
  KICK3 = `sha256-${'6'.repeat(64)}`;
/** `doc` with other contents (`hash`, and `bytes`) at the asset `path`. */
const withContents = (doc: PatchDocument, path: string, hash: string, bytes?: number) => ({
  ...doc,
  files: {
    ...doc.files,
    [path]: { ...doc.files[path]!, hash, ...(bytes ? { bytes } : {}) } as never,
  },
});

/** A work whose part Kit plays assets/kick.wav (its contents `kick`) in a sampler and reads assets/table.bin in a codebox. */
function kitWork(kick = `sha256-${'1'.repeat(64)}`) {
  const asset = (id: string, mime: string, hash: string): Intent => ({
    op: 'addAsset',
    asset: { id, name: id.slice(7), mime, bytes: 4, hash },
  });
  const code = [
    "import { defineSubgraph, f32, i32, type Node } from '@unworklet/core';",
    "import { bytes } from '@den-kit/assets';",
    'export default defineSubgraph(() => {',
    "  const table = bytes('assets/table.bin');",
    "  return { tick: (i: { in: Node<'f32'> }) => ({ out: i.in.add(f32(table.at(i32(0)))) }) };",
    '});',
  ].join('\n');
  const doc = apply(
    blank(),
    asset('assets/kick.wav', 'audio/wav', kick),
    asset('assets/table.bin', 'application/octet-stream', `sha256-${'2'.repeat(64)}`),
    {
      op: 'addNode',
      node: { id: 'sampler1', type: 'den.samplePlayer', config: { sound: 'assets/kick.wav' } },
    },
    { op: 'addNode', node: { id: 'box1', type: 'kit.codebox' } },
    { op: 'setCode', node: 'box1', code },
  ).doc;
  return apply(doc, { op: 'makePart', ids: ['sampler1', 'box1'], name: 'Kit' }).doc;
}

describe('a bundle: a part and what it needs', () => {
  it("carries the assets its sound reads, as well as its faces'; placed elsewhere, they come with it", () => {
    const doc = kitWork();
    expect(Object.keys(extractBundle(doc, 'kit').assets ?? {})).toEqual([
      'assets/kick.wav',
      'assets/table.bin',
    ]);
    const placed = place(blank(), save(emptyLibrary(), doc, 'kit').library, 'kit').doc;
    expect(placed.files['assets/kick.wav']).toMatchObject({ hash: `sha256-${'1'.repeat(64)}` });
    expect(placed.files['assets/table.bin']).toBeTruthy();
  });

  it("other contents at an asset's path are another version", () => {
    const doc = kitWork();
    const saved = save(emptyLibrary(), doc, 'kit');
    const again = saveToLibrary(
      saved.library,
      withContents(saved.doc, 'assets/kick.wav', KICK2),
      'kit',
      2,
    );
    expect(again.unchanged).toBe(false);
    expect(again.version).toBe(2);
  });

  it('carries the definition, the parts inside it, their nodes and cables; its hash ignores ids and places', () => {
    const doc = nested();
    const b = extractBundle(doc, 'tone');
    expect(b.part.id).toBe('tone');
    expect(Object.keys(b.parts)).toEqual(['inner']);
    expect(Object.keys(b.nodes).sort()).toEqual(
      Object.values(doc.nodes)
        .filter(n => n.inside === 'tone' || n.inside === 'inner')
        .map(n => n.id)
        .sort(),
    );
    expect(Object.values(b.nodes).every(n => n.iface === undefined)).toBe(true);
    expect(Object.values(b.edges).every(e => b.nodes[e.from.node] && b.nodes[e.to.node])).toBe(
      true,
    );
    expect(checkBundle(b, catalog)).toEqual(b);
    // Moving the whole part or renaming its nodes is not a change; turning a knob inside is.
    const moved = clone(b);
    for (const n of Object.values(moved.nodes)) n.pos = { x: n.pos.x + 100, y: n.pos.y + 50 };
    expect(bundleHash(moved)).toBe(bundleHash(b));
    const turned = clone(b);
    Object.values(turned.nodes).find(n => n.type === 'den.oscillator')!.config.waveform = 'sine';
    expect(bundleHash(turned)).not.toBe(bundleHash(b));
  });
  it('a broken bundle is refused with the reason', () => {
    const b = extractBundle(nested(), 'tone');
    const broken = (fn: (x: PartBundle & Record<string, unknown>) => void) => {
      const x = clone(b) as PartBundle & Record<string, unknown>;
      fn(x);
      return checkBundle(x, catalog);
    };
    expect(checkBundle(null, catalog)).toMatch(/\{part, parts, nodes, edges\}/);
    expect(
      broken(x => {
        x.part.id = 'Bad id';
      }),
    ).toMatch(/bad id/);
    expect(
      broken(x => {
        Object.values(x.nodes)[0]!.type = 'den.nope';
      }),
    ).toMatch(/does not know/);
    expect(
      broken(x => {
        Object.values(x.nodes)[0]!.inside = 'elsewhere';
      }),
    ).toMatch(/not inside one of the bundle's parts/);
    expect(
      broken(x => {
        const e = Object.values(x.edges)[0]!;
        e.to.node = 'ghost';
      }),
    ).toMatch(/joins a node the bundle does not carry/);
    expect(
      broken(x => {
        x.nodes.knob9 = {
          id: 'knob9',
          type: 'ui.knob',
          pos: { x: 0, y: 0 },
          config: {},
          values: {},
          inside: 'tone',
        };
      }),
    ).toMatch(/cannot be inside a part/);
    expect(
      broken(x => {
        x.part.inputs[0]!.node = Object.values(x.nodes).find(n => n.type === 'den.oscillator')!.id;
      }),
    ).toMatch(/not one of its Part input nodes/);
    // A part inside itself.
    expect(
      broken(x => {
        const use = Object.values(x.nodes).find(n => n.type === 'kit.part')!;
        x.nodes.loop9 = { ...clone(use), id: 'loop9', inside: 'inner', part: 'inner' };
      }),
    ).toMatch(/used inside itself/);
  });
});

describe('saving, placing and updating', () => {
  it('saving makes a My part (v1) and records it on the part; saving again unchanged makes nothing new; changed, a new version', () => {
    const r = save(emptyLibrary(), toned(), 'tone');
    expect(r.unchanged).toBe(false);
    expect(r.entry).toMatchObject({ id: 'tone', name: 'Tone' });
    expect(r.version).toBe(1);
    expect(r.doc.parts.tone!.from).toEqual({ id: 'tone', version: 1, hash: expect.any(String) });
    const again = save(r.library, r.doc, 'tone', 2);
    expect(again.unchanged).toBe(true);
    expect(again.library).toBe(r.library);
    const changed = apply(again.doc, {
      op: 'setConfig',
      node: 'osc1',
      key: 'waveform',
      value: 'sine',
    }).doc;
    const v2 = save(again.library, changed, 'tone', 3);
    expect(v2.version).toBe(2);
    expect(v2.library.parts.tone!.versions.map(v => v.version)).toEqual([1, 2]);
    expect(v2.doc.parts.tone!.from!.version).toBe(2);
    // A part saved from another patch with the same name gets its own id.
    const other = save(
      v2.library,
      apply(starter('bass', catalog), { op: 'makePart', ids: ['osc1'], name: 'Tone' }).doc,
      'tone',
    );
    expect(other.entry.id).toBe('tone2');
  });
  it('placed in another patch, the part comes in whole (ids made free) and sounds; placing it again adds a use', () => {
    const lib = save(emptyLibrary(), nested(), 'tone').library;
    // The other patch already has a part "tone" and nodes "osc1" / "filter1".
    const busy = toned();
    const r = place(busy, lib, 'tone', { pos: { x: 100, y: 900 } });
    expect(r.created).toHaveLength(1);
    const use = r.doc.nodes[r.created[0]!]!;
    expect(use.part).not.toBe('tone');
    const def = r.doc.parts[use.part!]!;
    expect(def.from).toMatchObject({ id: 'tone', version: 1 });
    expect(def.name).toBe('Tone');
    expect(Object.keys(r.doc.parts).sort()).toEqual(['inner', 'tone', def.id].sort());
    expect(use.pos).toEqual({ x: 100, y: 900 });
    expect(validate(r.doc, catalog).issues.filter(i => i.severity === 'error')).toEqual([]);
    // The placed copy is the saved one, whatever its ids are now.
    expect(bundleHash(extractBundle(r.doc, def.id))).toBe(
      bundleHash(latest(lib.parts.tone!).bundle),
    );
    undoes(busy, r);
    // Into an empty patch it keeps its own ids, and a use wired to Out plays.
    const plain = place(blank(), lib, 'tone');
    expect(Object.keys(plain.doc.parts).sort()).toEqual(['inner', 'tone']);
    const wired = apply(plain.doc, {
      op: 'connect',
      from: { node: plain.created[0]!, port: 'out' },
      to: { node: 'out1', port: 'left' },
    }).doc;
    expect(generate(wired, catalog).source).not.toBe('');
  });
  it("a newer version is offered with what changes; updating keeps each use's values where the knob stays, drops what went, and undoes exactly", () => {
    const first = save(emptyLibrary(), toned(), 'tone');
    // Elsewhere: the part is placed twice, one use with its own resonance.
    let elsewhere = place(blank(), first.library, 'tone').doc;
    const use1 = Object.values(elsewhere.nodes).find(n => n.type === 'kit.part')!.id;
    elsewhere = apply(
      elsewhere,
      {
        op: 'addNode',
        node: { id: 'second1', type: 'kit.part', part: elsewhere.nodes[use1]!.part! },
      },
      { op: 'setValue', node: use1, port: 'resonance', value: 3 },
    ).doc;
    // Back home: v2 adds a parameter (the oscillator's waveform cannot be one; add the filter's drive? use an LFO rate) and drops the cutoff input.
    let home = apply(
      first.doc,
      { op: 'addNode', node: { id: 'lfo9', type: 'den.lfo', inside: 'tone' } },
      { op: 'addParam', part: 'tone', node: 'lfo9', port: 'rate', id: 'rate', label: 'Rate' },
    ).doc;
    const cutoffIn = home.parts.tone!.inputs.find(p => p.id === 'cutoff')!.node;
    home = apply(home, { op: 'removeNode', id: cutoffIn }).doc;
    const v2 = save(first.library, home, 'tone', 5);
    expect(v2.version).toBe(2);
    const defId = elsewhere.nodes[use1]!.part!;
    const before = extractBundle(elsewhere, defId);
    const diff = diffBundles(before, latest(v2.library.parts.tone!).bundle);
    expect(diff.params).toEqual({ added: ['Rate'], removed: [] });
    expect(diff.inputs.removed).toEqual(['cutoff']);
    expect(describeDiff(diff)).toMatch(
      /adds the knob “Rate”; removes the input “cutoff” \(their cables go\)/,
    );
    const v = latest(v2.library.parts.tone!);
    const r = apply(elsewhere, {
      op: 'replacePart',
      part: defId,
      bundle: v.bundle,
      from: { id: 'tone', version: 2, hash: bundleHash(v.bundle) },
    });
    const doc = r.doc;
    expect(doc.parts[defId]!.from!.version).toBe(2);
    expect(doc.nodes[use1]!.values).toMatchObject({ resonance: 3, rate: expect.any(Number) });
    expect(doc.nodes.second1!.values.resonance).toBe(0.707);
    expect(catalog.inputs(doc.nodes[use1]!).some(p => p.id === 'cutoff')).toBe(false);
    expect(bundleHash(extractBundle(doc, defId))).toBe(bundleHash(v.bundle));
    expect(validate(doc, catalog).issues.filter(i => i.severity === 'error')).toEqual([]);
    undoes(elsewhere, r);
  });
  it("updating to other contents at an asset's path replaces the file only the earlier version used, and undoes exactly", () => {
    const home = save(emptyLibrary(), kitWork(), 'kit');
    const placed = place(blank(), home.library, 'kit').doc;
    const defId = Object.values(placed.nodes).find(n => n.type === 'kit.part')!.part!;
    const v2 = save(home.library, withContents(home.doc, 'assets/kick.wav', KICK2), 'kit', 2);
    const v = latest(v2.library.parts.kit!);
    const update: Intent = {
      op: 'replacePart',
      part: defId,
      bundle: v.bundle,
      from: { id: 'kit', version: v.version, hash: bundleHash(v.bundle) },
    };
    const r = apply(placed, update);
    expect(r.doc.files['assets/kick.wav']).toMatchObject({ hash: KICK2 });
    expect(bundleHash(extractBundle(r.doc, defId))).toBe(bundleHash(v.bundle));
    undoes(placed, r);
    // Something else plays the earlier file too, and would change with it: the update is refused.
    const shared = apply(placed, {
      op: 'addNode',
      node: { id: 'sampler9', type: 'den.samplePlayer', config: { sound: 'assets/kick.wav' } },
    }).doc;
    const refused = failure(() => apply(shared, update));
    expect(refused.code).toBe('duplicate-id');
    expect(refused.message).toMatch(/sampler9's sound/);
    // A file at that path the earlier version does not use is the work's own: it stays.
    const own = apply(
      placed,
      { op: 'updateAsset', id: 'assets/kick.wav', set: { name: 'kick-old.wav' } },
      {
        op: 'addAsset',
        asset: {
          id: 'assets/kick.wav',
          name: 'kick.wav',
          mime: 'audio/wav',
          bytes: 4,
          hash: KICK3,
        },
      },
    ).doc;
    expect(failure(() => apply(own, update)).code).toBe('duplicate-id');
  });

  it('placing or updating a part refuses what would take the work over its limits', () => {
    const home = save(emptyLibrary(), kitWork(), 'kit');
    /** `doc` with four files of 100 MB and one that brings its files to `total` bytes. */
    const filled = (doc: PatchDocument, total: number) =>
      apply(
        doc,
        ...['a', 'b', 'c', 'd', 'e'].map((c, i): Intent => ({
          op: 'addAsset',
          asset: {
            id: `assets/big-${c}.bin`,
            name: `big-${c}.bin`,
            mime: 'application/octet-stream',
            bytes:
              i < 4
                ? WORK_LIMITS.fileBytes
                : total - totalBytes(doc.files) - 4 * WORK_LIMITS.fileBytes,
            hash: `sha256-${c.repeat(64)}`,
          },
        })),
      ).doc;
    // The part's two assets (8 bytes) would take a work one byte over, and one file over.
    expect(
      failure(() => place(filled(blank(), WORK_LIMITS.workBytes - 7), home.library, 'kit')).code,
    ).toBe('too-large');
    const many = apply(blank(), {
      op: 'setProjectFiles',
      files: Object.fromEntries(
        Array.from({ length: WORK_LIMITS.files - 1 }, (_, i) => [`src/f${i}.ts`, 'x']),
      ),
    }).doc;
    expect(failure(() => place(many, home.library, 'kit')).code).toBe('too-large');
    // A newer version whose file is a byte larger than the one it replaces, in a full work.
    const placed = place(blank(), home.library, 'kit').doc;
    const defId = Object.values(placed.nodes).find(n => n.type === 'kit.part')!.part!;
    const v2 = save(home.library, withContents(home.doc, 'assets/kick.wav', KICK2, 5), 'kit', 2);
    expect(
      failure(() =>
        apply(filled(placed, WORK_LIMITS.workBytes), {
          op: 'replacePart',
          part: defId,
          bundle: latest(v2.library.parts.kit!).bundle,
        }),
      ).code,
    ).toBe('too-large');
  });
  it('placing or updating refuses a broken bundle and leaves the patch as it was', () => {
    const lib = save(emptyLibrary(), toned(), 'tone').library;
    const bundle = clone(latest(lib.parts.tone!).bundle);
    Object.values(bundle.nodes)[0]!.type = 'den.nope';
    expect(failure(() => apply(blank(), { op: 'importPart', bundle })).code).toBe('bad-bundle');
    expect(failure(() => apply(toned(), { op: 'replacePart', part: 'tone', bundle })).code).toBe(
      'bad-bundle',
    );
    expect(
      failure(() =>
        apply(toned(), { op: 'replacePart', part: 'nope', bundle: latest(lib.parts.tone!).bundle }),
      ).code,
    ).toBe('unknown-part');
    expect(
      failure(() =>
        apply(blank(), {
          op: 'importPart',
          bundle: latest(lib.parts.tone!).bundle,
          inside: 'nope',
        }),
      ).code,
    ).toBe('unknown-part');
    expect(
      failure(() =>
        apply(blank(), { op: 'importPart', bundle: latest(lib.parts.tone!).bundle, node: 'out1' }),
      ).code,
    ).toBe('duplicate-id');
    expect(
      failure(() =>
        apply(toned(), { op: 'updatePart', part: 'tone', from: { id: '', version: 0 } }),
      ).code,
    ).toBe('bad-value');
  });
  it('ids can be pinned (the AI lands what it tried); a pinned id that is taken is refused', () => {
    const lib = save(emptyLibrary(), toned(), 'tone').library;
    const bundle = latest(lib.parts.tone!).bundle;
    const r = apply(blank(), {
      op: 'importPart',
      bundle,
      ids: { parts: { tone: 'myTone' }, nodes: { osc1: 'oscA' } },
      node: 'tone9',
    });
    expect(r.doc.parts.myTone).toBeDefined();
    expect(r.doc.nodes.oscA!.inside).toBe('myTone');
    expect(r.created).toEqual(['tone9']);
    expect(
      failure(() => apply(blank(), { op: 'importPart', bundle, ids: { nodes: { osc1: 'out1' } } }))
        .code,
    ).toBe('duplicate-id');
  });
  it('a saved part survives the patch file round trip with where it came from', () => {
    const r = save(emptyLibrary(), toned(), 'tone');
    const back = parseDocument(serializeDocument(r.doc), catalog);
    if (!back.ok) throw new Error(back.error);
    expect(back.doc.parts.tone!.from).toEqual(r.doc.parts.tone!.from);
    expect(documentHash(back.doc)).toBe(documentHash(r.doc));
  });
});

describe('My parts files', () => {
  it('carry every content their parts use, two at the same path from different works included', () => {
    const one = save(emptyLibrary(), kitWork(`sha256-${'4'.repeat(64)}`), 'kit').library;
    const both = save(one, kitWork(`sha256-${'5'.repeat(64)}`), 'kit').library;
    const kicks = libraryAssets(both).filter(a => a.id === 'assets/kick.wav');
    expect(kicks.map(a => a.hash).sort()).toEqual([
      `sha256-${'4'.repeat(64)}`,
      `sha256-${'5'.repeat(64)}`,
    ]);
    const text = serializeLibrary(both, undefined, {
      assetData: {
        [`sha256-${'4'.repeat(64)}`]: 'data:audio/wav;base64,AAAA',
        [`sha256-${'5'.repeat(64)}`]: 'data:audio/wav;base64,BBBB',
      },
    });
    const read = parseLibrary(text, catalog);
    if (!read.ok) throw new Error(read.error);
    expect(read.assetData).toMatchObject({
      [`sha256-${'4'.repeat(64)}`]: 'data:audio/wav;base64,AAAA',
      [`sha256-${'5'.repeat(64)}`]: 'data:audio/wav;base64,BBBB',
    });
  });

  it('round trip; versions are kept up to the limit, oldest first out', () => {
    let lib = emptyLibrary(),
      doc = toned();
    for (let i = 0; i < KEEP_VERSIONS + 3; i++) {
      doc = apply(
        doc,
        { op: 'setValue', node: 'tone1', port: 'resonance', value: 1 + i * 0.1 },
        { op: 'setConfig', node: 'osc1', key: 'waveform', value: i % 2 ? 'saw' : 'sine' },
      ).doc;
      doc = apply(doc, {
        op: 'setValue',
        node: 'filter1',
        port: 'resonance',
        value: 0.6 + i * 0.1,
      }).doc;
      const r = save(lib, doc, 'tone', i);
      lib = r.library;
      doc = r.doc;
    }
    expect(lib.parts.tone!.versions).toHaveLength(KEEP_VERSIONS);
    expect(latest(lib.parts.tone!).version).toBe(KEEP_VERSIONS + 3);
    const text = serializeLibrary(lib);
    expect(JSON.parse(text).schema).toBe(LIBRARY_SCHEMA);
    const back = parseLibrary(text, catalog);
    if (!back.ok) throw new Error(back.error);
    expect(back.report).toEqual([]);
    expect(back.library).toEqual(lib);
  });
  it('broken files are refused; broken parts and versions are dropped with a reason', () => {
    expect(parseLibrary('{', catalog)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Not valid JSON/),
    });
    expect(parseLibrary({ schema: 'something-else' }, catalog)).toMatchObject({ ok: false });
    expect(parseLibrary({ schema: LIBRARY_SCHEMA, version: 99, parts: {} }, catalog)).toMatchObject(
      { ok: false, error: expect.stringMatching(/version 99/) },
    );
    const lib = save(emptyLibrary(), toned(), 'tone').library;
    const raw = JSON.parse(serializeLibrary(lib));
    raw.parts.tone.versions.push({ version: 2, savedAt: 2, bundle: { part: { id: 'tone' } } });
    raw.parts.tone.versions.push({
      version: 1,
      savedAt: 3,
      bundle: raw.parts.tone.versions[0].bundle,
    });
    raw.parts['Bad id'] = { versions: [] };
    raw.parts.empty = { name: 'Empty', versions: [{ version: 1, bundle: null }] };
    const read = parseLibrary(raw, catalog);
    if (!read.ok) throw new Error(read.error);
    expect(Object.keys(read.library.parts)).toEqual(['tone']);
    expect(read.library.parts.tone!.versions.map(v => v.version)).toEqual([1]);
    expect(read.report.map(i => i.code).sort()).toEqual([
      'dropped-my-part',
      'dropped-my-part',
      'dropped-version',
      'dropped-version',
      'dropped-version',
    ]);
  });
  it('merging a file adds new parts and new versions after the ones here, never the same content twice; removing takes a part out', () => {
    const a = save(emptyLibrary(), toned(), 'tone');
    const changed = apply(a.doc, {
      op: 'setConfig',
      node: 'osc1',
      key: 'waveform',
      value: 'sine',
    }).doc;
    const b = save(a.library, changed, 'tone', 2);
    const otherDoc = apply(starter('pad', catalog), {
      op: 'makePart',
      ids: ['lfo1', 'pdepth1'],
      name: 'Wobble',
    }).doc;
    const incoming = save(
      save(emptyLibrary(), changed, 'tone', 9).library,
      otherDoc,
      'wobble',
      10,
    ).library;
    const merged = mergeLibrary(a.library, incoming);
    expect(merged.added).toEqual(['wobble']);
    expect(merged.updated).toEqual(['tone']);
    expect(merged.library.parts.tone!.versions.map(v => v.version)).toEqual([1, 2]);
    expect(bundleHash(latest(merged.library.parts.tone!).bundle)).toBe(
      bundleHash(latest(b.library.parts.tone!).bundle),
    );
    expect(mergeLibrary(merged.library, incoming)).toMatchObject({ added: [], updated: [] });
    expect(Object.keys(removeFromLibrary(merged.library, 'wobble').parts)).toEqual(['tone']);
    expect(removeFromLibrary(merged.library, 'nope')).toBe(merged.library);
  });
});

// The passing-on prototype (prototype/remix): a passage survives its link, its
// versions are rebuilt from den-kit's operations, what changed reads in words, and
// shaking keeps every control within its range.
import { describe, expect, it } from 'vite-plus/test';
import { catalog } from '../../../src/sound/blocks/index.ts';
import { applyIntents } from '../../../src/work/ops.ts';
import { findWork } from '../../../src/screen/showcase/index.ts';
import {
  buildVersions,
  creditLine,
  decodePassage,
  describeChanges,
  encodePassage,
  passageText,
  phraseText,
  readPassage,
  valueOps,
  applyChanges,
} from '../../../prototype/remix/passage.ts';
import { examplePassage } from '../../../prototype/remix/example.ts';
import { controlsOf, seeded, shake } from '../../../prototype/remix/shake.ts';

const NOW = Date.UTC(2026, 10, 23);

describe('a passage in a link', () => {
  it('comes back from its link text as it was', async () => {
    const passage = examplePassage(catalog, NOW);
    const text = await encodePassage(passage);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(passageText(`#p=${text}`)).toBe(text);
    const read = await decodePassage(text);
    expect(read).toEqual({ ok: true, value: passage });
  });

  it('refuses damaged text and passages of another shape', async () => {
    const text = await encodePassage(examplePassage(catalog, NOW));
    expect((await decodePassage(text.slice(0, text.length / 2))).ok).toBe(false);
    expect(readPassage({ v: 2 }).ok).toBe(false);
    expect(readPassage({ ...examplePassage(catalog, NOW), work: 'nope' }).ok).toBe(false);
    const passage = examplePassage(catalog, NOW);
    expect(
      readPassage({ ...passage, hops: [{ ...passage.hops[1]!, phrase: [[0, 200, 100]] }] }).ok,
    ).toBe(false);
  });
});

describe('versions', () => {
  it('are rebuilt hop by hop from the operations', () => {
    const passage = examplePassage(catalog, NOW);
    const read = buildVersions(passage, catalog);
    if (!read.ok) throw new Error(read.error);
    const versions = read.value;
    expect(versions.map(v => v.by)).toEqual(['Owl', 'Mika', 'Juniper', 'Pico']);
    expect(versions[0]!.doc.nodes.kcut!.values.value).toBe(340);
    expect(versions[1]!.doc.nodes.kcut!.values.value).toBe(820);
    expect(versions[2]!.doc.nodes.kdec!.values.value).toBe(0.42);
    expect(versions[3]!.doc.nodes.echo1?.type).toBe('den.pingPongDelay');
    expect(
      Object.values(versions[3]!.doc.edges).some(
        e => e.from.node === 'echo1' && e.to.node === 'out1' && e.to.port === 'left',
      ),
    ).toBe(true);
  });

  it('refuse operations that do not fit the version they land on', () => {
    const passage = examplePassage(catalog, NOW);
    // Pico's cables without the echo they connect.
    const pico = passage.hops[2]!;
    const broken = { ...pico, ops: pico.ops.filter(op => op.op !== 'addNode') };
    const read = buildVersions(
      { ...passage, hops: [passage.hops[0]!, passage.hops[1]!, broken] },
      catalog,
    );
    expect(read.ok).toBe(false);
  });

  it('carry settings moved on the page as setValue operations', () => {
    const base = findWork('acid')!.build(catalog);
    const moved = applyIntents(
      base,
      [{ op: 'setValue', node: 'kres', port: 'value', value: 0.5 }],
      catalog,
    ).doc;
    const ops = valueOps(base, moved);
    expect(ops).toEqual([{ op: 'setValue', node: 'kres', port: 'value', from: 0.72, to: 0.5 }]);
    expect(applyChanges(base, ops, catalog).nodes.kres!.values.value).toBe(0.5);
  });
});

describe('what changed, in words', () => {
  it('names each control from its first value to its last, then what changed inside', () => {
    const passage = examplePassage(catalog, NOW);
    const read = buildVersions(passage, catalog);
    if (!read.ok) throw new Error(read.error);
    const [v0, v1, v2] = read.value;
    expect(describeChanges(v0!.doc, passage.hops[0]!.ops, catalog)).toEqual([
      { kind: 'setting', text: 'CUTOFF 340 Hz → 820 Hz' },
      { kind: 'setting', text: 'RESONANCE 0.720 → 0.860' },
    ]);
    expect(describeChanges(v2!.doc, passage.hops[2]!.ops, catalog)).toEqual([
      { kind: 'inside', text: 'Added Echo' },
      { kind: 'inside', text: 'Rewired 5 cables' },
    ]);
    // Moved there and back: nothing to tell.
    const there = applyIntents(
      v1!.doc,
      [{ op: 'setValue', node: 'kdrive', port: 'value', value: 4 }],
      catalog,
    );
    const back = applyIntents(
      there.doc,
      [{ op: 'setValue', node: 'kdrive', port: 'value', value: 2.2 }],
      catalog,
    );
    expect(describeChanges(v1!.doc, [...there.ops, ...back.ops], catalog)).toEqual([]);
  });

  it('credits everyone before the next person, and reads a phrase', () => {
    const passage = examplePassage(catalog, NOW);
    expect(creditLine(passage, 'Acid Line')).toBe(
      'Acid Line by Owl, passed on by Mika → Juniper → Pico',
    );
    expect(phraseText(passage.hops[1]!.phrase!)).toBe('12 notes, 1.9 s');
  });
});

describe('shaking', () => {
  it('moves every continuous control a little, within its range, the same way for the same seed', () => {
    const doc = findWork('acid')!.build(catalog);
    const controls = controlsOf(doc, catalog);
    expect(controls.map(c => c.node)).toEqual(['kcut', 'kdec', 'kdrive', 'kenv', 'kglide', 'kres']);
    const a = shake(doc, catalog, { random: seeded(7) });
    expect(shake(doc, catalog, { random: seeded(7) })).toEqual(a);
    expect(a.length).toBeGreaterThan(3);
    const after = applyIntents(doc, a, catalog).doc;
    for (const c of controls) {
      const v = after.nodes[c.node]!.values[c.port] as number;
      expect(v).toBeGreaterThanOrEqual(c.min);
      expect(v).toBeLessThanOrEqual(c.max);
    }
    // A log knob moves by a ratio: cutoff stays within 15% of its log range.
    const cut = after.nodes.kcut!.values.value as number;
    const span = Math.log(4000 / 40);
    expect(Math.abs(Math.log(cut / 340)) / span).toBeLessThanOrEqual(0.15 + 1e-9);
  });
});

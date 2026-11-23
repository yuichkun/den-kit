// A work's icon and cover (src/work/art.ts): boards of layers drawn from the work,
// started from the work itself and changed with the same typed ops as the rest of
// the work, by the person and by the AI, with undo and with what someone else
// changed later kept.
import { describe, expect, it } from 'vite-plus/test';
import { catalog } from '../../../src/sound/blocks/index.ts';
import { WORKS } from '../../../src/screen/showcase/index.ts';
import {
  ART_BOARDS,
  RECIPES,
  checkArtBoard,
  fallbackArt,
  groundOf,
  patchSigns,
  startArt,
  telling,
} from '../../../src/work/art.ts';
import { History, commit, type Author } from '../../../src/work/history.ts';
import {
  OpError,
  applyIntents,
  applyResolvedOps,
  invertAll,
  replaceOps,
} from '../../../src/work/ops.ts';
import { documentHash, parseDocument, serializeDocument } from '../../../src/work/persistence.ts';
import type { PatchDocument } from '../../../src/work/schema.ts';
import { starter } from '../../../src/work/starters.ts';
import { COLOR_TOKENS, assetsOf } from '../../../src/work/ui.ts';

const AI: Author = { kind: 'ai-llm', take: 'take1' };
const work = (id: string) => WORKS.find(w => w.id === id)!.build(catalog);

describe('starting points', () => {
  it('every starting point of every showcase work is a board that passes the checks as it is', () => {
    for (const w of WORKS) {
      const doc = w.build(catalog);
      const ctx = { assets: assetsOf(doc.files), nodes: {} };
      for (const board of ART_BOARDS)
        for (const layers of [
          ...RECIPES.map(r => startArt(doc, catalog, r, board)),
          fallbackArt(doc, board),
        ])
          expect(checkArtBoard({ layers }, ctx).layers, `${w.id} ${board}`).toEqual(layers);
    }
  });

  it('starting a board is one step, and undoing it leaves the work without art', () => {
    const doc = work('musicbox');
    const r = applyIntents(
      doc,
      [{ op: 'setArt', board: 'icon', layers: startArt(doc, catalog, 'specimen', 'icon') }],
      catalog,
    );
    expect(r.ops).toHaveLength(1);
    expect(r.doc.art?.icon?.layers.map(l => l.kind)).toEqual(['ground', 'window']);
    expect(applyResolvedOps(r.doc, invertAll(r.ops)).art).toBeUndefined();
  });

  it("the telling piece is one of the plugin's controls or pictures, not a backdrop", () => {
    for (const w of WORKS) {
      const doc = w.build(catalog);
      const piece = telling(doc, catalog);
      expect(piece.w * piece.h, w.id).toBeLessThanOrEqual(doc.panel.width * doc.panel.height * 0.5);
    }
  });

  it('the pattern reads the patch left to right, each copy once, without arithmetic or controls', () => {
    const doc = starter('bass', catalog);
    const signs = patchSigns(doc, catalog);
    expect(signs.length).toBeGreaterThan(2);
    expect(signs.some(s => ['math', 'ui', 'io'].includes(s.category))).toBe(false);
    const more = applyIntents(doc, [{ op: 'setCount', node: 'osc1', count: 3 }], catalog).doc;
    expect(patchSigns(more, catalog).filter(s => s.sign === 'wave').length).toBe(
      signs.filter(s => s.sign === 'wave').length + 2,
    );
  });

  it("another work's ground comes with that work's colours, not this one's tokens", () => {
    for (const id of ['acid', 'space', 'musicbox']) {
      const fills = groundOf(work(id));
      const colours = fills.flatMap(f =>
        f.kind === 'color' ? [f.color] : f.kind === 'image' ? [] : f.stops.map(s => s.color),
      );
      expect(
        colours.some(c => (COLOR_TOKENS as readonly string[]).includes(c)),
        id,
      ).toBe(false);
    }
  });
});

/** A bass with an icon and a cover the person made, and its history. */
function made() {
  const history = new History();
  const base = starter('bass', catalog);
  const r = commit(
    history,
    base,
    [
      { op: 'setArt', board: 'icon', layers: startArt(base, catalog, 'specimen', 'icon') },
      { op: 'setArt', board: 'cover', layers: startArt(base, catalog, 'pattern', 'cover') },
    ],
    catalog,
  );
  if (!r.ok) throw r.error;
  return { history, doc: r.doc };
}
function ok(r: ReturnType<typeof commit>): PatchDocument {
  if (!r.ok) throw r.error;
  return r.doc;
}

describe('the person and the AI on the same art', () => {
  it("the AI's edit of the cover lands while the person keeps working on the icon", () => {
    const { history, doc } = made();
    const seen = doc.revision;
    const after = ok(
      commit(
        history,
        doc,
        [{ op: 'updateArtLayer', board: 'icon', id: 'window1', set: { zoom: 3 } }],
        catalog,
      ),
    );
    const ai = ok(
      commit(
        history,
        after,
        [{ op: 'updateArtLayer', board: 'cover', id: 'mark1', set: { text: 'From the AI' } }],
        catalog,
        { author: AI, seen },
      ),
    );
    expect(ai.art?.cover?.layers.find(l => l.id === 'mark1')).toMatchObject({
      text: 'From the AI',
    });
    expect(ai.art?.icon?.layers.find(l => l.id === 'window1')).toMatchObject({ zoom: 3 });
  });

  it('an AI edit of a layer the person changed after the AI read it is refused, and says which', () => {
    const { history, doc } = made();
    const seen = doc.revision;
    const after = ok(
      commit(
        history,
        doc,
        [{ op: 'updateArtLayer', board: 'cover', id: 'mark1', set: { text: 'Mine' } }],
        catalog,
      ),
    );
    const r = commit(
      history,
      after,
      [
        { op: 'updateArtLayer', board: 'cover', id: 'mark1', set: { text: 'Theirs' } },
        { op: 'updateArtLayer', board: 'cover', id: 'pattern1', set: { scale: 2 } },
      ],
      catalog,
      { author: AI, seen },
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.code).toBe('conflict');
    expect(!r.ok && r.error.message).toMatch(
      /the work's cover \(mark1\) was changed by the person/,
    );
    // Replacing the whole cover touches the person's layer too.
    const whole = commit(
      history,
      after,
      [{ op: 'setArt', board: 'cover', layers: [{ id: 'ground1', kind: 'ground' }] }],
      catalog,
      { author: AI, seen },
    );
    expect(whole.ok).toBe(false);
  });

  it("undoing the AI's step takes back its edits and keeps what the person changed after it", () => {
    const { history, doc } = made();
    const ai = ok(
      commit(
        history,
        doc,
        [
          { op: 'updateArtLayer', board: 'cover', id: 'mark1', set: { text: 'From the AI' } },
          { op: 'updateArtLayer', board: 'cover', id: 'pattern1', set: { scale: 2 } },
        ],
        catalog,
        { author: AI, seen: doc.revision, group: 'request1' },
      ),
    );
    const person = ok(
      commit(
        history,
        ai,
        [{ op: 'updateArtLayer', board: 'cover', id: 'pattern1', set: { repeat: 'radial' } }],
        catalog,
      ),
    );
    // The person's step is on top: take the AI's step back from under it, as ⌘Z on its line does.
    const entries = history.entries();
    expect(entries.at(-1)!.author.kind).toBe('human');
    const undoneOnce = history.undo(person);
    expect(undoneOnce && 'doc' in undoneOnce).toBe(true);
    const again = history.undo((undoneOnce as { doc: PatchDocument }).doc);
    const back = (again as { doc: PatchDocument; kept: unknown[] }).doc;
    const cover = back.art!.cover!.layers;
    expect(cover.find(l => l.id === 'mark1')).toMatchObject({ text: doc.name });
    expect(cover.find(l => l.id === 'pattern1')).toMatchObject({ scale: 1.4 });
  });

  it('a drag is one step: its moves merge into the first place and the last', () => {
    const { history, doc } = made();
    let now = doc;
    for (const x of [10, 20, 30])
      now = ok(
        commit(
          history,
          now,
          [
            {
              op: 'updateArtLayer',
              board: 'cover',
              id: 'mark1',
              set: { rect: { x, y: 330, w: 1600, h: 240 } },
            },
          ],
          catalog,
          { gesture: 'drag1' },
        ),
      );
    const top = history.entries().at(-1)!;
    expect(top.ops).toHaveLength(1);
    const back = history.undo(now) as { doc: PatchDocument };
    expect(back.doc.art?.cover?.layers.find(l => l.id === 'mark1')).toMatchObject({
      rect: { x: 0, y: 330, w: 1600, h: 240 },
    });
  });
});

describe('what the art holds', () => {
  it('is saved with the work and read back as it was', () => {
    const { doc } = made();
    const parsed = parseDocument(serializeDocument(doc), catalog);
    expect(parsed.ok).toBe(true);
    const back = (parsed as { doc: PatchDocument }).doc;
    expect(back.art).toEqual(doc.art);
    expect(documentHash(back)).toBe(documentHash(doc));
  });

  it('a layer that cannot be read is dropped and reported; the rest of the board stays', () => {
    const { doc } = made();
    const data = JSON.parse(serializeDocument(doc));
    data.art.icon.layers.push({ id: 'sticker1', kind: 'sticker' });
    data.art.cover.layers[1].moment = undefined;
    data.art.icon.layers[1].moment = { gone1: 0.5 };
    const parsed = parseDocument(data, catalog);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.doc.art?.icon?.layers.map(l => l.id)).toEqual(['ground1', 'window1']);
    expect(parsed.doc.art?.icon?.layers[1]).not.toHaveProperty('moment');
    expect(parsed.report.some(i => /sticker/.test(i.message))).toBe(true);
    expect(parsed.report.some(i => /gone1/.test(i.message))).toBe(true);
  });

  it('a picture the art uses cannot be removed', () => {
    const doc = work('musicbox');
    const picture = Object.values(assetsOf(doc.files)).find(a => a.mime.startsWith('image/'))!;
    const withArt = applyIntents(
      doc,
      [
        {
          op: 'setArt',
          board: 'icon',
          layers: [
            {
              id: 'ground1',
              kind: 'ground',
              fill: [{ kind: 'image', asset: picture.id, fit: 'cover' }],
            },
          ],
        },
      ],
      catalog,
    ).doc;
    expect(() => applyIntents(withArt, [{ op: 'removeAsset', id: picture.id }], catalog)).toThrow(
      /the icon's ground1/,
    );
  });

  it('loading another work replaces the art as one step that undoes', () => {
    const { doc } = made();
    const next = work('acid');
    const ops = replaceOps(doc, next);
    const loaded = applyResolvedOps(doc, ops);
    expect(loaded.art).toBeUndefined();
    expect(applyResolvedOps(loaded, invertAll(ops)).art).toEqual(doc.art);
  });

  it('refuses what is not a layer, with a hint', () => {
    const { doc } = made();
    const tries: unknown[] = [
      {
        op: 'addArtLayer',
        board: 'icon',
        layer: { kind: 'window', rect: { x: 0, y: 0, w: 0, h: 9 }, focus: { x: 0, y: 0 }, zoom: 1 },
      },
      { op: 'updateArtLayer', board: 'icon', id: 'window1', set: { zoom: 'close' } },
      { op: 'updateArtLayer', board: 'cover', id: 'nope', set: { hidden: true } },
      {
        op: 'addArtLayer',
        board: 'cover',
        layer: { kind: 'mark', id: 'mark1', rect: { x: 0, y: 0, w: 9, h: 9 }, text: 'x' },
      },
      {
        op: 'setArt',
        board: 'icon',
        layers: Array.from({ length: 9 }, (_, i) => ({ id: `ground${i + 1}`, kind: 'ground' })),
      },
    ];
    for (const intent of tries)
      expect(() => applyIntents(doc, [intent as never], catalog), JSON.stringify(intent)).toThrow(
        OpError,
      );
  });
});

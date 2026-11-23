// The work's icon and cover: made and changed by the same operations as the plugin's
// decorations (with `on`), undone exactly, saved and read back, and guarded like the rest of
// the work: an AI's change to something the person changed after the AI read the work fails.
import { describe, expect, it } from 'vite-plus/test';
import { catalog } from '../../../src/sound/blocks/index.ts';
import { describeKey, keysOf } from '../../../src/work/changes.ts';
import { History, commit, type Author } from '../../../src/work/history.ts';
import {
  applyIntents,
  applyResolvedOps,
  invertAll,
  OpError,
  type Intent,
} from '../../../src/work/ops.ts';
import { documentHash, parseDocument, serializeDocument } from '../../../src/work/persistence.ts';
import { emptyDocument, type PatchDocument } from '../../../src/work/schema.ts';
import { usesOfAsset } from '../../../src/work/asset-uses.ts';
import { artStack, type SymbolElement } from '../../../src/work/art.ts';

const HASH = `sha256-${'a'.repeat(64)}`;
const PERSON: Author = { kind: 'human' };
const AI: Author = { kind: 'ai-llm', take: 'rq1', trace: 'rq1' };
const apply = (doc: PatchDocument, intents: Intent[]) => applyIntents(doc, intents, catalog);

function base(): PatchDocument {
  return apply(emptyDocument('Night Bass', 'w1'), [
    { op: 'addNode', node: { id: 'env1', type: 'den.envelope' } },
    { op: 'addNode', node: { id: 'filter1', type: 'den.filter' } },
    { op: 'addNode', node: { id: 'out1', type: 'kit.out' } },
    {
      op: 'addAsset',
      asset: { id: 'assets/shot.png', name: 'shot.png', mime: 'image/png', bytes: 10, hash: HASH },
    },
    {
      op: 'addElement',
      element: { id: 'title1', kind: 'text', text: 'Plugin', rect: { x: 0, y: 0, w: 90, h: 20 } },
    },
  ]).doc;
}
/** A cover with a picture and a title, and an icon with a symbol of the envelope. */
const art: Intent[] = [
  {
    op: 'addElement',
    on: 'cover',
    element: {
      kind: 'image',
      asset: 'assets/shot.png',
      fit: 'cover',
      rect: { x: 0, y: 0, w: 1280, h: 720 },
    },
  },
  {
    op: 'addElement',
    on: 'cover',
    element: {
      id: 'title',
      kind: 'text',
      text: 'NIGHT BASS',
      textStyle: { font: 'font', size: 96, color: 'fg' },
      rect: { x: 80, y: 520, w: 900, h: 120 },
    },
  },
  {
    op: 'addElement',
    on: 'icon',
    element: { kind: 'symbol', node: 'env1', rect: { x: 56, y: 56, w: 400, h: 400 } },
  },
];

describe('the icon and cover are made with the same operations as the plugin', () => {
  it('an element with `on` lands on that surface only, and undoes exactly', () => {
    const doc = base();
    const r = apply(doc, art);
    expect(Object.keys(r.doc.art!.cover!.elements)).toEqual(['picture1', 'title']);
    expect(r.doc.art!.cover!.order).toEqual(['picture1', 'title']);
    expect(Object.keys(r.doc.art!.icon!.elements)).toEqual(['symbol1']);
    expect(r.doc.ui).toEqual(doc.ui);
    expect(r.created).toEqual(['picture1', 'title', 'symbol1']);
    expect({ ...applyResolvedOps(r.doc, invertAll(r.ops)), revision: 0 }).toEqual({
      ...doc,
      revision: 0,
    });
  });

  it('ids are per surface: the cover and the plugin can both have a title', () => {
    const doc = apply(base(), art).doc;
    const r = apply(doc, [
      {
        op: 'addElement',
        on: 'icon',
        element: { id: 'title', kind: 'text', text: 'N', rect: { x: 0, y: 0, w: 10, h: 10 } },
      },
    ]);
    expect(r.doc.art!.icon!.elements.title).toBeTruthy();
    expect(() =>
      apply(doc, [
        {
          op: 'addElement',
          on: 'cover',
          element: { id: 'title', kind: 'shape', rect: { x: 0, y: 0, w: 10, h: 10 } },
        },
      ]),
    ).toThrow(/already taken on the cover/);
  });

  it('updateElement, setRect, arrange and removeElement work on the art', () => {
    const doc = apply(base(), art).doc;
    const r = apply(doc, [
      { op: 'updateElement', on: 'cover', id: 'title', set: { text: 'NIGHT' } },
      { op: 'setRect', on: 'cover', id: 'title', rect: { x: 120, y: 500, w: 900, h: 120 } },
      { op: 'arrange', on: 'cover', ids: ['title'], to: 'back' },
      { op: 'removeElement', on: 'cover', id: 'picture1' },
    ]);
    const cover = r.doc.art!.cover!;
    expect(cover.elements.title).toMatchObject({ text: 'NIGHT', rect: { x: 120, y: 500 } });
    expect(cover.order).toEqual(['title']);
    expect(artStack(cover).map(e => e.id)).toEqual(['title']);
    expect(r.doc.art!.icon).toEqual(doc.art!.icon);
  });

  it('a background of its own, and clearArt takes a surface away', () => {
    const doc = apply(base(), art).doc;
    const r = apply(doc, [
      { op: 'setArt', on: 'icon', set: { background: [{ kind: 'color', color: 'accent' }] } },
      { op: 'clearArt', on: 'cover' },
    ]);
    expect(r.doc.art!.icon!.background).toEqual([{ kind: 'color', color: 'accent' }]);
    expect(r.doc.art!.cover).toBeUndefined();
  });

  it('refuses what the art cannot hold, and leaves the work as it was', () => {
    const doc = apply(base(), art).doc;
    const before = structuredClone(doc);
    const refused = (intents: Intent[], message: RegExp) => {
      let error: unknown;
      try {
        apply(doc, intents);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(OpError);
      expect((error as OpError).message).toMatch(message);
    };
    refused(
      [
        {
          op: 'addElement',
          on: 'icon',
          element: { kind: 'led', bind: 'knob1', rect: { x: 0, y: 0, w: 9, h: 9 } },
        },
      ],
      /text, shapes, pictures, SVG and symbols/,
    );
    refused(
      [{ op: 'updateElement', on: 'cover', id: 'title', set: { bind: 'knob1' } }],
      /has no "bind"/,
    );
    refused(
      [
        {
          op: 'addElement',
          on: 'icon',
          element: { kind: 'symbol', node: 'out9', rect: { x: 0, y: 0, w: 9, h: 9 } },
        },
      ],
      /No module "out9"/,
    );
    refused(
      [{ op: 'updateElement', on: 'poster' as 'icon', id: 'x', set: {} }],
      /"icon" or "cover"/,
    );
    expect(doc).toEqual(before);
  });
});

describe('a symbol draws a module as it was when it was drawn', () => {
  it('keeps its shape when the knob moves, and draws it anew when its module is named again', () => {
    const doc = apply(base(), [
      ...art,
      { op: 'setValue', node: 'env1', port: 'attack', value: 0.5 },
    ]).doc;
    const symbol = () => doc.art!.icon!.elements.symbol1 as SymbolElement;
    expect(symbol().module.type).toBe('den.envelope');
    expect(symbol().module.values.attack).not.toBe(0.5);
    const redrawn = apply(doc, [
      { op: 'updateElement', on: 'icon', id: 'symbol1', set: { node: 'env1' } },
    ]);
    expect((redrawn.doc.art!.icon!.elements.symbol1 as SymbolElement).module.values.attack).toBe(
      0.5,
    );
    expect(redrawn.ops.map(o => (o.op === 'setArtElement' ? o.field : o.op))).toEqual(['module']);
  });

  it('a module with no shape cannot be drawn', () => {
    expect(() =>
      apply(base(), [
        { op: 'addNode', node: { id: 'gain1', type: 'kit.gain' } },
        {
          op: 'addElement',
          on: 'icon',
          element: { kind: 'symbol', node: 'gain1', rect: { x: 0, y: 0, w: 9, h: 9 } },
        },
      ]),
    ).toThrow(/no shape to draw/);
  });
});

describe('the art and the work’s assets', () => {
  it('an asset the art shows cannot be removed, and renaming it follows into the art', () => {
    const doc = apply(base(), art).doc;
    expect(usesOfAsset(doc, 'assets/shot.png')).toEqual(['picture1 on the cover']);
    expect(() => apply(doc, [{ op: 'removeAsset', id: 'assets/shot.png' }])).toThrow(/used by/);
    const renamed = apply(doc, [
      { op: 'updateAsset', id: 'assets/shot.png', set: { name: 'cover.png' } },
    ]).doc;
    expect(renamed.art!.cover!.elements.picture1).toMatchObject({ asset: 'assets/cover.png' });
  });
});

describe('the art is saved with the work', () => {
  it('reads back exactly', () => {
    const doc = apply(base(), [
      ...art,
      { op: 'setArt', on: 'cover', set: { background: [{ kind: 'color', color: 'bg' }] } },
    ]).doc;
    const back = parseDocument(serializeDocument(doc), catalog);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.report).toEqual([]);
    expect(back.doc.art).toEqual(doc.art);
    expect(documentHash(back.doc)).toBe(documentHash(doc));
  });

  it('drops what it cannot read and says so; a work without art reads as before', () => {
    const doc = apply(base(), art).doc;
    const data = JSON.parse(serializeDocument(doc));
    data.art.cover.elements.bad = { kind: 'canvas', rect: { x: 0, y: 0, w: 1, h: 1 } };
    const back = parseDocument(data, catalog);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.doc.art!.cover!.elements.bad).toBeUndefined();
    expect(back.report.map(i => i.code)).toEqual(['dropped-art']);
    const plain = parseDocument(serializeDocument(base()), catalog);
    expect(plain.ok && plain.doc.art).toBeUndefined();
  });
});

describe('who changed the art', () => {
  it('names each part of the art in words', () => {
    const r = apply(apply(base(), art).doc, [
      { op: 'setRect', on: 'cover', id: 'title', rect: { x: 1, y: 2, w: 3, h: 4 } },
      { op: 'setArt', on: 'cover', set: { background: [{ kind: 'color', color: 'bg' }] } },
    ]);
    expect(r.ops.flatMap(keysOf).map(describeKey)).toEqual([
      'title on the cover (rect)',
      "the cover's background",
    ]);
  });

  it('the AI cannot change what the person changed after it read the work; the rest of the art is free', () => {
    const history = new History();
    let doc = base();
    const edit = (intents: Intent[], author: Author, seen?: number) => {
      const r = commit(history, doc, intents, catalog, { author, seen });
      if (r.ok) doc = r.doc;
      return r;
    };
    edit(art, PERSON);
    const read = doc.revision;
    edit(
      [{ op: 'setRect', on: 'cover', id: 'title', rect: { x: 200, y: 40, w: 900, h: 120 } }],
      PERSON,
    );
    const moved = edit(
      [{ op: 'setRect', on: 'cover', id: 'title', rect: { x: 80, y: 80, w: 900, h: 120 } }],
      AI,
      read,
    );
    expect(moved.ok).toBe(false);
    if (!moved.ok) {
      expect(moved.error.code).toBe('conflict');
      expect(moved.error.message).toMatch(/title on the cover \(rect\) was changed by the person/);
    }
    expect(doc.art!.cover!.elements.title!.rect.x).toBe(200);
    const bolder = edit(
      [{ op: 'updateElement', on: 'icon', id: 'symbol1', set: { weight: 8 } }],
      AI,
      read,
    );
    expect(bolder.ok).toBe(true);
  });
});

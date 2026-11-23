// What the AI reads about the work's art (kit_get_art): each surface with its elements' exact
// fields, the surface the person has open, and what the person made or changed there by hand,
// which follows undo, removal and starting over.
import { describe, expect, it } from 'vite-plus/test';
import { artHandEdits, describeArt } from '../../../src/ai/art-tools.ts';
import { describeOps } from '../../../src/ai/llm-workspace.ts';
import { catalog } from '../../../src/sound/blocks/index.ts';
import { History, commit, type Author } from '../../../src/work/history.ts';
import { applyIntents, type Intent } from '../../../src/work/ops.ts';
import { emptyDocument, type PatchDocument } from '../../../src/work/schema.ts';

const PERSON: Author = { kind: 'human' };
const AI: Author = { kind: 'ai-llm', take: 'rq1', trace: 'rq1' };

function setup() {
  const history = new History();
  let doc: PatchDocument = applyIntents(
    emptyDocument('Night Bass', 'w1'),
    [
      { op: 'addNode', node: { id: 'filter1', type: 'den.filter' } },
      { op: 'addNode', node: { id: 'out1', type: 'kit.out' } },
    ],
    catalog,
  ).doc;
  const edit = (intents: Intent[], author: Author = PERSON) => {
    const r = commit(history, doc, intents, catalog, { author });
    if (!r.ok) throw r.error;
    doc = r.doc;
  };
  return { history, edit, doc: () => doc };
}
const title: Intent = {
  op: 'addElement',
  on: 'cover',
  element: {
    id: 'title',
    kind: 'text',
    text: 'NIGHT BASS',
    rect: { x: 96, y: 300, w: 720, h: 280 },
  },
};
const rule: Intent = {
  op: 'addElement',
  on: 'cover',
  element: { id: 'rule', kind: 'shape', shape: 'rect', rect: { x: 96, y: 612, w: 120, h: 10 } },
};
const symbol: Intent = {
  op: 'addElement',
  on: 'icon',
  element: {
    id: 'symbol1',
    kind: 'symbol',
    node: 'filter1',
    rect: { x: 64, y: 64, w: 384, h: 384 },
  },
};

describe("the person's hand edits on the art", () => {
  it('lists what the person added and changed, not what the AI did', () => {
    const w = setup();
    w.edit([title, rule]);
    w.edit([{ op: 'setRect', on: 'cover', id: 'title', rect: { x: 96, y: 240, w: 720, h: 280 } }]);
    w.edit([{ op: 'updateElement', on: 'cover', id: 'title', set: { text: 'ACID' } }]);
    w.edit([symbol], AI);
    w.edit(
      [{ op: 'setRect', on: 'cover', id: 'rule', rect: { x: 216, y: 612, w: 120, h: 10 } }],
      AI,
    );
    expect(artHandEdits(w.history.entries())).toEqual([
      'title on the cover (added it, place, text)',
      'rule on the cover (added it)',
    ]);
  });

  it('notes the stacking order only when the person arranged it', () => {
    const w = setup();
    w.edit([title, rule]);
    expect(artHandEdits(w.history.entries()).join('; ')).not.toMatch(/stacking order/);
    w.edit([{ op: 'arrange', on: 'cover', ids: ['rule'], to: 'back' }]);
    expect(artHandEdits(w.history.entries())).toContain('the cover (stacking order)');
  });

  it('forgets what was removed, cleared or undone', () => {
    const w = setup();
    w.edit([title, rule, symbol]);
    w.edit([{ op: 'removeElement', on: 'cover', id: 'rule' }]);
    expect(artHandEdits(w.history.entries())).toEqual([
      'title on the cover (added it)',
      'symbol1 on the icon (added it)',
    ]);
    w.edit([{ op: 'clearArt', on: 'cover' }], AI);
    expect(artHandEdits(w.history.entries())).toEqual(['symbol1 on the icon (added it)']);
    // Undoing the clear brings the title back, and with it what the person did to it.
    const undone = w.history.undo(w.doc());
    expect(!!undone && 'doc' in undone).toBe(true);
    expect(artHandEdits(w.history.entries())).toEqual([
      'title on the cover (added it)',
      'symbol1 on the icon (added it)',
    ]);
  });
});

describe('kit_get_art', () => {
  it('shows each surface back to front with exact fields, the open surface, the hand edits and the tokens', () => {
    const w = setup();
    w.edit([title, symbol]);
    const text = describeArt(w.doc(), catalog, {
      open: { on: 'cover', selected: 'title' },
      handEdits: artHandEdits(w.history.entries()),
    });
    expect(text).toMatch(/^The work “Night Bass”\./);
    expect(text).toContain('The person has the cover open, with title selected on it.');
    expect(text).toContain('Icon (512×512):');
    expect(text).toContain('Cover (1280×720):');
    const titleLine = /^ {2}- title: (\{.*\})$/m.exec(text);
    expect(JSON.parse(titleLine![1]!)).toEqual({
      kind: 'text',
      text: 'NIGHT BASS',
      rect: { x: 96, y: 300, w: 720, h: 280 },
    });
    // A symbol's drawn module is not a field the AI writes: it says what it draws instead.
    const line = text.split('\n').find(l => l.startsWith('  - symbol1:'))!;
    expect(line).not.toContain('"module"');
    expect(line).toMatch(/ — draws filter1 \(.+\) as it was when drawn$/);
    expect(text).toContain('title on the cover (added it); symbol1 on the icon (added it)');
    expect(text).toMatch(/Modules a symbol can draw: filter1 \(/);
    expect(text).toMatch(/Colour tokens now: .*accent #/);
    expect(text).toContain('Pictures: none.');
  });

  it('says when a surface has nothing yet and the person is not looking at the art', () => {
    const w = setup();
    const text = describeArt(w.doc(), catalog, { open: null, handEdits: [] });
    expect(text).toContain('The person is not looking at the art now.');
    expect(text.match(/none yet \(the first edit with "on" makes it\)/g)).toHaveLength(2);
    expect(text).toContain('The person has not changed the art by hand.');
  });
});

describe("the label of the AI's art edits", () => {
  it('names the surface once for a run of edits on it', () => {
    const rect = { x: 216, y: 300, w: 720, h: 280 };
    expect(
      describeOps(
        [
          { op: 'setRect', on: 'cover', id: 'title', rect },
          { op: 'setRect', on: 'cover', id: 'rule', rect },
          { op: 'updateElement', on: 'icon', id: 'symbol1', set: { weight: 8 } },
          { op: 'setRect', on: 'cover', id: 'symbol1', rect },
        ],
        [],
      ),
    ).toBe('cover: place title, place rule, icon: symbol1: weight, cover: place symbol1');
  });
});

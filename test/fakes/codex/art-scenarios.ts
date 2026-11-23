// Scripted turns that edit the work's icon and cover like a model would: read the art with
// kit_get_art, change only the surface asked about, in place, with the same operations the
// person uses (kit_apply_ops with "on"), look at the result (kit_look with "art"), then finish.
// They act on whatever the art holds, so they follow what the person made by hand.
import type { Scenario } from './fake-codex.ts';

type Rect = { x: number; y: number; w: number; h: number };
type Element = {
  id: string;
  kind: string;
  rect: Rect;
  weight?: number;
  textStyle?: { weight?: number };
};

/** The elements of one surface in kit_get_art's text ("  - id: {json}" lines under its heading). */
function elementsOf(text: string, on: 'icon' | 'cover'): Element[] {
  const heading = on === 'icon' ? 'Icon (' : 'Cover (';
  const start = text.indexOf(heading);
  if (start < 0) return [];
  const rest = text.slice(start + heading.length);
  const end = rest.search(/\n(Icon|Cover) \(|\n\n/);
  const block = end < 0 ? rest : rest.slice(0, end);
  const out: Element[] = [];
  for (const line of block.split('\n')) {
    const m = /^ {2}- ([a-zA-Z][a-zA-Z0-9]*): (\{.*\})(?: — draws .*)?$/.exec(line);
    if (m) out.push({ id: m[1]!, ...(JSON.parse(m[2]!) as Omit<Element, 'id'>) });
  }
  return out;
}

const artScenarios: Scenario[] = [
  {
    // "More room on the left of the cover": everything on the cover that does not fill it moves right; the icon is not touched.
    name: 'art-cover-room',
    match: text => /cover.*(room|space).*left|カバー.*左/i.test(text.split('\n\n').at(-1) ?? ''),
    async run(t) {
      await t.think();
      const art = await t.call('kit_get_art', {});
      const moving = elementsOf(art.text, 'cover').filter(e => e.rect.w < 1200);
      if (!moving.length) {
        await t.say('The cover has nothing to move yet.');
        return;
      }
      const edit = await t.call('kit_apply_ops', {
        ops: moving.map(e => ({
          op: 'setRect',
          on: 'cover',
          id: e.id,
          rect: { ...e.rect, x: e.rect.x + 120 },
        })),
      });
      if (!edit.success) {
        await t.say(`Not applied: ${edit.text}`);
        return;
      }
      const look = await t.call('kit_look', { art: 'cover' });
      await t.call('kit_finish', {
        summary: `Moved ${moving.map(e => e.id).join(', ')} 120 px right on the cover; the icon is as it was.${look.images ? ' Looked at it.' : ''}`,
      });
    },
  },
  {
    // "Make the icon bolder": thicker symbol lines and heavier letters on the icon only, changed in place.
    name: 'art-icon-bolder',
    match: text => /icon.*bold|アイコン.*太/i.test(text.split('\n\n').at(-1) ?? ''),
    async run(t) {
      await t.think();
      const art = await t.call('kit_get_art', {});
      const ops = elementsOf(art.text, 'icon').flatMap<Record<string, unknown>>(e =>
        e.kind === 'symbol'
          ? [
              {
                op: 'updateElement',
                on: 'icon',
                id: e.id,
                set: { weight: Math.min(20, Math.round((e.weight ?? 4) * 1.6 * 2) / 2) },
              },
            ]
          : e.kind === 'text'
            ? [
                {
                  op: 'updateElement',
                  on: 'icon',
                  id: e.id,
                  set: { textStyle: { ...e.textStyle, weight: 900 } },
                },
              ]
            : [],
      );
      if (!ops.length) {
        await t.say('The icon has no symbol or letters to make bolder.');
        return;
      }
      const edit = await t.call('kit_apply_ops', { ops });
      if (!edit.success) {
        await t.say(`Not applied: ${edit.text}`);
        return;
      }
      await t.call('kit_look', { art: 'icon' });
      await t.call('kit_finish', { summary: 'Bolder lines and letters on the icon.' });
    },
  },
  {
    // "Put the name on the cover": one text in the look's font and colour, at the lower left.
    name: 'art-cover-title',
    match: text => /name on the cover|カバーに名前/i.test(text.split('\n\n').at(-1) ?? ''),
    async run(t) {
      await t.think();
      const art = await t.call('kit_get_art', {});
      const name = /^The work “(.+)”\./m.exec(art.text)?.[1] ?? 'Untitled';
      const edit = await t.call('kit_apply_ops', {
        ops: [
          {
            op: 'addElement',
            on: 'cover',
            element: {
              id: 'name',
              kind: 'text',
              text: name,
              rect: { x: 96, y: 540, w: 900, h: 120 },
              textStyle: { font: 'font', size: 88, weight: 700, color: 'fg', align: 'left' },
            },
          },
        ],
      });
      if (!edit.success) {
        await t.say(`Not applied: ${edit.text}`);
        return;
      }
      await t.call('kit_finish', { summary: `Put “${name}” on the cover.` });
    },
  },
  {
    // An edit made from what the AI read before the person moved the title: refused, then read again and done.
    name: 'art-stale-read',
    match: text => /cover title up after a pause/i.test(text.split('\n\n').at(-1) ?? ''),
    async run(t) {
      const first = await t.call('kit_get_art', {});
      const title = elementsOf(first.text, 'cover').find(e => e.kind === 'text');
      if (!title) return;
      await t.sleep(1500); // the person drags the title meanwhile
      const stale = await t.call('kit_apply_ops', {
        ops: [
          {
            op: 'setRect',
            on: 'cover',
            id: title.id,
            rect: { ...title.rect, y: title.rect.y - 80 },
          },
        ],
      });
      await t.say(
        stale.success ? 'applied from the old read' : `refused: ${stale.text.slice(0, 300)}`,
      );
      const again = await t.call('kit_get_art', {});
      const now = elementsOf(again.text, 'cover').find(e => e.id === title.id)!;
      const edit = await t.call('kit_apply_ops', {
        ops: [
          { op: 'setRect', on: 'cover', id: now.id, rect: { ...now.rect, y: now.rect.y - 80 } },
        ],
      });
      await t.call('kit_finish', {
        summary: edit.success ? `Moved ${now.id} up from where the person put it.` : edit.text,
      });
    },
  },
];

export default artScenarios;

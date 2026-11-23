// The work's art for the AI: kit_get_art's text (each surface with its elements' exact fields,
// what the person made or changed there by hand, which surface they have open, the modules a
// symbol can draw, the look's tokens and the pictures), and the person's own art edits read
// from the history. The AI edits the art with the same operations as the person (ops.ts, `on`).
import {
  ART_SIZE,
  ART_SURFACES,
  artStack,
  drawable,
  type ArtElement,
  type ArtSurfaceName,
} from '../work/art.ts';
import type { Catalog } from '../work/catalog.ts';
import type { Transaction } from '../work/history.ts';
import type { PatchDocument } from '../work/schema.ts';
import { FONT_TOKENS, assetsOf, isImageAsset } from '../work/ui.ts';
import { effectiveColors } from './plugin-tools.ts';

/** What the person made or changed on the art by hand since the work was opened: "title on the cover (place, text)". */
export function artHandEdits(entries: readonly Transaction[]): string[] {
  const start = entries.map(t => !!t.replaced).lastIndexOf(true) + 1;
  const things = new Map<string, Set<string>>();
  const note = (thing: string, what: string) => {
    if (!things.has(thing)) things.set(thing, new Set());
    things.get(thing)!.add(what);
  };
  for (const tx of entries.slice(start)) {
    const human = tx.author.kind === 'human';
    // Adding or removing changes the order too; that is not a choice of stacking.
    const addsOn = new Set(
      tx.ops.flatMap(op =>
        op.op === 'addArtElement' || op.op === 'removeArtElement' ? [op.on] : [],
      ),
    );
    for (const op of tx.ops) {
      if (op.op === 'setArtSurface') {
        // Cleared or started over (by anyone): what was there is gone.
        for (const thing of things.keys())
          if (thing === `the ${op.on}` || thing.endsWith(` on the ${op.on}`)) things.delete(thing);
      } else if (op.op === 'removeArtElement') things.delete(`${op.element.id} on the ${op.on}`);
      else if (!human) continue;
      else if (op.op === 'addArtElement') note(`${op.element.id} on the ${op.on}`, 'added it');
      else if (op.op === 'setArtElement')
        note(`${op.id} on the ${op.on}`, op.field === 'rect' ? 'place' : op.field);
      else if (op.op === 'setArt' && op.field === 'background') note(`the ${op.on}`, 'background');
      else if (op.op === 'setArt' && op.field === 'order' && !addsOn.has(op.on))
        note(`the ${op.on}`, 'stacking order');
    }
  }
  return [...things].map(([thing, what]) => `${thing} (${[...what].join(', ')})`);
}

/** An element's fields as the AI writes them (a symbol's drawn module is left out: setting node redraws it). */
function fields(el: ArtElement): string {
  const { id: _id, ...rest } = el as ArtElement & Record<string, unknown>;
  if (el.kind === 'symbol') delete (rest as Record<string, unknown>).module;
  return JSON.stringify(rest);
}

/** kit_get_art's text. */
export function describeArt(
  doc: PatchDocument,
  catalog: Catalog,
  extra: { open?: { on: ArtSurfaceName; selected: string | null } | null; handEdits?: string[] },
): string {
  const lines: string[] = [`The work “${doc.name}”.`];
  lines.push(
    extra.open
      ? `The person has the ${extra.open.on} open${extra.open.selected ? `, with ${extra.open.selected} selected on it` : ''}.`
      : 'The person is not looking at the art now.',
  );
  for (const on of ART_SURFACES) {
    const { width, height } = ART_SIZE[on];
    const surface = doc.art?.[on];
    lines.push('', `${on === 'icon' ? 'Icon' : 'Cover'} (${width}×${height}):`);
    if (!surface) {
      lines.push('  none yet (the first edit with "on" makes it).');
      continue;
    }
    lines.push(
      `  background: ${surface.background?.length ? JSON.stringify(surface.background) : "none (the look's bg colour)"}`,
    );
    const stack = artStack(surface);
    if (!stack.length) lines.push('  nothing on it.');
    else lines.push('  back to front:');
    for (const el of stack) {
      const drawn =
        el.kind === 'symbol'
          ? ` — draws ${el.node} (${catalog.find(el.module.type)?.title ?? el.module.type}) as it was when drawn${doc.nodes[el.node] ? '' : '; that module is no longer in the patch'}`
          : '';
      lines.push(`  - ${el.id}: ${fields(el)}${drawn}`);
    }
  }
  lines.push(
    '',
    extra.handEdits?.length
      ? `Made or changed by the person by hand (keep these unless the request is about them; change them in place): ${extra.handEdits.join('; ')}.`
      : 'The person has not changed the art by hand.',
  );
  const modules = Object.values(doc.nodes).filter(n => drawable(n));
  lines.push(
    `Modules a symbol can draw: ${
      modules.length
        ? modules
            .map(n => `${n.id} (${n.label ?? catalog.find(n.type)?.title ?? n.type})`)
            .join(', ')
        : 'none'
    }.`,
  );
  const colors = effectiveColors(doc);
  lines.push(
    `Colour tokens now: ${Object.entries(colors)
      .map(([k, v]) => `${k} ${v}`)
      .join(
        ', ',
      )}. Font tokens: ${FONT_TOKENS.map(t => `${t} ${doc.ui.look.tokens[t] ?? 'theme'}`).join(', ')}.`,
  );
  const pictures = Object.values(assetsOf(doc.files)).filter(isImageAsset);
  lines.push(
    `Pictures: ${
      pictures.length
        ? pictures.map(a => `${a.id}${a.width ? ` (${a.width}×${a.height})` : ''}`).join(', ')
        : 'none'
    }.`,
  );
  return lines.join('\n');
}

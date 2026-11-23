// What the AI reads of a work's icon and cover (src/work/art.ts): each board's
// layers as data, with what they draw from (the plugin, its most telling piece,
// the patch as signs), and how to edit them with the same ops a person's edits
// make. kit_get_art returns it.
import {
  ART_BOARDS,
  BOARD_SIZE,
  RECIPES,
  RECIPE_DOC,
  patchSigns,
  telling,
  type ArtBoardId,
} from '../work/art.ts';
import type { Catalog } from '../work/catalog.ts';
import type { PatchDocument } from '../work/schema.ts';

const size = (board: ArtBoardId) => `${BOARD_SIZE[board].w}×${BOARD_SIZE[board].h}`;

/** The work's art in words and JSON, for the AI. */
export function describeArt(doc: PatchDocument, catalog: Catalog): string {
  const piece = telling(doc, catalog);
  const signs = patchSigns(doc, catalog).map(s => s.sign);
  const boards = ART_BOARDS.map(board => {
    const layers = doc.art?.[board]?.layers;
    return layers?.length
      ? `${board} (${size(board)}), bottom to top:\n${JSON.stringify(layers)}`
      : `${board} (${size(board)}): not made yet (the shelf shows the whole plugin, fitted, until someone makes it).`;
  });
  return [
    `The work's art: its icon (the small square that tells works apart where they are lined up) and its cover (the large picture). Each is a board of layers drawn from the work itself, so it follows the work when its look or patch changes. Rects are in board pixels.`,
    `The plugin is ${doc.panel.width}×${doc.panel.height}; its most telling piece is at ${JSON.stringify(piece)}. The patch as signs, in the order it is laid out: ${signs.join(' ') || '(none)'}.`,
    ...boards,
    'Layers (id, kind, name?, hidden? and):',
    "- ground {fill?}: the whole board. No fill: the plugin's own background. fill: fill layers as in the look's background.",
    "- window {rect, focus, zoom, moment?, style?}: a window onto the plugin screen. The plugin point focus sits at the window's centre; zoom is board pixels per plugin pixel. moment {control id: value} holds controls where the author left them (absent: as they are now). style is an element style (radius, stroke, shadows, fill over the window).",
    "- mark {rect, text, textStyle?, style?}: letters. Use the look's tokens (font, fg, accent, bg) so they follow the look.",
    "- pattern {rect, repeat: grid|brick|mirror|radial, scale (1 = a 64-pixel sign), offset?, rotate?, colors?, style?}: the patch's modules as signs, repeated; colors are tokens or colours, one per kind of module.",
    `Starting points the person can pick: ${RECIPES.map(r => `${r} (${RECIPE_DOC[r]})`).join('; ')}.`,
    'Edit with kit_apply_ops: setArt (a whole board), addArtLayer, updateArtLayer (null removes a field), removeArtLayer, arrangeArtLayer. Change only the board the request is about. What the person changed after you read stays theirs: an edit of it fails; read again with kit_get_art and work around it.',
  ].join('\n');
}

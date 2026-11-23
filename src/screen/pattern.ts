// A pattern layer of a work's art (src/work/art.ts) as marks to draw: the patch's
// signs, one per module in the order the patch is laid out, repeated over the
// layer's box, each kind of module in one of the layer's colours. Pure data:
// ArtBoard.vue draws the marks as SVG.
import type { PatternLayer, Sign } from '../work/art.ts';
import type { Category } from '../work/catalog.ts';

/** One cell of a pattern at scale 1, in board pixels. */
export const CELL = 64;

export interface PatternMark {
  sign: string;
  /** The cell's top-left corner and size, in the layer's box. */
  x: number;
  y: number;
  size: number;
  /** One of the layer's colours (a token or a colour). */
  color: string;
  /** Mirrored left to right (the way back in a mirror pattern). */
  flip: boolean;
  /** Degrees, around the cell's centre (radial patterns face outward). */
  turn: number;
}

/** A sign's drawing in a 64-unit cell: SVG path data, stroked unless `fill`. */
export const SIGN_PATHS: Readonly<Record<string, { d: string; fill?: boolean }>> = {
  dot: { d: 'M32 18a14 14 0 1 0 0.01 0z', fill: true },
  wave: { d: 'M8 32C16 8 24 8 32 32S48 56 56 32' },
  slope: { d: 'M8 22H34Q44 22 48 34L54 52' },
  envelope: { d: 'M8 52L18 12L28 30H44L56 52' },
  triangle: { d: 'M32 12L54 50H10Z' },
  rings: { d: 'M32 24a8 8 0 1 0 0.01 0zM32 12a20 20 0 1 0 0.01 0z' },
  bars: { d: 'M16 52V30M32 52V14M48 52V38' },
  diamond: { d: 'M32 10L54 32L32 54L10 32Z' },
  hexagon: { d: 'M32 10L51 21V43L32 54L13 43V21Z' },
};

/** The marks of a pattern layer over its box (marks may run past the edges: the box clips them). */
export function patternMarks(layer: PatternLayer, signs: readonly Sign[]): PatternMark[] {
  const row: readonly Sign[] = signs.length ? signs : [{ sign: 'dot', category: 'voice' }];
  const colors = layer.colors?.length ? layer.colors : ['accent', 'fg', 'muted', 'knob'];
  // Each kind of module keeps one colour, in the order the kinds first appear.
  const kinds: Category[] = [];
  for (const s of row) if (!kinds.includes(s.category)) kinds.push(s.category);
  const colorOf = (s: Sign) => colors[kinds.indexOf(s.category) % colors.length]!;
  const size = CELL * layer.scale;
  const { w, h } = layer.rect;
  const marks: PatternMark[] = [];
  const at = (i: number) => row[((i % row.length) + row.length) % row.length]!;
  if (layer.repeat === 'radial') {
    const cx = w / 2 + (layer.offset?.x ?? 0),
      cy = h / 2 + (layer.offset?.y ?? 0);
    const reach = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy)) + size;
    let i = 0;
    for (let ring = 0; ring * size <= reach && marks.length < 900; ring++) {
      const count = ring === 0 ? 1 : Math.max(6, Math.round(2 * Math.PI * ring));
      for (let k = 0; k < count; k++, i++) {
        const angle = (2 * Math.PI * k) / count - Math.PI / 2;
        const s = at(i);
        marks.push({
          sign: s.sign,
          x: cx + Math.cos(angle) * ring * size - size / 2,
          y: cy + Math.sin(angle) * ring * size - size / 2,
          size,
          color: colorOf(s),
          flip: false,
          turn: ring === 0 ? 0 : (angle * 180) / Math.PI + 90,
        });
      }
    }
    return marks;
  }
  const ox = (((layer.offset?.x ?? 0) % size) + size) % size,
    oy = (((layer.offset?.y ?? 0) % size) + size) % size;
  const cols = Math.ceil(w / size) + 2,
    rows = Math.ceil(h / size) + 2;
  for (let r = 0; r < rows && marks.length < 900; r++) {
    const shift = layer.repeat === 'brick' && r % 2 ? size / 2 : 0;
    const back = layer.repeat === 'mirror' && r % 2 === 1;
    for (let c = 0; c < cols; c++) {
      // The patch reads left to right; in a mirror pattern every other row reads back.
      const s = at(r * cols + (back ? cols - 1 - c : c));
      marks.push({
        sign: s.sign,
        x: (c - 1) * size + ox + shift,
        y: (r - 1) * size + oy,
        size,
        color: colorOf(s),
        flip: back,
        turn: 0,
      });
    }
  }
  return marks;
}

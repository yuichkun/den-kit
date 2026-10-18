// A rough sketch for the AI (U8c): marks the person draws over the plugin or
// the patch — a pen or marker stroke, a box, an arrow, a sticky note, a text —
// to say "this here", "something like this" or "put a waveform here". Marks are
// not part of the work and not in the undo history; they ride along with the
// next request. Each mark is numbered, and den-kit reads what it encloses,
// touches or points at (by the positions of the things on the view), so the AI
// gets the marks in words as well as on the picture.

export type MarkKind = 'pen' | 'marker' | 'rect' | 'arrow' | 'note' | 'text';
export type SketchView = 'plugin' | 'patch';
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Point = [number, number];
export interface Mark {
  id: string;
  /** Its number on the picture and in the words (①②③). */
  n: number;
  kind: MarkKind;
  color: string;
  /** In the view's own coordinates: the plugin's design pixels, or the patch's positions. */
  points?: Point[];
  rect?: Box;
  from?: Point;
  to?: Point;
  text?: string;
  /** Stroke width, in the view's coordinates. */
  width?: number;
  /** On the patch: the part it was drawn inside (their ids joined by "/"; absent on the main patch). */
  where?: string;
}
export interface Sketch {
  view: SketchView;
  marks: Mark[];
}
/** A sketch on one view, as it went with a request: how many marks; while the request runs, the marks in words and the picture. */
export interface SketchPart {
  view: SketchView;
  marks: number;
  text?: string;
  image?: string;
}
/** The sketch that went with a request (one part per view sketched on), and the marks it took (while it runs). */
export interface SentSketch {
  parts: SketchPart[];
  ids?: string[];
}
/** Something on the view a mark can be about: a control, a decoration, a module. */
export interface Target {
  id: string;
  box: Box;
  label: string;
}

export interface MarkReading {
  n: number;
  kind: MarkKind;
  color: string;
  box: Box;
  text?: string;
  /** Things the mark goes around (a loop, a box around them). */
  encloses: string[];
  /** Things it crosses or lies on. */
  touches: string[];
  /** An arrow's ends. */
  from?: string;
  to?: string;
  /** It is about empty space (nothing there). */
  empty: boolean;
}

export const MARK_COLORS = ['#ff4d6d', '#ffd166', '#06d6a0', '#4cc9f0'] as const;
export const COLOR_NAMES: Record<string, string> = {
  '#ff4d6d': 'red',
  '#ffd166': 'yellow',
  '#06d6a0': 'green',
  '#4cc9f0': 'blue',
};
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
export const markNumber = (n: number) => CIRCLED[n - 1] ?? `(${n})`;

/** The bounding box of a mark. */
export function markBox(m: Mark): Box {
  if (m.rect) return { ...m.rect };
  const pts: Point[] = m.points?.length ? m.points : [m.from ?? [0, 0], m.to ?? m.from ?? [0, 0]];
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  const pad = (m.width ?? 0) / 2;
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
}

const inBox = ([x, y]: Point, b: Box, pad = 0) =>
  x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** A stroke that comes back near where it began is a loop: it goes around something. */
export function isLoop(points: readonly Point[]): boolean {
  if (points.length < 8) return false;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const [x, y] of points) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  const size = Math.hypot(x1 - x0, y1 - y0);
  return size > 20 && dist(points[0]!, points.at(-1)!) <= Math.max(30, size * 0.3);
}

/** Point in polygon (even-odd). */
function inside([x, y]: Point, poly: readonly Point[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!,
      [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
/** How much of a box lies inside a closed shape (sampled on a 4×4 grid). */
function shareInside(b: Box, test: (p: Point) => boolean): number {
  let n = 0;
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++)
      if (test([b.x + (b.w * (i + 0.5)) / 4, b.y + (b.h * (j + 0.5)) / 4])) n++;
  return n / 16;
}
/** The thing under a point (the smallest box that holds it), or the nearest within `near`. */
function at(p: Point, targets: readonly Target[], near = 24): string | undefined {
  const holding = targets
    .filter(t => inBox(p, t.box))
    .sort((a, b) => a.box.w * a.box.h - b.box.w * b.box.h);
  if (holding[0]) return holding[0].id;
  let best: Target | undefined,
    bestD = near;
  for (const t of targets) {
    const dx = Math.max(t.box.x - p[0], 0, p[0] - (t.box.x + t.box.w)),
      dy = Math.max(t.box.y - p[1], 0, p[1] - (t.box.y + t.box.h));
    const d = Math.hypot(dx, dy);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best?.id;
}

/** What each mark is about, from where the things on the view are. */
export function readMarks(sketch: Sketch, targets: readonly Target[]): MarkReading[] {
  return sketch.marks.map(m => {
    const box = markBox(m);
    const r: MarkReading = {
      n: m.n,
      kind: m.kind,
      color: m.color,
      box,
      encloses: [],
      touches: [],
      empty: false,
      ...(m.text ? { text: m.text } : {}),
    };
    if (m.kind === 'arrow' && m.from && m.to) {
      r.from = at(m.from, targets);
      r.to = at(m.to, targets);
      r.empty = !r.from && !r.to;
      return r;
    }
    if ((m.kind === 'pen' || m.kind === 'marker') && m.points?.length) {
      if (isLoop(m.points)) {
        r.encloses = targets
          .filter(t => shareInside(t.box, p => inside(p, m.points!)) >= 0.6)
          .map(t => t.id);
      }
      const pad = (m.width ?? 4) / 2 + 2;
      r.touches = targets
        .filter(t => !r.encloses.includes(t.id) && m.points!.some(p => inBox(p, t.box, pad)))
        .map(t => t.id);
    } else if (m.rect) {
      const rect = m.rect;
      if (m.kind === 'rect')
        r.encloses = targets
          .filter(t => shareInside(t.box, p => inBox(p, rect)) >= 0.6)
          .map(t => t.id);
      r.touches = targets
        .filter(t => !r.encloses.includes(t.id) && overlaps(t.box, rect))
        .map(t => t.id);
    }
    r.empty = !r.encloses.length && !r.touches.length;
    return r;
  });
}

const KIND_WORD: Record<MarkKind, string> = {
  pen: 'pen stroke',
  marker: 'marker stroke',
  rect: 'box',
  arrow: 'arrow',
  note: 'sticky note',
  text: 'text',
};
const boxText = (b: Box) =>
  `x ${Math.round(b.x)}, y ${Math.round(b.y)}, ${Math.round(b.w)}×${Math.round(b.h)}`;

/**
 * The sketch in words for the AI: one line per numbered mark, with what it is about. `picture`: whether a picture
 * shows the numbered marks (true, or what the picture is), or there is none (false).
 */
export function sketchText(
  sketch: Sketch,
  readings: readonly MarkReading[],
  targets: readonly Target[],
  size?: { width: number; height: number },
  picture: boolean | string = true,
): string {
  const label = new Map(targets.map(t => [t.id, t.label]));
  const name = (id: string) => label.get(id) ?? id;
  const where =
    sketch.view === 'plugin'
      ? `the plugin${size ? ` (${size.width}×${size.height} design pixels)` : ''}`
      : 'the patch';
  const lines = readings.map(r => {
    const loop = (r.kind === 'pen' || r.kind === 'marker') && r.encloses.length > 0;
    const what = `${markNumber(r.n)} ${COLOR_NAMES[r.color] ?? r.color} ${loop ? `${r.kind} loop` : KIND_WORD[r.kind]}`;
    const text = r.text ? ` “${r.text}”` : '';
    if (r.kind === 'arrow')
      return `${what} from ${r.from ? name(r.from) : 'empty space'} to ${r.to ? name(r.to) : 'empty space'}`;
    const about = [
      r.encloses.length ? `around ${r.encloses.map(name).join(', ')}` : '',
      r.touches.length
        ? `${r.encloses.length ? 'also touching' : 'on'} ${r.touches.map(name).join(', ')}`
        : '',
    ]
      .filter(Boolean)
      .join('; ');
    return `${what}${text}${about ? ` ${about}` : ' in empty space'} (${boxText(r.box)})`;
  });
  const about =
    picture === false
      ? 'the marks (no picture: your model does not take pictures)'
      : `the marks are numbered on the picture${typeof picture === 'string' ? ` (${picture})` : ''}`;
  return `The person sketched on ${where}; ${about}:\n${lines.join('\n')}`;
}

/** The things marks can be about on the plugin: its controls and decorations. */
export function pluginTargets(
  doc: {
    nodes: Record<string, { id: string; type: string; label?: string; panel?: Box }>;
    ui: {
      elements: Record<
        string,
        { id: string; kind: string; rect: Box; text?: unknown; name?: string }
      >;
    };
  },
  isControl: (type: string) => boolean,
): Target[] {
  const out: Target[] = [];
  for (const n of Object.values(doc.nodes))
    if (n.panel && isControl(n.type))
      out.push({
        id: n.id,
        box: n.panel,
        label: `${n.id} (${n.type.replace(/^ui\./, '')}${n.label ? ` “${n.label}”` : ''})`,
      });
  for (const e of Object.values(doc.ui.elements))
    out.push({
      id: e.id,
      box: e.rect,
      label: `${e.id} (${e.kind}${typeof e.text === 'string' ? ` “${e.text.slice(0, 24)}”` : e.name ? ` ${e.name}` : ''})`,
    });
  return out;
}

/** The things marks can be about on the patch: the modules in the place shown, where the view draws them. */
export function patchTargets(
  nodes: ReadonlyArray<{ id: string; type: string; label?: string }>,
  boxes: Readonly<Record<string, Box>>,
  title: (type: string) => string,
): Target[] {
  return nodes.flatMap(n =>
    boxes[n.id]
      ? [
          {
            id: n.id,
            box: boxes[n.id]!,
            label: `${n.id} (${title(n.type)}${n.label ? ` “${n.label}”` : ''})`,
          },
        ]
      : [],
  );
}

/** Everything the marks are about: what they go around, cross or join. */
export function markedThings(readings: readonly MarkReading[]): string[] {
  return [
    ...new Set(
      readings.flatMap(r => [
        ...r.encloses,
        ...r.touches,
        ...(r.from ? [r.from] : []),
        ...(r.to ? [r.to] : []),
      ]),
    ),
  ];
}

/** Marks that only point at things, like a selection: loops and boxes. */
export function onlyPointing(readings: readonly MarkReading[]): boolean {
  return (
    readings.length > 0 &&
    readings.every(
      r =>
        (r.kind === 'pen' || r.kind === 'marker' || r.kind === 'rect') &&
        !r.text &&
        r.encloses.length > 0,
    )
  );
}

/** "3 marks on the plugin", "a mark on the patch and 2 on the plugin". */
export function sketchSummary(parts: readonly Pick<SketchPart, 'view' | 'marks'>[]): string {
  return parts
    .map(
      (p, i) => `${p.marks === 1 ? 'a mark' : `${p.marks}${i ? '' : ' marks'}`} on the ${p.view}`,
    )
    .join(' and ');
}

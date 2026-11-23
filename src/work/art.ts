// A work's art: its icon, the small square that tells works apart where they are
// lined up, and its cover, the large picture its author chooses. Each is a board of
// a few layers that draw from the work itself: the ground (the plugin's own
// background, or fills of the author's), a window onto the plugin screen, letters
// in the work's fonts and colours, and a pattern made from the patch. An author can
// start without a picture of their own, and the art follows the work when its look
// or its patch changes. Pure data, checks and the starting recipes: ops.ts edits it,
// persistence.ts loads it, src/screen/ArtBoard.vue draws it.
import type { Catalog, Category } from './catalog.ts';
import { NODE_ID_PATTERN, clone, type PatchDocument, type Value, type XY } from './schema.ts';
import { THEME_TOKENS } from './themes.ts';
import {
  COLOR_TOKENS,
  LIMITS,
  UiCheckError,
  checkColor,
  checkFill,
  checkRect,
  checkStyle,
  checkTextStyle,
  isAssetPath,
  type CheckContext,
  type ColorToken,
  type ElementStyle,
  type Fill,
  type Rect,
  type TextStyle,
} from './ui.ts';

export const ART_BOARDS = ['icon', 'cover'] as const;
export type ArtBoardId = (typeof ART_BOARDS)[number];
/** Each board's design size: layer rects are in these pixels. */
export const BOARD_SIZE: Readonly<Record<ArtBoardId, { w: number; h: number }>> = {
  icon: { w: 512, h: 512 },
  cover: { w: 1600, h: 900 },
};
export const ART_LIMITS = { layers: 8, text: 80, colors: 6, moment: 64, name: 40 } as const;
export const LAYER_KINDS = ['ground', 'window', 'mark', 'pattern'] as const;
export type ArtLayerKind = (typeof LAYER_KINDS)[number];
export const REPEATS = ['grid', 'brick', 'mirror', 'radial'] as const;
export type Repeat = (typeof REPEATS)[number];

interface LayerBase {
  id: string;
  name?: string;
  hidden?: boolean;
}
/** The whole board. Without `fill` it is the plugin's own background (or its bg colour). */
export interface GroundLayer extends LayerBase {
  kind: 'ground';
  fill?: Fill[];
}
/**
 * A window onto the plugin screen: the plugin point `focus` sits at the window's
 * centre and `zoom` turns plugin pixels into board pixels. `moment` holds controls
 * where the author left them while playing (absent: as they are now).
 */
export interface WindowLayer extends LayerBase {
  kind: 'window';
  rect: Rect;
  focus: XY;
  zoom: number;
  moment?: Record<string, Value>;
  style?: ElementStyle;
}
/** Letters, in the work's fonts and colours when they name tokens. */
export interface MarkLayer extends LayerBase {
  kind: 'mark';
  rect: Rect;
  text: string;
  textStyle?: TextStyle;
  style?: ElementStyle;
}
/**
 * A pattern made from the patch: one sign per module, by its category, in the order
 * the sound flows, repeated over the rect in `colors` (tokens follow the look).
 */
export interface PatternLayer extends LayerBase {
  kind: 'pattern';
  rect: Rect;
  repeat: Repeat;
  /** The size of one sign, 1 = a 64-pixel cell. */
  scale: number;
  offset?: XY;
  rotate?: number;
  colors?: string[];
  style?: ElementStyle;
}
export type ArtLayer = GroundLayer | WindowLayer | MarkLayer | PatternLayer;
export interface ArtBoard {
  /** Bottom to top. */
  layers: ArtLayer[];
}
export type WorkArt = Partial<Record<ArtBoardId, ArtBoard>>;

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
function bad(message: string, hint?: string): never {
  throw new UiCheckError('bad-art', message, hint);
}
function num(v: unknown, min: number, max: number, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) bad(`${what} must be a number.`);
  return Math.min(max, Math.max(min, v as number));
}
function xy(v: unknown, what: string): XY {
  if (!isObj(v)) bad(`${what} must be {x, y}.`);
  return {
    x: num((v as Record<string, unknown>).x, -8000, 8000, `${what}.x`),
    y: num((v as Record<string, unknown>).y, -8000, 8000, `${what}.y`),
  };
}

export const isBoard = (v: unknown): v is ArtBoardId =>
  (ART_BOARDS as readonly unknown[]).includes(v);

const FIELDS: Readonly<Record<ArtLayerKind, readonly string[]>> = {
  ground: ['fill'],
  window: ['rect', 'focus', 'zoom', 'moment', 'style'],
  mark: ['rect', 'text', 'textStyle', 'style'],
  pattern: ['rect', 'repeat', 'scale', 'offset', 'rotate', 'colors', 'style'],
};
/** The fields a layer of `kind` takes, besides id, kind, name and hidden. */
export const layerFields = (kind: ArtLayerKind) => FIELDS[kind];

/**
 * Check one layer. `ctx.nodes` are the controls a window's moment may name; with
 * `ctx.lenient` (loading a file) a missing picture or font is kept and reported, as
 * on the plugin.
 */
export function checkArtLayer(raw: unknown, ctx: CheckContext): ArtLayer {
  if (!isObj(raw)) bad('A layer is an object with a kind (ground, window, mark, pattern).');
  const r = raw as Record<string, unknown>;
  if (!(LAYER_KINDS as readonly unknown[]).includes(r.kind))
    bad(`Unknown layer kind ${JSON.stringify(r.kind)}.`, `Kinds: ${LAYER_KINDS.join(', ')}.`);
  const kind = r.kind as ArtLayerKind;
  if (typeof r.id !== 'string' || !NODE_ID_PATTERN.test(r.id))
    bad(`A layer id must match ${NODE_ID_PATTERN}.`);
  for (const key of Object.keys(r))
    if (!['id', 'kind', 'name', 'hidden', ...FIELDS[kind]].includes(key))
      bad(
        `A ${kind} layer has no "${key}".`,
        `Its fields: ${['name', 'hidden', ...FIELDS[kind]].join(', ')}.`,
      );
  const base: LayerBase = { id: r.id as string };
  if (r.name !== undefined) {
    if (typeof r.name !== 'string') bad('A layer name is text.');
    if ((r.name as string).trim()) base.name = (r.name as string).slice(0, ART_LIMITS.name);
  }
  if (r.hidden === true) base.hidden = true;
  const style = () => (r.style === undefined ? {} : { style: checkStyle(r.style, ctx) });
  switch (kind) {
    case 'ground': {
      if (r.fill === undefined) return { ...base, kind };
      if (!Array.isArray(r.fill) || r.fill.length > LIMITS.fills)
        bad(`A ground's fill is a list of up to ${LIMITS.fills} layers (bottom first).`);
      return { ...base, kind, fill: (r.fill as unknown[]).map(f => checkFill(f, ctx)) };
    }
    case 'window': {
      const layer: WindowLayer = {
        ...base,
        kind,
        rect: checkRect(r.rect, 'the window'),
        focus: xy(r.focus, 'focus'),
        zoom: num(r.zoom, 0.05, 20, 'zoom'),
        ...style(),
      };
      if (r.moment !== undefined) {
        if (!isObj(r.moment)) bad('moment is {control id: value}.');
        const moment: Record<string, Value> = {};
        for (const [id, value] of Object.entries(r.moment as Record<string, unknown>).slice(
          0,
          ART_LIMITS.moment,
        )) {
          // A moment is a snapshot: a control that is gone has nothing to show, so it is left out.
          if (!ctx.nodes[id]) {
            ctx.warn?.(`A window's moment names "${id}", which is not a control on the plugin.`);
            continue;
          }
          if (typeof value === 'boolean') moment[id] = value;
          else if (typeof value === 'number' && Number.isFinite(value)) moment[id] = value;
          else bad(`The moment's value for "${id}" must be a number or true/false.`);
        }
        if (Object.keys(moment).length) layer.moment = moment;
      }
      return layer;
    }
    case 'mark': {
      if (typeof r.text !== 'string') bad('A mark has text.');
      const layer: MarkLayer = {
        ...base,
        kind,
        rect: checkRect(r.rect, 'the mark'),
        text: (r.text as string).slice(0, ART_LIMITS.text),
        ...style(),
      };
      if (r.textStyle !== undefined) layer.textStyle = checkTextStyle(r.textStyle, ctx);
      return layer;
    }
    case 'pattern': {
      if (!(REPEATS as readonly unknown[]).includes(r.repeat ?? 'grid'))
        bad(`repeat must be one of ${REPEATS.join(', ')}.`);
      const layer: PatternLayer = {
        ...base,
        kind,
        rect: checkRect(r.rect, 'the pattern'),
        repeat: (r.repeat ?? 'grid') as Repeat,
        scale: r.scale === undefined ? 1 : num(r.scale, 0.2, 6, 'scale'),
        ...style(),
      };
      if (r.offset !== undefined) layer.offset = xy(r.offset, 'offset');
      if (r.rotate !== undefined) layer.rotate = num(r.rotate, -360, 360, 'rotate');
      if (r.colors !== undefined) {
        if (!Array.isArray(r.colors) || !r.colors.length || r.colors.length > ART_LIMITS.colors)
          bad(`colors is a list of 1 to ${ART_LIMITS.colors} colours.`);
        layer.colors = (r.colors as unknown[]).map((c, i) => checkColor(c, `colour ${i + 1}`));
      }
      return layer;
    }
  }
}

/** Check a whole board: up to ART_LIMITS.layers layers with different ids. */
export function checkArtBoard(raw: unknown, ctx: CheckContext): ArtBoard {
  const list = isObj(raw) ? (raw as Record<string, unknown>).layers : raw;
  if (!Array.isArray(list)) bad('A board is {layers: [...]}, bottom first.');
  if ((list as unknown[]).length > ART_LIMITS.layers)
    bad(`A board has at most ${ART_LIMITS.layers} layers.`);
  const layers: ArtLayer[] = [];
  for (const raw of list as unknown[]) {
    try {
      const layer = checkArtLayer(raw, ctx);
      if (layers.some(l => l.id === layer.id)) bad(`Two layers are called "${layer.id}".`);
      layers.push(layer);
    } catch (error) {
      if (!ctx.lenient) throw error;
      ctx.warn?.(`Dropped a layer: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { layers };
}

/** The next free layer id on a board for a layer of `kind` (`window1`, `mark2`). */
export function nextLayerId(board: ArtBoard | undefined, kind: ArtLayerKind): string {
  const taken = new Set((board?.layers ?? []).map(l => l.id));
  for (let n = 1; ; n++) if (!taken.has(`${kind}${n}`)) return `${kind}${n}`;
}

/** The pictures and fonts the art uses, and where ("icon ground1"). */
export function artAssetUses(art: WorkArt | undefined): Map<string, string[]> {
  const uses = new Map<string, string[]>();
  const add = (asset: string | undefined, where: string) => {
    if (asset && isAssetPath(asset)) uses.set(asset, [...(uses.get(asset) ?? []), where]);
  };
  for (const board of ART_BOARDS)
    for (const layer of art?.[board]?.layers ?? []) {
      const where = `the ${board}'s ${layer.id}`;
      const fills = [
        ...(layer.kind === 'ground' ? (layer.fill ?? []) : []),
        ...('style' in layer ? (layer.style?.fill ?? []) : []),
      ];
      for (const f of fills) if (f.kind === 'image') add(f.asset, where);
      if (layer.kind === 'mark') add(layer.textStyle?.font, where);
    }
  return uses;
}

// ---- the signs of a pattern ---------------------------------------------------------------
/** The sign each kind of module gets in a pattern. */
export const SIGN_OF: Readonly<Partial<Record<Category, string>>> = {
  voice: 'dot',
  source: 'wave',
  filter: 'slope',
  envelope: 'envelope',
  modulation: 'triangle',
  fx: 'rings',
  dynamics: 'bars',
  code: 'diamond',
  part: 'hexagon',
};
export interface Sign {
  sign: string;
  category: Category;
}
/**
 * The patch as a row of signs: the modules of the main patch that make or shape the
 * sound, left to right as the patch is laid out, each as many times as it runs
 * (×N, up to 16). Inputs, outputs, controls, arithmetic and comments are left out.
 */
export function patchSigns(doc: PatchDocument, catalog: Catalog): Sign[] {
  const nodes = Object.values(doc.nodes)
    .filter(n => n.inside === undefined)
    .map(n => ({ n, def: catalog.find(n.type) }))
    .filter(({ def }) => def && SIGN_OF[def.category] && def.kind !== 'comment')
    .sort((a, b) => a.n.pos.x - b.n.pos.x || a.n.pos.y - b.n.pos.y);
  const signs: Sign[] = [];
  for (const { n, def } of nodes)
    for (let i = 0; i < Math.min(16, n.count ?? 1) && signs.length < 96; i++)
      signs.push({ sign: SIGN_OF[def!.category]!, category: def!.category });
  return signs;
}

// ---- starting points ---------------------------------------------------------------------
export const RECIPES = ['window', 'specimen', 'pattern'] as const;
export type Recipe = (typeof RECIPES)[number];
export const RECIPE_TITLE: Readonly<Record<Recipe, string>> = {
  window: 'Window',
  specimen: 'Specimen',
  pattern: 'Pattern',
};
export const RECIPE_DOC: Readonly<Record<Recipe, string>> = {
  window: 'A window onto the plugin screen, close on its most telling piece.',
  specimen: "The plugin's most telling piece in a round window, on the plugin's own ground.",
  pattern: "The patch's modules as a repeating pattern in the work's colours, with its initial.",
};

/**
 * The plugin's most telling piece, in plugin pixels: its biggest control or picture
 * (a keyboard, a slider or text counts for less; backdrops that cover half the plugin
 * do not count), or the whole plugin when it has none.
 */
export function telling(doc: PatchDocument, catalog: Catalog): Rect {
  const W = doc.panel.width,
    H = doc.panel.height;
  let best: { rect: Rect; score: number } | null = null;
  const consider = (rect: Rect, weight: number, cap: number) => {
    const area = rect.w * rect.h;
    if (!weight || area > W * H * cap) return;
    const score = area * weight;
    if (!best || score > best.score) best = { rect, score };
  };
  for (const n of Object.values(doc.nodes)) {
    if (!n.panel || n.inside !== undefined || catalog.find(n.type)?.kind !== 'widget') continue;
    consider(
      n.panel,
      n.type === 'ui.keyboard'
        ? 0.2
        : n.type === 'ui.slider'
          ? 0.6
          : n.type === 'ui.meter'
            ? 0.8
            : 1,
      0.5,
    );
  }
  const WEIGHT: Record<string, number> = {
    image: 0.9,
    svg: 0.9,
    canvas: 0.9,
    code: 0.9,
    led: 0.5,
    text: 0.3,
  };
  for (const el of Object.values(doc.ui.elements))
    if (!el.hidden) consider(el.rect, WEIGHT[el.kind] ?? 0, 0.45);
  return best ? (best as { rect: Rect }).rect : { x: 0, y: 0, w: W, h: H };
}

const centre = (r: Rect): XY => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const round = (v: number) => Math.round(v * 100) / 100;
/** The work's initial (its first letter or digit), for a mark. */
export function initialOf(name: string): string {
  return (name.match(/[\p{L}\p{N}]/u)?.[0] ?? 'd').toUpperCase();
}

/** The layers a board starts with from `recipe`, drawn from the work. */
export function startArt(
  doc: PatchDocument,
  catalog: Catalog,
  recipe: Recipe,
  board: ArtBoardId,
): ArtLayer[] {
  const { w: BW, h: BH } = BOARD_SIZE[board];
  const piece = telling(doc, catalog);
  const W = doc.panel.width,
    H = doc.panel.height;
  const closeOn = (size: number, share: number) => ({
    focus: centre(piece),
    zoom: round(Math.min(8, Math.max(0.2, (share * size) / Math.max(piece.w, piece.h)))),
  });
  const shadow = { x: 0, y: board === 'icon' ? 10 : 18, blur: board === 'icon' ? 28 : 48 };
  const porthole = (rect: Rect): ElementStyle => ({
    radius: rect.w / 2,
    stroke: { color: 'accent', width: board === 'icon' ? 6 : 8, style: 'solid' },
    shadows: [{ ...shadow, spread: 0, color: 'rgba(0,0,0,0.45)', inset: false }],
  });
  switch (recipe) {
    case 'window':
      return board === 'icon'
        ? [
            {
              id: 'window1',
              kind: 'window',
              rect: { x: 0, y: 0, w: BW, h: BH },
              ...closeOn(BW, 0.7),
            },
          ]
        : [
            {
              id: 'window1',
              kind: 'window',
              rect: { x: 0, y: 0, w: BW, h: BH },
              focus: { x: W / 2, y: H / 2 },
              zoom: round(Math.max(BW / W, BH / H)),
            },
          ];
    case 'specimen': {
      const rect =
        board === 'icon' ? { x: 76, y: 76, w: 360, h: 360 } : { x: 900, y: 150, w: 600, h: 600 };
      const layers: ArtLayer[] = [
        { id: 'ground1', kind: 'ground' },
        { id: 'window1', kind: 'window', rect, ...closeOn(rect.w, 0.8), style: porthole(rect) },
      ];
      if (board === 'cover')
        layers.push({
          id: 'mark1',
          kind: 'mark',
          rect: { x: 110, y: 300, w: 720, h: 300 },
          text: doc.name,
          textStyle: {
            font: 'font',
            size: 112,
            weight: 700,
            color: 'fg',
            align: 'left',
            lineHeight: 1,
          },
        });
      return layers;
    }
    case 'pattern': {
      const colors = ['accent', 'fg', 'muted', 'knob'];
      const layers: ArtLayer[] = [
        { id: 'ground1', kind: 'ground', fill: [{ kind: 'color', color: 'bg' }] },
        {
          id: 'pattern1',
          kind: 'pattern',
          rect: { x: 0, y: 0, w: BW, h: BH },
          repeat: 'grid',
          scale: board === 'icon' ? 1 : 1.4,
          colors,
        },
      ];
      layers.push(
        board === 'icon'
          ? {
              id: 'mark1',
              kind: 'mark',
              rect: { x: 151, y: 151, w: 210, h: 210 },
              text: initialOf(doc.name),
              textStyle: { font: 'font', size: 150, weight: 700, color: 'bg' },
              style: { fill: [{ kind: 'color', color: 'accent' }], radius: 105 },
            }
          : {
              id: 'mark1',
              kind: 'mark',
              rect: { x: 0, y: 330, w: BW, h: 240 },
              text: doc.name,
              textStyle: { font: 'font', size: 112, weight: 700, color: 'fg' },
              style: { fill: [{ kind: 'color', color: 'bg', opacity: 0.88 }] },
            },
      );
      return layers;
    }
  }
}

/** What stands for a board its author has not made: the whole plugin, fitted, on its own ground. */
export function fallbackArt(doc: PatchDocument, board: ArtBoardId): ArtLayer[] {
  const { w: BW, h: BH } = BOARD_SIZE[board];
  const W = doc.panel.width,
    H = doc.panel.height;
  return [
    { id: 'ground1', kind: 'ground' },
    {
      id: 'window1',
      kind: 'window',
      rect: { x: 0, y: 0, w: BW, h: BH },
      focus: { x: W / 2, y: H / 2 },
      zoom: round(Math.min(BW / W, BH / H)),
    },
  ];
}

/**
 * Another work's ground, to put on this work's art: its background (or its bg colour when it
 * has none), with its colour tokens turned into that work's colours. Pictures keep their asset
 * paths: they must be added to this work too.
 */
export function groundOf(source: PatchDocument): Fill[] {
  const tokens: Record<string, string> = {
    ...(THEME_TOKENS[source.panel.theme] ?? THEME_TOKENS.graphite),
    ...source.ui.look.tokens,
  };
  const own = (c: string) =>
    (COLOR_TOKENS as readonly string[]).includes(c) ? tokens[c as ColorToken]! : c;
  const list = source.ui.look.background?.length
    ? clone(source.ui.look.background)
    : [{ kind: 'color' as const, color: 'bg' }];
  return list.map(f =>
    f.kind === 'color'
      ? { ...f, color: own(f.color) }
      : f.kind === 'linear' || f.kind === 'radial'
        ? { ...f, stops: f.stops.map(s => ({ ...s, color: own(s.color) })) }
        : f,
  );
}

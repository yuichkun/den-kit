// The work's art: its icon and its cover, two surfaces of their own that show the work where it
// is listed. Each holds the same kinds of things as the plugin's decorations (text, shapes,
// pictures, SVG) plus symbols, the shape of one of the patch's modules, on a background of its
// own. Colours and fonts may name the look's tokens, so the art follows the work's look. Art is
// part of the document: the same operations change it for people and the AI (ops.ts, with
// `on`), and it undoes and saves like the rest. Pure data: no DOM, no Vue.
import { moduleShape } from './module-shape.ts';
import type { ConfigValue, PatchNode, Value } from './schema.ts';
import {
  FONT_TOKENS,
  FONTS,
  LIMITS,
  UiCheckError,
  checkColor,
  checkElement,
  checkFill,
  checkRect,
  checkStyle,
  isAssetPath,
  type CheckContext,
  type ElementStyle,
  type Fill,
  type ImageElement,
  type Rect,
  type ShapeElement,
  type SvgElement,
  type TextElement,
} from './ui.ts';

export const ART_SURFACES = ['icon', 'cover'] as const;
export type ArtSurfaceName = (typeof ART_SURFACES)[number];
/** Each surface's design size: an icon is square, a cover is wide (16:9). */
export const ART_SIZE: Readonly<Record<ArtSurfaceName, { width: number; height: number }>> = {
  icon: { width: 512, height: 512 },
  cover: { width: 1280, height: 720 },
};
export const ART_KINDS = ['text', 'shape', 'image', 'svg', 'symbol'] as const;
export type ArtKind = (typeof ART_KINDS)[number];
export const ART_LIMITS = { elements: 100 } as const;

/** What a symbol draws: a module's type and settings when it was drawn. */
export interface SymbolModule {
  type: string;
  config: Record<string, ConfigValue>;
  values: Record<string, Value>;
}
/**
 * A symbol: the shape of one of the patch's modules (an envelope's curve, a filter's response,
 * an oscillator's wave), drawn as a line. It keeps what it drew, so moving a knob later does not
 * change the art; setting `node` again draws the module as it is then.
 */
export interface SymbolElement {
  kind: 'symbol';
  id: string;
  rect: Rect;
  name?: string;
  /** The box behind the line (a fill, a radius for a round frame, a border). */
  style?: ElementStyle;
  locked?: boolean;
  hidden?: boolean;
  /** The module it was drawn from. */
  node: string;
  module: SymbolModule;
  /** The line's colour: a token or a colour (default: accent). */
  ink?: string;
  /** The line's width, in % of the symbol's width (default: 4). */
  weight?: number;
}
export type ArtElement =
  | Omit<TextElement, 'bind'>
  | ShapeElement
  | ImageElement
  | SvgElement
  | SymbolElement;

export interface ArtSurface {
  /** Layers, bottom to top; absent: the look's background colour (bg). */
  background?: Fill[];
  elements: Record<string, ArtElement>;
  /** Back to front. Elements missing here are drawn on top. */
  order: string[];
}
export interface WorkArt {
  icon?: ArtSurface;
  cover?: ArtSurface;
}

export const emptySurface = (): ArtSurface => ({ elements: {}, order: [] });
export const isSurfaceName = (v: unknown): v is ArtSurfaceName =>
  (ART_SURFACES as readonly unknown[]).includes(v);
/** The surface's elements, back to front. */
export function artStack(surface: ArtSurface): ArtElement[] {
  const ids = surface.order.filter(id => surface.elements[id]);
  for (const id of Object.keys(surface.elements)) if (!ids.includes(id)) ids.push(id);
  return ids.map(id => surface.elements[id]!);
}
/** A free id on the surface, like `text2`. */
export function nextArtId(surface: ArtSurface | undefined, stem: string): string {
  for (let n = 1; ; n++) {
    const id = `${stem}${n}`;
    if (!surface?.elements[id]) return id;
  }
}

const SYMBOL_FIELDS = ['node', 'module', 'ink', 'weight'];
const KIND_FIELDS: Record<ArtKind, string[]> = {
  text: ['text', 'textStyle'],
  shape: ['shape'],
  image: ['asset', 'fit'],
  svg: ['svg'],
  symbol: SYMBOL_FIELDS,
};
/** The fields updateElement may change on an element of the art. */
export const ART_FIELDS = (kind: ArtKind) => [
  'rect',
  'name',
  'style',
  'locked',
  'hidden',
  ...KIND_FIELDS[kind],
];

const bad = (code: string, message: string, hint?: string): never => {
  throw new UiCheckError(code, message, hint);
};
const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** What a symbol of this module draws now. */
export function symbolModule(node: PatchNode): SymbolModule {
  return {
    type: node.type,
    config: JSON.parse(JSON.stringify(node.config)) as Record<string, ConfigValue>,
    values: JSON.parse(JSON.stringify(node.values)) as Record<string, Value>,
  };
}
function checkModule(v: unknown): SymbolModule {
  if (!isObj(v) || typeof v.type !== 'string' || !/^[a-z]+\.[a-zA-Z0-9]{1,48}$/.test(v.type))
    bad('bad-element', 'A symbol draws a module: give its id as node.');
  const record = <T>(r: unknown, ok: (x: unknown) => x is T): Record<string, T> => {
    if (r === undefined) return {};
    if (!isObj(r)) bad('bad-element', 'A symbol’s module settings are a record.');
    const out: Record<string, T> = {};
    for (const [k, x] of Object.entries(r as Record<string, unknown>))
      if (/^[a-zA-Z][a-zA-Z0-9]{0,31}$/.test(k) && ok(x)) out[k] = x;
    return out;
  };
  const m = v as Record<string, unknown>;
  return {
    type: m.type as string,
    config: record(
      m.config,
      (x): x is ConfigValue =>
        (typeof x === 'string' && x.length <= 200) ||
        typeof x === 'boolean' ||
        (typeof x === 'number' && Number.isFinite(x)),
    ),
    values: record(
      m.values,
      (x): x is Value => typeof x === 'boolean' || (typeof x === 'number' && Number.isFinite(x)),
    ),
  };
}

/** Does this module have a shape a symbol can draw? */
export const drawable = (node: Pick<PatchNode, 'type' | 'config' | 'values'>) =>
  moduleShape(node, 100, 100) !== null;

/** Check (and normalise) one element of the art. A symbol needs `module` (ops.ts fills it from `node` when the element is added or `node` is set). */
export function checkArtElement(v: unknown, ctx: CheckContext): ArtElement {
  if (!isObj(v)) bad('bad-element', 'An element is an object with a kind.');
  const e = v as Record<string, unknown>;
  if (!(ART_KINDS as readonly unknown[]).includes(e.kind))
    bad(
      'bad-element',
      `The icon and the cover hold text, shapes, pictures, SVG and symbols, not ${JSON.stringify(e.kind ?? null)}.`,
      'Lamps, canvases and code parts belong on the plugin.',
    );
  if (e.kind !== 'symbol') {
    if (e.bind !== undefined)
      bad(
        'bad-element',
        'Text on the icon or the cover cannot show a control: the art does not play.',
      );
    return checkElement(e, { ...ctx, nodes: {} }) as ArtElement;
  }
  const known = ['id', 'kind', 'rect', 'name', 'style', 'locked', 'hidden', ...SYMBOL_FIELDS];
  for (const key of Object.keys(e))
    if (!known.includes(key))
      bad('bad-element', `A symbol has no "${key}".`, `Fields: ${known.join(', ')}.`);
  if (typeof e.node !== 'string' || !/^[a-z][a-zA-Z0-9]{0,31}$/.test(e.node))
    bad('bad-element', 'A symbol names the module it draws: node is a module id, such as "env1".');
  const module = checkModule(e.module);
  if (!drawable(module))
    bad(
      'not-drawable',
      `${e.node} (${module.type}) has no shape to draw.`,
      'Symbols draw envelopes, oscillators, LFOs, filters, EQs, drives, delays, reverbs, flangers, phasers, dynamics and tremolos.',
    );
  const el: SymbolElement = {
    kind: 'symbol',
    id: typeof e.id === 'string' ? e.id : '',
    rect: checkRect(e.rect),
    node: e.node as string,
    module,
  };
  if (e.name !== undefined) {
    if (typeof e.name !== 'string' || e.name.length > 80)
      bad('bad-value', 'name is text of up to 80 characters.');
    el.name = e.name as string;
  }
  if (e.style !== undefined) el.style = checkStyle(e.style, ctx);
  if (e.locked !== undefined) el.locked = e.locked === true;
  if (e.hidden !== undefined) el.hidden = e.hidden === true;
  if (e.ink !== undefined) el.ink = checkColor(e.ink, 'ink');
  if (e.weight !== undefined) {
    if (typeof e.weight !== 'number' || !Number.isFinite(e.weight))
      bad('bad-value', 'weight must be a number (the line’s width in % of the symbol’s width).');
    el.weight = Math.min(20, Math.max(0.5, e.weight as number));
  }
  return el;
}

/** A surface's background: up to LIMITS.fills layers. */
export function checkBackground(v: unknown, ctx: CheckContext): Fill[] {
  if (!Array.isArray(v)) bad('bad-fill', 'background is a list of fill layers (bottom first).');
  if ((v as unknown[]).length > LIMITS.fills)
    bad('too-large', `At most ${LIMITS.fills} fill layers.`);
  return (v as unknown[]).map(f => checkFill(f, ctx));
}

/** Where the art uses each asset (pictures and fonts), in words. */
export function artAssetUses(art: WorkArt | undefined): Map<string, string[]> {
  const uses = new Map<string, string[]>();
  const add = (asset: string | undefined, where: string) => {
    if (asset && isAssetPath(asset)) uses.set(asset, [...(uses.get(asset) ?? []), where]);
  };
  for (const on of ART_SURFACES) {
    const s = art?.[on];
    if (!s) continue;
    for (const f of s.background ?? [])
      if (f.kind === 'image') add(f.asset, `the ${on}'s background`);
    for (const el of Object.values(s.elements)) {
      const where = `${el.id} on the ${on}`;
      for (const f of el.style?.fill ?? []) if (f.kind === 'image') add(f.asset, where);
      if (el.kind === 'image') add(el.asset, where);
      const font = el.kind === 'text' ? el.textStyle?.font : undefined;
      if (font && !FONTS[font] && !(FONT_TOKENS as readonly string[]).includes(font))
        add(font, where);
    }
  }
  return uses;
}

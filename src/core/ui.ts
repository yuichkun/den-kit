// The plugin's own screen beyond the widget nodes: its look (colours, fonts,
// background, control skins, CSS), the decorations that live only on the plugin
// (text, shapes, images, SVG, LEDs, canvases), their stacking order and
// groups, the reference picture laid under the editor, and the assets (pictures,
// fonts) all of these use. Pure data and checks: ops.ts edits it, persistence.ts
// loads it, the plugin renderer draws it. Every value that reaches CSS passes a
// check here first (colours, numbers, asset references), so a patch file or an
// AI edit cannot smuggle anything into the page.
import { PART_NAME } from './project.ts';
import { CONTROL_KINDS, SKINS, skinDef, type ControlKind, type Skin, type SkinParamValue } from './skins.ts';

export interface Rect { x: number; y: number; w: number; h: number }

// ---- colours and fonts --------------------------------------------------------------
export const COLOR_TOKENS = ['bg', 'fg', 'accent', 'track', 'knob', 'pointer', 'muted', 'glow'] as const;
export type ColorToken = typeof COLOR_TOKENS[number];
export const FONT_TOKENS = ['font', 'labelFont', 'valueFont'] as const;
export type FontToken = typeof FONT_TOKENS[number];
export type TokenName = ColorToken | FontToken;
export const TOKEN_DOC: Readonly<Record<TokenName, string>> = {
  bg: 'Background of the plugin.', fg: 'Text and marks.', accent: 'Values, lit things, the main colour.', track: 'Tracks, slots, pads, screens.',
  knob: 'Knob caps and fader caps.', pointer: 'Knob pointers and fader lines.', muted: 'Secondary text.', glow: 'Glows and halos.',
  font: 'Text in general.', labelFont: 'Control labels.', valueFont: 'Value readouts.',
};
/** The CSS custom property a token is published as (inherited into every control). */
export const tokenVar = (t: TokenName) => `--dk-${t.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`;

const NAMED_COLORS = new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen transparent').split(' '));
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNC = /^(?:rgba?|hsla?)\([0-9.,%\s/deg+-]{1,64}\)$/i;
/** A token name, a hex colour, rgb()/hsl() with plain numbers, or a CSS colour name. */
export function isColor(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 80 && ((COLOR_TOKENS as readonly string[]).includes(v) || HEX.test(v) || FUNC.test(v) || NAMED_COLORS.has(v.toLowerCase()));
}
export const cssColor = (c: string) => (COLOR_TOKENS as readonly string[]).includes(c) ? `var(${tokenVar(c as ColorToken)})` : c;

/** Built-in fonts: OFL fonts bundled with den-kit, plus system stacks. A font asset can be used by its id too. */
export const FONTS: Readonly<Record<string, { title: string; stack: string; doc: string }>> = {
  lato: { title: 'Lato', stack: 'Lato, system-ui, sans-serif', doc: 'Plain, clean sans.' },
  system: { title: 'System', stack: 'system-ui, -apple-system, "Segoe UI", sans-serif', doc: 'The computer\'s own sans.' },
  serif: { title: 'Serif', stack: 'Georgia, "Times New Roman", serif', doc: 'Book serif.' },
  mono: { title: 'Mono', stack: 'ui-monospace, Menlo, Consolas, monospace', doc: 'The computer\'s monospace.' },
  caveat: { title: 'Caveat', stack: '"Caveat", cursive', doc: 'Handwriting, a quick pen.' },
  kalam: { title: 'Kalam', stack: '"Kalam", cursive', doc: 'Handwriting, a felt marker.' },
  'jetbrains-mono': { title: 'JetBrains Mono', stack: '"JetBrains Mono", ui-monospace, monospace', doc: 'Technical monospace.' },
  'share-tech-mono': { title: 'Share Tech Mono', stack: '"Share Tech Mono", ui-monospace, monospace', doc: 'Instrument readout monospace.' },
  oswald: { title: 'Oswald', stack: '"Oswald", "Arial Narrow", sans-serif', doc: 'Condensed sans for bold labels.' },
  'bebas-neue': { title: 'Bebas Neue', stack: '"Bebas Neue", "Arial Narrow", sans-serif', doc: 'Tall all-caps display.' },
  cinzel: { title: 'Cinzel', stack: '"Cinzel", Georgia, serif', doc: 'Engraved classical capitals.' },
  'playfair-display': { title: 'Playfair Display', stack: '"Playfair Display", Georgia, serif', doc: 'High-contrast elegant serif.' },
  fredoka: { title: 'Fredoka', stack: '"Fredoka", system-ui, sans-serif', doc: 'Round and friendly.' },
  'baloo-2': { title: 'Baloo 2', stack: '"Baloo 2", system-ui, sans-serif', doc: 'Chunky and playful.' },
  orbitron: { title: 'Orbitron', stack: '"Orbitron", system-ui, sans-serif', doc: 'Geometric sci-fi.' },
  monoton: { title: 'Monoton', stack: '"Monoton", system-ui, sans-serif', doc: 'Multi-line neon capitals (headlines only).' },
  michroma: { title: 'Michroma', stack: '"Michroma", system-ui, sans-serif', doc: 'Wide 1970s technical.' },
  'courier-prime': { title: 'Courier Prime', stack: '"Courier Prime", "Courier New", monospace', doc: 'Typewriter.' },
  'saira-stencil-one': { title: 'Saira Stencil', stack: '"Saira Stencil One", system-ui, sans-serif', doc: 'Industrial stencil.' },
};
/** CSS font-family for a font reference (token, built-in font, or font asset). */
export function fontStack(font: string | undefined): string {
  if (!font) return `var(${tokenVar('font')})`;
  if ((FONT_TOKENS as readonly string[]).includes(font)) return `var(${tokenVar(font as FontToken)})`;
  if (FONTS[font]) return FONTS[font]!.stack;
  return `"${assetFontFamily(font)}", system-ui, sans-serif`;
}
export const assetFontFamily = (assetId: string) => `dk-asset-${assetId}`;

// ---- assets -----------------------------------------------------------------------------
export const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'] as const;
export const FONT_MIMES = ['font/woff2', 'font/woff', 'font/ttf', 'font/otf'] as const;
export const ASSET_ID_PATTERN = /^[a-z][a-z0-9-]{1,47}$/;
export const MAX_ASSET_BYTES = 8 * 1024 * 1024;
export interface AssetSource { title?: string; author?: string; url?: string; license?: string }
export interface AssetMeta {
  id: string;
  name: string;
  mime: string;
  bytes: number;
  width?: number;
  height?: number;
  /** Bundled with den-kit (served at this path); user assets live in the browser's store under their id. */
  url?: string;
  /** Where it came from and under which licence (shown in the asset panel, kept on export). */
  source?: AssetSource;
}
export const isImageAsset = (a: AssetMeta | undefined) => !!a && (IMAGE_MIMES as readonly string[]).includes(a.mime);
export const isFontAsset = (a: AssetMeta | undefined) => !!a && (FONT_MIMES as readonly string[]).includes(a.mime);

// ---- fills, styles, text --------------------------------------------------------------
export const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'soft-light', 'hard-light', 'lighten', 'darken', 'color-dodge', 'color-burn', 'difference', 'luminosity'] as const;
export type BlendMode = typeof BLEND_MODES[number];
export interface Stop { color: string; at: number }
interface FillCommon { opacity?: number; blend?: BlendMode }
export type Fill = FillCommon & (
  | { kind: 'color'; color: string }
  | { kind: 'linear'; angle: number; stops: Stop[] }
  | { kind: 'radial'; x: number; y: number; stops: Stop[] }
  | { kind: 'image'; asset: string; fit: 'cover' | 'contain' | 'stretch' | 'tile'; size?: number }
);
export interface Shadow { x: number; y: number; blur: number; spread: number; color: string; inset: boolean }
export interface ElementStyle {
  /** Layers, bottom to top (colour, gradients, pictures). */
  fill?: Fill[];
  stroke?: { color: string; width: number; style: 'solid' | 'dashed' | 'dotted' };
  radius?: number;
  opacity?: number;
  /** Drop shadows, inner shadows and glows (a glow is a shadow with no offset). */
  shadows?: Shadow[];
  rotate?: number;
  blend?: BlendMode;
  blur?: number;
}
export interface TextShadow { x: number; y: number; blur: number; color: string }
export interface TextStyle {
  /** A font token (font, labelFont, valueFont), a built-in font id, or a font asset id. */
  font?: string;
  size?: number;
  weight?: number;
  color?: string;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  /** Letter spacing in em. */
  spacing?: number;
  lineHeight?: number;
  case?: 'none' | 'upper' | 'lower';
  italic?: boolean;
  shadows?: TextShadow[];
  stroke?: { color: string; width: number };
}

// ---- elements -----------------------------------------------------------------------------
export const ELEMENT_KINDS = ['text', 'shape', 'image', 'svg', 'led', 'canvas', 'code'] as const;
export type ElementKind = typeof ELEMENT_KINDS[number];
interface ElementBase { id: string; rect: Rect; name?: string; style?: ElementStyle; locked?: boolean; hidden?: boolean }
/** Text. With `bind` it shows that control's value: `{value}` in the text is replaced by it (e.g. "CUTOFF {value}"). */
export interface TextElement extends ElementBase { kind: 'text'; text: string; textStyle?: TextStyle; bind?: string }
export interface ShapeElement extends ElementBase { kind: 'shape'; shape: 'rect' | 'ellipse' | 'line' }
export interface ImageElement extends ElementBase { kind: 'image'; asset: string; fit: 'cover' | 'contain' | 'stretch' }
export interface SvgElement extends ElementBase { kind: 'svg'; svg: string }
/** A lamp: on while the bound control is on (or above `threshold`), or with `@level` while sound comes out. */
export interface LedElement extends ElementBase { kind: 'led'; bind: string; color: string; threshold: number }
/** A canvas: code that draws every frame (runs in a worker) and may take the mouse. (Files before U5 called it a custom part, kind "part".) */
export interface CanvasElement extends ElementBase { kind: 'canvas'; code: string; props: Record<string, string | number | boolean> }
/** A code part: a part of the screen's web project (src/parts/<part>.ts), shown in its box, with its own settings. */
export interface CodeElement extends ElementBase { kind: 'code'; part: string; props: Record<string, string | number | boolean> }
export type UiElement = TextElement | ShapeElement | ImageElement | SvgElement | LedElement | CanvasElement | CodeElement;

/** How one widget node looks (its own overrides on top of the plugin's look). */
export interface WidgetStyle {
  skin?: Skin;
  /** The box behind the control. */
  style?: ElementStyle;
  /** Colour tokens for this control only. */
  tokens?: Partial<Record<ColorToken, string>>;
  /** Label and value text. */
  textStyle?: TextStyle;
}

export interface Look {
  tokens: Partial<Record<TokenName, string>>;
  background?: Fill[];
  /** Default skin per control kind. */
  skins: Partial<Record<ControlKind, Skin>>;
  /** Plugin-wide CSS, scoped to the plugin. Only url(asset:ID) may load anything. */
  css?: string;
}
export interface Underlay { asset: string; opacity: number; visible: boolean }
export interface PluginUi {
  look: Look;
  elements: Record<string, UiElement>;
  /** Stacking order, back to front: element ids and widget node ids. Anything on the plugin that is missing here is drawn on top, in patch order. */
  order: string[];
  /** Group id → members (element or widget node ids). An id belongs to one group at most. */
  groups: Record<string, string[]>;
  /** A reference picture shown under the plugin while editing (never in play). */
  underlay?: Underlay;
  /** The design brief: the idea, palette, type and layout in a few lines, written by the person or the AI, kept to on later edits. */
  brief?: string;
}
export const emptyUi = (): PluginUi => ({ look: { tokens: {}, skins: {} }, elements: {}, order: [], groups: {} });

export const LIMITS = { elements: 500, text: 2000, svg: 200_000, code: 64_000, css: 32_000, fills: 8, stops: 16, shadows: 6, props: 32, brief: 2000 } as const;

// ---- checks ---------------------------------------------------------------------------------
export class UiCheckError extends Error {
  readonly code: string;
  readonly hint?: string;
  constructor(code: string, message: string, hint?: string) { super(message); this.name = 'UiCheckError'; this.code = code; this.hint = hint; }
}
function bad(code: string, message: string, hint?: string): never { throw new UiCheckError(code, message, hint); }

export interface CheckContext {
  assets: Readonly<Record<string, AssetMeta>>;
  /** Ids that a bind may point at (widget nodes). */
  nodes: Readonly<Record<string, unknown>>;
  /** Loading a file: keep references to missing assets or controls (reported through `warn`) instead of refusing. */
  lenient?: boolean;
  warn?(message: string): void;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function num(v: unknown, min: number, max: number, what: string, fallback?: number): number {
  if (v === undefined && fallback !== undefined) return fallback;
  if (typeof v !== 'number' || !Number.isFinite(v)) bad('bad-value', `${what} must be a number.`);
  return Math.min(max, Math.max(min, v as number));
}
function str(v: unknown, max: number, what: string): string {
  if (typeof v !== 'string') bad('bad-value', `${what} must be text.`);
  if ((v as string).length > max) bad('too-large', `${what} is limited to ${max} characters.`);
  return v as string;
}
function oneOf<T extends string>(v: unknown, options: readonly T[], what: string, fallback?: T): T {
  if (v === undefined && fallback !== undefined) return fallback;
  if (!(options as readonly unknown[]).includes(v)) bad('bad-value', `${what} must be one of ${options.join(', ')}.`);
  return v as T;
}
export function checkColor(v: unknown, what = 'colour'): string {
  if (!isColor(v)) bad('bad-color', `${what} ${JSON.stringify(v)} is not a colour.`, `Use a token (${COLOR_TOKENS.join(', ')}), #rrggbb, rgb()/hsl() or a CSS colour name.`);
  return v as string;
}
function checkAssetRef(v: unknown, ctx: CheckContext, what: string, kind: 'image' | 'font' = 'image'): string {
  if (typeof v !== 'string' || !ASSET_ID_PATTERN.test(v)) bad('bad-asset', `${what} must be an asset id.`);
  const asset = ctx.assets[v as string];
  if (!asset) {
    if (ctx.lenient) { ctx.warn?.(`${what}: asset "${v}" is missing.`); return v as string; }
    bad('unknown-asset', `No asset "${v}".`, Object.keys(ctx.assets).length ? `Assets: ${Object.keys(ctx.assets).join(', ')}` : 'Add the picture to the assets first.');
  }
  if (asset && (kind === 'image' ? !isImageAsset(asset) : !isFontAsset(asset))) bad('bad-asset', `${what}: asset "${v}" is not ${kind === 'image' ? 'a picture' : 'a font'}.`);
  return v as string;
}
export function checkFont(v: unknown, ctx: CheckContext, what = 'font'): string {
  if (typeof v === 'string' && ((FONT_TOKENS as readonly string[]).includes(v) || FONTS[v])) return v;
  if (typeof v === 'string' && ASSET_ID_PATTERN.test(v) && (ctx.assets[v] || ctx.lenient)) return checkAssetRef(v, ctx, what, 'font');
  return bad('bad-font', `${what} ${JSON.stringify(v)} is not a font.`, `Fonts: ${Object.keys(FONTS).join(', ')}, a font token (${FONT_TOKENS.join(', ')}) or a font asset id.`);
}
function checkStops(v: unknown): Stop[] {
  if (!Array.isArray(v) || v.length < 2 || v.length > LIMITS.stops) bad('bad-fill', `A gradient needs 2–${LIMITS.stops} stops.`);
  return (v as unknown[]).map((s, i) => { if (!isObj(s)) bad('bad-fill', 'A gradient stop is {color, at}.'); return { color: checkColor(s.color, `stop ${i + 1}`), at: num(s.at, 0, 1, 'stop position', i / ((v as unknown[]).length - 1)) }; });
}
export function checkFill(v: unknown, ctx: CheckContext): Fill {
  if (!isObj(v)) bad('bad-fill', 'A fill is an object with a kind (color, linear, radial, image).');
  const f = v as Record<string, unknown>;
  const common: FillCommon = {};
  if (f.opacity !== undefined) common.opacity = num(f.opacity, 0, 1, 'fill opacity');
  if (f.blend !== undefined) common.blend = oneOf(f.blend, BLEND_MODES, 'blend');
  switch (f.kind) {
    case 'color': return { kind: 'color', color: checkColor(f.color), ...common };
    case 'linear': return { kind: 'linear', angle: num(f.angle, -360, 360, 'gradient angle', 180), stops: checkStops(f.stops), ...common };
    case 'radial': return { kind: 'radial', x: num(f.x, 0, 1, 'gradient centre x', 0.5), y: num(f.y, 0, 1, 'gradient centre y', 0.5), stops: checkStops(f.stops), ...common };
    case 'image': {
      const fill: Fill = { kind: 'image', asset: checkAssetRef(f.asset, ctx, 'fill image'), fit: oneOf(f.fit, ['cover', 'contain', 'stretch', 'tile'] as const, 'fit', 'cover'), ...common };
      if (f.size !== undefined) fill.size = num(f.size, 4, 4000, 'tile size');
      return fill;
    }
    default: return bad('bad-fill', `Unknown fill kind ${JSON.stringify(f.kind)}.`, 'Kinds: color, linear, radial, image.');
  }
}
function checkFills(v: unknown, ctx: CheckContext): Fill[] {
  if (!Array.isArray(v)) bad('bad-fill', 'fill is a list of layers (bottom first).');
  if ((v as unknown[]).length > LIMITS.fills) bad('too-large', `At most ${LIMITS.fills} fill layers.`);
  return (v as unknown[]).map(f => checkFill(f, ctx));
}
function checkShadow(v: unknown): Shadow {
  if (!isObj(v)) bad('bad-style', 'A shadow is {x, y, blur, spread, color, inset}.');
  const s = v as Record<string, unknown>;
  return { x: num(s.x, -500, 500, 'shadow x', 0), y: num(s.y, -500, 500, 'shadow y', 0), blur: num(s.blur, 0, 500, 'shadow blur', 0), spread: num(s.spread, -200, 200, 'shadow spread', 0), color: checkColor(s.color, 'shadow colour'), inset: s.inset === true };
}
export function checkStyle(v: unknown, ctx: CheckContext): ElementStyle {
  if (!isObj(v)) bad('bad-style', 'style is an object.');
  const s = v as Record<string, unknown>;
  const out: ElementStyle = {};
  for (const key of Object.keys(s)) if (!['fill', 'stroke', 'radius', 'opacity', 'shadows', 'rotate', 'blend', 'blur'].includes(key)) bad('bad-style', `Unknown style "${key}".`, 'Style keys: fill, stroke, radius, opacity, shadows, rotate, blend, blur.');
  if (s.fill !== undefined) out.fill = checkFills(s.fill, ctx);
  if (s.stroke !== undefined) {
    if (!isObj(s.stroke)) bad('bad-style', 'stroke is {color, width, style}.');
    const k = s.stroke as Record<string, unknown>;
    out.stroke = { color: checkColor(k.color, 'stroke colour'), width: num(k.width, 0, 100, 'stroke width', 1), style: oneOf(k.style, ['solid', 'dashed', 'dotted'] as const, 'stroke style', 'solid') };
  }
  if (s.radius !== undefined) out.radius = num(s.radius, 0, 4000, 'radius');
  if (s.opacity !== undefined) out.opacity = num(s.opacity, 0, 1, 'opacity');
  if (s.shadows !== undefined) {
    if (!Array.isArray(s.shadows) || s.shadows.length > LIMITS.shadows) bad('bad-style', `shadows is a list of up to ${LIMITS.shadows}.`);
    out.shadows = (s.shadows as unknown[]).map(checkShadow);
  }
  if (s.rotate !== undefined) out.rotate = num(s.rotate, -360, 360, 'rotate');
  if (s.blend !== undefined) out.blend = oneOf(s.blend, BLEND_MODES, 'blend');
  if (s.blur !== undefined) out.blur = num(s.blur, 0, 200, 'blur');
  return out;
}
export function checkTextStyle(v: unknown, ctx: CheckContext): TextStyle {
  if (!isObj(v)) bad('bad-style', 'textStyle is an object.');
  const s = v as Record<string, unknown>;
  const out: TextStyle = {};
  for (const key of Object.keys(s)) if (!['font', 'size', 'weight', 'color', 'align', 'valign', 'spacing', 'lineHeight', 'case', 'italic', 'shadows', 'stroke'].includes(key)) bad('bad-style', `Unknown text style "${key}".`, 'Text style keys: font, size, weight, color, align, valign, spacing, lineHeight, case, italic, shadows, stroke.');
  if (s.font !== undefined) out.font = checkFont(s.font, ctx);
  if (s.size !== undefined) out.size = num(s.size, 4, 600, 'text size');
  if (s.weight !== undefined) out.weight = Math.round(num(s.weight, 100, 900, 'weight') / 100) * 100;
  if (s.color !== undefined) out.color = checkColor(s.color, 'text colour');
  if (s.align !== undefined) out.align = oneOf(s.align, ['left', 'center', 'right'] as const, 'align');
  if (s.valign !== undefined) out.valign = oneOf(s.valign, ['top', 'middle', 'bottom'] as const, 'valign');
  if (s.spacing !== undefined) out.spacing = num(s.spacing, -0.5, 3, 'letter spacing');
  if (s.lineHeight !== undefined) out.lineHeight = num(s.lineHeight, 0.5, 4, 'line height');
  if (s.case !== undefined) out.case = oneOf(s.case, ['none', 'upper', 'lower'] as const, 'case');
  if (s.italic !== undefined) out.italic = s.italic === true;
  if (s.shadows !== undefined) {
    if (!Array.isArray(s.shadows) || s.shadows.length > LIMITS.shadows) bad('bad-style', `text shadows is a list of up to ${LIMITS.shadows}.`);
    out.shadows = (s.shadows as unknown[]).map(x => { if (!isObj(x)) bad('bad-style', 'A text shadow is {x, y, blur, color}.'); const t = x as Record<string, unknown>; return { x: num(t.x, -200, 200, 'shadow x', 0), y: num(t.y, -200, 200, 'shadow y', 0), blur: num(t.blur, 0, 200, 'shadow blur', 0), color: checkColor(t.color, 'text shadow colour') }; });
  }
  if (s.stroke !== undefined) {
    if (!isObj(s.stroke)) bad('bad-style', 'text stroke is {color, width}.');
    const k = s.stroke as Record<string, unknown>;
    out.stroke = { color: checkColor(k.color, 'text stroke colour'), width: num(k.width, 0, 20, 'text stroke width', 1) };
  }
  return out;
}
export function checkSkin(control: ControlKind, v: unknown, ctx: CheckContext): Skin {
  if (!isObj(v) || typeof v.name !== 'string') bad('bad-skin', 'A skin is {name, params}.');
  const s = v as { name: string; params?: unknown };
  const def = skinDef(control, s.name);
  if (!def) return bad('bad-skin', `A ${control} has no skin "${s.name}".`, `Skins: ${CONTROL_SKIN_NAMES(control)}.`);
  const params: Record<string, SkinParamValue> = {};
  if (s.params !== undefined) {
    if (!isObj(s.params)) bad('bad-skin', 'skin params is an object.');
    for (const [key, value] of Object.entries(s.params as Record<string, unknown>)) {
      const p = def.params.find(x => x.id === key);
      if (!p) bad('bad-skin', `Skin ${def.name} has no parameter "${key}".`, `Parameters: ${def.params.map(x => x.id).join(', ') || 'none'}.`);
      switch (p!.kind) {
        case 'number': params[key] = num(value, p!.min ?? -1e6, p!.max ?? 1e6, `${def.name}.${key}`); break;
        case 'color': params[key] = checkColor(value, `${def.name}.${key}`); break;
        case 'enum': params[key] = oneOf(value, p!.options as readonly string[], `${def.name}.${key}`); break;
        case 'boolean': if (typeof value !== 'boolean') bad('bad-skin', `${def.name}.${key} is true or false.`); params[key] = value as boolean; break;
        case 'asset': params[key] = value === '' ? '' : checkAssetRef(value, ctx, `${def.name}.${key}`); break;
        case 'text': params[key] = str(value, 200, `${def.name}.${key}`); break;
      }
    }
  }
  return Object.keys(params).length ? { name: def.name, params } : { name: def.name };
}
const CONTROL_SKIN_NAMES = (control: ControlKind) => SKINS.filter(s => s.control === control).map(s => s.name).join(', ');

function checkTokens(v: unknown, ctx: CheckContext, fonts: boolean): Partial<Record<TokenName, string>> {
  if (!isObj(v)) bad('bad-look', 'tokens is an object.');
  const out: Partial<Record<TokenName, string>> = {};
  for (const [key, value] of Object.entries(v as Record<string, unknown>)) {
    if ((COLOR_TOKENS as readonly string[]).includes(key)) out[key as ColorToken] = checkColor(value, `token ${key}`);
    else if (fonts && (FONT_TOKENS as readonly string[]).includes(key)) { if ((FONT_TOKENS as readonly string[]).includes(value as string)) bad('bad-font', `token ${key} cannot point at another font token.`); out[key as FontToken] = checkFont(value, ctx, `token ${key}`); }
    else bad('bad-look', `Unknown token "${key}".`, `Tokens: ${[...COLOR_TOKENS, ...(fonts ? FONT_TOKENS : [])].join(', ')}.`);
  }
  return out;
}
export function checkWidgetStyle(control: ControlKind, v: unknown, ctx: CheckContext): WidgetStyle {
  if (!isObj(v)) bad('bad-style', 'A widget style is {skin, style, tokens, textStyle}.');
  const s = v as Record<string, unknown>;
  for (const key of Object.keys(s)) if (!['skin', 'style', 'tokens', 'textStyle'].includes(key)) bad('bad-style', `Unknown widget style "${key}".`, 'Keys: skin, style, tokens, textStyle.');
  const out: WidgetStyle = {};
  if (s.skin !== undefined) out.skin = checkSkin(control, s.skin, ctx);
  if (s.style !== undefined) out.style = checkStyle(s.style, ctx);
  if (s.tokens !== undefined) out.tokens = checkTokens(s.tokens, ctx, false) as Partial<Record<ColorToken, string>>;
  if (s.textStyle !== undefined) out.textStyle = checkTextStyle(s.textStyle, ctx);
  return out;
}
export function checkLook(v: unknown, ctx: CheckContext): Look {
  if (!isObj(v)) bad('bad-look', 'The look is {tokens, background, skins, css}.');
  const s = v as Record<string, unknown>;
  for (const key of Object.keys(s)) if (!['tokens', 'background', 'skins', 'css'].includes(key)) bad('bad-look', `Unknown look key "${key}".`, 'Keys: tokens, background, skins, css.');
  const out: Look = { tokens: s.tokens === undefined ? {} : checkTokens(s.tokens, ctx, true), skins: {} };
  if (s.background !== undefined) out.background = checkFills(s.background, ctx);
  if (s.skins !== undefined) {
    if (!isObj(s.skins)) bad('bad-look', 'skins is {knob: {...}, slider: {...}, ...}.');
    for (const [control, skin] of Object.entries(s.skins as Record<string, unknown>)) {
      if (!(CONTROL_KINDS as readonly string[]).includes(control)) bad('bad-look', `Unknown control kind "${control}".`, `Kinds: ${CONTROL_KINDS.join(', ')}.`);
      out.skins[control as ControlKind] = checkSkin(control as ControlKind, skin, ctx);
    }
  }
  if (s.css !== undefined) out.css = str(s.css, LIMITS.css, 'css');
  return out;
}
export function checkRect(v: unknown, what = 'rect'): Rect {
  if (!isObj(v)) bad('bad-rect', `${what} must be {x, y, w, h}.`);
  const r = v as Record<string, unknown>;
  const n = (x: unknown, name: string) => { if (typeof x !== 'number' || !Number.isFinite(x)) bad('bad-rect', `${what}.${name} must be a number.`); return x as number; };
  const x = n(r.x, 'x'), y = n(r.y, 'y'), w = n(r.w, 'w'), h = n(r.h, 'h');
  if (w <= 0 || h <= 0) bad('bad-rect', `${what} needs a positive width and height.`);
  return { x: Math.min(8000, Math.max(-8000, x)), y: Math.min(8000, Math.max(-8000, y)), w: Math.min(8000, w), h: Math.min(8000, h) };
}
function checkBind(v: unknown, ctx: CheckContext, allowLevel: boolean): string {
  if (typeof v !== 'string' || !/^(@level|[a-z][a-zA-Z0-9]{0,31}(\.[a-zA-Z][a-zA-Z0-9]{0,31})?)$/.test(v)) bad('bad-bind', `bind ${JSON.stringify(v)} must name a control${allowLevel ? ' (or @level)' : ''}.`);
  if (v === '@level') { if (!allowLevel) bad('bad-bind', 'Text can show a control, not @level.'); return v; }
  const node = (v as string).split('.')[0]!;
  if (!ctx.nodes[node]) {
    if (ctx.lenient) { ctx.warn?.(`bind: no control "${node}".`); return v as string; }
    bad('unknown-node', `No control "${node}" to bind to.`);
  }
  return v as string;
}
function checkProps(v: unknown): Record<string, string | number | boolean> {
  if (!isObj(v)) bad('bad-value', 'props is an object of numbers, text and true/false.');
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > LIMITS.props) bad('too-large', `At most ${LIMITS.props} props.`);
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of entries) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(key)) bad('bad-value', `prop name "${key}" must be letters and digits.`);
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'string' && value.length <= 200) out[key] = value;
    else bad('bad-value', `prop ${key} must be a number, true/false or short text.`);
  }
  return out;
}
const SVG_START = /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i;

/** Check (and normalise) one element. */
export function checkElement(v: unknown, ctx: CheckContext): UiElement {
  if (!isObj(v)) bad('bad-element', 'An element is an object with a kind.');
  // A canvas was called a custom part (kind "part") before U5: older files and old habits still work.
  const e = (v.kind === 'part' ? { ...v, kind: 'canvas' } : v) as Record<string, unknown>;
  const kind = oneOf(e.kind, ELEMENT_KINDS, 'element kind');
  const known = ['id', 'kind', 'rect', 'name', 'style', 'locked', 'hidden', ...KIND_FIELDS[kind]];
  for (const key of Object.keys(e)) if (!known.includes(key)) bad('bad-element', `A ${kind} element has no "${key}".`, `Fields: ${known.join(', ')}.`);
  const base: ElementBase = { id: typeof e.id === 'string' ? e.id : '', rect: checkRect(e.rect) };
  if (e.name !== undefined) base.name = str(e.name, 80, 'name');
  if (e.style !== undefined) base.style = checkStyle(e.style, ctx);
  if (e.locked !== undefined) base.locked = e.locked === true;
  if (e.hidden !== undefined) base.hidden = e.hidden === true;
  switch (kind) {
    case 'text': {
      const el: TextElement = { ...base, kind, text: e.text === undefined ? '' : str(e.text, LIMITS.text, 'text') };
      if (e.textStyle !== undefined) el.textStyle = checkTextStyle(e.textStyle, ctx);
      if (e.bind !== undefined) el.bind = checkBind(e.bind, ctx, false);
      return el;
    }
    case 'shape': return { ...base, kind, shape: oneOf(e.shape, ['rect', 'ellipse', 'line'] as const, 'shape', 'rect') };
    case 'image': return { ...base, kind, asset: checkAssetRef(e.asset, ctx, 'image'), fit: oneOf(e.fit, ['cover', 'contain', 'stretch'] as const, 'fit', 'contain') };
    case 'svg': {
      const svg = str(e.svg, LIMITS.svg, 'svg');
      if (!SVG_START.test(svg)) bad('bad-svg', 'svg must be SVG markup starting with <svg>.');
      return { ...base, kind, svg };
    }
    case 'led': return { ...base, kind, bind: checkBind(e.bind, ctx, true), color: e.color === undefined ? 'accent' : checkColor(e.color, 'LED colour'), threshold: num(e.threshold, 0, 1, 'threshold', 0.5) };
    case 'canvas': {
      const code = str(e.code, LIMITS.code, 'code');
      if (!/export\s+default/.test(code)) bad('bad-code', 'A canvas must `export default` its draw function (or {setup, draw, pointer}).');
      return { ...base, kind, code, props: e.props === undefined ? {} : checkProps(e.props) };
    }
    case 'code': {
      if (typeof e.part !== 'string' || !PART_NAME.test(e.part)) bad('bad-part', `A code part names its part: the file src/parts/<name>.ts, where the name is lowercase letters, digits and dashes (got ${JSON.stringify(e.part ?? null)}).`);
      return { ...base, kind, part: e.part as string, props: e.props === undefined ? {} : checkProps(e.props) };
    }
  }
}
const KIND_FIELDS: Record<ElementKind, string[]> = { text: ['text', 'textStyle', 'bind'], shape: ['shape'], image: ['asset', 'fit'], svg: ['svg'], led: ['bind', 'color', 'threshold'], canvas: ['code', 'props'], code: ['part', 'props'] };
export const ELEMENT_FIELDS = (kind: ElementKind) => ['rect', 'name', 'style', 'locked', 'hidden', ...KIND_FIELDS[kind]];

export function checkAsset(v: unknown): AssetMeta {
  if (!isObj(v)) bad('bad-asset', 'An asset is {id, name, mime, bytes}.');
  const a = v as Record<string, unknown>;
  if (typeof a.id !== 'string' || !ASSET_ID_PATTERN.test(a.id)) bad('bad-asset', `Asset id ${JSON.stringify(a.id)} must match ${ASSET_ID_PATTERN}.`);
  const mime = oneOf(a.mime, [...IMAGE_MIMES, ...FONT_MIMES], 'asset type');
  const bytes = num(a.bytes, 0, MAX_ASSET_BYTES, 'asset size');
  if ((a.bytes as number) > MAX_ASSET_BYTES) bad('too-large', `Assets are limited to ${MAX_ASSET_BYTES / 1024 / 1024} MB.`);
  const out: AssetMeta = { id: a.id as string, name: str(a.name ?? a.id, 120, 'asset name'), mime, bytes: Math.round(bytes) };
  if (a.width !== undefined) out.width = Math.round(num(a.width, 1, 20000, 'width'));
  if (a.height !== undefined) out.height = Math.round(num(a.height, 1, 20000, 'height'));
  if (a.url !== undefined) {
    const url = str(a.url, 300, 'asset url');
    // Only den-kit's own files: no other site is ever fetched for a patch.
    if (!/^\/?[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/.test(url) || url.includes('..')) bad('bad-asset', 'An asset url must be a path inside den-kit (e.g. /showcase/wood.jpg).');
    out.url = url;
  }
  if (a.source !== undefined) {
    if (!isObj(a.source)) bad('bad-asset', 'source is {title, author, url, license}.');
    const s = a.source as Record<string, unknown>, source: AssetSource = {};
    for (const key of ['title', 'author', 'url', 'license'] as const) if (s[key] !== undefined) source[key] = str(s[key], 300, `source ${key}`);
    if (source.url && !/^https?:\/\//.test(source.url)) bad('bad-asset', 'source url must be an http(s) link.');
    out.source = source;
  }
  return out;
}

// ---- reading the stack --------------------------------------------------------------------
/** Everything on the plugin, back to front. `placed` lists the widget nodes on the plugin (patch order). */
export function stackOrder(ui: PluginUi, placed: readonly string[]): string[] {
  const present = new Set([...placed, ...Object.keys(ui.elements)]);
  const out = ui.order.filter(id => present.has(id));
  const seen = new Set(out);
  for (const id of [...placed, ...Object.keys(ui.elements)]) if (!seen.has(id)) { out.push(id); seen.add(id); }
  return out;
}
export function groupOf(ui: PluginUi, id: string): string | undefined {
  for (const [group, members] of Object.entries(ui.groups)) if (members.includes(id)) return group;
  return undefined;
}
/** The ids plus every other member of their groups. */
export function withGroups(ui: PluginUi, ids: readonly string[]): string[] {
  const out = new Set(ids);
  for (const id of ids) { const g = groupOf(ui, id); if (g) for (const m of ui.groups[g]!) out.add(m); }
  return [...out];
}
/** Every asset id the plugin uses (look, elements, widget styles, underlay). */
export function assetUses(ui: PluginUi, widgetStyles: ReadonlyArray<[string, WidgetStyle | undefined]>): Map<string, string[]> {
  const uses = new Map<string, string[]>();
  const add = (asset: string | undefined, where: string) => { if (!asset) return; uses.set(asset, [...(uses.get(asset) ?? []), where]); };
  const fills = (list: Fill[] | undefined, where: string) => { for (const f of list ?? []) if (f.kind === 'image') add(f.asset, where); };
  const skin = (s: Skin | undefined, control: ControlKind | undefined, where: string) => {
    if (!s || !control) return;
    const def = skinDef(control, s.name);
    for (const p of def?.params ?? []) if (p.kind === 'asset' && typeof s.params?.[p.id] === 'string') add(s.params[p.id] as string, where);
  };
  const text = (t: TextStyle | undefined, where: string) => { if (t?.font && ASSET_ID_PATTERN.test(t.font) && !FONTS[t.font]) add(t.font, where); };
  fills(ui.look.background, 'background');
  for (const [control, s] of Object.entries(ui.look.skins)) skin(s, control as ControlKind, `${control} skin`);
  for (const key of FONT_TOKENS) { const f = ui.look.tokens[key]; if (f && !FONTS[f]) add(f, `${key} token`); }
  for (const m of (ui.look.css ?? '').matchAll(/url\(\s*['"]?asset:([a-z][a-z0-9-]{1,47})['"]?\s*\)/g)) add(m[1], 'css');
  for (const el of Object.values(ui.elements)) {
    fills(el.style?.fill, el.id);
    if (el.kind === 'image') add(el.asset, el.id);
    if (el.kind === 'text') text(el.textStyle, el.id);
  }
  for (const [id, style] of widgetStyles) {
    if (!style) continue;
    fills(style.style?.fill, id);
    text(style.textStyle, id);
    skin(style.skin, controlOfId(style), id);
  }
  if (ui.underlay) add(ui.underlay.asset, 'underlay');
  return uses;
}
// Widget skins are checked against their control kind when set; for listing uses any kind that knows the skin will do.
function controlOfId(style: WidgetStyle): ControlKind | undefined { return style.skin ? CONTROL_KINDS.find(c => skinDef(c, style.skin!.name)) : undefined; }

/**
 * Plugin CSS, made safe to put in the page: comments and @import dropped, every
 * url() except url(asset:ID) (resolved through `resolve`) replaced by none, and
 * nothing that could close the style element.
 */
export function sanitizeCss(css: string, resolve: (asset: string) => string | null): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@import[^;]*;?/gi, '')
    .replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (_m, _q, target: string) => {
      const asset = /^asset:([a-z][a-z0-9-]{1,47})$/.exec(target.trim());
      const url = asset ? resolve(asset[1]!) : null;
      return url ? `url("${url.replace(/["\\\n]/g, '')}")` : 'none';
    })
    .replace(/<\/?style/gi, '')
    .replace(/expression\s*\(/gi, '(');
}

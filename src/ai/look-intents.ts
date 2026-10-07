// Fast edits of the plugin screen: "darker", "red accent", "bigger text",
// "handwritten font", "rounder corners", "a neon look". Each becomes ordinary
// edits of the look, the decorations and the controls' styles, applied at once
// as one undo step like the fast path's sound edits. Pure: the router plans
// them, the fast path applies them.
import type { Catalog } from '../core/catalog.ts';
import { applyIntents, type Intent } from '../core/ops.ts';
import type { PatchDocument } from '../core/schema.ts';
import { CONTROL_OF, skinDef, type ControlKind, type Skin } from '../core/skins.ts';
import { THEME_TOKENS } from '../core/themes.ts';
import { COLOR_TOKENS, FONTS, ASSET_ID_PATTERN, type Fill, type TextStyle, type WidgetStyle } from '../core/ui.ts';
import { contrastRatio, luminance } from '../plugin/checks.ts';
import { findWork, lookIntents } from '../showcase/index.ts';
import type { Amount, Plan, PlanResult } from './intents.ts';

export type LookChange =
  | { kind: 'tone'; direction: 'darker' | 'lighter' }
  | { kind: 'accent'; color: string; name: string }
  | { kind: 'text'; direction: 'bigger' | 'smaller' }
  | { kind: 'font'; font: string }
  | { kind: 'corners'; direction: 'rounder' | 'squarer' }
  | { kind: 'wear'; work: string };

/** Accent colours by name (bright enough for dark screens, deep enough for light ones). */
export const ACCENTS: Readonly<Record<string, string>> = {
  red: '#ff4d4d', orange: '#ff9c1a', yellow: '#ffd23f', gold: '#e6b84a', green: '#3ddc84', lime: '#a6ff00', 'neon green': '#39ff14',
  teal: '#2bc4b4', cyan: '#3ad1ff', blue: '#4d7cff', purple: '#a66bff', pink: '#ff5ca8', magenta: '#ff3cac', white: '#f2f2f2', silver: '#c9ccd1',
};
/** Showcase works whose look can be worn, by the word for it. */
export const LOOK_WORDS: Readonly<Record<string, string>> = { neon: 'neon', sunset: 'pad', wood: 'musicbox', space: 'space', tape: 'tapeecho', cassette: 'lofi', pedal: 'fuzz', toy: 'toy', lab: 'duck', acid: 'acid' };

const STEP: Record<Amount, number> = { tiny: 0.04, small: 0.07, medium: 0.12, large: 0.2, extreme: 0.32 };
const FACTOR: Record<Amount, number> = { tiny: 1.06, small: 1.1, medium: 1.18, large: 1.3, extreme: 1.5 };

// ---- colours ---------------------------------------------------------------------------------
function hexRgb(c: string): [number, number, number, number] | null {
  const m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(c.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length <= 4) h = [...h].map(x => x + x).join('');
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
}
const toHex = (r: number, g: number, b: number, a = 1) => `#${[r, g, b].map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}${a < 1 ? Math.round(a * 255).toString(16).padStart(2, '0') : ''}`;
function rgbHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hslRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}
/** The colour lighter or darker by `dl` (HSL lightness), or null when it is not a hex colour. */
export function shiftLightness(c: string, dl: number): string | null {
  const rgb = hexRgb(c); if (!rgb) return null;
  const [h, s, l] = rgbHsl(rgb[0], rgb[1], rgb[2]);
  const [r, g, b] = hslRgb(h, s, Math.min(0.97, Math.max(0.02, l + dl)));
  return toHex(r, g, b, rgb[3]);
}
const tokens = (doc: PatchDocument) => ({ ...(THEME_TOKENS[doc.panel.theme] ?? THEME_TOKENS.graphite), ...doc.ui.look.tokens }) as Record<string, string>;
const colorOf = (doc: PatchDocument, c: string) => (COLOR_TOKENS as readonly string[]).includes(c) ? tokens(doc)[c]! : c;

// ---- the changes -------------------------------------------------------------------------------
/** Plan one screen change against `doc` (one undo step when applied). */
export function planLook(doc: PatchDocument, catalog: Catalog, change: LookChange, amount: Amount = 'medium'): PlanResult {
  const done = (intents: Intent[], label: string, short = label, note?: string): PlanResult => {
    if (!intents.length) return { ok: false, reason: 'at-limit', message: `Nothing to change for “${label}” on this plugin.` };
    try { applyIntents(doc, intents, catalog); } catch (error) { return { ok: false, reason: 'unknown', message: `Could not ${label}: ${error instanceof Error ? error.message : String(error)}` }; }
    const plan: Plan = { kind: 'look', change: change.kind, intents, label, short };
    return { ok: true, plan: note ? { ...plan, label: `${label} (${note})` } : plan };
  };
  switch (change.kind) {
    case 'tone': return tone(doc, change.direction, amount, done);
    case 'accent': {
      const old = colorOf(doc, 'accent').toLowerCase();
      const set: Record<string, string> = { accent: change.color };
      // Everything that was the accent colour (pointer, glow…) follows it.
      for (const t of COLOR_TOKENS) if (t !== 'accent' && colorOf(doc, t).toLowerCase() === old) set[t] = change.color;
      return done([{ op: 'setLook', look: { tokens: set } }], `accent colour → ${change.name}`, `accent ${change.name}`);
    }
    case 'text': return textSize(doc, change.direction, amount, done);
    case 'font': {
      if (!FONTS[change.font]) return { ok: false, reason: 'unknown', message: `No font “${change.font}”.` };
      const intents: Intent[] = [{ op: 'setLook', look: { tokens: { font: change.font, labelFont: change.font, valueFont: change.font } } }];
      for (const el of Object.values(doc.ui.elements)) if (el.kind === 'text' && el.textStyle?.font && !isAssetFont(el.textStyle.font)) intents.push({ op: 'updateElement', id: el.id, set: { textStyle: { ...el.textStyle, font: change.font } } });
      for (const n of Object.values(doc.nodes)) if (n.style?.textStyle?.font && !isAssetFont(n.style.textStyle.font)) intents.push({ op: 'setStyle', node: n.id, style: { ...n.style, textStyle: { ...n.style.textStyle, font: change.font } } });
      return done(intents, `font → ${FONTS[change.font]!.title}`, `font ${FONTS[change.font]!.title}`);
    }
    case 'corners': return corners(doc, change.direction, amount, done);
    case 'wear': {
      const work = findWork(change.work);
      if (!work) return { ok: false, reason: 'unknown', message: `No look “${change.work}”.` };
      return done(lookIntents(doc, work.build(catalog)), `wears the ${work.title} look`, `${work.title} look`);
    }
  }
}
type Done = (intents: Intent[], label: string, short?: string, note?: string) => PlanResult;
const isAssetFont = (font: string) => !FONTS[font] && ASSET_ID_PATTERN.test(font) && !['font', 'labelFont', 'valueFont'].includes(font);

/** Darker or lighter: the background colour, and a tint over the background pictures. */
function tone(doc: PatchDocument, direction: 'darker' | 'lighter', amount: Amount, done: Done): PlanResult {
  const step = STEP[amount] * (direction === 'darker' ? -1 : 1);
  const look: { tokens?: Record<string, string>; background?: Fill[] } = {};
  const bg = shiftLightness(colorOf(doc, 'bg'), step);
  if (bg) look.tokens = { bg };
  const layers = doc.ui.look.background ?? [];
  if (layers.length) {
    // The top layer is our tint when it is plain black or white: turn it up or down instead of stacking another.
    const top = layers.at(-1)!;
    const tint = top.kind === 'color' && !top.blend && (top.color === '#000000' || top.color === '#ffffff') ? top : null;
    const want = direction === 'darker' ? '#000000' : '#ffffff';
    const rest = tint ? layers.slice(0, -1) : layers;
    let opacity = Math.abs(step) * 2;
    if (tint) opacity = (tint.color === want ? 1 : -1) * (tint.opacity ?? 1) + Math.abs(step) * 2;
    const color = opacity >= 0 ? want : (want === '#000000' ? '#ffffff' : '#000000');
    const next: Fill[] = Math.abs(opacity) < 0.02 ? rest : [...rest, { kind: 'color', color, opacity: Math.round(Math.min(0.85, Math.abs(opacity)) * 100) / 100 }];
    look.background = next;
  }
  if (!look.tokens && !look.background) return { ok: false, reason: 'unknown', message: 'The background is not a colour den-kit can make darker or lighter; ask the LLM.' };
  // Say so when the text no longer reads against the new background.
  const fg = hexRgb(colorOf(doc, 'fg')), nbg = hexRgb(bg ?? colorOf(doc, 'bg'));
  const ratio = fg && nbg ? contrastRatio(luminance(fg[0], fg[1], fg[2]), luminance(nbg[0], nbg[1], nbg[2])) : null;
  const note = ratio !== null && ratio < 3 ? `text contrast now ${ratio.toFixed(1)}:1 — ⌘Z to go back` : undefined;
  return done([{ op: 'setLook', look }], `${direction} screen`, `${direction} screen`, note);
}

/** Bigger or smaller text: every text (its box grows with it) and every control's label. */
function textSize(doc: PatchDocument, direction: 'bigger' | 'smaller', amount: Amount, done: Done): PlanResult {
  const f = direction === 'bigger' ? FACTOR[amount] : 1 / FACTOR[amount];
  const size = (s: number) => Math.round(Math.min(200, Math.max(8, s * f)) * 2) / 2;
  const intents: Intent[] = [];
  for (const el of Object.values(doc.ui.elements)) {
    if (el.kind !== 'text') continue;
    const t: TextStyle = el.textStyle ?? {};
    const r = el.rect;
    const w = Math.max(r.w, Math.round(r.w * f)), h = Math.round(r.h * f);
    const x = t.align === 'left' ? r.x : t.align === 'right' ? r.x + r.w - w : Math.round(r.x + (r.w - w) / 2);
    intents.push({ op: 'updateElement', id: el.id, set: { textStyle: { ...t, size: size(t.size ?? 14) }, rect: { x, y: Math.round(r.y + (r.h - h) / 2), w, h } } });
  }
  for (const n of Object.values(doc.nodes)) {
    if (!n.panel || !CONTROL_OF[n.type] || n.type === 'ui.keyboard') continue;
    const style: WidgetStyle = n.style ?? {};
    intents.push({ op: 'setStyle', node: n.id, style: { ...style, textStyle: { ...style.textStyle, size: size(style.textStyle?.size ?? 11) } } });
  }
  return done(intents, `text ${direction} (×${f.toFixed(2)})`, `text ${direction}`);
}

/** Rounder or squarer corners: shapes, controls' boxes, and skins with a corner radius. */
function corners(doc: PatchDocument, direction: 'rounder' | 'squarer', amount: Amount, done: Done): PlanResult {
  const f = direction === 'rounder' ? FACTOR[amount] ** 2 : 1 / FACTOR[amount] ** 2;
  const radius = (r: number | undefined, fallback: number) => {
    const v = r === undefined || r === 0 ? (direction === 'rounder' ? fallback : 0) : r * f;
    return Math.round(v < 2 ? 0 : Math.min(400, v));
  };
  const intents: Intent[] = [];
  for (const el of Object.values(doc.ui.elements)) {
    if (el.kind !== 'shape' || el.shape !== 'rect' || (!el.style?.fill?.length && !el.style?.stroke)) continue;
    const r = radius(el.style?.radius, 10);
    if (r !== (el.style?.radius ?? 0)) intents.push({ op: 'updateElement', id: el.id, set: { style: { ...el.style, radius: r } } });
  }
  const skinRadius = (control: ControlKind, skin: Skin | undefined): Skin | undefined => {
    if (!skin) return undefined;
    const def = skinDef(control, skin.name);
    const p = def?.params.find(x => x.id === 'radius');
    if (!p) return undefined;
    const now = Number(skin.params?.radius ?? p.default);
    const r = radius(now, 8);
    return r === now ? undefined : { ...skin, params: { ...skin.params, radius: Math.min(p.max ?? 400, r) } };
  };
  for (const n of Object.values(doc.nodes)) {
    const control = CONTROL_OF[n.type];
    if (!n.panel || !control) continue;
    const style: WidgetStyle = n.style ?? {};
    let next: WidgetStyle | null = null;
    if (style.style?.fill?.length || style.style?.stroke) { const r = radius(style.style.radius, 10); if (r !== (style.style.radius ?? 0)) next = { ...style, style: { ...style.style, radius: r } }; }
    const skin = skinRadius(control, style.skin ?? doc.ui.look.skins[control]);
    if (skin && style.skin) next = { ...(next ?? style), skin };
    if (next) intents.push({ op: 'setStyle', node: n.id, style: next });
  }
  const lookSkins: Record<string, Skin> = {};
  for (const [control, skin] of Object.entries(doc.ui.look.skins)) { const s = skinRadius(control as ControlKind, skin); if (s) lookSkins[control] = s; }
  if (Object.keys(lookSkins).length) intents.push({ op: 'setLook', look: { skins: lookSkins } });
  return done(intents, `${direction} corners`);
}

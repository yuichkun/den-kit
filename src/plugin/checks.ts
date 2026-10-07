// Checks of the plugin screen, the way a designer would look it over: things
// off the plugin or cut by its edge, controls on top of each other or hidden
// under something opaque, text too small to read or too faint against what is
// behind it, controls that drive nothing or have no label, pictures that are
// missing. The structural checks read the patch alone (pure); the measured ones
// take what the browser saw when it drew the plugin (look.ts): text that does
// not fit, canvases that failed, the pixels behind each text.
import type { Catalog } from '../core/catalog.ts';
import type { PatchDocument } from '../core/schema.ts';
import { CONTROL_OF } from '../core/skins.ts';
import { assetUses, stackOrder, type Fill, type UiElement } from '../core/ui.ts';
import { intersects } from './edit.ts';
import { partNames } from '../core/project.ts';
import type { Rect } from './spec.ts';

export interface PluginIssue {
  code: 'empty' | 'outside' | 'cut' | 'overlap' | 'covered' | 'tiny-text' | 'unlabelled' | 'unwired' | 'missing-asset' | 'no-voice' | 'text-overflow' | 'squeezed' | 'canvas-error' | 'contrast' | 'code-missing' | 'code-error' | 'code-off';
  /** The things it is about (element or control ids). */
  ids: string[];
  message: string;
  severity: 'error' | 'warn';
}

const area = (r: Rect) => Math.max(0, r.w) * Math.max(0, r.h);
/** The box a rect covers once turned by `deg` around its centre. */
export function visualRect(r: Rect, deg = 0): Rect {
  if (!deg) return r;
  const a = deg * Math.PI / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const w = r.w * c + r.h * s, h = r.w * s + r.h * c;
  const round = (v: number) => Math.round(v * 100) / 100;
  return { x: round(r.x + r.w / 2 - w / 2), y: round(r.y + r.h / 2 - h / 2), w: round(w), h: round(h) };
}
function overlapArea(a: Rect, b: Rect) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}
const PLAYED = new Set(['ui.knob', 'ui.slider', 'ui.toggle', 'ui.button', 'ui.xy']);
const name = (doc: PatchDocument, id: string) => { const n = doc.nodes[id]; const el = doc.ui.elements[id]; return n ? `${id} ("${n.label ?? id}")` : el?.name ? `${id} ("${el.name}")` : id; };

/** Alpha of the strongest colour in a list of fills (pictures count as opaque). */
function fillOpacity(fills: readonly Fill[] | undefined): number {
  let best = 0;
  for (const f of fills ?? []) {
    const o = f.opacity ?? 1;
    if (f.kind === 'image') best = Math.max(best, o);
    else if (f.kind === 'color') best = Math.max(best, o * alphaOf(f.color));
    else best = Math.max(best, o * Math.max(...f.stops.map(s => alphaOf(s.color))));
  }
  return best;
}
/** The alpha written in a colour (#rgba, #rrggbbaa, rgba(), hsla(), transparent); 1 otherwise. */
export function alphaOf(c: string): number {
  if (c === 'transparent') return 0;
  const hex = /^#([0-9a-f]{4}|[0-9a-f]{8})$/i.exec(c);
  if (hex) return hex[1]!.length === 4 ? parseInt(hex[1]![3]! + hex[1]![3]!, 16) / 255 : parseInt(hex[1]!.slice(6), 16) / 255;
  const fn = /^(?:rgba|hsla)\(.*[,/]\s*([0-9.]+%?)\s*\)$/i.exec(c);
  if (fn) return fn[1]!.endsWith('%') ? parseFloat(fn[1]!) / 100 : parseFloat(fn[1]!);
  return 1;
}
/** How much an element hides what is under it (0: not at all, 1: completely). */
function opacity(el: UiElement): number {
  const o = el.style?.opacity ?? 1;
  if (el.kind === 'image') return o;
  if (el.kind === 'shape' && el.shape !== 'line') return o * fillOpacity(el.style?.fill);
  if (el.kind === 'text' || el.kind === 'led' || el.kind === 'svg' || el.kind === 'canvas' || el.kind === 'code') return o * fillOpacity(el.style?.fill);
  return 0;
}

/** The checks that need only the patch. */
export function checkPlugin(doc: PatchDocument, catalog: Catalog): PluginIssue[] {
  const out: PluginIssue[] = [];
  const W = doc.panel.width, H = doc.panel.height;
  const frame: Rect = { x: 0, y: 0, w: W, h: H };
  const widgets = Object.values(doc.nodes).filter(n => n.panel && CONTROL_OF[n.type] && catalog.find(n.type)?.kind === 'widget');
  const order = stackOrder(doc.ui, widgets.map(n => n.id));
  const elements = Object.values(doc.ui.elements).filter(e => !e.hidden);
  if (!widgets.length && !elements.length) return [{ code: 'empty', ids: [], message: 'The plugin is empty: put controls on it (addControl, or setPanel for controls already in the patch).', severity: 'warn' }];
  const rectOf = (id: string): Rect | undefined => { const el = doc.ui.elements[id]; return el ? visualRect(el.rect, el.style?.rotate) : doc.nodes[id]?.panel; };

  // Off the plugin, or cut by its edge (shapes and big backdrops may bleed off the edge on purpose).
  for (const id of order) {
    const r = rectOf(id); if (!r) continue;
    const el = doc.ui.elements[id];
    if (el?.hidden) continue;
    const inside = overlapArea(r, frame);
    if (inside === 0) out.push({ code: 'outside', ids: [id], message: `${name(doc, id)} is entirely off the plugin (${W}×${H}); nobody can see it.`, severity: 'error' });
    else if (inside < area(r) - 1 && !(el && (el.kind === 'shape' || area(r) >= area(frame) * 0.5))) {
      out.push({ code: 'cut', ids: [id], message: `${name(doc, id)} (${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)} as drawn) sticks out of the plugin (${W}×${H}) and is cut.`, severity: el ? 'warn' : 'error' });
    }
  }

  // Controls on top of each other; an opaque decoration above a control hides it.
  for (let i = 0; i < widgets.length; i++) for (let j = i + 1; j < widgets.length; j++) {
    const a = widgets[i]!, b = widgets[j]!;
    const o = overlapArea(a.panel!, b.panel!);
    if (o > Math.min(area(a.panel!), area(b.panel!)) * 0.04) out.push({ code: 'overlap', ids: [a.id, b.id], message: `${name(doc, a.id)} and ${name(doc, b.id)} overlap; move them apart.`, severity: 'error' });
  }
  const level = new Map(order.map((id, i) => [id, i]));
  for (const w of widgets) {
    for (const el of elements) {
      if ((level.get(el.id) ?? -1) < (level.get(w.id) ?? 0)) continue;
      if (opacity(el) < 0.6 || el.kind === 'text') continue;
      if (overlapArea(el.rect, w.panel!) > area(w.panel!) * 0.3) out.push({ code: 'covered', ids: [el.id, w.id], message: `${name(doc, el.id)} lies over ${name(doc, w.id)} and hides it; send it back ({"op":"arrange","ids":["${el.id}"],"to":"back"}) or make it see-through.`, severity: 'error' });
    }
  }
  // (Text boxes are often bigger than their words: texts on top of each other are measured where they are drawn, see textOverlaps.)
  const texts = elements.filter((e): e is Extract<UiElement, { kind: 'text' }> => e.kind === 'text' && !!(e.text || e.bind));

  // Text too small to read.
  for (const t of texts) {
    const size = t.textStyle?.size ?? 14;
    if (size < 10) out.push({ code: 'tiny-text', ids: [t.id], message: `${name(doc, t.id)} is ${size} px; text under 11 px is hard to read.`, severity: size < 8 ? 'error' : 'warn' });
  }
  for (const w of widgets) {
    const size = w.style?.textStyle?.size;
    if (size !== undefined && size < 9) out.push({ code: 'tiny-text', ids: [w.id], message: `The label of ${name(doc, w.id)} is ${size} px; make it at least 10 px.`, severity: 'warn' });
  }

  // Controls that drive nothing, or that nobody can tell apart.
  // A control a canvas or a code part reads or moves is in use (its id appears in their code).
  const partSources = Object.entries(doc.project?.files ?? {}).filter(([path]) => path.startsWith('src/')).map(([, text]) => text);
  const canvasCode = [...elements.filter(e => e.kind === 'canvas').map(e => (e as Extract<UiElement, { kind: 'canvas' }>).code), ...partSources].join('\n');
  const boundText = new Set(texts.filter(t => t.bind).map(t => t.bind!.split('.')[0]!));
  for (const w of widgets) {
    if (PLAYED.has(w.type) && !Object.values(doc.edges).some(e => e.from.node === w.id) && !new RegExp(`['"\`]${w.id}['"\`]`).test(canvasCode)) {
      out.push({ code: 'unwired', ids: [w.id], message: `${name(doc, w.id)} drives nothing: connect it to a module input (or remove it).`, severity: 'warn' });
    }
    if (w.type === 'ui.keyboard' && !Object.values(doc.nodes).some(n => n.type === 'kit.voiceIn')) out.push({ code: 'no-voice', ids: [w.id], message: `${name(doc, w.id)} plays nothing: the patch has no Voice In (it is an effect).`, severity: 'warn' });
    const label = (w.label ?? '').trim();
    // A switch that prints its own words (SQR / SAW), and a footswitch, say what they are.
    const skin = w.style?.skin ?? doc.ui.look.skins[CONTROL_OF[w.type]!];
    const speaks = skin?.name === 'footswitch' || (skin?.name === 'switch' && ((skin.params?.onText ?? 'ON') !== 'ON' || (skin.params?.offText ?? 'OFF') !== 'OFF'));
    const hidesLabel = skin?.params?.label === 'none' && !speaks;
    if (PLAYED.has(w.type) && (!label || label === w.id || hidesLabel) && !boundText.has(w.id)) {
      const near = texts.some(t => { const r = visualRect(t.rect, t.style?.rotate); return !t.bind && intersects({ x: r.x - 24, y: r.y - 24, w: r.w + 48, h: r.h + 48 }, w.panel!); });
      if (!near) out.push({ code: 'unlabelled', ids: [w.id], message: `${name(doc, w.id)} has no label anyone can read; give it one (setLabel) or put a text by it.`, severity: 'warn' });
    }
  }

  // Code parts whose file the project does not have.
  const parts = new Set(partNames(doc.project));
  for (const el of elements) if (el.kind === 'code' && !parts.has(el.part)) out.push({ code: 'code-missing', ids: [el.id], message: `${name(doc, el.id)} shows the part "${el.part}", but the project has no src/parts/${el.part}.ts${parts.size ? ` (parts: ${[...parts].join(', ')})` : ''}.`, severity: 'error' });

  // Pictures and fonts the plugin uses but the patch does not have.
  const uses = assetUses(doc.ui, widgets.map(n => [n.id, n.style]));
  for (const [asset, where] of uses) if (!doc.assets[asset]) out.push({ code: 'missing-asset', ids: where.filter(x => doc.ui.elements[x] || doc.nodes[x]), message: `The asset "${asset}" (used by ${where.join(', ')}) is not in the patch.`, severity: 'error' });
  return out;
}

// ---- measured: the pixels behind each text ---------------------------------------------------
export interface TextBox {
  id: string;
  /** What it is, for the message ("The text title1", "The label of knob1"). */
  what: string;
  /** Texts, control labels or value readouts (faint ones of a kind are reported together). */
  kind?: 'text' | 'label' | 'value';
  /** Where it is in the picture (pixels). */
  rect: Rect;
  /** Its colour (r, g, b 0..255, a 0..1). */
  color: [number, number, number, number];
  /** Font size in design px, and bold. */
  size: number;
  bold: boolean;
}
/** WCAG relative luminance of an sRGB colour (0..255). */
export function luminance(r: number, g: number, b: number): number {
  const c = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}
export const contrastRatio = (l1: number, l2: number) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
export interface Pixels { data: Uint8ClampedArray; width: number; height: number }

/** Contrast below which text is hard to read (ISO 9241-3 asks 3:1 at least), and below which it is faint (WCAG AA: 4.5:1, 3:1 for large text). */
export const CONTRAST = { hard: 3, faint: 4.5, faintLarge: 3 } as const;

/**
 * Each text against what is right behind its letters. Each layer is a picture of
 * the plugin without the letters (`bare`) and one with them (`full`, same size):
 * the pixels that differ are the letters, and the background 2 px around them
 * counts. The worst tenth of it (the brightest bits behind light text, the
 * darkest behind dark text) gives the contrast. Two layers: one keeps the texts'
 * shadows and outlines in the background (a dark shadow under light letters
 * helps), one leaves them out (a glow belongs to the letters); the text reads
 * as well as the better of the two. Without `full`, the whole box counts.
 */
export function contrastIssues(boxes: readonly TextBox[], layers: ReadonlyArray<{ bare: Pixels; full?: Pixels }>): PluginIssue[] {
  const found: Array<{ box: TextBox; ratio: number; severity: 'error' | 'warn'; need: number }> = [];
  for (const box of boxes) {
    let ratio = -1;
    for (const layer of layers) { const r = contrastOf(box, layer.bare, layer.full); if (r !== null) ratio = Math.max(ratio, r); }
    if (ratio < 0) continue;
    const large = box.size >= 24 || (box.bold && box.size >= 18.5);
    const faint = large ? CONTRAST.faintLarge : CONTRAST.faint;
    if (ratio < CONTRAST.hard) found.push({ box, ratio, severity: 'error', need: CONTRAST.hard });
    else if (ratio < faint) found.push({ box, ratio, severity: 'warn', need: faint });
  }
  // Faint labels of several controls are one finding (a look-wide colour choice), said once.
  const out: PluginIssue[] = [];
  const grouped = new Map<string, typeof found>();
  for (const f of found) {
    const key = f.severity === 'warn' && f.box.kind && f.box.kind !== 'text' ? f.box.kind : `one:${out.length}:${f.box.id}:${f.box.what}`;
    grouped.set(key, [...(grouped.get(key) ?? []), f]);
  }
  for (const list of grouped.values()) {
    const fix = 'Change the colour, give it a shadow, or put a backdrop behind it.';
    const range = (l: typeof found) => { const lo = Math.min(...l.map(f => f.ratio)), hi = Math.max(...l.map(f => f.ratio)); return lo.toFixed(1) === hi.toFixed(1) ? `${lo.toFixed(1)}:1` : `${lo.toFixed(1)}–${hi.toFixed(1)}:1`; };
    if (list.length >= 3) {
      const kind = list[0]!.box.kind === 'value' ? 'value readouts' : 'labels';
      out.push({ code: 'contrast', ids: list.map(f => f.box.id), message: `The ${kind} of ${list.map(f => f.box.what.replace(/^The (label|value) of /, '')).join(', ')} are faint: contrast ${range(list)} against what is behind them (${list[0]!.need}:1 reads well). ${fix}`, severity: 'warn' });
      continue;
    }
    for (const f of list) out.push({ code: 'contrast', ids: [f.box.id], message: f.severity === 'error' ? `${f.box.what} is hard to read: contrast ${f.ratio.toFixed(1)}:1 against what is behind it (at least ${f.need}:1). ${fix}` : `${f.box.what} is faint: contrast ${f.ratio.toFixed(1)}:1 against what is behind it (${f.need}:1 reads well). ${fix}`, severity: f.severity });
  }
  return out;
}

/** The contrast of one text against one picture of what is behind it (null when it is off the picture). */
function contrastOf(box: TextBox, bare: Pixels, full?: Pixels): number | null {
  const x0 = Math.max(0, Math.floor(box.rect.x)), y0 = Math.max(0, Math.floor(box.rect.y));
  const x1 = Math.min(bare.width, Math.ceil(box.rect.x + box.rect.w)), y1 = Math.min(bare.height, Math.ceil(box.rect.y + box.rect.h));
  if (x1 <= x0 || y1 <= y0) return null;
  const w = x1 - x0, h = y1 - y0;
  const at = (x: number, y: number) => ((y0 + y) * bare.width + x0 + x) * 4;
  // The letters: where the picture with them differs from the one without; then 2 px around them.
  let near: Uint8Array | null = null;
  if (full && full.width === bare.width && full.height === bare.height) {
    const glyph = new Uint8Array(w * h);
    let count = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = at(x, y);
      if (Math.abs(full.data[i]! - bare.data[i]!) + Math.abs(full.data[i + 1]! - bare.data[i + 1]!) + Math.abs(full.data[i + 2]! - bare.data[i + 2]!) > 48) { glyph[y * w + x] = 1; count++; }
    }
    if (count >= 6) near = dilate(glyph, w, h, 2);
  }
  const lums: number[] = [];
  let sr = 0, sg = 0, sb = 0;
  const step = near ? 1 : Math.max(1, Math.floor(Math.sqrt((w * h) / 4000)));
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
    if (near && !near[y * w + x]) continue;
    const i = at(x, y);
    const r = bare.data[i]!, g = bare.data[i + 1]!, b = bare.data[i + 2]!;
    sr += r; sg += g; sb += b;
    lums.push(luminance(r, g, b));
  }
  if (!lums.length) return null;
  lums.sort((a, b) => a - b);
  const n = lums.length;
  const [tr, tg, tb, ta] = box.color;
  // A see-through text colour sits on the average background.
  const mix = (c: number, bg: number) => c * ta + bg * (1 - ta);
  const text = luminance(mix(tr, sr / n), mix(tg, sg / n), mix(tb, sb / n));
  const median = lums[Math.floor(n / 2)]!;
  const worst = text > median ? lums[Math.min(n - 1, Math.floor(n * 0.9))]! : lums[Math.floor(n * 0.1)]!;
  return contrastRatio(text, worst);
}

/** Grow a 0/1 mask by `r` pixels (a square around each set pixel). */
function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const rows = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    for (let dx = -r; dx <= r; dx++) { const xx = x + dx; if (xx >= 0 && xx < w) rows[y * w + xx] = 1; }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!rows[y * w + x]) continue;
    for (let dy = -r; dy <= r; dy++) { const yy = y + dy; if (yy >= 0 && yy < h) out[yy * w + x] = 1; }
  }
  return out;
}

/**
 * Words on top of words, or on a control, where the browser drew them (`lines`:
 * each text's line boxes in design pixels; `controls`: the controls' boxes).
 */
export function textOverlaps(lines: ReadonlyArray<{ id: string; what: string; rects: Rect[] }>, controls: ReadonlyArray<{ id: string; what: string; rect: Rect }>): PluginIssue[] {
  const out: PluginIssue[] = [];
  const hit = (a: Rect[], b: Rect[]) => a.reduce((sum, x) => sum + b.reduce((t, y) => t + overlapArea(x, y), 0), 0);
  const size = (a: Rect[]) => a.reduce((sum, x) => sum + area(x), 0);
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
    const a = lines[i]!, b = lines[j]!;
    if (hit(a.rects, b.rects) > Math.min(size(a.rects), size(b.rects)) * 0.15) out.push({ code: 'overlap', ids: [a.id, b.id], message: `${a.what} and ${b.what} are drawn on top of each other.`, severity: 'warn' });
  }
  for (const t of lines) for (const c of controls) {
    if (hit(t.rects, [c.rect]) > size(t.rects) * 0.2) out.push({ code: 'overlap', ids: [t.id, c.id], message: `${t.what} is drawn over ${c.what}; move one of them.`, severity: 'warn' });
  }
  return out;
}

export const formatPluginIssue = (i: PluginIssue) => `${i.severity === 'error' ? 'Problem' : 'Check'}: ${i.message}`;

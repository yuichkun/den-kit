// Layout arithmetic for editing the plugin: align, distribute, nudge, resize,
// bounds, hit tests. Pure functions over rectangles in design pixels.
import type { Rect } from './spec.ts';

export type Align = 'left' | 'right' | 'top' | 'bottom' | 'hcenter' | 'vcenter';

export function bounds(rects: readonly Rect[]): Rect {
  if (!rects.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x0 = Math.min(...rects.map(r => r.x)), y0 = Math.min(...rects.map(r => r.y));
  const x1 = Math.max(...rects.map(r => r.x + r.w)), y1 = Math.max(...rects.map(r => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Line things up with the edge or centre of the selection's bounds. With only one
 * thing selected (or one group), they line up with the plugin itself (`frame`).
 * `units` lists the sets that move together (groups), each by one offset.
 */
export function align(rects: Readonly<Record<string, Rect>>, how: Align, frame: Rect, units?: readonly (readonly string[])[]): Record<string, Rect> {
  const sets = units ?? Object.keys(rects).map(id => [id]);
  const box = (ids: readonly string[]) => bounds(ids.map(id => rects[id]!).filter(Boolean));
  const target = sets.length > 1 ? bounds(sets.map(box)) : frame;
  const out: Record<string, Rect> = {};
  for (const ids of sets) {
    const b = box(ids);
    const dx = how === 'left' ? target.x - b.x : how === 'right' ? target.x + target.w - (b.x + b.w) : how === 'hcenter' ? target.x + (target.w - b.w) / 2 - b.x : 0;
    const dy = how === 'top' ? target.y - b.y : how === 'bottom' ? target.y + target.h - (b.y + b.h) : how === 'vcenter' ? target.y + (target.h - b.h) / 2 - b.y : 0;
    for (const id of ids) { const r = rects[id]; if (r) out[id] = { ...r, x: Math.round(r.x + dx), y: Math.round(r.y + dy) }; }
  }
  return out;
}

/** Equal gaps between things (the first and the last stay put), along x (`h`) or y (`v`). */
export function distribute(rects: Readonly<Record<string, Rect>>, axis: 'h' | 'v', units?: readonly (readonly string[])[]): Record<string, Rect> {
  const sets = (units ?? Object.keys(rects).map(id => [id])).map(ids => ({ ids, box: bounds(ids.map(id => rects[id]!).filter(Boolean)) }));
  const out: Record<string, Rect> = {};
  if (sets.length < 3) return out;
  const pos = (b: Rect) => axis === 'h' ? b.x : b.y, size = (b: Rect) => axis === 'h' ? b.w : b.h;
  sets.sort((a, b) => pos(a.box) - pos(b.box));
  const first = sets[0]!.box, last = sets.at(-1)!.box;
  const span = pos(last) + size(last) - pos(first);
  const gap = (span - sets.reduce((sum, s) => sum + size(s.box), 0)) / (sets.length - 1);
  let at = pos(first);
  for (const s of sets) {
    const d = Math.round(at) - pos(s.box);
    for (const id of s.ids) { const r = rects[id]!; out[id] = axis === 'h' ? { ...r, x: r.x + d } : { ...r, y: r.y + d }; }
    at += size(s.box) + gap;
  }
  return out;
}

/** Move by (dx, dy), keeping at least a corner inside the plugin. */
export function nudge(rects: Readonly<Record<string, Rect>>, dx: number, dy: number, frame: Rect): Record<string, Rect> {
  const out: Record<string, Rect> = {};
  for (const [id, r] of Object.entries(rects)) out[id] = { ...r, x: Math.min(frame.w - 8, Math.max(8 - r.w, r.x + dx)), y: Math.min(frame.h - 8, Math.max(8 - r.h, r.y + dy)) };
  return out;
}

/** Grow or shrink by (dw, dh), never below `min`. */
export function grow(rects: Readonly<Record<string, Rect>>, dw: number, dh: number, min = 4): Record<string, Rect> {
  const out: Record<string, Rect> = {};
  for (const [id, r] of Object.entries(rects)) out[id] = { ...r, w: Math.max(min, r.w + dw), h: Math.max(min, r.h + dh) };
  return out;
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
/** Drag a handle of `r` by (dx, dy); with `keepRatio` the corners keep the proportions. */
export function resizeBy(r: Rect, handle: Handle, dx: number, dy: number, keepRatio = false, min = 4): Rect {
  let { x, y, w, h } = r;
  if (handle.includes('e')) w = r.w + dx;
  if (handle.includes('w')) { w = r.w - dx; x = r.x + dx; }
  if (handle.includes('s')) h = r.h + dy;
  if (handle.includes('n')) { h = r.h - dy; y = r.y + dy; }
  if (keepRatio && handle.length === 2 && r.w > 0 && r.h > 0) {
    const k = Math.max(w / r.w, h / r.h);
    const nw = r.w * k, nh = r.h * k;
    if (handle.includes('w')) x = r.x + r.w - nw;
    if (handle.includes('n')) y = r.y + r.h - nh;
    w = nw; h = nh;
  }
  if (w < min) { if (handle.includes('w')) x -= min - w; w = min; }
  if (h < min) { if (handle.includes('n')) y -= min - h; h = min; }
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

export const intersects = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Fit a picture of natural size (w × h) into at most `max` of the plugin, centred on (cx, cy). */
export function placePicture(natural: { width?: number; height?: number }, at: { x: number; y: number }, frame: Rect, max = 0.6): Rect {
  const w0 = natural.width ?? 200, h0 = natural.height ?? 200;
  const k = Math.min(1, (frame.w * max) / w0, (frame.h * max) / h0);
  const w = Math.max(8, Math.round(w0 * k)), h = Math.max(8, Math.round(h0 * k));
  return { x: Math.round(at.x - w / 2), y: Math.round(at.y - h / 2), w, h };
}

// What a custom part is given each frame, and how it moves controls. Shared by
// the page (part-runtime.ts, PluginPart.vue) and the part's worker; no DOM here,
// so the rules are unit-tested in Node.
import { fromUnit, toUnit } from './format.ts';

/** A control's range, for drawing scales and turning 0..1 into its own units. */
export interface PartRange { min: number; max: number; log: boolean; unit: string }
export type PartValue = number | boolean | { x: number; y: number };
/** Where the mouse is over the part (in the part's own pixels). */
export interface PartPointer { x: number; y: number; over: boolean; down: boolean; shift: boolean; alt: boolean; meta: boolean }
export type PartPointerType = 'down' | 'move' | 'up' | 'wheel' | 'double' | 'leave';
/** One thing the mouse did: a press, a move, a release, a wheel turn (dy, about ±100 a notch), a double click, leaving the part. */
export interface PartPointerEvent { type: PartPointerType; x: number; y: number; dx: number; dy: number; shift: boolean; alt: boolean; meta: boolean }

export interface PartFrame {
  t: number; dt: number; level: number; peak: number; wave: Float32Array; spectrum: Float32Array;
  values: Record<string, PartValue>; norms: Record<string, number>; ranges: Record<string, PartRange>;
  colors: Record<string, string>; pointer: PartPointer;
}

export const NO_POINTER: PartPointer = { x: 0, y: 0, over: false, down: false, shift: false, alt: false, meta: false };
/** Cursors a part may show over itself. */
export const PART_CURSORS = ['default', 'pointer', 'grab', 'grabbing', 'crosshair', 'ns-resize', 'ew-resize', 'move', 'none'] as const;

/** A control's 0..1 position (XY pads: x). */
export function normOf(value: PartValue, range: PartRange | undefined): number {
  if (typeof value === 'object') return value.x;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return range ? toUnit(value, range.min, range.max, range.log) : 0;
}
const same = (a: PartValue | undefined, b: PartValue) => typeof b === 'object' ? !!a && typeof a === 'object' && Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9 : typeof b === 'number' ? typeof a === 'number' && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)) : a === b;

/** What the part wrote that the page has not shown back yet. */
export type PendingWrites = Map<string, { value: PartValue; at: number }>;
/**
 * A frame may have left the page before the page saw the part's last write; it
 * then still carries the old value. Until a frame shows the written value (or
 * `holdMs` passes), the part keeps seeing what it wrote, so a burst of relative
 * moves (wheel turns) adds up instead of starting over from a stale value.
 */
export function overlayPending(frame: Pick<PartFrame, 'values' | 'norms' | 'ranges'>, pending: PendingWrites, now: number, holdMs = 500) {
  for (const [id, p] of pending) {
    if (now - p.at > holdMs || same(frame.values[id], p.value) || frame.values[id] === undefined) { pending.delete(id); continue; }
    frame.values[id] = p.value;
    frame.norms[id] = normOf(p.value, frame.ranges[id]);
  }
}

export class PartWriteError extends Error { constructor(message: string) { super(message); this.name = 'PartWriteError'; } }

/**
 * Check a write by the part (f.set / f.setNorm) against the frame it saw and
 * update that frame, so later reads in the same frame see the new value.
 * Returns the values to send to the control (`value`, or `x` and `y`).
 */
export function writeControl(frame: Pick<PartFrame, 'values' | 'norms' | 'ranges'>, id: string, v: unknown, norm = false): Record<string, number | boolean> {
  const current = frame.values[id];
  if (current === undefined) {
    const known = Object.keys(frame.values);
    throw new PartWriteError(`f.${norm ? 'setNorm' : 'set'}: no control "${id}".${known.length ? ` Controls: ${known.join(', ')}.` : ' Add a knob, slider, switch or XY pad to the patch first (it need not be on the plugin).'}`);
  }
  if (typeof current === 'object') {
    const p = v as { x?: unknown; y?: unknown } | null;
    if (!p || typeof p !== 'object' || typeof p.x !== 'number' || typeof p.y !== 'number' || !Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new PartWriteError(`f.set('${id}', {x, y}): an XY pad takes x and y from 0 to 1.`);
    const x = Math.min(1, Math.max(0, p.x)), y = Math.min(1, Math.max(0, p.y));
    frame.values[id] = { x, y }; frame.norms[id] = x;
    return { x, y };
  }
  if (typeof current === 'boolean') {
    if (typeof v !== 'boolean' && (typeof v !== 'number' || !Number.isFinite(v))) throw new PartWriteError(`f.set('${id}', on): a switch takes true or false.`);
    const on = typeof v === 'boolean' ? v : v >= 0.5;
    frame.values[id] = on; frame.norms[id] = on ? 1 : 0;
    return { value: on };
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new PartWriteError(`f.${norm ? 'setNorm' : 'set'}('${id}', ${norm ? 'n' : 'value'}): ${norm ? 'n must be a number from 0 to 1' : 'the value must be a number'}.`);
  const r = frame.ranges[id];
  const value = norm ? (r ? fromUnit(v, r.min, r.max, r.log) : Math.min(1, Math.max(0, v))) : r ? Math.min(r.max, Math.max(r.min, v)) : v;
  frame.values[id] = value;
  frame.norms[id] = r ? toUnit(value, r.min, r.max, r.log) : 0;
  return { value };
}

// What a canvas is given each frame, and how it moves controls. Shared by
// the page (canvas-runtime.ts, PluginCanvas.vue) and the canvas's worker; no DOM here,
// so the rules are unit-tested in Node.
import { fromUnit, toUnit } from './format.ts';

/** A control's range, for drawing scales and turning 0..1 into its own units. */
export interface CanvasRange { min: number; max: number; log: boolean; unit: string }
export type CanvasValue = number | boolean | { x: number; y: number };
/** Where the mouse is over the canvas (in the canvas's own pixels). */
export interface CanvasPointer { x: number; y: number; over: boolean; down: boolean; shift: boolean; alt: boolean; meta: boolean }
export type CanvasPointerType = 'down' | 'move' | 'up' | 'wheel' | 'double' | 'leave';
/** One thing the mouse did: a press, a move, a release, a wheel turn (dy, about ±100 a notch), a double click, leaving the canvas. */
export interface CanvasPointerEvent { type: CanvasPointerType; x: number; y: number; dx: number; dy: number; shift: boolean; alt: boolean; meta: boolean }

export interface CanvasFrame {
  t: number; dt: number; level: number; peak: number; wave: Float32Array; spectrum: Float32Array;
  values: Record<string, CanvasValue>; norms: Record<string, number>; ranges: Record<string, CanvasRange>;
  /** The canvas's writes the page has taken in so far: every one numbered up to this. */
  acked: number;
  colors: Record<string, string>; pointer: CanvasPointer;
}
/** The controls as the page has them now (sent with every frame and every mouse event). */
export type CanvasControls = Pick<CanvasFrame, 'values' | 'norms' | 'ranges' | 'acked'>;

export const NO_POINTER: CanvasPointer = { x: 0, y: 0, over: false, down: false, shift: false, alt: false, meta: false };
/** Cursors a canvas may show over itself. */
export const CANVAS_CURSORS = ['default', 'pointer', 'grab', 'grabbing', 'crosshair', 'ns-resize', 'ew-resize', 'move', 'none'] as const;

/** A control's 0..1 position (XY pads: x). */
export function normOf(value: CanvasValue, range: CanvasRange | undefined): number {
  if (typeof value === 'object') return value.x;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return range ? toUnit(value, range.min, range.max, range.log) : 0;
}

/** What the canvas wrote, by control: the value and the write's number (the page takes writes in in order). */
export type PendingWrites = Map<string, { value: CanvasValue; write: number }>;
/**
 * A frame or a mouse event may have left the page before the page took in the
 * canvas's last writes; it then still carries the old values. Until the page has
 * taken a write in (`acked` reaches its number), the canvas keeps seeing what it
 * wrote, so a burst of relative moves (wheel turns) adds up instead of starting
 * over from a stale value. After that the page has the say, whatever it did
 * with the write (an undo may already have changed the value again).
 */
export function overlayPending(controls: Pick<CanvasFrame, 'values' | 'norms' | 'ranges'>, pending: PendingWrites, acked: number) {
  for (const [id, p] of pending) {
    if (p.write <= acked || controls.values[id] === undefined) { pending.delete(id); continue; }
    controls.values[id] = p.value;
    controls.norms[id] = normOf(p.value, controls.ranges[id]);
  }
}

export class CanvasWriteError extends Error { constructor(message: string) { super(message); this.name = 'CanvasWriteError'; } }

/**
 * Check a write by the canvas (f.set / f.setNorm) against the frame it saw and
 * update that frame, so later reads in the same frame see the new value.
 * Returns the values to send to the control (`value`, or `x` and `y`).
 */
export function writeControl(frame: Pick<CanvasFrame, 'values' | 'norms' | 'ranges'>, id: string, v: unknown, norm = false): Record<string, number | boolean> {
  const current = frame.values[id];
  if (current === undefined) {
    const known = Object.keys(frame.values);
    throw new CanvasWriteError(`f.${norm ? 'setNorm' : 'set'}: no control "${id}".${known.length ? ` Controls: ${known.join(', ')}.` : ' Add a knob, slider, switch or XY pad to the patch first (it need not be on the plugin).'}`);
  }
  if (typeof current === 'object') {
    const p = v as { x?: unknown; y?: unknown } | null;
    if (!p || typeof p !== 'object' || typeof p.x !== 'number' || typeof p.y !== 'number' || !Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new CanvasWriteError(`f.set('${id}', {x, y}): an XY pad takes x and y from 0 to 1.`);
    const x = Math.min(1, Math.max(0, p.x)), y = Math.min(1, Math.max(0, p.y));
    frame.values[id] = { x, y }; frame.norms[id] = x;
    return { x, y };
  }
  if (typeof current === 'boolean') {
    if (typeof v !== 'boolean' && (typeof v !== 'number' || !Number.isFinite(v))) throw new CanvasWriteError(`f.set('${id}', on): a switch takes true or false.`);
    const on = typeof v === 'boolean' ? v : v >= 0.5;
    frame.values[id] = on; frame.norms[id] = on ? 1 : 0;
    return { value: on };
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new CanvasWriteError(`f.${norm ? 'setNorm' : 'set'}('${id}', ${norm ? 'n' : 'value'}): ${norm ? 'n must be a number from 0 to 1' : 'the value must be a number'}.`);
  const r = frame.ranges[id];
  const value = norm ? (r ? fromUnit(v, r.min, r.max, r.log) : Math.min(1, Math.max(0, v))) : r ? Math.min(r.max, Math.max(r.min, v)) : v;
  frame.values[id] = value;
  frame.norms[id] = r ? toUnit(value, r.min, r.max, r.log) : 0;
  return { value };
}

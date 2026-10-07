// Runs one custom part: the user's module draws on an OffscreenCanvas every
// frame. The module default-exports draw(ctx, f) or { setup(ctx, f), draw(ctx, f),
// pointer(e, f) }. With pointer, the part takes the mouse while the plugin plays:
// e is a press, a move, a release, a wheel turn, a double click or the mouse
// leaving, at e.x, e.y in the part; f.set / f.setNorm move controls the way a hand
// on them would (the page makes one press one undo step).
// Nothing here can reach the page; network APIs are taken away before the code loads.
/// <reference lib="webworker" />
import { NO_POINTER, PART_CURSORS, overlayPending, writeControl, type PartControls, type PartFrame, type PartPointer, type PartPointerEvent, type PartRange, type PartValue, type PendingWrites } from './part-api.ts';

interface Frame {
  t: number; dt: number; w: number; h: number;
  level: number; peak: number; wave: Float32Array; spectrum: Float32Array;
  props: Record<string, unknown>; state: Record<string, unknown>; pointer: PartPointer;
  value(id: string): number; norm(id: string): number; xy(id: string): { x: number; y: number }; on(id: string): boolean; color(token: string): string;
  range(id: string): PartRange;
  set(id: string, value: PartValue): void; setNorm(id: string, n: number): void; cursor(name: string): void;
}
type Draw = (ctx: OffscreenCanvasRenderingContext2D, f: Frame) => void;
type Pointer = (e: PartPointerEvent, f: Frame) => void;
type FrameMessage = { type: 'frame' } & PartFrame;
/** What a mouse event before the first frame sees of time and the sound. */
const QUIET: PartFrame = { t: 0, dt: 1 / 60, level: 0, peak: 0, wave: new Float32Array(256), spectrum: new Float32Array(64), values: {}, norms: {}, ranges: {}, acked: 0, colors: {}, pointer: NO_POINTER };

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let draw: Draw | null = null;
let setup: Draw | null = null;
let pointer: Pointer | null = null;
let size = { w: 1, h: 1, ratio: 1 };
let props: Record<string, unknown> = {};
let state: Record<string, unknown> = {};
let ready = false;
let generation = 0;
/** The latest frame's data, with the controls as the latest message (a frame or a mouse event) had them. */
let last: PartFrame | null = null;
/** Writes the page has not taken in yet (see overlayPending), and how many the part has made. */
const pending: PendingWrites = new Map();
let writes = 0;
let cursor = 'default';

for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'Worker', 'SharedWorker', 'indexedDB', 'caches', 'BroadcastChannel']) {
  for (let o: object | null = self; o; o = Object.getPrototypeOf(o)) { try { delete (o as Record<string, unknown>)[name]; } catch { /* not ours to delete */ } }
  try { Object.defineProperty(self, name, { value: undefined, configurable: false, writable: false }); } catch { /* already gone */ }
}

/** The line of the user's code an error points at (blob: module stack). */
function lineOf(error: unknown): number | undefined {
  const m = /blob:[^\s)]*:(\d+):\d+/.exec(error instanceof Error ? error.stack ?? '' : '');
  return m ? Number(m[1]) : undefined;
}
const fail = (error: unknown, where: string) => { ready = false; postMessage({ type: 'error', message: `${where}: ${error instanceof Error ? error.message : String(error)}`, line: lineOf(error) }); };

function frameOf(m: PartFrame): Frame {
  return {
    t: m.t, dt: m.dt, w: size.w, h: size.h, level: m.level, peak: m.peak, wave: m.wave, spectrum: m.spectrum, props, state, pointer: m.pointer,
    value: id => { const v = m.values[id]; return typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : v ? v.x : 0; },
    norm: id => m.norms[id] ?? 0,
    xy: id => { const v = m.values[id]; return v && typeof v === 'object' ? v : { x: 0.5, y: 0.5 }; },
    on: id => { const v = m.values[id]; return typeof v === 'boolean' ? v : typeof v === 'number' ? v >= 0.5 : false; },
    color: token => m.colors[token] ?? token,
    range: id => m.ranges[id] ?? { min: 0, max: 1, log: false, unit: '' },
    set: (id, value) => write(m, id, writeControl(m, id, value)),
    setNorm: (id, n) => write(m, id, writeControl(m, id, n, true)),
    cursor: name => {
      if (!(PART_CURSORS as readonly string[]).includes(name)) throw new Error(`f.cursor: use one of ${PART_CURSORS.join(', ')}.`);
      if (name !== cursor) { cursor = name; postMessage({ type: 'cursor', cursor }); }
    },
  };
}

function write(m: PartFrame, id: string, values: Record<string, number | boolean>) {
  const n = ++writes;
  pending.set(id, { value: m.values[id]!, write: n });
  postMessage({ type: 'set', id, values, write: n });
}

function resize(w: number, h: number, ratio: number) {
  size = { w: Math.max(1, w), h: Math.max(1, h), ratio: Math.max(0.1, ratio) };
  if (!canvas || !ctx) return;
  canvas.width = Math.max(1, Math.round(size.w * size.ratio));
  canvas.height = Math.max(1, Math.round(size.h * size.ratio));
  ctx.setTransform(size.ratio, 0, 0, size.ratio, 0, 0);
}

async function load(code: string) {
  const mine = ++generation;
  ready = false; draw = null; setup = null; pointer = null; state = {}; pending.clear();
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  try {
    const mod = await import(/* @vite-ignore */ url);
    if (mine !== generation) return;
    const exported = mod.default;
    if (typeof exported === 'function') draw = exported;
    else if (exported && typeof exported.draw === 'function') {
      draw = exported.draw.bind(exported);
      setup = typeof exported.setup === 'function' ? exported.setup.bind(exported) : null;
      pointer = typeof exported.pointer === 'function' ? exported.pointer.bind(exported) : null;
    } else throw new Error('export default must be draw(ctx, f) or { setup, draw, pointer }');
    ready = true;
    postMessage({ type: 'loaded', interactive: !!pointer });
  } catch (error) { if (mine === generation) fail(error, 'Loading'); }
  finally { URL.revokeObjectURL(url); }
}

let needsSetup = true;
onmessage = async (e: MessageEvent) => {
  const m = e.data;
  if (m.type === 'init') { canvas = m.canvas; ctx = canvas!.getContext('2d'); resize(m.w, m.h, m.ratio); props = m.props ?? {}; await load(m.code); needsSetup = true; }
  else if (m.type === 'code') { props = m.props ?? {}; await load(m.code); needsSetup = true; }
  else if (m.type === 'props') { props = m.props ?? {}; }
  else if (m.type === 'resize') { resize(m.w, m.h, m.ratio); needsSetup = true; }
  else if (m.type === 'snapshot') {
    // A picture of what the part shows now (the page cannot read a canvas it gave away).
    try { postMessage({ type: 'snapshot', seq: m.seq, blob: canvas ? await canvas.convertToBlob({ type: 'image/png' }) : null }); }
    catch { postMessage({ type: 'snapshot', seq: m.seq, blob: null }); }
  }
  else if (m.type === 'pointer') {
    // The event carries the controls as the page has them now: the last frame may be from before an
    // undo or a redo (or from before a frame could be sent at all). The pointer state follows every
    // event, so the next frame draws the mouse where it is.
    const ev = m.event as PartPointerEvent;
    const c = m.controls as PartControls;
    overlayPending(c, pending, c.acked);
    last = { ...(last ?? QUIET), values: c.values, norms: c.norms, ranges: c.ranges, acked: c.acked, pointer: m.pointer as PartPointer };
    if (ready && pointer) {
      try { pointer(ev, frameOf(last)); }
      catch (error) { fail(error, 'Pointer'); }
    }
    postMessage({ type: 'handled', seq: m.seq });
  }
  else if (m.type === 'frame') {
    const fm = m as FrameMessage;
    overlayPending(fm, pending, fm.acked);
    last = { ...fm, pointer: fm.pointer ?? NO_POINTER };
    if (!ready || !ctx || !draw) { postMessage({ type: 'drawn' }); return; }
    const f = frameOf(last);
    try {
      ctx.save();
      if (needsSetup && setup) setup(ctx, f);
      needsSetup = false;
      draw(ctx, f);
      ctx.restore();
      postMessage({ type: 'drawn' });
    } catch (error) { try { ctx.restore(); } catch { /* ignore */ } fail(error, 'Drawing'); postMessage({ type: 'drawn' }); }
  }
};

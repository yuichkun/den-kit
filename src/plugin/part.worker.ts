// Runs one custom part: the user's module draws on an OffscreenCanvas every
// frame. The module default-exports draw(ctx, f) or { setup(ctx, f), draw(ctx, f) }.
// Nothing here can reach the page; network APIs are taken away before the code loads.
/// <reference lib="webworker" />

type Draw = (ctx: OffscreenCanvasRenderingContext2D, f: Frame) => void;
interface Frame {
  t: number; dt: number; w: number; h: number;
  level: number; peak: number; wave: Float32Array; spectrum: Float32Array;
  props: Record<string, unknown>; state: Record<string, unknown>;
  value(id: string): number; norm(id: string): number; xy(id: string): { x: number; y: number }; on(id: string): boolean; color(token: string): string;
}
interface FrameMessage { type: 'frame'; t: number; dt: number; level: number; peak: number; wave: Float32Array; spectrum: Float32Array; values: Record<string, number | boolean | { x: number; y: number }>; norms: Record<string, number>; colors: Record<string, string> }

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let draw: Draw | null = null;
let setup: Draw | null = null;
let size = { w: 1, h: 1, ratio: 1 };
let props: Record<string, unknown> = {};
let state: Record<string, unknown> = {};
let ready = false;
let generation = 0;

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

function frameOf(m: FrameMessage): Frame {
  return {
    t: m.t, dt: m.dt, w: size.w, h: size.h, level: m.level, peak: m.peak, wave: m.wave, spectrum: m.spectrum, props, state,
    value: id => { const v = m.values[id]; return typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : v ? v.x : 0; },
    norm: id => m.norms[id] ?? 0,
    xy: id => { const v = m.values[id]; return v && typeof v === 'object' ? v : { x: 0.5, y: 0.5 }; },
    on: id => { const v = m.values[id]; return typeof v === 'boolean' ? v : typeof v === 'number' ? v >= 0.5 : false; },
    color: token => m.colors[token] ?? token,
  };
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
  ready = false; draw = null; setup = null; state = {};
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  try {
    const mod = await import(/* @vite-ignore */ url);
    if (mine !== generation) return;
    const exported = mod.default;
    if (typeof exported === 'function') draw = exported;
    else if (exported && typeof exported.draw === 'function') { draw = exported.draw.bind(exported); setup = typeof exported.setup === 'function' ? exported.setup.bind(exported) : null; }
    else throw new Error('export default must be draw(ctx, f) or { setup, draw }');
    ready = true;
    postMessage({ type: 'loaded' });
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
  else if (m.type === 'frame') {
    if (!ready || !ctx || !draw) { postMessage({ type: 'drawn' }); return; }
    const f = frameOf(m);
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

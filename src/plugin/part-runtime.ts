// The page side of a custom part: hands the canvas to a worker, feeds it a
// frame of data (time, the sound, control values and ranges, the look's
// colours, the mouse) each animation frame, one at a time, and stops it if a
// frame takes too long. Mouse events go to the worker as they happen; what the
// part writes to controls comes back through `onSet`.
import PartWorker from './part.worker.ts?worker';
import type { PartFrame, PartPointer, PartPointerEvent } from './part-api.ts';

export type { PartFrame };
export interface PartStatus { error: string | null; line?: number }
export interface PartEvents {
  status(status: PartStatus): void;
  /** The code loaded; `interactive`: it handles the mouse (exports pointer). */
  loaded?(interactive: boolean): void;
  /** The part moved a control. */
  set?(id: string, values: Record<string, number | boolean>): void;
  cursor?(cursor: string): void;
  /** The worker finished handling mouse event `seq` (and sent what it wrote). */
  handled?(seq: number): void;
}

/** How long one frame (or loading the code) may take before the part is stopped. */
export const PART_TIMEOUT_MS = 1500;

export class PartRunner {
  private worker: Worker | null = null;
  private busy = false;
  private since = 0;
  private dead = false;
  private seq = 0;
  private readonly snapshots = new Map<number, (blob: Blob | null) => void>();
  private readonly on: PartEvents;

  constructor(canvas: HTMLCanvasElement, code: string, props: Record<string, unknown>, size: { w: number; h: number; ratio: number }, on: PartEvents) {
    this.on = on;
    const offscreen = canvas.transferControlToOffscreen();
    this.worker = new PartWorker();
    this.worker.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === 'drawn' || m.type === 'loaded') { this.busy = false; if (m.type === 'loaded') { this.on.status({ error: null }); this.on.loaded?.(!!m.interactive); } }
      else if (m.type === 'error') this.on.status({ error: m.message, line: m.line });
      else if (m.type === 'set') this.on.set?.(String(m.id), m.values);
      else if (m.type === 'cursor') this.on.cursor?.(String(m.cursor));
      else if (m.type === 'handled') this.on.handled?.(Number(m.seq));
      else if (m.type === 'snapshot') { const done = this.snapshots.get(Number(m.seq)); this.snapshots.delete(Number(m.seq)); done?.(m.blob instanceof Blob ? m.blob : null); }
    };
    this.worker.onerror = e => { e.preventDefault(); this.on.status({ error: e.message || 'The part crashed.' }); };
    this.busy = true; this.since = performance.now();
    this.worker.postMessage({ type: 'init', canvas: offscreen, code, props, ...size }, [offscreen]);
  }

  setCode(code: string, props: Record<string, unknown>) { if (this.dead) return; this.busy = true; this.since = performance.now(); this.worker?.postMessage({ type: 'code', code, props }); }
  setProps(props: Record<string, unknown>) { this.worker?.postMessage({ type: 'props', props }); }
  resize(size: { w: number; h: number; ratio: number }) { this.worker?.postMessage({ type: 'resize', ...size }); }

  /** Pass a mouse event on; returns its sequence number (see `handled`), or -1 when the part is stopped. */
  pointer(event: PartPointerEvent, state: PartPointer): number {
    if (this.dead || !this.worker) return -1;
    const seq = ++this.seq;
    this.worker.postMessage({ type: 'pointer', event, pointer: state, seq });
    return seq;
  }

  /** A PNG of what the part shows now (null when it is stopped or does not answer in time). */
  snapshot(timeoutMs = 1000): Promise<Blob | null> {
    if (this.dead || !this.worker) return Promise.resolve(null);
    const seq = ++this.seq;
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.snapshots.delete(seq); resolve(null); }, timeoutMs);
      this.snapshots.set(seq, blob => { clearTimeout(timer); resolve(blob); });
      this.worker!.postMessage({ type: 'snapshot', seq });
    });
  }

  /** Send a frame unless the last one is still drawing; a frame stuck too long stops the part. */
  frame(data: () => PartFrame): boolean {
    if (this.dead || !this.worker) return false;
    if (this.busy) {
      if (performance.now() - this.since > PART_TIMEOUT_MS) { this.stop(); this.on.status({ error: `Stopped: one frame took longer than ${PART_TIMEOUT_MS / 1000} s (an endless loop?). Fix the code and apply it again.` }); }
      return false;
    }
    const f = data();
    this.busy = true; this.since = performance.now();
    this.worker.postMessage({ type: 'frame', ...f }, [f.wave.buffer, f.spectrum.buffer]);
    return true;
  }

  get stopped() { return this.dead; }
  stop() { this.dead = true; this.worker?.terminate(); this.worker = null; for (const done of this.snapshots.values()) done(null); this.snapshots.clear(); }
}

/** Each part's canvas → its runner, so a picture of the plugin can ask the part for what it shows. */
export const PART_CANVASES = new WeakMap<HTMLCanvasElement, PartRunner>();
export function partSnapshot(canvas: HTMLCanvasElement): Promise<Blob | null> | null {
  const runner = PART_CANVASES.get(canvas);
  return runner ? runner.snapshot() : null;
}

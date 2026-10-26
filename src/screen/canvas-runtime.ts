// The page side of a canvas: hands the canvas to a worker, feeds it a
// frame of data (time, the sound, control values and ranges, the look's
// colours, the mouse) each animation frame, one at a time, and stops it if a
// frame takes too long. Mouse events go to the worker as they happen, each with
// the controls as they are then; what the canvas writes to controls comes back
// through `set`, numbered, and the page says which writes it has taken in
// (`acked` in the controls it sends).
import CanvasWorker from './canvas.worker.ts?worker';
import type {
  CanvasControls,
  CanvasFrame,
  CanvasPointer,
  CanvasPointerEvent,
} from './canvas-api.ts';

export type { CanvasFrame };
export interface CanvasStatus {
  error: string | null;
  line?: number;
}
export interface CanvasEvents {
  status(status: CanvasStatus): void;
  /** The code loaded; `interactive`: it handles the mouse (exports pointer). */
  loaded?(interactive: boolean): void;
  /** The canvas moved a control (its `write`-th write). */
  set?(id: string, values: Record<string, number | boolean>, write: number): void;
  cursor?(cursor: string): void;
  /** The worker finished handling mouse event `seq` (and sent what it wrote). */
  handled?(seq: number): void;
}

/** How long one frame (or loading the code) may take before the canvas is stopped. */
export const CANVAS_TIMEOUT_MS = 1500;

export class CanvasRunner {
  private worker: Worker | null = null;
  private busy = false;
  private since = 0;
  private dead = false;
  private seq = 0;
  private readonly snapshots = new Map<number, (blob: Blob | null) => void>();
  private readonly on: CanvasEvents;

  constructor(
    canvas: HTMLCanvasElement,
    code: string,
    props: Record<string, unknown>,
    size: { w: number; h: number; ratio: number },
    on: CanvasEvents,
  ) {
    this.on = on;
    const offscreen = canvas.transferControlToOffscreen();
    this.worker = new CanvasWorker();
    this.worker.onmessage = (e: MessageEvent) => {
      if (this.dead) return; // stopped: what it still had on the way is not this canvas's any more
      const m = e.data;
      if (m.type === 'drawn' || m.type === 'loaded') {
        this.busy = false;
        if (m.type === 'loaded') {
          this.on.status({ error: null });
          this.on.loaded?.(!!m.interactive);
        }
      } else if (m.type === 'error') this.on.status({ error: m.message, line: m.line });
      else if (m.type === 'set') this.on.set?.(String(m.id), m.values, Number(m.write));
      else if (m.type === 'cursor') this.on.cursor?.(String(m.cursor));
      else if (m.type === 'handled') this.on.handled?.(Number(m.seq));
      else if (m.type === 'snapshot') {
        const done = this.snapshots.get(Number(m.seq));
        this.snapshots.delete(Number(m.seq));
        done?.(m.blob instanceof Blob ? m.blob : null);
      }
    };
    this.worker.onerror = e => {
      e.preventDefault();
      if (!this.dead) this.on.status({ error: e.message || 'The canvas crashed.' });
    };
    this.busy = true;
    this.since = performance.now();
    this.worker.postMessage({ type: 'init', canvas: offscreen, code, props, ...size }, [offscreen]);
  }

  setCode(code: string, props: Record<string, unknown>) {
    if (this.dead) return;
    this.busy = true;
    this.since = performance.now();
    this.worker?.postMessage({ type: 'code', code, props });
  }
  setProps(props: Record<string, unknown>) {
    this.worker?.postMessage({ type: 'props', props });
  }
  resize(size: { w: number; h: number; ratio: number }) {
    this.worker?.postMessage({ type: 'resize', ...size });
  }

  /** Pass a mouse event on, with the controls as they are now; returns its sequence number (see `handled`), or -1 when the canvas is stopped. */
  pointer(event: CanvasPointerEvent, state: CanvasPointer, controls: CanvasControls): number {
    if (this.dead || !this.worker) return -1;
    const seq = ++this.seq;
    this.worker.postMessage({ type: 'pointer', event, pointer: state, controls, seq });
    return seq;
  }

  /** A PNG of what the canvas shows now (null when it is stopped or does not answer in time). */
  snapshot(timeoutMs = 1000): Promise<Blob | null> {
    if (this.dead || !this.worker) return Promise.resolve(null);
    const seq = ++this.seq;
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.snapshots.delete(seq);
        resolve(null);
      }, timeoutMs);
      this.snapshots.set(seq, blob => {
        clearTimeout(timer);
        resolve(blob);
      });
      this.worker!.postMessage({ type: 'snapshot', seq });
    });
  }

  /** Send a frame unless the last one is still drawing; a frame stuck too long stops the canvas. */
  frame(data: () => CanvasFrame): boolean {
    if (this.dead || !this.worker) return false;
    if (this.busy) {
      if (performance.now() - this.since > CANVAS_TIMEOUT_MS) {
        this.stop();
        this.on.status({
          error: `Stopped: one frame took longer than ${CANVAS_TIMEOUT_MS / 1000} s (an endless loop?). Fix the code and apply it again.`,
        });
      }
      return false;
    }
    const f = data();
    this.busy = true;
    this.since = performance.now();
    this.worker.postMessage({ type: 'frame', ...f }, [f.wave.buffer, f.spectrum.buffer]);
    return true;
  }

  get stopped() {
    return this.dead;
  }
  stop() {
    this.dead = true;
    this.worker?.terminate();
    this.worker = null;
    for (const done of this.snapshots.values()) done(null);
    this.snapshots.clear();
  }
}

/** Each canvas's canvas → its runner, so a picture of the plugin can ask the canvas for what it shows. */
export const CANVAS_RUNNERS = new WeakMap<HTMLCanvasElement, CanvasRunner>();
export function canvasSnapshot(canvas: HTMLCanvasElement): Promise<Blob | null> | null {
  const runner = CANVAS_RUNNERS.get(canvas);
  return runner ? runner.snapshot() : null;
}

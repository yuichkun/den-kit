// The page side of a custom part: hands the canvas to a worker, feeds it a
// frame of data (time, the sound, control values, the look's colours) each
// animation frame, one at a time, and stops it if a frame takes too long.
import PartWorker from './part.worker.ts?worker';

export interface PartFrame { t: number; dt: number; level: number; peak: number; wave: Float32Array; spectrum: Float32Array; values: Record<string, number | boolean | { x: number; y: number }>; norms: Record<string, number>; colors: Record<string, string> }
export interface PartStatus { error: string | null; line?: number }

/** How long one frame (or loading the code) may take before the part is stopped. */
export const PART_TIMEOUT_MS = 1500;

export class PartRunner {
  private worker: Worker | null = null;
  private busy = false;
  private since = 0;
  private dead = false;
  private readonly onStatus: (status: PartStatus) => void;

  constructor(canvas: HTMLCanvasElement, code: string, props: Record<string, unknown>, size: { w: number; h: number; ratio: number }, onStatus: (status: PartStatus) => void) {
    this.onStatus = onStatus;
    const offscreen = canvas.transferControlToOffscreen();
    this.worker = new PartWorker();
    this.worker.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === 'drawn' || m.type === 'loaded') { this.busy = false; if (m.type === 'loaded') this.onStatus({ error: null }); }
      else if (m.type === 'error') this.onStatus({ error: m.message, line: m.line });
    };
    this.worker.onerror = e => { e.preventDefault(); this.onStatus({ error: e.message || 'The part crashed.' }); };
    this.busy = true; this.since = performance.now();
    this.worker.postMessage({ type: 'init', canvas: offscreen, code, props, ...size }, [offscreen]);
  }

  setCode(code: string, props: Record<string, unknown>) { if (this.dead) return; this.busy = true; this.since = performance.now(); this.worker?.postMessage({ type: 'code', code, props }); }
  setProps(props: Record<string, unknown>) { this.worker?.postMessage({ type: 'props', props }); }
  resize(size: { w: number; h: number; ratio: number }) { this.worker?.postMessage({ type: 'resize', ...size }); }

  /** Send a frame unless the last one is still drawing; a frame stuck too long stops the part. */
  frame(data: () => PartFrame): boolean {
    if (this.dead || !this.worker) return false;
    if (this.busy) {
      if (performance.now() - this.since > PART_TIMEOUT_MS) { this.stop(); this.onStatus({ error: `Stopped: one frame took longer than ${PART_TIMEOUT_MS / 1000} s (an endless loop?). Fix the code and apply it again.` }); }
      return false;
    }
    const f = data();
    this.busy = true; this.since = performance.now();
    this.worker.postMessage({ type: 'frame', ...f }, [f.wave.buffer, f.spectrum.buffer]);
    return true;
  }

  get stopped() { return this.dead; }
  stop() { this.dead = true; this.worker?.terminate(); this.worker = null; }
}

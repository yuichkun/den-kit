// Offline renders for the listening tool, on their own worker so they never
// delay or supersede the live patch's compiles. One render at a time; a render
// that hangs (a codebox loop) is cut off and the worker replaced.
import type { Issue } from '../core/issues.ts';
import type { ListenReport } from '../core/analysis.ts';
import type { RenderRequest, RenderResponse } from './protocol.ts';

export interface RenderWorkerLike {
  onmessage: ((event: { data: RenderResponse | { id: number; phase: string } }) => void) | null;
  onerror: ((event: { message?: string; preventDefault?: () => void }) => void) | null;
  postMessage(message: RenderRequest): void;
  terminate(): void;
}

export class RenderFailure extends Error {
  readonly issues: Issue[];
  constructor(message: string, issues: Issue[] = []) {
    super(message);
    this.name = 'RenderFailure';
    this.issues = issues;
  }
}

export interface Rendered {
  report: ListenReport;
  png?: Uint8Array;
  renderMs: number;
}
type Job = {
  request: Omit<RenderRequest, 'id' | 'kind'>;
  resolve: (r: Rendered) => void;
  reject: (e: unknown) => void;
};

export class RenderClient {
  private worker: RenderWorkerLike | null = null;
  private queue: Job[] = [];
  private current: (Job & { id: number; timer: ReturnType<typeof setTimeout> }) | null = null;
  private serial = 0;
  private readonly createWorker: () => RenderWorkerLike;
  private readonly timeoutMs: number;
  readonly stats = { rendered: 0, failed: 0, timeouts: 0 };

  constructor(options: { createWorker: () => RenderWorkerLike; timeoutMs?: number }) {
    this.createWorker = options.createWorker;
    this.timeoutMs = options.timeoutMs ?? 45000;
  }

  render(request: Omit<RenderRequest, 'id' | 'kind'>): Promise<Rendered> {
    return new Promise((resolve, reject) => {
      this.queue.push({ request, resolve, reject });
      this.pump();
    });
  }

  private pump() {
    if (this.current || !this.queue.length) return;
    const job = this.queue.shift()!;
    const id = ++this.serial;
    const timer = setTimeout(
      () =>
        this.fail(
          id,
          new RenderFailure(
            `Rendering took longer than ${Math.round(this.timeoutMs / 1000)} s and was stopped.`,
          ),
          true,
        ),
      this.timeoutMs,
    );
    this.current = { ...job, id, timer };
    const worker = this.ensureWorker();
    worker.postMessage({ ...job.request, id, kind: 'render' });
  }

  private ensureWorker(): RenderWorkerLike {
    if (this.worker) return this.worker;
    const worker = this.createWorker();
    worker.onmessage = event => {
      const data = event.data;
      if (worker !== this.worker || !this.current || data.id !== this.current.id || 'phase' in data)
        return;
      if ('error' in data) {
        this.fail(data.id, new RenderFailure(data.error.message, data.error.issues));
        return;
      }
      const job = this.current;
      clearTimeout(job.timer);
      this.current = null;
      this.stats.rendered++;
      job.resolve({
        report: data.report,
        png: data.png ? new Uint8Array(data.png) : undefined,
        renderMs: data.renderMs,
      });
      this.pump();
    };
    worker.onerror = event => {
      event.preventDefault?.();
      if (this.current)
        this.fail(
          this.current.id,
          new RenderFailure(event.message || 'The render worker crashed.'),
          true,
        );
    };
    this.worker = worker;
    return worker;
  }

  private fail(id: number, error: RenderFailure, replace = false) {
    const job = this.current;
    if (!job || job.id !== id) return;
    clearTimeout(job.timer);
    this.current = null;
    this.stats.failed++;
    if (replace) {
      if (error.message.includes('longer than')) this.stats.timeouts++;
      try {
        this.worker?.terminate();
      } catch {
        /* gone */
      }
      this.worker = null;
    }
    job.reject(error);
    this.pump();
  }

  dispose() {
    try {
      this.worker?.terminate();
    } catch {
      /* gone */
    }
    this.worker = null;
    if (this.current) {
      clearTimeout(this.current.timer);
      this.current.reject(new RenderFailure('Stopped.'));
      this.current = null;
    }
    for (const job of this.queue.splice(0)) job.reject(new RenderFailure('Stopped.'));
  }
}

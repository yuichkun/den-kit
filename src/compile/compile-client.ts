// Main-thread side of compilation. One compile in flight; newer requests replace
// the queued one (latest wins), so a burst of edits compiles at most twice and a
// stale artifact can never overwrite a newer patch. A hung worker (e.g. a
// codebox infinite loop at build time) is terminated and replaced.
import type { Generated } from '../core/codegen.ts';
import type { Issue } from '../core/issues.ts';
import type { Artifact, CompileRequest, CompileResponse } from './protocol.ts';

export interface WorkerLike {
  onmessage: ((event: { data: CompileResponse }) => void) | null;
  onerror: ((event: { message?: string; preventDefault?: () => void }) => void) | null;
  onmessageerror?: ((event: unknown) => void) | null;
  postMessage(message: CompileRequest): void;
  terminate(): void;
}

export class CompileFailure extends Error {
  readonly issues: Issue[];
  readonly kind: 'error' | 'timeout' | 'superseded' | 'crashed' | 'disposed';
  constructor(message: string, issues: Issue[], kind: CompileFailure['kind']) {
    super(message);
    this.name = 'CompileFailure';
    this.issues = issues;
    this.kind = kind;
  }
}

export interface CompileInputs {
  nodes: string[];
  codeboxes: CompileRequest['codeboxes'];
}
interface Job {
  generated: Generated;
  inputs: CompileInputs;
  resolve: (a: Artifact) => void;
  reject: (e: unknown) => void;
  onPhase?: (phase: string) => void;
}

export interface CompileClientOptions {
  createWorker: () => WorkerLike;
  timeoutMs?: number;
  cacheSize?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export class CompileClient {
  private worker: WorkerLike | null = null;
  private serial = 0;
  private inflight: (Job & { id: number; timer: unknown }) | null = null;
  private queued: Job | null = null;
  private readonly cache = new Map<string, Artifact>();
  private disposed = false;
  readonly stats = {
    started: 0,
    completed: 0,
    failed: 0,
    timeouts: 0,
    cacheHits: 0,
    workersCreated: 0,
  };
  private readonly options: Required<Omit<CompileClientOptions, 'createWorker'>> &
    Pick<CompileClientOptions, 'createWorker'>;

  constructor(options: CompileClientOptions) {
    this.options = {
      cacheSize: 8,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: h => clearTimeout(h as ReturnType<typeof setTimeout>),
      ...options,
      timeoutMs: options.timeoutMs ?? 20000,
    };
  }

  /** Keep an artifact compiled elsewhere (an LLM draft), so applying that draft swaps in at once. */
  prime(artifact: Artifact) {
    if (!this.disposed && !this.cache.has(artifact.hash)) this.remember(artifact);
  }

  /** Cached artifact for a hash (A/B and takes never recompile). */
  cached(hash: string): Artifact | undefined {
    const hit = this.cache.get(hash);
    if (hit) {
      this.cache.delete(hash);
      this.cache.set(hash, hit);
    }
    return hit;
  }

  compile(
    generated: Generated,
    inputs: CompileInputs,
    onPhase?: (phase: string) => void,
  ): Promise<Artifact> {
    if (this.disposed)
      return Promise.reject(new CompileFailure('Compiler is disposed.', [], 'disposed'));
    const hit = this.cached(generated.hash);
    if (hit) {
      this.stats.cacheHits++;
      return Promise.resolve(hit);
    }
    if (this.inflight?.generated.hash === generated.hash) {
      // Same program already compiling: share the result.
      const inflight = this.inflight;
      return new Promise((resolve, reject) => {
        const { resolve: r0, reject: j0 } = inflight;
        inflight.resolve = a => {
          r0(a);
          resolve(a);
        };
        inflight.reject = e => {
          j0(e);
          reject(e);
        };
      });
    }
    return new Promise<Artifact>((resolve, reject) => {
      if (this.queued)
        this.queued.reject(new CompileFailure('Superseded by a newer edit.', [], 'superseded'));
      this.queued = { generated, inputs, resolve, reject, onPhase };
      this.pump();
    });
  }

  private ensureWorker(): WorkerLike {
    if (this.worker) return this.worker;
    const worker = this.options.createWorker();
    this.stats.workersCreated++;
    worker.onmessage = event => this.receive(worker, event.data);
    worker.onerror = event => {
      event.preventDefault?.();
      this.crash(worker, event.message || 'The compile worker crashed.');
    };
    worker.onmessageerror = () => this.crash(worker, 'The compile result could not be read.');
    this.worker = worker;
    return worker;
  }

  private pump() {
    if (this.inflight || !this.queued || this.disposed) return;
    const job = this.queued;
    this.queued = null;
    const hit = this.cached(job.generated.hash);
    if (hit) {
      this.stats.cacheHits++;
      job.resolve(hit);
      this.pump();
      return;
    }
    const worker = this.ensureWorker();
    const id = ++this.serial;
    const timer = this.options.setTimer(() => this.timeout(id), this.options.timeoutMs);
    this.inflight = { ...job, id, timer };
    this.stats.started++;
    worker.postMessage({
      id,
      hash: job.generated.hash,
      source: job.generated.source,
      nodes: job.inputs.nodes,
      codeboxes: job.inputs.codeboxes,
    });
  }

  private receive(worker: WorkerLike, data: CompileResponse) {
    const job = this.inflight;
    if (worker !== this.worker || !job || data.id !== job.id) return; // stale worker or stale job
    if ('phase' in data) {
      job.onPhase?.(data.phase);
      return;
    }
    this.options.clearTimer(job.timer);
    this.inflight = null;
    if ('result' in data) {
      this.stats.completed++;
      this.remember(data.result);
      job.resolve(data.result);
    } else {
      this.stats.failed++;
      job.reject(new CompileFailure(data.error.message, data.error.issues ?? [], 'error'));
    }
    this.pump();
  }

  private timeout(id: number) {
    const job = this.inflight;
    if (!job || job.id !== id) return;
    this.stats.timeouts++;
    this.replaceWorker();
    this.inflight = null;
    const codebox = Object.keys(job.generated.codeboxes);
    job.reject(
      new CompileFailure(
        `Compilation timed out after ${Math.round(this.options.timeoutMs / 1000)} s.${codebox.length ? ' Check codebox code for endless loops at build time.' : ''}`,
        codebox.map(node => ({
          severity: 'warning' as const,
          code: 'compile-timeout',
          node,
          message: 'Compilation timed out; this codebox may loop forever while building.',
        })),
        'timeout',
      ),
    );
    this.pump();
  }

  private crash(worker: WorkerLike, message: string) {
    if (worker !== this.worker) return;
    this.replaceWorker();
    const job = this.inflight;
    this.inflight = null;
    if (job) {
      this.options.clearTimer(job.timer);
      this.stats.failed++;
      job.reject(new CompileFailure(message, [], 'crashed'));
    }
    this.pump();
  }

  private replaceWorker() {
    try {
      this.worker?.terminate();
    } catch {
      /* already gone */
    }
    this.worker = null;
  }

  private remember(artifact: Artifact) {
    this.cache.set(artifact.hash, artifact);
    while (this.cache.size > this.options.cacheSize)
      this.cache.delete(this.cache.keys().next().value!);
  }

  dispose() {
    this.disposed = true;
    if (this.inflight) {
      this.options.clearTimer(this.inflight.timer);
      this.inflight.reject(new CompileFailure('Compiler is disposed.', [], 'disposed'));
      this.inflight = null;
    }
    if (this.queued) {
      this.queued.reject(new CompileFailure('Compiler is disposed.', [], 'disposed'));
      this.queued = null;
    }
    this.replaceWorker();
  }
}

/** Inputs the worker needs besides the generated source, derived from the document. */
/** What the compile worker needs besides the source: node ids for error messages and the codeboxes to type-check (on the generated program's ids). */
export function compileInputs(
  _doc: import('../core/schema.ts').PatchDocument,
  generated: Generated,
): CompileInputs {
  return {
    nodes: generated.nodes,
    codeboxes: Object.entries(generated.codeboxes).map(([node, line]) => ({
      node,
      line,
      code: generated.boxes[node]?.code ?? '',
      inputs: generated.boxes[node]?.inputs ?? [],
      outputs: generated.boxes[node]?.outputs ?? [],
    })),
  };
}

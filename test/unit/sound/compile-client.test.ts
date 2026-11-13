import { describe, expect, it } from 'vite-plus/test';
import {
  CompileClient,
  CompileFailure,
  type WorkerLike,
} from '../../../src/sound/compile/compile-client.ts';
import type { Generated } from '../../../src/sound/codegen.ts';
import type { CompileRequest } from '../../../src/sound/compile/protocol.ts';
import { compileKey, DEFAULT_COMPILE_TARGET } from '../../../src/sound/compile/target.ts';

class FakeWorker implements WorkerLike {
  onmessage: WorkerLike['onmessage'] = null;
  onerror: WorkerLike['onerror'] = null;
  onmessageerror: WorkerLike['onmessageerror'] = null;
  received: CompileRequest[] = [];
  terminated = false;
  postMessage(m: CompileRequest) {
    this.received.push(m);
  }
  terminate() {
    this.terminated = true;
  }
  succeed(i = this.received.length - 1) {
    const r = this.received[i]!;
    this.onmessage?.({
      data: {
        id: r.id,
        result: {
          hash: r.hash,
          meta: {} as never,
          moduleSource: 'unexpected worker-supplied executable source',
          wasm: new ArrayBuffer(1),
          processorName: `p-${compileKey(r.hash, r.target)}`,
          ...r.target,
          schemaHash: `schema-${compileKey(r.hash, r.target)}`,
          compileMs: 1,
        },
      },
    });
  }
  fail(message: string) {
    const r = this.received.at(-1)!;
    this.onmessage?.({
      data: { id: r.id, error: { message, issues: [{ severity: 'error', code: 'x', message }] } },
    });
  }
}
const gen = (hash: string): Generated => ({
  source: `// ${hash}`,
  hash,
  params: [],
  values: {},
  nodeLines: {},
  codeboxes: {},
  probes: [],
  voices: null,
  audioIn: false,
  issues: [],
  origin: {},
  nodes: [],
  boxes: {},
  assets: [],
});
const inputs = { nodes: [], codeboxes: [] };

function setup() {
  const workers: FakeWorker[] = [];
  const timers: Array<{ fn: () => void; ms: number; cleared: boolean }> = [];
  const client = new CompileClient({
    createWorker: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
    setTimer: (fn, ms) => {
      const t = { fn, ms, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimer: t => {
      (t as { cleared: boolean }).cleared = true;
    },
  });
  return { client, workers, timers };
}

describe('compile client', () => {
  it('a burst of edits compiles the first and the last only; superseded ones reject', async () => {
    const { client, workers } = setup();
    const results = ['a', 'b', 'c', 'd'].map(h =>
      client.compile(gen(h), inputs).then(
        a => a.hash,
        e => (e as CompileFailure).kind,
      ),
    );
    expect(workers[0]!.received.map(r => r.hash)).toEqual(['a']);
    workers[0]!.succeed();
    await Promise.resolve();
    expect(workers[0]!.received.map(r => r.hash)).toEqual(['a', 'd']);
    workers[0]!.succeed();
    expect(await Promise.all(results)).toEqual(['a', 'superseded', 'superseded', 'd']);
  });
  it('cache hits never recompile; identical in-flight requests share one compile', async () => {
    const { client, workers } = setup();
    const p1 = client.compile(gen('a'), inputs),
      p2 = client.compile(gen('a'), inputs);
    workers[0]!.succeed();
    expect((await p1).hash).toBe('a');
    expect((await p2).hash).toBe('a');
    await client.compile(gen('a'), inputs);
    expect(workers[0]!.received).toHaveLength(1);
    expect(client.stats.cacheHits).toBe(1);
  });
  it('constructs worklet code from data using the trusted runtime and requested identity', async () => {
    const { client, workers } = setup();
    const pending = client.compile(gen('a'), inputs);
    workers[0]!.succeed();
    const artifact = await pending;
    expect(artifact.processorName).toBe('den-kit-a-48000-128');
    expect(artifact.moduleSource).toContain('registerProcessor("den-kit-a-48000-128"');
    expect(artifact.moduleSource).not.toContain('unexpected worker-supplied executable source');
  });
  it('keeps the same patch at different rates and quanta in separate cache entries', async () => {
    const { client, workers } = setup();
    const targets = [
      DEFAULT_COMPILE_TARGET,
      { sampleRate: 44100, renderQuantumSize: 128 },
      { sampleRate: 44100, renderQuantumSize: 256 },
    ];
    const artifacts = [];
    for (const target of targets) {
      const pending = client.compile(gen('same-patch'), inputs, target);
      expect(workers[0]!.received.at(-1)!.target).toEqual(target);
      workers[0]!.succeed();
      const artifact = await pending;
      expect(artifact).toMatchObject(target);
      artifacts.push(artifact);
    }
    for (const [i, target] of targets.entries()) {
      expect(client.cached('same-patch', target)).toBe(artifacts[i]);
      expect(await client.compile(gen('same-patch'), inputs, target)).toBe(artifacts[i]);
    }
    expect(workers[0]!.received).toHaveLength(3);
  });
  it('shares an in-flight compile only when its rate and quantum match', async () => {
    const { client, workers } = setup();
    const first = { sampleRate: 44100, renderQuantumSize: 32 };
    const second = { sampleRate: 44100, renderQuantumSize: 256 };
    const a = client.compile(gen('same-patch'), inputs, first);
    const b = client.compile(gen('same-patch'), inputs, { ...first });
    const c = client.compile(gen('same-patch'), inputs, second);
    expect(workers[0]!.received).toHaveLength(1);
    workers[0]!.succeed();
    expect(await a).toBe(await b);
    expect(workers[0]!.received.map(r => r.target)).toEqual([first, second]);
    workers[0]!.succeed();
    expect(await c).toMatchObject(second);
    expect(await c).not.toBe(await a);
  });
  it('primes drafts only for the target they were compiled for', async () => {
    const { client, workers } = setup();
    const target = { sampleRate: 96000, renderQuantumSize: 128 };
    const pending = client.compile(gen('draft'), inputs, target);
    workers[0]!.succeed();
    const artifact = await pending;
    const other = setup();
    other.client.prime(artifact);
    expect(other.client.cached('draft')).toBeUndefined();
    expect(await other.client.compile(gen('draft'), inputs, target)).toBe(artifact);
    expect(other.workers).toHaveLength(0);
    const defaultCompile = other.client.compile(gen('draft'), inputs);
    other.workers[0]!.succeed();
    expect(await defaultCompile).toMatchObject(DEFAULT_COMPILE_TARGET);
    expect(other.client.cached('draft', target)).toBe(artifact);
  });
  it('captures the target when a request is queued', async () => {
    const { client, workers } = setup();
    const first = client.compile(gen('a'), inputs);
    const target = { sampleRate: 44100, renderQuantumSize: 32 };
    const queued = client.compile(gen('b'), inputs, target);
    target.sampleRate = 96000;
    target.renderQuantumSize = 256;
    workers[0]!.succeed();
    await first;
    expect(workers[0]!.received.at(-1)!.target).toEqual({
      sampleRate: 44100,
      renderQuantumSize: 32,
    });
    workers[0]!.succeed();
    expect(await queued).toMatchObject({ sampleRate: 44100, renderQuantumSize: 32 });
  });
  it('a hung worker is terminated at the timeout and replaced; codeboxes are blamed', async () => {
    const { client, workers, timers } = setup();
    const g = { ...gen('loop'), codeboxes: { box1: 10 } };
    const p = client.compile(g, inputs).then(
      () => {
        throw new Error('expected failure');
      },
      e => e as CompileFailure,
    );
    timers[0]!.fn();
    const failure = await p;
    expect(failure).toMatchObject({ kind: 'timeout' });
    expect(failure.issues[0]).toMatchObject({ node: 'box1' });
    expect(workers[0]!.terminated).toBe(true);
    const next = client.compile(gen('ok'), inputs);
    expect(workers).toHaveLength(2);
    workers[1]!.succeed();
    expect((await next).hash).toBe('ok');
  });
  it('late results from a terminated worker are ignored', async () => {
    const { client, workers, timers } = setup();
    const p = client.compile(gen('a'), inputs).catch(e => (e as CompileFailure).kind);
    timers[0]!.fn();
    expect(await p).toBe('timeout');
    const q = client.compile(gen('b'), inputs);
    workers[0]!.succeed(0); // the dead worker answers late
    workers[1]!.succeed();
    expect((await q).hash).toBe('b');
  });
  it('worker crash rejects the job and the next compile uses a fresh worker', async () => {
    const { client, workers } = setup();
    const p = client.compile(gen('a'), inputs).catch(e => (e as CompileFailure).kind);
    workers[0]!.onerror?.({ message: 'OOM' });
    expect(await p).toBe('crashed');
    const q = client.compile(gen('b'), inputs);
    workers[1]!.succeed();
    expect((await q).hash).toBe('b');
  });
  it('compile errors carry issues; dispose rejects pending work', async () => {
    const { client, workers } = setup();
    const p = client.compile(gen('a'), inputs).then(
      () => {
        throw new Error('expected failure');
      },
      e => e as CompileFailure,
    );
    workers[0]!.fail('bad');
    expect((await p).issues[0]!.message).toBe('bad');
    const q = client.compile(gen('b'), inputs).catch(e => (e as CompileFailure).kind);
    client.dispose();
    expect(await q).toBe('disposed');
    expect(await client.compile(gen('c'), inputs).catch(e => (e as CompileFailure).kind)).toBe(
      'disposed',
    );
  });
});

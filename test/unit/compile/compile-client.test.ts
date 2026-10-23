import { describe, expect, it } from 'vite-plus/test';
import {
  CompileClient,
  CompileFailure,
  type WorkerLike,
} from '../../../src/sound/compile/compile-client.ts';
import type { Generated } from '../../../src/sound/codegen.ts';
import type { CompileRequest } from '../../../src/sound/compile/protocol.ts';

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
          moduleSource: '',
          wasm: new ArrayBuffer(1),
          processorName: `p-${r.hash}`,
          sampleRate: 48000,
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
  it('C4 a burst of edits compiles the first and the last only; superseded ones reject', async () => {
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
  it('C9 cache hits never recompile; identical in-flight requests share one compile', async () => {
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
  it('C2 a hung worker is terminated at the timeout and replaced; codeboxes are blamed', async () => {
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
  it('C5 late results from a terminated worker are ignored', async () => {
    const { client, workers, timers } = setup();
    const p = client.compile(gen('a'), inputs).catch(e => (e as CompileFailure).kind);
    timers[0]!.fn();
    expect(await p).toBe('timeout');
    const q = client.compile(gen('b'), inputs);
    workers[0]!.succeed(0); // the dead worker answers late
    workers[1]!.succeed();
    expect((await q).hash).toBe('b');
  });
  it('C3 worker crash rejects the job and the next compile uses a fresh worker', async () => {
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

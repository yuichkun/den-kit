// A context discovered while pre-start validation is in flight must load only
// its own compiled sound, even when the earlier validation fails.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { KitSession } from '../../../src/editor/session.ts';
import { catalog } from '../../../src/sound/blocks/index.ts';
import type { WorkerLike } from '../../../src/sound/compile/compile-client.ts';
import type { Artifact, CompileRequest } from '../../../src/sound/compile/protocol.ts';
import { DEFAULT_COMPILE_TARGET } from '../../../src/sound/compile/target.ts';
import { starter } from '../../../src/work/starters.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

function setup() {
  const requests: CompileRequest[] = [];
  const worker: WorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage: request => requests.push(request),
    terminate() {},
  };
  const native = { sampleRate: 44100, renderQuantumSize: 32 };
  const engine = {
    running: false,
    target: { ...DEFAULT_COMPILE_TARGET },
    start: async () => {
      engine.target = native;
      engine.running = true;
      return true;
    },
    load: vi.fn(async (_artifact: Artifact) => {}),
    setAssets() {},
    unload() {},
  };
  const session = new KitSession({
    storage: null,
    createWorker: () => worker as unknown as Worker,
    engine: engine as never,
  });
  session.replace(starter('bass', catalog), 'Bass', false);
  function answer(index: number, error = false) {
    const request = requests[index]!;
    worker.onmessage?.({
      data: error
        ? { id: request.id, error: { message: 'Pre-start validation failed.', issues: [] } }
        : {
            id: request.id,
            result: {
              hash: request.hash,
              ...request.target,
              schemaHash: 'schema',
              meta: {} as Artifact['meta'],
              moduleSource: '',
              wasm: new ArrayBuffer(0),
              processorName: 'patch',
              compileMs: 1,
            },
          },
    });
  }
  return { session, engine, requests, answer, native };
}

describe('audio startup target', () => {
  for (const failEarlier of [false, true]) {
    it(`loads the native target when pre-start compilation ${failEarlier ? 'fails' : 'finishes'} later`, async () => {
      const { session, engine, requests, answer, native } = setup();
      const validation = session.compileNow();
      expect(requests[0]!.target).toEqual(DEFAULT_COMPILE_TARGET);
      const starting = session.enableAudio();
      await Promise.resolve();
      answer(0, failEarlier);
      await validation;
      expect(engine.load).not.toHaveBeenCalled();
      expect(session.compileStatus.value).toBe('compiling');
      expect(requests[1]!.target).toEqual(native);
      answer(1);
      expect(await starting).toBe(true);
      expect(engine.load).toHaveBeenCalledTimes(1);
      expect(engine.load.mock.calls[0]![0]).toMatchObject(native);
      expect(session.compileStatus.value).toBe('ok');
      expect(session.audioSampleRate.value).toBe(native.sampleRate);
      session.compiler.dispose();
    });
  }

  for (const failEarlier of [false, true]) {
    it(`recompiles the current patch if the context changes while its compile ${failEarlier ? 'fails' : 'finishes'}`, async () => {
      const { session, engine, requests, answer, native } = setup();
      await engine.start();
      const compiling = session.compileNow();
      expect(requests[0]!.target).toEqual(native);
      const replacement = { sampleRate: 96000, renderQuantumSize: 256 };
      engine.target = replacement;
      answer(0, failEarlier);
      await Promise.resolve();
      expect(engine.load).not.toHaveBeenCalled();
      expect(session.compileStatus.value).toBe('compiling');
      expect(requests[1]!.target).toEqual(replacement);
      answer(1);
      expect(await compiling).toMatchObject(replacement);
      expect(engine.load).toHaveBeenCalledTimes(1);
      expect(engine.load.mock.calls[0]![0]).toMatchObject(replacement);
      expect(session.compileStatus.value).toBe('ok');
      expect(session.audioSampleRate.value).toBe(replacement.sampleRate);
      session.compiler.dispose();
    });
  }
});

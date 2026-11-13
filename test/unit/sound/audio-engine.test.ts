// A context replacement keeps the sounding node until its target is compiled and
// ready; failed and superseded replacements close without taking the sound away.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { createNode } from '@unworklet/core';
import { AudioEngine, type LoadInfo } from '../../../src/sound/audio-engine.ts';
import type { Artifact } from '../../../src/sound/compile/protocol.ts';
import type { CompileTarget } from '../../../src/sound/compile/target.ts';

vi.mock('@unworklet/core', () => ({ createNode: vi.fn() }));
vi.mock('@unworklet/core/worklet', () => ({ makeWorkletNamespaceFromMeta: () => ({}) }));

class AudioNodeFake {
  gain = {
    value: 0,
    cancelScheduledValues() {},
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    setTargetAtTime() {},
  };
  connect<T>(destination: T): T {
    return destination;
  }
  disconnect() {}
}

class Context {
  state = 'suspended';
  destination = new AudioNodeFake();
  onstatechange: (() => void) | null = null;
  private time = 0;
  readonly sampleRate: number;
  readonly renderQuantumSize: number;
  constructor(sampleRate: number, renderQuantumSize = 128) {
    this.sampleRate = sampleRate;
    this.renderQuantumSize = renderQuantumSize;
  }
  get currentTime() {
    return (this.time += 0.1);
  }
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  suspend = vi.fn(async () => {
    this.state = 'suspended';
  });
  close = vi.fn(async () => {
    this.state = 'closed';
  });
  decodeAudioData = vi.fn(async () => ({
    numberOfChannels: 1,
    sampleRate: this.sampleRate,
    length: 2,
    getChannelData: () => Float32Array.of(0.1, -0.1),
  }));
  asAudioContext() {
    return this as unknown as AudioContext;
  }
}

function node() {
  return {
    outputs: { main: new AudioNodeFake() },
    inputs: {},
    params: {},
    midi: {},
    events: {},
    onError() {},
    dispose: vi.fn(),
  };
}

function artifact(hash: string, target = { sampleRate: 48000, renderQuantumSize: 128 }): Artifact {
  return {
    hash,
    ...target,
    schemaHash: `schema-${target.sampleRate}-${target.renderQuantumSize}`,
    meta: {} as Artifact['meta'],
    moduleSource: '',
    wasm: new ArrayBuffer(1),
    processorName: `${hash}-${target.sampleRate}-${target.renderQuantumSize}`,
    compileMs: 1,
  };
}
const info: LoadInfo = { values: {}, voices: false, audioIn: false, probes: 0 };
const engines: AudioEngine[] = [];

beforeEach(() => {
  info.values = {};
  delete info.assets;
  vi.mocked(createNode).mockReset();
  vi.mocked(createNode).mockImplementation(async () => node() as never);
  for (const name of ['AnalyserNode', 'GainNode', 'DynamicsCompressorNode', 'WaveShaperNode'])
    vi.stubGlobal(name, AudioNodeFake);
});
afterEach(async () => {
  await Promise.all(engines.splice(0).map(engine => engine.dispose()));
  vi.unstubAllGlobals();
});

function engineAt(...contexts: Context[]) {
  let index = 0;
  const engine = new AudioEngine(
    {},
    {
      createContext: () => contexts[index++]!.asAudioContext(),
      rotateAfter: 1,
      crossfadeMs: 0,
    },
  );
  engines.push(engine);
  return engine;
}

describe('audio context targets', () => {
  it('starts at the actual target and passes the compiled schema to the worklet', async () => {
    const context = new Context(44100, 32);
    const engine = engineAt(context);
    expect(await engine.start()).toBe(true);
    expect(engine.target).toEqual({ sampleRate: 44100, renderQuantumSize: 32 });
    const compiled = artifact('a', engine.target);
    await engine.load(compiled, info);
    expect(createNode).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        schemaHash: compiled.schemaHash,
        worklet: expect.objectContaining({ bakedSampleRate: 44100 }),
      }),
      { initial: {} },
    );
    expect(engine.currentHash).toBe('a');
  });

  it('refuses a different target without a compiler, and verifies a compiler result', async () => {
    const engine = engineAt(new Context(44100, 256));
    await engine.start();
    await expect(engine.load(artifact('a'), info)).rejects.toThrow('44100 Hz and 256 samples');
    const wrong = vi.fn(async () => artifact('a'));
    await expect(engine.load(artifact('a'), info, wrong)).rejects.toThrow('does not match');
    expect(wrong).toHaveBeenCalledWith({ sampleRate: 44100, renderQuantumSize: 256 });
    expect(createNode).not.toHaveBeenCalled();
    await engine.load(artifact('a'), info, async target => artifact('a', target));
    expect(engine.currentHash).toBe('a');
  });

  it('keeps the old sound when compiling for a replacement context fails', async () => {
    const old = new Context(48000);
    const replacement = new Context(96000, 256);
    const engine = engineAt(old, replacement);
    await engine.start();
    const playing = node();
    vi.mocked(createNode).mockResolvedValueOnce(playing as never);
    await engine.load(artifact('a'), info);
    await expect(
      engine.load(artifact('b'), info, async () => {
        throw new Error('unsupported target');
      }),
    ).rejects.toThrow('unsupported target');
    expect(engine.ctx).toBe(old);
    expect(engine.currentHash).toBe('a');
    expect(playing.dispose).not.toHaveBeenCalled();
    expect(old.close).not.toHaveBeenCalled();
    expect(replacement.state).toBe('closed');
    expect(engine.stats.rotations).toBe(0);
  });

  it('keeps the old sound when the replacement worklet fails to load', async () => {
    const old = new Context(48000);
    const replacement = new Context(96000, 256);
    const engine = engineAt(old, replacement);
    await engine.start();
    await engine.load(artifact('a'), info);
    vi.mocked(createNode).mockRejectedValueOnce(new Error('worklet refused'));
    await expect(
      engine.load(artifact('b'), info, async target => artifact('b', target)),
    ).rejects.toThrow('worklet refused');
    expect(engine.ctx).toBe(old);
    expect(engine.currentHash).toBe('a');
    expect(old.state).toBe('running');
    expect(replacement.state).toBe('closed');
  });

  it('changes contexts only after the matching replacement is ready', async () => {
    const old = new Context(48000);
    const replacement = new Context(96000, 256);
    replacement.state = 'running';
    const engine = engineAt(old, replacement);
    await engine.start();
    await engine.load(artifact('a'), info);
    const compile = vi.fn(async (target: CompileTarget) => {
      expect(old.state).toBe('running');
      expect(engine.currentHash).toBe('a');
      return artifact('b', target);
    });
    vi.mocked(createNode).mockImplementationOnce(async () => {
      expect(old.state).toBe('running');
      expect(replacement.state).toBe('suspended');
      expect(engine.currentHash).toBe('a');
      return node() as never;
    });
    await engine.load(artifact('b'), info, compile);
    expect(compile).toHaveBeenCalledExactlyOnceWith({ sampleRate: 96000, renderQuantumSize: 256 });
    expect(engine.ctx).toBe(replacement);
    expect(engine.currentHash).toBe('b');
    expect(old.state).toBe('closed');
    expect(engine.stats.rotations).toBe(1);
    expect(replacement.suspend).toHaveBeenCalledOnce();
  });

  it('closes a superseded replacement without changing the latest sound', async () => {
    const old = new Context(48000);
    const replacement = new Context(96000, 256);
    const engine = engineAt(old, replacement);
    await engine.start();
    await engine.load(artifact('a'), info);
    let finish!: (value: Artifact) => void;
    let began!: () => void;
    const started = new Promise<void>(resolve => (began = resolve));
    const loading = engine.load(artifact('b'), info, async () => {
      began();
      return new Promise(resolve => (finish = resolve));
    });
    await started;
    await engine.load(artifact('a'), info);
    finish(artifact('b', { sampleRate: 96000, renderQuantumSize: 256 }));
    await loading;
    expect(engine.ctx).toBe(old);
    expect(engine.currentHash).toBe('a');
    expect(old.state).toBe('running');
    expect(replacement.state).toBe('closed');
    expect(engine.stats.rotations).toBe(0);
  });

  it('disposal closes a context waiting for a compiler and ignores its eventual result', async () => {
    const old = new Context(48000);
    const replacement = new Context(96000, 256);
    const engine = engineAt(old, replacement);
    await engine.start();
    await engine.load(artifact('a'), info);
    let finish!: (value: Artifact) => void;
    let began!: () => void;
    const started = new Promise<void>(resolve => (began = resolve));
    const loading = engine.load(artifact('b'), info, async () => {
      began();
      return new Promise(resolve => (finish = resolve));
    });
    await started;
    await engine.dispose();
    expect(old.state).toBe('closed');
    expect(replacement.state).toBe('closed');
    finish(artifact('b', { sampleRate: 96000, renderQuantumSize: 256 }));
    await loading;
    expect(engine.ctx).toBeNull();
    expect(createNode).toHaveBeenCalledOnce();
  });

  it('an empty patch cancels the first load while its worklet is still loading', async () => {
    const engine = engineAt(new Context(48000));
    await engine.start();
    const pendingNode = node();
    let finish!: (value: never) => void;
    vi.mocked(createNode).mockImplementationOnce(() => new Promise(resolve => (finish = resolve)));
    const loading = engine.load(artifact('a'), info);
    engine.unload();
    finish(pendingNode as never);
    await loading;
    expect(engine.currentHash).toBeNull();
    expect(pendingNode.dispose).toHaveBeenCalledOnce();
  });

  it('an empty patch cancels a replacement while its worklet is still loading', async () => {
    const old = new Context(48000);
    const replacement = new Context(96000, 256);
    const engine = engineAt(old, replacement);
    await engine.start();
    await engine.load(artifact('a'), info);
    const pendingNode = node();
    let finish!: (value: never) => void;
    let began!: () => void;
    const started = new Promise<void>(resolve => (began = resolve));
    vi.mocked(createNode).mockImplementationOnce(() => {
      began();
      return new Promise(resolve => (finish = resolve));
    });
    const loading = engine.load(artifact('b'), info, async target => artifact('b', target));
    await started;
    engine.unload();
    finish(pendingNode as never);
    await loading;
    expect(engine.ctx).toBe(old);
    expect(engine.currentHash).toBeNull();
    expect(replacement.state).toBe('closed');
    expect(pendingNode.dispose).toHaveBeenCalledOnce();
  });

  it('keeps knob and asset edits made while the replacement worklet loads', async () => {
    const engine = engineAt(new Context(44100, 32));
    await engine.start();
    const param = { minValue: 0, maxValue: 1, setValueAtTime: vi.fn() };
    const emit = vi.fn();
    const pendingNode = {
      ...node(),
      params: { cutoff: param },
      events: { asset: { emit } },
    };
    let finish!: (value: never) => void;
    vi.mocked(createNode).mockImplementationOnce(() => new Promise(resolve => (finish = resolve)));
    const loading = engine.load(artifact('a', engine.target), {
      ...info,
      values: { cutoff: 0.1 },
    });
    engine.setParam('cutoff', 0.7);
    engine.setAssets([
      { key: 'new', event: 'asset', kind: 'bytes', read: async () => new Uint8Array([17]) },
    ]);
    finish(pendingNode as never);
    await loading;
    expect(param.setValueAtTime).toHaveBeenCalledWith(Math.fround(0.7), expect.any(Number));
    expect(emit).toHaveBeenCalledWith({ data: new Uint8Array([17]), length: 1 });
  });

  it('handles a health edge emitted during silent replacement prewarming', async () => {
    const old = new Context(48000);
    const replacement = new Context(96000, 256);
    const engine = engineAt(old, replacement);
    await engine.start();
    await engine.load(artifact('a'), info);
    let report: (() => void) | undefined;
    const reset = vi.fn();
    let sent = false;
    const pendingNode = {
      ...node(),
      outputs: {
        main: {
          connect<T>(destination: T): T {
            if (!sent) {
              sent = true;
              report?.();
              expect(engine.stats.healthEvents).toBe(0);
              expect(old.state).toBe('running');
            }
            return destination;
          },
          disconnect() {},
        },
      },
      events: {
        kitHealth: { on: (handler: () => void) => (report = handler) },
        reset: { emit: reset },
      },
    };
    vi.mocked(createNode).mockResolvedValueOnce(pendingNode as never);
    await engine.load(artifact('b'), info, async target => artifact('b', target));
    expect(sent).toBe(true);
    expect(engine.stats.healthEvents).toBe(1);
    expect(reset).toHaveBeenCalledWith({ value: 1 });
  });

  it('delivers assets decoded at the replacement rate before its first render, once', async () => {
    const old = new Context(44100, 32);
    const replacement = new Context(96000, 256);
    const engine = engineAt(old, replacement);
    await engine.start();
    await engine.load(artifact('a', engine.target), info);
    let finish!: (bytes: Uint8Array) => void;
    let began!: () => void;
    const started = new Promise<void>(resolve => (began = resolve));
    const emit = vi.fn();
    const connect = vi.fn();
    const pendingNode = {
      ...node(),
      outputs: {
        main: {
          connect<T>(destination: T): T {
            expect(emit).toHaveBeenCalledOnce();
            connect();
            return destination;
          },
          disconnect() {},
        },
      },
      events: { asset: { emit } },
    };
    vi.mocked(createNode).mockResolvedValueOnce(pendingNode as never);
    const loading = engine.load(
      artifact('b', engine.target),
      {
        ...info,
        assets: [
          {
            event: 'asset',
            key: 'same-sound',
            kind: 'mono',
            read: () => {
              began();
              return new Promise(resolve => (finish = resolve));
            },
          },
        ],
      },
      async target => artifact('b', target),
    );
    await started;
    expect(connect).not.toHaveBeenCalled();
    expect(old.state).toBe('running');
    expect(replacement.state).toBe('suspended');
    const readAgain = vi.fn(async () => new Uint8Array([17]));
    engine.setAssets([{ event: 'asset', key: 'same-sound', kind: 'mono', read: readAgain }]);
    finish(new Uint8Array([17]));
    await loading;
    expect(readAgain).not.toHaveBeenCalled();
    expect(old.decodeAudioData).not.toHaveBeenCalled();
    expect(replacement.decodeAudioData).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith({ data: Float32Array.of(0.1, -0.1) });
    expect(engine.target.sampleRate).toBe(96000);
  });

  it('starts closing the current context before disposal yields to the browser', async () => {
    const context = new Context(48000);
    const engine = engineAt(context);
    await engine.start();
    const closing = engine.dispose();
    expect(context.state).toBe('closed');
    await closing;
  });

  it('keeps an asset edit made while the replacement prewarms without reloading unchanged assets', async () => {
    const engine = engineAt(new Context(48000), new Context(96000, 256));
    await engine.start();
    await engine.load(artifact('a'), info);
    const emit = vi.fn();
    let changed = false;
    const pendingNode = {
      ...node(),
      outputs: {
        main: {
          connect<T>(destination: T): T {
            if (!changed) {
              changed = true;
              engine.setAssets([
                {
                  event: 'asset',
                  key: 'edited',
                  kind: 'bytes',
                  read: async () => new Uint8Array([2]),
                },
              ]);
            }
            return destination;
          },
          disconnect() {},
        },
      },
      events: { asset: { emit } },
    };
    vi.mocked(createNode).mockResolvedValueOnce(pendingNode as never);
    await engine.load(
      artifact('b'),
      {
        ...info,
        assets: [
          {
            event: 'asset',
            key: 'initial',
            kind: 'bytes',
            read: async () => new Uint8Array([1]),
          },
        ],
      },
      async target => artifact('b', target),
    );
    expect(emit.mock.calls.map(([payload]) => payload)).toEqual([
      { data: new Uint8Array([1]), length: 1 },
      { data: new Uint8Array([2]), length: 1 },
    ]);
  });
});

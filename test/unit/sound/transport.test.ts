import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vite-plus/test';
import { audioTransportSnapshot } from '../../../src/sound/transport.ts';

const source = readFileSync(
  new URL('../../../src/sound/transport.worklet.js', import.meta.url),
  'utf8',
);

function clock() {
  let Processor: any;
  const context = {
    currentTime: 0,
    sampleRate: 48000,
    AudioWorkletProcessor: class {
      port: any = {};
    },
    registerProcessor: (_name: string, ctor: any) => {
      Processor = ctor;
    },
  };
  runInNewContext(source, context);
  const node = new Processor();
  return {
    send(snapshot: unknown) {
      node.port.onmessage({ data: { type: 'clock', snapshot } });
    },
    click(enabled: boolean) {
      node.port.onmessage({ data: { type: 'click', enabled } });
    },
    render(frames: number) {
      const output = Array.from({ length: 5 }, () => new Float32Array(frames));
      const click = new Float32Array(frames);
      node.process([], [output, [click]]);
      context.currentTime += frames / 48000;
      return { output, click };
    },
  };
}

const snapshot = { time: 0, beat: 0, tempo: 120, playing: true, startTime: 0, expires: 10 };
const pulses = (data: Float32Array) => Array.from(data.keys()).filter(i => data[i] === 1);

describe('audible-time mapping', () => {
  it('accounts for device output timing and the safety compressor exactly once', () => {
    const mapped = audioTransportSnapshot(
      { performanceTime: 1000, beat: 4, tempo: 120, playing: true, startPerformanceTime: 1500 },
      {
        currentTime: 2,
        baseLatency: 0.01,
        outputLatency: 0.02,
        getOutputTimestamp: () => ({ contextTime: 1.98, performanceTime: 1000 }),
      },
      1000,
    )!;
    expect(mapped.beat).toBeCloseTo(4.052, 8);
    expect(mapped.startTime).toBeCloseTo(2.474, 8);
    expect(mapped.expires).toBeCloseTo(2.974, 8);
  });

  it('falls back during startup and reanchors after the audio clock resumes or rotates', () => {
    const host = { performanceTime: 1000, beat: 4, tempo: 120, playing: true };
    const mapped = audioTransportSnapshot(
      host,
      { currentTime: 0, baseLatency: 0.01, outputLatency: 0.02 },
      1000,
    )!;
    expect(mapped.beat).toBeCloseTo(4.072, 8);
    const resumed = audioTransportSnapshot(
      host,
      { currentTime: 0, getOutputTimestamp: () => ({ contextTime: 0, performanceTime: 1600 }) },
      1600,
    )!;
    expect(resumed.beat).toBeCloseTo(5.212, 8);
    expect(resumed.expires).toBeCloseTo(0.394, 8);
  });

  it('refuses nonfinite clocks', () => {
    expect(
      audioTransportSnapshot(
        { performanceTime: 0, beat: NaN, tempo: 120, playing: true },
        { currentTime: 0 },
        0,
      ),
    ).toBeNull();
  });
});

describe('sample clock worklet', () => {
  it('emits sample-exact beats and four-beat phase without main-thread timers', () => {
    const c = clock();
    c.send(snapshot);
    const { output } = c.render(48001);
    expect(pulses(output[3])).toEqual([0, 24000, 48000]);
    expect(output[1][12000]).toBeCloseTo(0.5, 7);
    expect(output[2][24000]).toBeCloseTo(0.25, 7);
    expect(output[0][40000]).toBe(120);
  });

  it('changes tempo with phase continuity across snapshot and render boundaries', () => {
    const c = clock();
    c.send(snapshot);
    c.render(12000);
    c.send({ ...snapshot, time: 0.25, beat: 0.5, tempo: 60 });
    const { output } = c.render(48000);
    expect(pulses(output[3])).toEqual([24000]);
    expect(output[1][12000]).toBeCloseTo(0.75, 7);
  });

  it('does not double-trigger a beat after a backward correction across its boundary', () => {
    const c = clock();
    c.send({ ...snapshot, beat: 0.99, startTime: -5 });
    expect(pulses(c.render(480).output[3])).toEqual([240]);
    c.send({ ...snapshot, time: 0.01, beat: 0.995, startTime: -5 });
    expect(pulses(c.render(24480).output[3])).toEqual([24120]);
  });

  it('recognizes a remote stop and restart that both happened between snapshots', () => {
    const c = clock();
    c.send({ ...snapshot, beat: 100.99, startTime: -5, transportId: 1 });
    expect(pulses(c.render(480).output[3])).toEqual([240]);
    c.send({ ...snapshot, time: 0.01, beat: 0.02, startTime: 0, transportId: 2 });
    expect(pulses(c.render(24000).output[3])).toEqual([23520]);
  });

  it('does not double-trigger when integer-microsecond start time rounds just before beat zero', () => {
    const c = clock();
    c.send({ ...snapshot, beat: -0.000001 });
    expect(pulses(c.render(128).output[3])).toEqual([0]);
  });

  it('waits for a quantized start, and stays silent when stopped or stale', () => {
    const c = clock();
    c.click(true);
    c.send({ ...snapshot, beat: -0.5, startTime: 0.25, expires: 0.75 });
    const { output, click } = c.render(48000);
    expect(pulses(output[3])).toEqual([12000]);
    expect(output[4][11999]).toBe(0);
    expect(output[4][12000]).toBe(1);
    expect(output[4][36000]).toBe(0);
    expect(click.slice(0, 12000).every(v => v === 0)).toBe(true);
    expect(click.slice(12000, 13000).some(v => Math.abs(v) > 0.01)).toBe(true);
    expect(click.slice(36000).every(v => v === 0)).toBe(true);
    c.send(null);
    const stopped = c.render(128);
    expect(stopped.output[4].every(v => v === 0)).toBe(true);
    expect(stopped.click.every(v => v === 0)).toBe(true);
  });

  it('joining a running clock mid-beat does not invent a pulse, including negative beats', () => {
    const c = clock();
    c.send({ ...snapshot, beat: -0.25, startTime: -5 });
    const { output } = c.render(12000);
    expect(pulses(output[3])).toEqual([6000]);
    expect(output[1][0]).toBe(0.75);
    expect(output[2][0]).toBe(0.9375);
  });
});

// The listening metrics on synthetic signals with known answers.
import { describe, expect, it } from 'vite-plus/test';
import { inflateSync } from 'node:zlib';
import {
  analyse,
  encodePng,
  fft,
  pngDataUrl,
  spectrogramPng,
  testSignal,
} from '../../../src/core/analysis.ts';

const SR = 48000;
const sine = (hz: number, seconds: number, amp = 0.5, env?: (t: number) => number) =>
  Float32Array.from(
    { length: Math.round(seconds * SR) },
    (_, i) => Math.sin((2 * Math.PI * hz * i) / SR) * amp * (env ? env(i / SR) : 1),
  );
let seed = 3;
const noise = (seconds: number, amp = 0.3) =>
  Float32Array.from({ length: Math.round(seconds * SR) }, () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return (seed / 1073741824 - 1) * amp;
  });

describe('analyse', () => {
  it('a 440 Hz sine: level, brightness and no clipping', () => {
    const s = sine(440, 1, 0.5);
    const r = analyse([s, s], SR);
    expect(r.peakDb).toBeCloseTo(-6, 0);
    expect(r.rmsDb).toBeCloseTo(-9, 0);
    expect(r.centroidHz.mean).toBeGreaterThan(380);
    expect(r.centroidHz.mean).toBeLessThan(560);
    expect(r.clipped).toBe(0);
    expect(r.stereoWidth).toBe(0);
    expect(r.silent).toBe(false);
    expect(r.summary).toMatch(/No clipping/);
  });
  it('noise is brighter than a low sine; unrelated channels are wide', () => {
    const r = analyse([noise(1), noise(1)], SR);
    expect(r.centroidHz.mean).toBeGreaterThan(5000);
    expect(r.stereoWidth).toBeGreaterThan(0.8);
  });
  it('counts clipping, reports DC and silence', () => {
    const loud = Float32Array.from({ length: SR / 10 }, (_, i) => (i % 2 ? 1 : -1));
    expect(analyse([loud], SR).clipped).toBe(SR / 10);
    const dc = new Float32Array(SR / 2).fill(0.2);
    expect(analyse([dc, dc], SR).dcOffset).toBeCloseTo(0.2, 3);
    const silent = analyse([new Float32Array(SR), new Float32Array(SR)], SR);
    expect(silent.silent).toBe(true);
    expect(silent.summary).toMatch(/Silent/);
    expect(analyse([new Float32Array(10)], SR, { broken: 5 }).summary).toMatch(/Broken output: 5/);
  });
  it('measures attack and release from the note times', () => {
    // 200 ms linear attack from 0.1 s, note-off at 0.6 s, exponential release (tau 50 ms).
    const env = (t: number) =>
      t < 0.1 ? 0 : t < 0.3 ? (t - 0.1) / 0.2 : t < 0.6 ? 1 : Math.exp(-(t - 0.6) / 0.05);
    const s = sine(220, 1.2, 0.5, env);
    const r = analyse([s, s], SR, { onSamples: [0.1 * SR], offSamples: [0.6 * SR] });
    expect(r.attackMs).toBeGreaterThan(160);
    expect(r.attackMs).toBeLessThan(220);
    expect(r.releaseMs).toBeGreaterThan(180); // -40 dB of exp(-t/50ms) ≈ 230 ms
    expect(r.releaseMs).toBeLessThan(280);
  });
  it('the envelope overview is one value per 100 ms', () => {
    expect(analyse([sine(440, 1)], SR).envelopeDb).toHaveLength(10);
  });
});

describe('fft', () => {
  it('finds the bin of a pure tone', () => {
    const n = 1024,
      re = new Float64Array(n),
      im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * 64 * i) / n);
    fft(re, im);
    let best = 0;
    for (let k = 1; k < n / 2; k++)
      if (Math.hypot(re[k]!, im[k]!) > Math.hypot(re[best]!, im[best]!)) best = k;
    expect(best).toBe(64);
  });
});

describe('PNG', () => {
  it('encodes a valid RGB PNG whose pixels decode back', async () => {
    const raw = new Uint8Array([0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 0, 255, 255, 255, 255]); // 2x2, filter bytes first
    const png = await encodePng(2, 2, raw);
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(png.buffer);
    expect(view.getUint32(16)).toBe(2);
    expect(view.getUint32(20)).toBe(2);
    const idatLen = view.getUint32(33);
    expect(String.fromCharCode(...png.subarray(37, 41))).toBe('IDAT');
    expect([...inflateSync(png.subarray(41, 41 + idatLen))]).toEqual([...raw]);
    expect(pngDataUrl(png)).toMatch(/^data:image\/png;base64,/);
  });
  it('draws a spectrogram of the requested size', async () => {
    const png = await spectrogramPng(sine(1000, 0.5), SR, 64, 32);
    const view = new DataView(png.buffer);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([64, 32]);
  });
});

describe('test signals', () => {
  it.each(['chords', 'drums', 'noise'] as const)('%s is stereo, finite and audible', kind => {
    const [l, r] = testSignal(kind, 2, SR);
    expect(l!.length).toBe(2 * SR);
    expect(r!.length).toBe(2 * SR);
    const a = analyse([l!, r!], SR);
    expect(a.silent).toBe(false);
    expect(a.clipped).toBe(0);
    expect(l!.every(Number.isFinite)).toBe(true);
  });
});

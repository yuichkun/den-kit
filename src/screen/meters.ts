// What the plugin's sound looks like right now, for lamps (`@level`) and
// canvases: the plugin window reads its output analyser once per frame and shares it.
import type { InjectionKey, Ref } from 'vue';

export interface Meters {
  level: number;
  peak: number;
}
export const LEVEL: InjectionKey<Ref<Meters>> = Symbol('den-kit-level');

/** Reads the output: the waveform, a 0..1 spectrum (dB-scaled), the RMS level and the peak. */
export interface AudioTap {
  read(wave: Float32Array, spectrum: Float32Array): Meters;
}
export const TAP: InjectionKey<AudioTap> = Symbol('den-kit-tap');

/** A tap on an analyser (null: silence). */
export function analyserTap(get: () => AnalyserNode | null): AudioTap {
  let freq = new Float32Array(0),
    time = new Float32Array(0);
  return {
    read(wave, spectrum) {
      const a = get();
      if (!a) {
        wave.fill(0);
        spectrum.fill(0);
        return { level: 0, peak: 0 };
      }
      if (time.length !== a.fftSize) time = new Float32Array(a.fftSize);
      if (freq.length !== a.frequencyBinCount) freq = new Float32Array(a.frequencyBinCount);
      a.getFloatTimeDomainData(time);
      a.getFloatFrequencyData(freq);
      let sum = 0,
        peak = 0;
      for (const x of time) {
        sum += x * x;
        peak = Math.max(peak, Math.abs(x));
      }
      for (let i = 0; i < wave.length; i++)
        wave[i] = time[Math.floor((i * time.length) / wave.length)] ?? 0;
      // Log-spaced bands from about 30 Hz up, -100..-20 dB mapped to 0..1.
      const bins = freq.length;
      for (let i = 0; i < spectrum.length; i++) {
        const lo = Math.floor(bins * 0.004 * 250 ** (i / spectrum.length)),
          hi = Math.max(lo + 1, Math.floor(bins * 0.004 * 250 ** ((i + 1) / spectrum.length)));
        let m = -Infinity;
        for (let k = lo; k < Math.min(bins, hi); k++) m = Math.max(m, freq[k]!);
        spectrum[i] = Math.max(0, Math.min(1, (m + 100) / 80));
      }
      return { level: Math.sqrt(sum / Math.max(1, time.length)), peak };
    },
  };
}

// Scopes and meters (rule 9) only show: they take no input. A meter holds its
// peak for a moment, then lets it fall.

/** How long a meter holds its peak, and how fast it falls after (in level per second). */
export const PEAK_HOLD_MS = 1000;
export const PEAK_FALL_PER_S = 1.5;

export interface MeterReading {
  level: number;
  peak: number;
}

export class Meter {
  private peak = 0;
  private peakAt = -Infinity;
  private last = -Infinity;
  /** A new level (0 and up, 1 is full scale) at a time in milliseconds. */
  update(level: number, now: number): MeterReading {
    const safe = Number.isFinite(level) ? Math.max(0, level) : 0;
    if (safe >= this.peak) {
      this.peak = safe;
      this.peakAt = now;
    } else if (now - this.peakAt > PEAK_HOLD_MS) {
      const elapsed = (now - Math.max(this.last, this.peakAt + PEAK_HOLD_MS)) / 1000;
      this.peak = Math.max(safe, this.peak - PEAK_FALL_PER_S * Math.max(0, elapsed));
    }
    this.last = now;
    return { level: safe, peak: this.peak };
  }
}

/** A waveform as points across a scope's box (y: 0 at the top, full scale at the edges). */
export function scopePoints(
  samples: ArrayLike<number>,
  width: number,
  height: number,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const n = samples.length;
  for (let i = 0; i < n; i++) {
    const s = Number.isFinite(samples[i]!) ? Math.max(-1, Math.min(1, samples[i]!)) : 0;
    out.push([(i / Math.max(1, n - 1)) * width, ((1 - s) / 2) * height]);
  }
  return out;
}

export const createMeter = () => new Meter();

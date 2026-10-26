// A value's range: where it may go, how it is spread over a control's travel
// (linear, or logarithmic for frequencies), and where it starts.

export interface Range {
  min: number;
  max: number;
  /** log: equal travel multiplies the value by equal steps (min and max must be above 0). */
  scale?: 'linear' | 'log';
  default?: number;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const isLog = (r: Range) => r.scale === 'log' && r.min > 0 && r.max > 0;

/** The position of a value along the control's travel, 0 to 1. */
export function toPosition(range: Range, value: number): number {
  if (range.max === range.min) return 0;
  if (isLog(range)) return clamp01(Math.log(value / range.min) / Math.log(range.max / range.min));
  return clamp01((value - range.min) / (range.max - range.min));
}

/** The value at a position along the control's travel (0 to 1). */
export function fromPosition(range: Range, position: number): number {
  const p = clamp01(position);
  if (isLog(range)) return range.min * Math.pow(range.max / range.min, p);
  return range.min + p * (range.max - range.min);
}

export const defaultOf = (range: Range) =>
  range.default === undefined ? range.min : Math.min(range.max, Math.max(range.min, range.default));

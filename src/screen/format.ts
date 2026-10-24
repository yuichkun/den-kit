// How a control's value reads as text (knob readouts, bound text on the plugin).
const digits = (v: number) => {
  const a = Math.abs(v);
  return a === 0
    ? '0'
    : a >= 100
      ? v.toFixed(0)
      : a >= 10
        ? v.toFixed(1)
        : v.toFixed(a >= 1 ? 2 : 3);
};
export function formatValue(value: number, unit: string) {
  const abs = Math.abs(value);
  // Short times read as milliseconds and high frequencies as kHz, like the patch view.
  if (unit === 's' && abs < 1) return `${digits(value * 1000)} ms`;
  if (unit === 'Hz' && abs >= 1000) return `${digits(value / 1000)} kHz`;
  const text = abs >= 1000 ? `${(value / 1000).toFixed(abs >= 10000 ? 1 : 2)}k` : digits(value);
  return unit ? `${text} ${unit}` : text;
}

/** 0..1 position of `value`; out-of-range values sit at the ends. */
export function toUnit(value: number, min: number, max: number, log: boolean) {
  if (!(max > min) || !Number.isFinite(value)) return 0;
  const v = Math.min(max, Math.max(min, value));
  if (log && min > 0) return Math.log(v / min) / Math.log(max / min);
  return (v - min) / (max - min);
}
export function fromUnit(u: number, min: number, max: number, log: boolean) {
  const t = Math.min(1, Math.max(0, u));
  if (log && min > 0) return min * (max / min) ** t;
  return min + (max - min) * t;
}

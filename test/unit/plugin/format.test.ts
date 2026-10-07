// How values read on the plugin: short times in ms, high frequencies in kHz.
import { describe, expect, it } from 'vitest';
import { formatValue, fromUnit, toUnit } from '../../../src/plugin/format.ts';

describe('formatValue', () => {
  it('reads times under a second as milliseconds', () => {
    expect(formatValue(0.42, 's')).toBe('420 ms');
    expect(formatValue(0.0015, 's')).toBe('1.50 ms');
    expect(formatValue(0.06, 's')).toBe('60.0 ms');
    expect(formatValue(0, 's')).toBe('0 ms');
    expect(formatValue(2.6, 's')).toBe('2.60 s');
  });
  it('reads frequencies from 1000 Hz up as kHz', () => {
    expect(formatValue(340, 'Hz')).toBe('340 Hz');
    expect(formatValue(2600, 'Hz')).toBe('2.60 kHz');
    expect(formatValue(11025, 'Hz')).toBe('11.0 kHz');
  });
  it('keeps three significant digits otherwise', () => {
    expect(formatValue(0.72, '')).toBe('0.720');
    expect(formatValue(-32, 'dB')).toBe('-32.0 dB');
    expect(formatValue(14, 'st')).toBe('14.0 st');
    expect(formatValue(12000, '')).toBe('12.0k');
  });
  it('maps values onto 0..1 and back (log ranges too)', () => {
    expect(toUnit(1000, 100, 10000, true)).toBeCloseTo(0.5);
    expect(fromUnit(0.5, 100, 10000, true)).toBeCloseTo(1000);
    expect(toUnit(5, 0, 10, false)).toBe(0.5);
  });
});

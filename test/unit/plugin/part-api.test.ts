// What a custom part may write to controls: checked, clamped, and visible to
// later reads in the same frame.
import { describe, expect, it } from 'vitest';
import { PartWriteError, overlayPending, writeControl, type PartFrame, type PendingWrites } from '../../../src/plugin/part-api.ts';

const frame = (): Pick<PartFrame, 'values' | 'norms' | 'ranges'> => ({
  values: { cut: 1000, mix: 0.5, on: false, pad: { x: 0.5, y: 0.5 } },
  norms: { cut: 0.5, mix: 0.5, on: 0, pad: 0.5 },
  ranges: { cut: { min: 100, max: 10000, log: true, unit: 'Hz' }, mix: { min: 0, max: 1, log: false, unit: '' }, on: { min: 0, max: 1, log: false, unit: '' }, pad: { min: 0, max: 1, log: false, unit: '' } },
});

describe('custom parts write controls', () => {
  it('sets a value in its own units, clamped to its range, and later reads see it', () => {
    const f = frame();
    expect(writeControl(f, 'cut', 20000)).toEqual({ value: 10000 });
    expect(f.values.cut).toBe(10000);
    expect(f.norms.cut).toBeCloseTo(1);
    expect(writeControl(f, 'mix', 0.25)).toEqual({ value: 0.25 });
  });

  it('setNorm follows the control\'s scale (log for frequencies)', () => {
    const f = frame();
    expect(writeControl(f, 'cut', 0.5, true).value).toBeCloseTo(1000);
    expect(writeControl(f, 'cut', 2, true).value).toBeCloseTo(10000);
    expect(f.norms.cut).toBeCloseTo(1);
  });

  it('switches take true/false (or a number from 0.5 up), XY pads take {x, y}', () => {
    const f = frame();
    expect(writeControl(f, 'on', true)).toEqual({ value: true });
    expect(writeControl(f, 'on', 0.2)).toEqual({ value: false });
    expect(writeControl(f, 'pad', { x: 1.4, y: 0.25 })).toEqual({ x: 1, y: 0.25 });
    expect(f.values.pad).toEqual({ x: 1, y: 0.25 });
  });

  it('refuses unknown controls, wrong shapes and non-finite numbers with a message that says what to do', () => {
    const f = frame();
    expect(() => writeControl(f, 'nope', 1)).toThrow(PartWriteError);
    expect(() => writeControl(f, 'nope', 1)).toThrow(/Controls: cut, mix, on, pad/);
    expect(() => writeControl({ values: {}, norms: {}, ranges: {} }, 'k1', 1)).toThrow(/Add a knob/);
    expect(() => writeControl(f, 'cut', Number.NaN)).toThrow(/must be a number/);
    expect(() => writeControl(f, 'cut', '3')).toThrow(/must be a number/);
    expect(() => writeControl(f, 'pad', 0.5)).toThrow(/XY pad takes x and y/);
    expect(() => writeControl(f, 'on', 'yes')).toThrow(/true or false/);
    expect(f.values).toEqual(frame().values);
  });
});

describe('writes the page has not shown back yet', () => {
  it('a frame that left before the write still carries the old value: the part keeps seeing its own', () => {
    const pending: PendingWrites = new Map([['cut', { value: 2000, at: 0 }], ['pad', { value: { x: 0.9, y: 0.1 }, at: 0 }]]);
    const stale = frame();
    overlayPending(stale, pending, 100);
    expect(stale.values.cut).toBe(2000);
    expect(stale.norms.cut).toBeCloseTo(Math.log(20) / Math.log(100));
    expect(stale.values.pad).toEqual({ x: 0.9, y: 0.1 });
    expect(pending.size).toBe(2);
  });
  it('once a frame shows the write (or after a while) the page has the say again', () => {
    const pending: PendingWrites = new Map([['cut', { value: 2000, at: 0 }], ['mix', { value: 0.9, at: 0 }]]);
    const shown = frame(); shown.values.cut = 2000;
    overlayPending(shown, pending, 100);
    expect([...pending.keys()]).toEqual(['mix']);
    const later = frame();
    overlayPending(later, pending, 1000);
    expect(later.values.mix).toBe(0.5);
    expect(pending.size).toBe(0);
  });
});

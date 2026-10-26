// What a canvas may write to controls: checked, clamped, and visible to
// later reads in the same frame.
import { describe, expect, it } from 'vite-plus/test';
import {
  CanvasWriteError,
  overlayPending,
  writeControl,
  type CanvasFrame,
  type PendingWrites,
} from '../../../src/screen/canvas-api.ts';

const frame = (): Pick<CanvasFrame, 'values' | 'norms' | 'ranges'> => ({
  values: { cut: 1000, mix: 0.5, on: false, pad: { x: 0.5, y: 0.5 } },
  norms: { cut: 0.5, mix: 0.5, on: 0, pad: 0.5 },
  ranges: {
    cut: { min: 100, max: 10000, log: true, unit: 'Hz' },
    mix: { min: 0, max: 1, log: false, unit: '' },
    on: { min: 0, max: 1, log: false, unit: '' },
    pad: { min: 0, max: 1, log: false, unit: '' },
  },
});

describe('canvases write controls', () => {
  it('sets a value in its own units, clamped to its range, and later reads see it', () => {
    const f = frame();
    expect(writeControl(f, 'cut', 20000)).toEqual({ value: 10000 });
    expect(f.values.cut).toBe(10000);
    expect(f.norms.cut).toBeCloseTo(1);
    expect(writeControl(f, 'mix', 0.25)).toEqual({ value: 0.25 });
  });

  it("setNorm follows the control's scale (log for frequencies)", () => {
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
    expect(() => writeControl(f, 'nope', 1)).toThrow(CanvasWriteError);
    expect(() => writeControl(f, 'nope', 1)).toThrow(/Controls: cut, mix, on, pad/);
    expect(() => writeControl({ values: {}, norms: {}, ranges: {} }, 'k1', 1)).toThrow(
      /Add a knob/,
    );
    expect(() => writeControl(f, 'cut', Number.NaN)).toThrow(/must be a number/);
    expect(() => writeControl(f, 'cut', '3')).toThrow(/must be a number/);
    expect(() => writeControl(f, 'pad', 0.5)).toThrow(/XY pad takes x and y/);
    expect(() => writeControl(f, 'on', 'yes')).toThrow(/true or false/);
    expect(f.values).toEqual(frame().values);
  });
});

describe('writes the page has not taken in yet', () => {
  it('a frame or mouse event that left before the page took a write in still carries the old value: the part keeps seeing its own', () => {
    const pending: PendingWrites = new Map([
      ['cut', { value: 2000, write: 3 }],
      ['pad', { value: { x: 0.9, y: 0.1 }, write: 4 }],
    ]);
    const stale = frame();
    overlayPending(stale, pending, 2);
    expect(stale.values.cut).toBe(2000);
    expect(stale.norms.cut).toBeCloseTo(Math.log(20) / Math.log(100));
    expect(stale.values.pad).toEqual({ x: 0.9, y: 0.1 });
    expect(pending.size).toBe(2);
  });
  it('once the page has taken a write in, the page has the say again (an undo may have changed the value since)', () => {
    const pending: PendingWrites = new Map([
      ['cut', { value: 2000, write: 3 }],
      ['mix', { value: 0.9, write: 4 }],
    ]);
    const afterUndo = frame();
    overlayPending(afterUndo, pending, 3);
    expect(afterUndo.values.cut).toBe(1000);
    expect(afterUndo.values.mix).toBe(0.9);
    expect([...pending.keys()]).toEqual(['mix']);
    const later = frame();
    overlayPending(later, pending, 4);
    expect(later.values.mix).toBe(0.5);
    expect(pending.size).toBe(0);
  });
  it('a write to a control that is gone is forgotten', () => {
    const pending: PendingWrites = new Map([['gone', { value: 1, write: 5 }]]);
    const f = frame();
    overlayPending(f, pending, 0);
    expect(f.values.gone).toBeUndefined();
    expect(pending.size).toBe(0);
  });
});

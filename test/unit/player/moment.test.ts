import { describe, expect, it } from 'vite-plus/test';
import {
  endValues,
  movingAt,
  readMoment,
  valuesAt,
  type Moment,
} from '../../../src/player/moment.ts';

const moment = (m: Partial<Moment> = {}): Moment => ({
  seconds: 6,
  source: null,
  notes: [],
  moves: [],
  ...m,
});

describe('moment', () => {
  it('reads a moment, with a move on the value port and full velocity unless named', () => {
    const read = readMoment({
      seconds: 4,
      source: 'guitar',
      notes: [{ at: 0.5, note: 60, hold: 0.2 }],
      moves: [{ widget: 'k1', from: 0, to: 1, at: 1, takes: 2 }],
    });
    expect(read).toEqual({
      seconds: 4,
      source: 'guitar',
      notes: [{ at: 0.5, note: 60, hold: 0.2, velocity: 100 }],
      moves: [{ widget: 'k1', port: 'value', from: 0, to: 1, at: 1, takes: 2 }],
    });
  });

  it('refuses what is not a moment', () => {
    expect(readMoment(null)).toHaveProperty('error');
    expect(readMoment({ seconds: 0 })).toHaveProperty('error');
    expect(readMoment({ seconds: 5, source: 'input' })).toHaveProperty('error');
    expect(readMoment({ seconds: 5, notes: [{ at: 0, note: 200, hold: 1 }] })).toHaveProperty(
      'error',
    );
    expect(
      readMoment({ seconds: 5, moves: [{ widget: 'k', from: 0, to: 1, at: -1 }] }),
    ).toHaveProperty('error');
  });

  it('holds a control at its first move until the move starts, eases it, then holds where it ends', () => {
    const m = moment({
      moves: [
        { widget: 'k', port: 'value', from: 0, to: 10, at: 1, takes: 2 },
        { widget: 'k', port: 'value', from: 10, to: 4, at: 4, takes: 1 },
      ],
    });
    const at = (t: number) => valuesAt(m, t).get('k\u0000value')!.value;
    expect(at(0)).toBe(0);
    expect(at(2)).toBe(5);
    expect(at(3.5)).toBe(10);
    expect(at(4.5)).toBe(7);
    expect(at(6)).toBe(4);
    expect(endValues(m)).toEqual([{ widget: 'k', port: 'value', value: 4 }]);
  });

  it('names the control being turned only while a move takes time', () => {
    const m = moment({
      moves: [
        { widget: 'a', port: 'value', from: 0, to: 1, at: 1, takes: 1 },
        { widget: 'b', port: 'x', from: 0, to: 1, at: 3, takes: 0 },
      ],
    });
    expect(movingAt(m, 0.5)).toBeNull();
    expect(movingAt(m, 1.5)?.widget).toBe('a');
    expect(movingAt(m, 3)).toBeNull();
  });
});

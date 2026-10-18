import { describe, expect, it } from 'vite-plus/test';
import {
  align,
  bounds,
  distribute,
  grow,
  nudge,
  placePicture,
  resizeBy,
} from '../../../src/plugin/edit.ts';

const frame = { x: 0, y: 0, w: 400, h: 300 };
const r = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe('editing the plugin layout', () => {
  it('aligns to the selection bounds, or to the plugin when one thing (or one group) is selected', () => {
    const rects = { a: r(10, 10, 20, 20), b: r(50, 40, 40, 10) };
    expect(align(rects, 'left', frame)).toEqual({ a: r(10, 10, 20, 20), b: r(10, 40, 40, 10) });
    expect(align(rects, 'right', frame)).toEqual({ a: r(70, 10, 20, 20), b: r(50, 40, 40, 10) });
    expect(align(rects, 'bottom', frame)).toEqual({ a: r(10, 30, 20, 20), b: r(50, 40, 40, 10) });
    expect(align(rects, 'hcenter', frame)).toEqual({ a: r(40, 10, 20, 20), b: r(30, 40, 40, 10) });
    expect(align({ a: r(10, 10, 20, 20) }, 'hcenter', frame)).toEqual({ a: r(190, 10, 20, 20) });
    // A group moves as one: its members keep their places relative to each other.
    expect(align(rects, 'vcenter', frame, [['a', 'b']])).toEqual({
      a: r(10, 130, 20, 20),
      b: r(50, 160, 40, 10),
    });
  });
  it('distributes with equal gaps, first and last staying put', () => {
    const rects = { a: r(0, 0, 10, 10), b: r(15, 0, 30, 10), c: r(100, 0, 10, 10) };
    const out = distribute(rects, 'h');
    expect(out.a!.x).toBe(0);
    expect(out.c!.x).toBe(100);
    expect(out.b!.x - 10).toBe(100 - (out.b!.x + 30)); // the same gap on both sides
    expect(distribute({ a: rects.a, b: rects.b }, 'h')).toEqual({});
  });
  it('nudges keep things reachable; growing never goes below the minimum', () => {
    expect(nudge({ a: r(390, 290, 20, 20) }, 50, 50, frame)).toEqual({ a: r(392, 292, 20, 20) });
    expect(grow({ a: r(0, 0, 10, 10) }, -20, 5)).toEqual({ a: r(0, 0, 4, 15) });
  });
  it('resizes from any handle; corners can keep the proportions', () => {
    expect(resizeBy(r(10, 10, 100, 50), 'se', 20, 10)).toEqual(r(10, 10, 120, 60));
    expect(resizeBy(r(10, 10, 100, 50), 'nw', 20, 10)).toEqual(r(30, 20, 80, 40));
    expect(resizeBy(r(10, 10, 100, 50), 'se', 100, 0, true)).toEqual(r(10, 10, 200, 100));
    expect(resizeBy(r(10, 10, 100, 50), 'w', 200, 0)).toEqual(r(106, 10, 4, 50));
  });
  it('pictures land centred where they were dropped, shrunk to fit', () => {
    expect(placePicture({ width: 1000, height: 500 }, { x: 200, y: 150 }, frame)).toEqual(
      r(80, 90, 240, 120),
    );
    expect(placePicture({ width: 40, height: 20 }, { x: 10, y: 10 }, frame)).toEqual(
      r(-10, 0, 40, 20),
    );
    expect(bounds([r(0, 0, 10, 10), r(20, 30, 5, 5)])).toEqual(r(0, 0, 25, 35));
  });
});

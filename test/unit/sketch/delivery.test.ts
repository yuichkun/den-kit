import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vite-plus/test';
import {
  decodeReply,
  encodeReply,
  readState,
  type Reply,
  type Sheet,
} from '../../../sketch/delivery/record.ts';
import type { Control } from '../../../sketch/delivery/sound.ts';
import {
  applyCondition,
  fileName,
  readSpec,
  settingAt,
  toUnit,
  variation,
  type DeliverySpec,
} from '../../../sketch/delivery/spec.ts';
import { peaks, wav } from '../../../sketch/delivery/wav.ts';

const footsteps = readSpec(
  JSON.parse(
    readFileSync(
      new URL('../../../public/delivery/footsteps/delivery.json', import.meta.url),
      'utf8',
    ),
  ),
) as DeliverySpec;
const controls: Control[] = [
  { id: 'tone', label: 'Tone', min: 200, max: 6000, scale: 'log', unit: 'Hz', value: 2400 },
  { id: 'grit', label: 'Grit', min: 0, max: 1, scale: 'linear', unit: '', value: 0.1 },
];
const points = [
  { name: 'Low', x: 0.1, y: 0.1, values: { tone: 300, grit: 0.2 } },
  { name: 'High', x: 0.9, y: 0.9, values: { tone: 4000, grit: 0.8 } },
];
const ids = new Set(['tone', 'grit']);
const emptySheet: Sheet = { rows: [], cells: {}, naming: 'x_{nn}', channels: 1 };

describe('the author side of a delivery', () => {
  it('reads the footsteps delivery', () => {
    expect('error' in footsteps).toBe(false);
    expect(footsteps.points.map(p => p.name)).toEqual([
      'Metal',
      'Wood',
      'Concrete',
      'Gravel',
      'Grass',
      'Snow',
    ]);
    expect(footsteps.condition.options.map(o => o.name)).toEqual(['walk', 'run', 'sneak']);
  });
  it('refuses a delivery without points or with a delivered version it does not list', () => {
    expect(readSpec({ ...footsteps, points: [] })).toHaveProperty('error');
    expect(readSpec({ ...footsteps, delivered: 'v9' })).toHaveProperty('error');
  });
});

describe('the map', () => {
  it('gives a point its own setting on the point', () => {
    expect(settingAt(points, controls, 0.1, 0.1)).toEqual({ tone: 300, grit: 0.2 });
  });
  it('never leaves the range the points give, anywhere', () => {
    for (const [x, y] of [
      [0, 1],
      [0.5, 0.5],
      [1, 0],
      [0.95, 0.99],
    ] as const) {
      const s = settingAt(points, controls, x, y);
      expect(s.tone).toBeGreaterThanOrEqual(300 - 1e-9);
      expect(s.tone).toBeLessThanOrEqual(4000 + 1e-9);
      expect(s.grit).toBeGreaterThanOrEqual(0.2 - 1e-9);
      expect(s.grit).toBeLessThanOrEqual(0.8 + 1e-9);
    }
  });
});

describe('variations', () => {
  const base = { tone: 1000, grit: 0.5 };
  const spread = { tone: 0.04, grit: 0.06 };
  it('are the same from the same seed and differ from another', () => {
    expect(variation(controls, base, spread, 96, 7)).toEqual(
      variation(controls, base, spread, 96, 7),
    );
    expect(variation(controls, base, spread, 96, 7)).not.toEqual(
      variation(controls, base, spread, 96, 8),
    );
  });
  it('move each control only within the spread', () => {
    for (let seed = 1; seed < 200; seed++) {
      const v = variation(controls, base, spread, 96, seed);
      for (const c of controls)
        expect(
          Math.abs(toUnit(c, v.setting[c.id]!) - toUnit(c, base[c.id as 'tone'])),
        ).toBeLessThanOrEqual(spread[c.id as 'tone'] + 1e-9);
      expect(v.preroll).toBeGreaterThanOrEqual(2);
      expect(v.preroll).toBeLessThan(62);
      expect(Math.abs(v.velocity - 96)).toBeLessThanOrEqual(8);
    }
  });
  it('follow a condition: set, add and multiply, inside the range', () => {
    const run = {
      name: 'run',
      every: 0.3,
      velocity: 120,
      change: { tone: { mul: 10 }, grit: { set: 0.2, add: 0.1 } },
    };
    const out = applyCondition(controls, base, run);
    expect(out.tone).toBe(6000);
    expect(out.grit).toBeCloseTo(0.3);
  });
});

describe('file names', () => {
  it('fill the pattern and stay safe', () => {
    expect(
      fileName('footstep_{point}_{condition}_{nn}', {
        point: 'Near Gravel',
        condition: 'run',
        nn: 3,
        version: 'v1',
      }),
    ).toBe('footstep_near_gravel_run_03.wav');
    expect(fileName('../{point}/x y', { point: 'A', condition: '', nn: 1, version: 'v1' })).toBe(
      'a_x_y.wav',
    );
  });
});

describe('a reply link', () => {
  const reply: Reply = {
    work: 'footsteps',
    version: 'v1',
    fingerprint: 'a027069e',
    name: 'Level designer',
    message: 'Gravel is close — run a little heavier?',
    kept: [
      {
        id: 'k1',
        name: 'Near Gravel',
        setting: { tone: 3000, grit: 0.7 },
        version: 'v1',
        fingerprint: 'a027069e',
        from: 'map',
        pos: { x: 0.7, y: 0.3 },
      },
    ],
    sheet: {
      rows: [],
      cells: { 'point:Wood|walk': { count: 2, seeds: [5, 6], locked: [true, false] } },
      naming: 'f_{nn}',
      channels: 1,
    },
  };
  it('reads back what was sent', () => {
    expect(decodeReply(encodeReply(reply), ids, emptySheet)).toEqual(reply);
  });
  it('keeps only known controls and finite numbers', () => {
    const odd = {
      ...reply,
      kept: [{ ...reply.kept[0]!, setting: { tone: 3000, evil: 1, grit: 'x' } }],
    };
    const read = decodeReply(encodeReply(odd as unknown as Reply), ids, emptySheet) as Reply;
    expect(read.kept[0]!.setting).toEqual({ tone: 3000 });
  });
  it('refuses a damaged link', () => {
    expect(decodeReply('%%%not-base64', ids, emptySheet)).toHaveProperty('error');
    expect(decodeReply(btoa('[1,2]'), ids, emptySheet)).toHaveProperty('error');
  });
  it('limits what the stored state may hold', () => {
    const fresh = { version: 'v1', kept: [], sheet: emptySheet, name: '' };
    const read = readState(
      {
        version: 'v2',
        kept: [{ id: '<script>', setting: { tone: 1 } }],
        sheet: { cells: { a: { count: 99 } } },
      },
      ids,
      fresh,
    );
    expect(read.version).toBe('v2');
    expect(read.kept).toEqual([]);
    expect(read.sheet.cells.a!.count).toBe(8);
  });
});

describe('WAV files', () => {
  it('write a 16-bit PCM header, mono as the average, faded at the end', () => {
    const left = new Float32Array(480).fill(0.5),
      right = new Float32Array(480).fill(0.25);
    const bytes = wav({ channels: [left, right], sampleRate: 48000 }, 1, 0.001);
    const view = new DataView(bytes.buffer);
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('RIFF');
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(bytes.length).toBe(44 + 480 * 2);
    expect(view.getInt16(44, true)).toBe(Math.round(0.375 * 0x7fff - 0.5));
    expect(Math.abs(view.getInt16(44 + 479 * 2, true))).toBeLessThan(800);
    expect(peaks({ channels: [left, right], sampleRate: 48000 }, 4)).toEqual([0.5, 0.5, 0.5, 0.5]);
  });
});

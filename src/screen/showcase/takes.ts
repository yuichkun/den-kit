// Demo takes for the showcase works: written by hand (`demo`), not recorded from
// someone playing, to show what a take hands over with a work. Each is made from a
// few lines of music and a few curves, at the controls' ids in its work.
import type { Intent } from '../../work/ops.ts';
import {
  serializeTake,
  takePathFor,
  TAKE_FORMAT,
  TAKE_VERSION,
  type Take,
  type TakeMove,
  type TakeNote,
} from '../../work/takes.ts';

/** The edit that puts a take in a work: its file. */
export const takeFile = (take: Take): Intent => ({
  op: 'setProjectFiles',
  files: { [takePathFor(take.name, {})]: serializeTake(take) },
});

const ease = (k: number) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, k)))) / 2;
/** A knob turned from `a` to `b` between two times, a move every `every` ms (log: evenly in octaves). */
function turn(
  control: string,
  from: number,
  to: number,
  a: number,
  b: number,
  { log = false, every = 40 } = {},
): TakeMove[] {
  const moves: TakeMove[] = [];
  for (let t = from; t <= to; t += every) {
    const k = ease((t - from) / (to - from));
    const value = log ? a * (b / a) ** k : a + (b - a) * k;
    moves.push({ t, control, values: { value: Number(value.toPrecision(4)) } });
  }
  return moves;
}

/** Acid Line: a bass line on the pads, the cutoff opened and closed and the resonance raised as it plays. */
export function acidTake(): Take {
  const step = 120; // sixteenths at 125 BPM
  const lead = 300;
  // [pad note, accented, slides into the next], null: a rest.
  const bar: Array<[number, boolean, boolean] | null> = [
    [36, true, false],
    [36, false, false],
    [48, false, true],
    [36, false, false],
    null,
    [39, false, false],
    [36, true, false],
    [43, false, true],
    [46, false, false],
    null,
    [36, true, false],
    [48, false, true],
    [39, false, false],
    [41, false, false],
    [43, true, false],
    [36, false, false],
  ];
  const notes: TakeNote[] = [];
  for (let b = 0; b < 8; b++)
    bar.forEach((n, i) => {
      if (!n) return;
      notes.push({
        t: lead + (b * 16 + i) * step,
        note: n[0],
        velocity: n[1] ? 120 : 84,
        length: n[2] ? step + 10 : 80,
      });
    });
  const barMs = 16 * step;
  const moves = [
    ...turn('kcut', lead + barMs, lead + barMs * 3.75, 340, 2400, { log: true }),
    ...turn('kres', lead + barMs * 4, lead + barMs * 4 + 400, 0.72, 0.9),
    ...turn('kcut', lead + barMs * 5, lead + barMs * 6.75, 2400, 420, { log: true }),
    ...turn('kdec', lead + barMs * 5 + 80, lead + barMs * 6.75, 0.2, 0.5, { log: true }),
  ].sort((a, b) => a.t - b.t);
  return {
    format: TAKE_FORMAT,
    version: TAKE_VERSION,
    name: 'Open the filter on a running line',
    about:
      'Let the line run, then open CUTOFF slowly; push RESONANCE once it is open, and close it again with a longer DECAY.',
    demo: true,
    length: lead + barMs * 8 + 300,
    start: {
      kcut: { value: 340 },
      kres: { value: 0.72 },
      kenv: { value: 3.4 },
      kdec: { value: 0.2 },
      kglide: { value: 0.06 },
      kdrive: { value: 2.2 },
    },
    moves,
    notes,
  };
}

/** Afterglow: two held chords, the sun on the XY pad dragged from dark and still to bright and swaying. */
export function padTake(): Take {
  const chord = (t: number, list: number[], length: number): TakeNote[] =>
    list.map((note, i) => ({ t: t + i * 25, note, velocity: 76 + i * 4, length: length - i * 25 }));
  const notes = [...chord(300, [48, 52, 55, 59], 7000), ...chord(8000, [53, 55, 57, 60], 7000)];
  const xy = (from: number, to: number, path: (k: number) => [number, number], every = 40) => {
    const moves: TakeMove[] = [];
    for (let t = from; t <= to; t += every) {
      const [x, y] = path((t - from) / (to - from));
      moves.push({
        t,
        control: 'xy1',
        values: { x: Number(x.toFixed(4)), y: Number(y.toFixed(4)) },
      });
    }
    return moves;
  };
  const moves = [
    // Down to the dark, still corner first...
    ...xy(1200, 1700, k => [0.55 - 0.4 * ease(k), 0.35 - 0.2 * ease(k)]),
    // ...then slowly up to bright and swaying, along a curve.
    ...xy(2300, 6800, k => {
      const e = ease(k);
      return [0.15 + 0.7 * e, 0.15 + 0.67 * Math.sin((Math.PI / 2) * e)];
    }),
    ...turn('kspace', 7400, 8600, 0.38, 0.72),
    // Over the second chord, the sun wanders and sways.
    ...xy(9000, 14000, k => [
      0.85 - 0.5 * ease(k),
      0.82 - 0.12 * k + 0.13 * Math.sin(4 * Math.PI * k),
    ]),
  ].sort((a, b) => a.t - b.t);
  return {
    format: TAKE_FORMAT,
    version: TAKE_VERSION,
    name: 'Let the chord bloom',
    about:
      'Hold the chord and start the sun dark and still, then bring it up slowly. Open the Space between the chords.',
    demo: true,
    length: 15600,
    start: {
      xy1: { x: 0.55, y: 0.35 },
      katt: { value: 1.2 },
      krel: { value: 2.6 },
      kbloom: { value: 2.4 },
      kspace: { value: 0.38 },
    },
    moves,
    notes,
  };
}

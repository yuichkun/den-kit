// Takes as files of the work: read within limits and refused with a reason, written
// one move or note per line and read back the same, named next to the other takes,
// kept small without losing a movement's shape, and cut into steps to follow.
import { describe, expect, it } from 'vite-plus/test';
import { applyIntents } from '../../../src/work/ops.ts';
import { catalog } from '../../../src/sound/blocks/index.ts';
import { emptyDocument } from '../../../src/work/schema.ts';
import {
  isTakePath,
  parseTake,
  serializeTake,
  simplifyMoves,
  takeGestures,
  takePathFor,
  takeSteps,
  takesOf,
  valuesAt,
  TAKE_FORMAT,
  TAKE_LIMITS,
  type Take,
  type TakeMove,
} from '../../../src/work/takes.ts';

const take = (over: Partial<Take> = {}): Take => ({
  format: TAKE_FORMAT,
  version: 1,
  name: 'Sweep',
  length: 4000,
  start: { cut: { value: 100 }, pad: { x: 0.5, y: 0.5 } },
  moves: [
    { t: 1000, control: 'cut', values: { value: 200 } },
    { t: 1100, control: 'cut', values: { value: 400 } },
  ],
  notes: [{ t: 0, note: 48, velocity: 100, length: 500 }],
  ...over,
});

describe('a take', () => {
  it('reads back as it was written, one move or note per line', () => {
    const t = take({ about: 'Slowly.', demo: true });
    const text = serializeTake(t);
    expect(parseTake(text)).toEqual(t);
    expect(text.split('\n')).toContain('    {"t":1100,"control":"cut","values":{"value":400}}');
    expect(text).toMatch(
      /"notes": \[\n {4}\{"t":0,"note":48,"velocity":100,"length":500\}\n {2}\]/,
    );
  });

  it('is refused with a reason when it is not a take, and read within its limits', () => {
    expect(parseTake('{')).toEqual({ error: 'is not JSON.' });
    expect(parseTake('[]')).toEqual({ error: 'is not a JSON object.' });
    expect(parseTake(JSON.stringify({ ...take(), format: 'x' }))).toMatchObject({
      error: expect.stringMatching(/is not a take/),
    });
    expect(parseTake(JSON.stringify({ ...take(), version: 2 }))).toMatchObject({
      error: expect.stringMatching(/version 2/),
    });
    expect(parseTake(JSON.stringify({ ...take(), length: TAKE_LIMITS.ms + 1 }))).toMatchObject({
      error: expect.stringMatching(/length/),
    });
    // A move after the end, a note out of range, a value that is not a number: refused, saying which.
    expect(
      parseTake(
        JSON.stringify({ ...take(), moves: [{ t: 5000, control: 'cut', values: { value: 1 } }] }),
      ),
    ).toMatchObject({ error: expect.stringMatching(/^moves\[0\]/) });
    expect(
      parseTake(
        JSON.stringify({ ...take(), notes: [{ t: 0, note: 128, velocity: 1, length: 1 }] }),
      ),
    ).toMatchObject({ error: expect.stringMatching(/^notes\[0\]/) });
    expect(
      parseTake(
        JSON.stringify({ ...take(), moves: [{ t: 1, control: 'cut', values: { value: 'loud' } }] }),
      ),
    ).toMatchObject({ error: expect.stringMatching(/^moves\[0\]/) });
    expect(
      parseTake(
        JSON.stringify({
          ...take(),
          moves: Array.from({ length: TAKE_LIMITS.moves + 1 }, () => ({
            t: 1,
            control: 'cut',
            values: { value: 1 },
          })),
        }),
      ),
    ).toMatchObject({ error: expect.stringMatching(/more than/) });
  });

  it('is put in order, its velocities and notes kept in range, its name cut short', () => {
    const read = parseTake(
      JSON.stringify({
        ...take(),
        name: `  ${'n'.repeat(200)}  `,
        moves: [
          { t: 2000.4, control: 'cut', values: { value: 3 } },
          { t: 10, control: 'cut', values: { value: 1 } },
        ],
        notes: [
          { t: 3900, note: 50, velocity: 400, length: 900 },
          { t: 0, note: 48, velocity: 0, length: 10 },
        ],
      }),
    ) as Take;
    expect(read.name).toHaveLength(TAKE_LIMITS.name);
    expect(read.moves.map(m => m.t)).toEqual([10, 2000]);
    expect(read.notes).toEqual([
      { t: 0, note: 48, velocity: 1, length: 10 },
      { t: 3900, note: 50, velocity: 127, length: 100 },
    ]);
  });

  it('is a file under takes/, named after the take next to the others', () => {
    expect(isTakePath('takes/sweep.json')).toBe(true);
    expect(isTakePath('takes/a/b.json')).toBe(false);
    expect(isTakePath('src/takes/sweep.json')).toBe(false);
    expect(takePathFor('Open the filter!', {})).toBe('takes/open-the-filter.json');
    expect(takePathFor('Take 1', { 'takes/take-1.json': {} })).toBe('takes/take-1-2.json');
    expect(takePathFor('…', {})).toBe('takes/take.json');
  });

  it("is read from the work's files, a broken one said by its path", () => {
    const doc = applyIntents(
      emptyDocument('A'),
      [
        {
          op: 'setProjectFiles',
          files: {
            'takes/good.json': serializeTake(take()),
            'takes/bad.json': '{"format":"den-kit/take"}',
            'notes.json': serializeTake(take()),
          },
        },
      ],
      catalog,
    ).doc;
    expect(takesOf(doc.files)).toEqual([
      { path: 'takes/bad.json', error: expect.stringMatching(/^takes\/bad\.json is take version/) },
      { path: 'takes/good.json', take: take() },
    ]);
  });

  it('says where a control is at a time, from where it started and the moves up to then', () => {
    const t = take();
    expect(valuesAt(t, 'cut', 0)).toEqual({ value: 100 });
    expect(valuesAt(t, 'cut', 1000)).toEqual({ value: 200 });
    expect(valuesAt(t, 'cut', 1000, true)).toEqual({ value: 100 });
    expect(valuesAt(t, 'cut', 9999)).toEqual({ value: 400 });
    expect(valuesAt(t, 'nothing', 9999)).toBeUndefined();
  });
});

describe("a take's moves, kept small", () => {
  const line = (control: string, from: number, to: number, a: number, b: number): TakeMove[] =>
    Array.from({ length: (to - from) / 10 + 1 }, (_, i) => ({
      t: from + i * 10,
      control,
      values: { value: a + ((b - a) * i * 10) / (to - from) },
    }));
  const unit = (_: string, v: Record<string, number | boolean>) => [Number(v.value)];

  it('keeps the corners of a movement and its ends, and every move of a control it cannot measure', () => {
    // Up in a straight line, then down: the start, the turn and the end are what is left.
    const moves = [...line('k', 0, 500, 0, 1), ...line('k', 510, 1000, 0.9, 0)];
    const kept = simplifyMoves(moves, unit);
    expect(kept.map(m => m.t)).toEqual([0, 500, 510, 1000]);
    // A pause splits it into two movements: both keep their ends.
    const paused = [...line('k', 0, 100, 0, 0.5), ...line('k', 900, 1000, 0.5, 1)];
    expect(simplifyMoves(paused, unit).map(m => m.t)).toEqual([0, 100, 900, 1000]);
    const toggles = line('sw', 0, 50, 0, 1);
    expect(simplifyMoves(toggles, () => null)).toEqual(toggles);
  });
});

describe("a take's steps", () => {
  it('are the stretches where controls move, with the notes sounding then, and the notes between', () => {
    const t = take({
      length: 12000,
      notes: [
        // A chord held through the first movement.
        { t: 0, note: 48, velocity: 90, length: 3000 },
        { t: 20, note: 52, velocity: 90, length: 2980 },
        // A run of twenty notes, then a pause, then two short ones just before the last movement.
        ...Array.from({ length: 20 }, (_, i) => ({
          t: 3500 + i * 100,
          note: 60,
          velocity: 90,
          length: 80,
        })),
        { t: 8000, note: 62, velocity: 90, length: 80 },
        { t: 8100, note: 64, velocity: 90, length: 80 },
      ],
      moves: [
        { t: 1000, control: 'cut', values: { value: 200 } },
        { t: 1200, control: 'cut', values: { value: 300 } },
        // Another control moving along with it: the same step.
        { t: 1300, control: 'pad', values: { x: 0.9, y: 0.9 } },
        { t: 8300, control: 'cut', values: { value: 50 } },
      ],
    });
    const steps = takeSteps(t);
    expect(steps.map(s => [s.from, s.to, s.gestures.map(g => g.control), s.notes.length])).toEqual([
      [0, 3000, [], 2],
      [1000, 1300, ['cut', 'pad'], 2],
      [3500, 4480, [], 10],
      [4500, 5480, [], 10],
      [8000, 8450, ['cut'], 2],
    ]);
    const [cut, pad] = steps[1]!.gestures;
    expect(cut).toMatchObject({ before: { value: 100 }, after: { value: 300 } });
    expect(pad).toMatchObject({ before: { x: 0.5, y: 0.5 }, after: { x: 0.9, y: 0.9 } });
  });

  it('split a control’s moves into movements at a pause', () => {
    const t = take({
      moves: [
        { t: 0, control: 'cut', values: { value: 1 } },
        { t: 400, control: 'cut', values: { value: 2 } },
        { t: 1000, control: 'cut', values: { value: 3 } },
      ],
    });
    expect(takeGestures(t).map(g => [g.from, g.to, g.before, g.after])).toEqual([
      [0, 400, { value: 100 }, { value: 2 }],
      [1000, 1000, { value: 2 }, { value: 3 }],
    ]);
  });
});

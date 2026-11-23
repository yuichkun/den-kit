// Takes: how a person played a work's plugin screen, kept with the work so that the
// people it is handed to can watch it, follow it step by step, or play along. A take
// is a text file of the work (takes/<name>.json), so it changes by the same operation
// as any file, undoes, travels in the work file and its playable build, and reads as
// plain JSON to people and the AI. It holds the controls' values when it started,
// each move of a control (its values, at a time in ms from the start) and each note
// (when, how hard, how long). A take came from a person playing unless `demo` says it
// was written by hand. A take is data from whoever made the work: it is read within
// the limits below, and it only names controls; a control it names that a screen does
// not have is left out where it plays.
import type { WorkFile } from './files.ts';

export const TAKE_FOLDER = 'takes/';
export const TAKE_FORMAT = 'den-kit/take';
export const TAKE_VERSION = 1;
export const TAKE_LIMITS = {
  /** A take's length. */
  ms: 10 * 60_000,
  moves: 40_000,
  notes: 8_000,
  /** The controls a take names. */
  controls: 500,
  name: 80,
  about: 400,
};

/** A control's values: `value`, or `x` and `y` for an XY pad. */
export type TakeValues = Record<string, number | boolean>;
export interface TakeMove {
  /** ms from the start. */
  t: number;
  control: string;
  values: TakeValues;
}
export interface TakeNote {
  t: number;
  note: number;
  velocity: number;
  /** How long it is held, in ms. */
  length: number;
}
export interface Take {
  format: typeof TAKE_FORMAT;
  version: number;
  name: string;
  /** What the person who made the take says about it. */
  about?: string;
  /** Written by hand, not recorded from someone playing. */
  demo?: boolean;
  /** ms. */
  length: number;
  /** Each control's values when the take starts. */
  start: Record<string, TakeValues>;
  moves: TakeMove[];
  notes: TakeNote[];
}
export type ReadTake = { path: string; take: Take } | { path: string; error: string };

export const isTakePath = (path: string) => /^takes\/[^/]+\.json$/.test(path);

/** A path for a new take named `name`, next to the takes `files` has. */
export function takePathFor(name: string, files: Readonly<Record<string, unknown>>): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'take';
  let path = `${TAKE_FOLDER}${slug}.json`;
  for (let i = 2; path in files; i++) path = `${TAKE_FOLDER}${slug}-${i}.json`;
  return path;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function readValues(v: unknown): TakeValues | null {
  if (!isObject(v)) return null;
  const entries = Object.entries(v);
  if (!entries.length || entries.length > 8) return null;
  const out: TakeValues = {};
  for (const [key, value] of entries) {
    if (key.length > 20 || (!finite(value) && typeof value !== 'boolean')) return null;
    out[key] = value;
  }
  return out;
}
const readControl = (v: unknown) =>
  typeof v === 'string' && v.length > 0 && v.length <= 100 ? v : null;

/** A take from its file's text, or why it cannot be read. */
export function parseTake(text: string): Take | { error: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { error: 'is not JSON.' };
  }
  return readTake(value);
}

export function readTake(v: unknown): Take | { error: string } {
  if (!isObject(v)) return { error: 'is not a JSON object.' };
  if (v.format !== TAKE_FORMAT)
    return { error: `is not a take (its format is not ${TAKE_FORMAT}).` };
  if (v.version !== TAKE_VERSION)
    return { error: `is take version ${String(v.version)}; den-kit reads ${TAKE_VERSION}.` };
  if (!finite(v.length) || v.length <= 0 || v.length > TAKE_LIMITS.ms)
    return { error: `has no length, or one over ${TAKE_LIMITS.ms / 60_000} minutes.` };
  const length = Math.round(v.length);
  const start: Record<string, TakeValues> = {};
  if (v.start !== undefined) {
    if (!isObject(v.start)) return { error: 'start is not an object of controls.' };
    const entries = Object.entries(v.start);
    if (entries.length > TAKE_LIMITS.controls)
      return { error: `names more than ${TAKE_LIMITS.controls} controls.` };
    for (const [control, values] of entries) {
      const read = readValues(values);
      if (!readControl(control) || !read) return { error: `start.${control} is not values.` };
      start[control] = read;
    }
  }
  const moves: TakeMove[] = [];
  if (!Array.isArray(v.moves ?? [])) return { error: 'moves is not a list.' };
  const rawMoves = (v.moves ?? []) as unknown[];
  if (rawMoves.length > TAKE_LIMITS.moves)
    return { error: `has more than ${TAKE_LIMITS.moves} moves.` };
  const controls = new Set(Object.keys(start));
  for (const [i, m] of rawMoves.entries()) {
    const control = isObject(m) ? readControl(m.control) : null;
    const values = isObject(m) ? readValues(m.values) : null;
    if (!isObject(m) || !finite(m.t) || m.t < 0 || m.t > length || !control || !values)
      return { error: `moves[${i}] is not a move (t within the length, control, values).` };
    controls.add(control);
    moves.push({ t: Math.round(m.t), control, values });
  }
  if (controls.size > TAKE_LIMITS.controls)
    return { error: `names more than ${TAKE_LIMITS.controls} controls.` };
  const notes: TakeNote[] = [];
  if (!Array.isArray(v.notes ?? [])) return { error: 'notes is not a list.' };
  const rawNotes = (v.notes ?? []) as unknown[];
  if (rawNotes.length > TAKE_LIMITS.notes)
    return { error: `has more than ${TAKE_LIMITS.notes} notes.` };
  for (const [i, n] of rawNotes.entries()) {
    if (
      !isObject(n) ||
      !finite(n.t) ||
      n.t < 0 ||
      n.t > length ||
      !Number.isInteger(n.note) ||
      (n.note as number) < 0 ||
      (n.note as number) > 127 ||
      !finite(n.velocity) ||
      !finite(n.length) ||
      n.length <= 0
    )
      return { error: `notes[${i}] is not a note (t, note 0–127, velocity, length).` };
    const t = Math.round(n.t);
    notes.push({
      t,
      note: n.note as number,
      velocity: Math.min(127, Math.max(1, Math.round(n.velocity))),
      length: Math.max(1, Math.min(Math.round(n.length), length - t)),
    });
  }
  const take: Take = {
    format: TAKE_FORMAT,
    version: TAKE_VERSION,
    name: (typeof v.name === 'string' ? v.name.trim() : '').slice(0, TAKE_LIMITS.name) || 'Take',
    length,
    start,
    moves: moves.sort((a, b) => a.t - b.t),
    notes: notes.sort((a, b) => a.t - b.t || a.note - b.note),
  };
  if (typeof v.about === 'string' && v.about.trim())
    take.about = v.about.trim().slice(0, TAKE_LIMITS.about);
  if (v.demo === true) take.demo = true;
  return take;
}

const round = (v: number | boolean) => (typeof v === 'number' ? Number(v.toPrecision(5)) : v);
const roundValues = (values: TakeValues) =>
  Object.fromEntries(Object.entries(values).map(([k, v]) => [k, round(v)]));

/** A take's file: one move or note per line, so that it reads and diffs line by line. */
export function serializeTake(take: Take): string {
  const head: Record<string, unknown> = {
    format: TAKE_FORMAT,
    version: TAKE_VERSION,
    name: take.name,
  };
  if (take.about) head.about = take.about;
  if (take.demo) head.demo = true;
  head.length = Math.round(take.length);
  const lines = Object.entries(head).map(
    ([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`,
  );
  const start = Object.fromEntries(
    Object.entries(take.start).map(([control, values]) => [control, roundValues(values)]),
  );
  lines.push(`  "start": ${JSON.stringify(start)}`);
  const list = (items: unknown[]) =>
    items.length ? `[\n${items.map(i => `    ${JSON.stringify(i)}`).join(',\n')}\n  ]` : '[]';
  lines.push(
    `  "moves": ${list(take.moves.map(m => ({ t: Math.round(m.t), control: m.control, values: roundValues(m.values) })))}`,
  );
  lines.push(
    `  "notes": ${list(take.notes.map(n => ({ t: Math.round(n.t), note: n.note, velocity: n.velocity, length: Math.round(n.length) })))}`,
  );
  return `{\n${lines.join(',\n')}\n}\n`;
}

/** The work's takes, by path: each read, or why it cannot be. */
export function takesOf(files: Readonly<Record<string, WorkFile>>): ReadTake[] {
  return Object.entries(files)
    .filter(([path, file]) => isTakePath(path) && 'text' in file)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, file]) => {
      const read = parseTake((file as { text: string }).text);
      return 'error' in read ? { path, error: `${path} ${read.error}` } : { path, take: read };
    });
}

/** A control's values at `t` (moves at `t` included), or before it (`before`). */
export function valuesAt(
  take: Take,
  control: string,
  t: number,
  before = false,
): TakeValues | undefined {
  let values = take.start[control] ? { ...take.start[control] } : undefined;
  for (const m of take.moves) {
    if (m.t > t || (before && m.t === t)) break;
    if (m.control === control) values = { ...values, ...m.values };
  }
  return values;
}

/** One movement of one control: its moves with no pause longer than GESTURE_GAP between them. */
export interface TakeGesture {
  control: string;
  from: number;
  to: number;
  /** The control's values before the movement (none: the take does not say). */
  before?: TakeValues;
  after: TakeValues;
  moves: TakeMove[];
}
/** A part of a take to play as one step: what moves in it, and the notes that sound in it. */
export interface TakeStep {
  from: number;
  to: number;
  gestures: TakeGesture[];
  notes: TakeNote[];
}

/** Moves of one control further apart than this are two movements. */
export const GESTURE_GAP = 450;
/** Movements closer than this make one step. */
const JOIN = 250;
/** A pause in the notes this long starts a new step. */
const PHRASE_GAP = 600;
/** The most notes one step asks for. */
const PHRASE_NOTES = 16;
/** Fewer notes than this just before controls move go with that step. */
const SHORT_PHRASE = 6;

export function takeGestures(take: Take): TakeGesture[] {
  const byControl = new Map<string, TakeMove[]>();
  for (const m of take.moves) {
    const list = byControl.get(m.control) ?? [];
    list.push(m);
    byControl.set(m.control, list);
  }
  const out: TakeGesture[] = [];
  for (const [control, moves] of byControl) {
    let before = take.start[control] ? { ...take.start[control] } : undefined;
    let current: TakeMove[] = [];
    const flush = () => {
      if (!current.length) return;
      const after = Object.assign({}, before, ...current.map(m => m.values)) as TakeValues;
      out.push({
        control,
        from: current[0]!.t,
        to: current.at(-1)!.t,
        before,
        after,
        moves: current,
      });
      before = after;
      current = [];
    };
    for (const m of moves) {
      if (current.length && m.t - current.at(-1)!.t > GESTURE_GAP) flush();
      current.push(m);
    }
    flush();
  }
  return out.sort((a, b) => a.from - b.from || a.control.localeCompare(b.control));
}

/**
 * A take as steps, in time order: each stretch where controls move (movements that
 * overlap or nearly touch) is a step, with the notes that sound in it; the notes that
 * start between those stretches are steps of their own, split at pauses and kept
 * short. A few short notes just before a stretch belong to its step.
 */
export function takeSteps(take: Take): TakeStep[] {
  const windows: Array<{ from: number; to: number; gestures: TakeGesture[] }> = [];
  for (const g of takeGestures(take)) {
    const last = windows.at(-1);
    if (last && g.from <= last.to + JOIN) {
      last.to = Math.max(last.to, g.to);
      last.gestures.push(g);
    } else windows.push({ from: g.from, to: g.to, gestures: [g] });
  }
  const steps: TakeStep[] = [];
  const phrases = (from: number, to: number): TakeStep[] => {
    const out: TakeStep[] = [];
    let current: TakeNote[] = [];
    let end = -Infinity;
    // A run of notes without a pause, in even parts of at most PHRASE_NOTES.
    const flush = () => {
      const parts = Math.ceil(current.length / PHRASE_NOTES);
      const size = Math.ceil(current.length / Math.max(1, parts));
      for (let i = 0; i < current.length; i += size) {
        const notes = current.slice(i, i + size);
        out.push({
          from: notes[0]!.t,
          to: Math.max(...notes.map(n => n.t + n.length)),
          gestures: [],
          notes,
        });
      }
      current = [];
    };
    for (const n of take.notes) {
      if (n.t < from || n.t >= to) continue;
      if (current.length && n.t > end + PHRASE_GAP) flush();
      current.push(n);
      end = Math.max(end, n.t + n.length);
    }
    flush();
    return out;
  };
  let cursor = 0;
  for (const w of windows) {
    const before = phrases(cursor, w.from);
    let from = w.from;
    const lead = before.at(-1);
    if (lead && lead.notes.length < SHORT_PHRASE && lead.to <= w.from) from = before.pop()!.from;
    steps.push(...before);
    // A movement as short as a click still gets a moment to see.
    const to = Math.max(w.to, w.from + 150);
    steps.push({
      from,
      to,
      gestures: w.gestures,
      notes: take.notes.filter(n => n.t < to && n.t + n.length > from),
    });
    cursor = to;
  }
  steps.push(...phrases(cursor, Infinity));
  return steps;
}

/**
 * Fewer moves that trace the same movement: within each movement of a control (its
 * first and last moves kept, so pauses stay as they were), a move is left out while
 * the line between the moves kept around it stays within `tolerance` of it. Where a
 * control is, as numbers to measure that in, comes from `unitOf` (its position from 0
 * to 1 on each axis); a control it gives nothing for keeps every move.
 */
export function simplifyMoves(
  moves: readonly TakeMove[],
  unitOf: (control: string, values: TakeValues) => number[] | null,
  tolerance = 0.004,
): TakeMove[] {
  const byControl = new Map<string, TakeMove[]>();
  for (const m of moves) {
    const list = byControl.get(m.control) ?? [];
    list.push(m);
    byControl.set(m.control, list);
  }
  const kept: TakeMove[] = [];
  for (const list of byControl.values()) {
    let runStart = 0;
    for (let i = 1; i <= list.length; i++) {
      if (i < list.length && list[i]!.t - list[i - 1]!.t <= GESTURE_GAP) continue;
      kept.push(...keepTracing(list.slice(runStart, i), unitOf, tolerance));
      runStart = i;
    }
  }
  return kept.sort((a, b) => a.t - b.t);
}

function keepTracing(
  run: readonly TakeMove[],
  unitOf: (control: string, values: TakeValues) => number[] | null,
  tolerance: number,
): TakeMove[] {
  const points = run.map(m => unitOf(m.control, m.values));
  if (run.length < 3 || points.some(p => !p)) return [...run];
  const keep = run.map((_, i) => i === 0 || i === run.length - 1);
  const spans: Array<[number, number]> = [[0, run.length - 1]];
  while (spans.length) {
    const [a, b] = spans.pop()!;
    let worst = -1,
      far = tolerance;
    for (let i = a + 1; i < b; i++) {
      const k = (run[i]!.t - run[a]!.t) / Math.max(1, run[b]!.t - run[a]!.t);
      const d = Math.hypot(
        ...points[i]!.map(
          (u, axis) => u - (points[a]![axis]! + (points[b]![axis]! - points[a]![axis]!) * k),
        ),
      );
      if (d > far) {
        far = d;
        worst = i;
      }
    }
    if (worst > 0) {
      keep[worst] = true;
      spans.push([a, worst], [worst, b]);
    }
  }
  return run.filter((_, i) => keep[i]);
}

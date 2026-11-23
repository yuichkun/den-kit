// A moment: a few seconds of a work being played, which a playable build can carry
// next to its page (moment.json). Notes are played on the work's voices; moves turn
// its controls from one value to another; an effect hears `source`, one of the
// built-in inputs. The player starts the work where the moment ends, so a person who
// saw the moment (a clip of it, or its picture) picks up from there, and plays the
// moment itself when a page shows the work before anyone has touched it.
export type MomentSource = 'chords' | 'drums' | 'guitar';

export interface MomentNote {
  /** Seconds from the moment's start. */
  at: number;
  note: number;
  /** Seconds the note is held. */
  hold: number;
  velocity: number;
}

export interface MomentMove {
  widget: string;
  port: string;
  from: number;
  to: number;
  at: number;
  /** Seconds the move takes; 0 sets the value at once. */
  takes: number;
}

export interface Moment {
  seconds: number;
  source: MomentSource | null;
  notes: MomentNote[];
  moves: MomentMove[];
}

export const MOMENT_FILE = 'moment.json';

const SOURCES: readonly string[] = ['chords', 'drums', 'guitar'];
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A moment read from moment.json, or why it cannot be one. */
export function readMoment(data: unknown): Moment | { error: string } {
  if (!data || typeof data !== 'object') return { error: 'A moment is an object.' };
  const m = data as Record<string, unknown>;
  if (!finite(m.seconds) || m.seconds <= 0 || m.seconds > 60)
    return { error: 'A moment lasts more than 0 and at most 60 seconds.' };
  const source = m.source ?? null;
  if (source !== null && !SOURCES.includes(source as string))
    return { error: `A moment's source is one of ${SOURCES.join(', ')}.` };
  const notes: MomentNote[] = [];
  for (const n of Array.isArray(m.notes) ? m.notes : []) {
    const { at, note, hold, velocity = 100 } = (n ?? {}) as Record<string, unknown>;
    if (![at, note, hold, velocity].every(finite) || (at as number) < 0 || (hold as number) <= 0)
      return { error: 'A note has a start (at), a note number and a hold in seconds.' };
    if (
      (note as number) < 0 ||
      (note as number) > 127 ||
      (velocity as number) < 1 ||
      (velocity as number) > 127
    )
      return { error: 'A note number is 0 to 127 and its velocity 1 to 127.' };
    notes.push({
      at: at as number,
      note: note as number,
      hold: hold as number,
      velocity: velocity as number,
    });
  }
  const moves: MomentMove[] = [];
  for (const v of Array.isArray(m.moves) ? m.moves : []) {
    const {
      widget,
      port = 'value',
      from,
      to,
      at,
      takes = 0,
    } = (v ?? {}) as Record<string, unknown>;
    if (
      typeof widget !== 'string' ||
      typeof port !== 'string' ||
      ![from, to, at, takes].every(finite)
    )
      return { error: 'A move names a widget and a port, and has from, to, at and takes.' };
    if ((at as number) < 0 || (takes as number) < 0)
      return { error: 'A move starts (at) and takes zero seconds or more.' };
    moves.push({
      widget,
      port,
      from: from as number,
      to: to as number,
      at: at as number,
      takes: takes as number,
    });
  }
  return { seconds: m.seconds, source: source as MomentSource | null, notes, moves };
}

const key = (move: MomentMove) => `${move.widget}\u0000${move.port}`;
const eased = (x: number) => x * x * (3 - 2 * x);

/**
 * Each moved control's value at `t` seconds: before its first move it holds that
 * move's `from`; during a move it eases from `from` to `to`; after it, it holds `to`
 * until a later move of the same control starts.
 */
export function valuesAt(moment: Moment, t: number): Map<string, MomentMove & { value: number }> {
  const values = new Map<string, MomentMove & { value: number }>();
  const moves = [...moment.moves].sort((a, b) => a.at - b.at);
  for (const move of moves) {
    const k = key(move);
    if (move.at > t) {
      if (!values.has(k)) values.set(k, { ...move, value: move.from });
      continue;
    }
    const x = move.takes > 0 ? Math.min(1, (t - move.at) / move.takes) : 1;
    values.set(k, { ...move, value: move.from + (move.to - move.from) * eased(x) });
  }
  return values;
}

/** Where the moment leaves each control it moves. */
export function endValues(moment: Moment) {
  return [...valuesAt(moment, Infinity).values()].map(({ widget, port, to }) => ({
    widget,
    port,
    value: to,
  }));
}

/** The move turning a control at `t`, if any (the latest one that has started and not ended). */
export function movingAt(moment: Moment, t: number): MomentMove | null {
  let moving: MomentMove | null = null;
  for (const move of moment.moves)
    if (
      move.takes > 0 &&
      move.at <= t &&
      t <= move.at + move.takes &&
      (!moving || move.at >= moving.at)
    )
      moving = move;
  return moving;
}

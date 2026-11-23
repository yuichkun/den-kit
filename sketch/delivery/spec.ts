// The author's side of a delivery, and the pure rules the sketch builds on it. The
// author's side is a file written by hand next to the builds (delivery.json): den-kit
// has no place to set it yet. It names points on the controls (a surface, a kind of
// rain), how far a variation may move each control, the conditions the recipient's
// list is ordered by (a gait), the file names, and the versions the author sent.
import type { Control, Setting } from './sound.ts';

export interface Point {
  name: string;
  /** Where the point sits on the map, 0..1 from the left and from the top. */
  x: number;
  y: number;
  values: Setting;
}
/** How a condition moves one control: set it, then add to it, then multiply it. */
export interface Change {
  set?: number;
  add?: number;
  mul?: number;
}
export interface Condition {
  name: string;
  /** Seconds between steps when the recipient walks it. */
  every: number;
  velocity: number;
  change: Record<string, Change>;
}
export interface VersionInfo {
  id: string;
  /** The build's folder, next to delivery.json. */
  folder: string;
  notes: string;
}
export interface DeliverySpec {
  title: string;
  message: string;
  versions: VersionInfo[];
  /** The version the recipient was given first. */
  delivered: string;
  /** The notes a step plays, in turn (left and right foot); none for a sound that plays on its own. */
  notes: number[];
  /** Seconds of sound in one file. */
  length: number;
  points: Point[];
  axes: { x: [string, string]; y: [string, string] } | null;
  /** How far a variation may move each control, as a share of its range (0..0.5). */
  spread: Record<string, number>;
  condition: { name: string; options: Condition[] };
  /** File names: {point}, {condition}, {nn} and {version} are filled in. */
  naming: string;
  /** The files' channels unless the recipient picks others (1: mono, as game steps usually are). */
  channels: 1 | 2;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const text = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.length <= max ? v : null;
function numbers(v: unknown): Record<string, number> | null {
  if (!isRecord(v)) return null;
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v)) {
    if (!isNumber(n)) return null;
    out[k] = n;
  }
  return out;
}

/** delivery.json as read, or why it cannot be used. */
export function readSpec(value: unknown): DeliverySpec | { error: string } {
  const fail = (what: string) => ({ error: `delivery.json: ${what}` });
  if (!isRecord(value)) return fail('not an object.');
  const title = text(value.title, 80);
  const message = text(value.message ?? '', 600);
  const naming = text(value.naming, 120);
  if (!title || message === null || !naming) return fail('title, message or naming is missing.');
  if (!Array.isArray(value.versions) || !value.versions.length) return fail('no versions.');
  const versions: VersionInfo[] = [];
  for (const v of value.versions) {
    const id = isRecord(v) ? text(v.id, 20) : null;
    const folder = isRecord(v) ? text(v.folder, 40) : null;
    if (!id || !folder || !/^[\w-]+$/.test(folder)) return fail('a version has no id or folder.');
    versions.push({ id, folder, notes: (isRecord(v) && text(v.notes, 400)) || '' });
  }
  const delivered = text(value.delivered, 20);
  if (!delivered || !versions.some(v => v.id === delivered))
    return fail('the delivered version is not listed.');
  // No notes: the sound plays on its own (rain), and a file is its length of sound.
  if (!Array.isArray(value.notes)) return fail('notes is not a list.');
  const notes = value.notes.filter(isNumber).map(n => Math.min(127, Math.max(0, Math.round(n))));
  if (!isNumber(value.length) || value.length <= 0 || value.length > 30)
    return fail('length is not 0..30 seconds.');
  if (!Array.isArray(value.points) || !value.points.length) return fail('no points.');
  const points: Point[] = [];
  for (const p of value.points) {
    const name = isRecord(p) ? text(p.name, 40) : null;
    const values = isRecord(p) ? numbers(p.values) : null;
    if (!isRecord(p) || !name || !values || !isNumber(p.x) || !isNumber(p.y))
      return fail('a point is incomplete.');
    points.push({ name, x: clamp01(p.x), y: clamp01(p.y), values });
  }
  let axes: DeliverySpec['axes'] = null;
  if (isRecord(value.axes)) {
    const pair = (v: unknown): [string, string] | null =>
      Array.isArray(v) && v.length === 2 && v.every(s => text(s, 30) !== null)
        ? [v[0] as string, v[1] as string]
        : null;
    const x = pair(value.axes.x),
      y = pair(value.axes.y);
    if (x && y) axes = { x, y };
  }
  const spread = numbers(value.spread ?? {});
  if (!spread) return fail('spread is not a list of numbers.');
  const condition = value.condition;
  if (!isRecord(condition) || !text(condition.name, 30) || !Array.isArray(condition.options))
    return fail('condition is incomplete.');
  const options: Condition[] = [];
  for (const o of condition.options) {
    const name = isRecord(o) ? text(o.name, 30) : null;
    if (!isRecord(o) || !name || !isNumber(o.every) || !isNumber(o.velocity))
      return fail('a condition option is incomplete.');
    const change: Record<string, Change> = {};
    for (const [id, c] of Object.entries(isRecord(o.change) ? o.change : {})) {
      if (!isRecord(c)) return fail(`the change of ${id} is not an object.`);
      change[id] = {
        ...(isNumber(c.set) ? { set: c.set } : {}),
        ...(isNumber(c.add) ? { add: c.add } : {}),
        ...(isNumber(c.mul) ? { mul: c.mul } : {}),
      };
    }
    options.push({
      name,
      every: Math.min(4, Math.max(0.1, o.every)),
      velocity: Math.min(127, Math.max(1, Math.round(o.velocity))),
      change,
    });
  }
  if (!options.length) return fail('the condition has no options.');
  return {
    title,
    message,
    versions,
    delivered,
    notes,
    length: value.length,
    points,
    axes,
    spread: Object.fromEntries(
      Object.entries(spread).map(([k, v]) => [k, Math.min(0.5, Math.max(0, v))]),
    ),
    condition: { name: text(condition.name, 30)!, options },
    naming,
    channels: value.channels === 2 ? 2 : 1,
  };
}

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** A control's value as a share of its range (log controls by ratio). */
export const toUnit = (c: Control, v: number) =>
  c.scale === 'log' && c.min > 0
    ? clamp01(Math.log(v / c.min) / Math.log(c.max / c.min))
    : clamp01((v - c.min) / (c.max - c.min || 1));
export const fromUnit = (c: Control, u: number) =>
  c.scale === 'log' && c.min > 0
    ? c.min * Math.pow(c.max / c.min, clamp01(u))
    : c.min + clamp01(u) * (c.max - c.min);

/** A setting with every control, the author's value where the setting has none. */
export const complete = (controls: readonly Control[], setting: Setting): Setting =>
  Object.fromEntries(
    controls.map(c => [
      c.id,
      Number.isFinite(setting[c.id]) ? Math.min(c.max, Math.max(c.min, setting[c.id]!)) : c.value,
    ]),
  );

/**
 * The setting at a place on the map: the points' settings weighed by the inverse square
 * of their distance (on a point, exactly its setting). It stays within the points'
 * values, control by control: the map never leaves the range the author named.
 */
export function settingAt(
  points: readonly Point[],
  controls: readonly Control[],
  x: number,
  y: number,
): Setting {
  const on = points.find(p => (p.x - x) ** 2 + (p.y - y) ** 2 < 1e-6);
  if (on) return complete(controls, on.values);
  const weights = points.map(p => 1 / ((p.x - x) ** 2 + (p.y - y) ** 2));
  const total = weights.reduce((a, b) => a + b, 0);
  return Object.fromEntries(
    controls.map(c => {
      const u = points.reduce(
        (sum, p, i) => sum + weights[i]! * toUnit(c, p.values[c.id] ?? c.value),
        0,
      );
      return [c.id, fromUnit(c, u / total)];
    }),
  );
}

/** The point nearest a place, and how far it is (0..√2). */
export function nearest(points: readonly Point[], x: number, y: number) {
  let best = points[0]!,
    distance = Infinity;
  for (const p of points) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < distance) [best, distance] = [p, d];
  }
  return { point: best, distance };
}

/** Each control from the lowest to the highest value the points give it (the author's range). */
export function pointRange(points: readonly Point[], controls: readonly Control[]) {
  return Object.fromEntries(
    controls.map(c => {
      const units = points.map(p => toUnit(c, p.values[c.id] ?? c.value));
      return [c.id, { low: Math.min(...units), high: Math.max(...units) }];
    }),
  );
}

/** A setting moved by a condition (a gait): set, add, multiply, kept within each control's range. */
export function applyCondition(
  controls: readonly Control[],
  setting: Setting,
  condition: Condition,
): Setting {
  const out = complete(controls, setting);
  for (const c of controls) {
    const change = condition.change[c.id];
    if (!change) continue;
    let v = out[c.id]!;
    if (change.set !== undefined) v = change.set;
    if (change.add !== undefined) v += change.add;
    if (change.mul !== undefined) v *= change.mul;
    out[c.id] = Math.min(c.max, Math.max(c.min, v));
  }
  return out;
}

/** A 32-bit seed from text (FNV-1a), never 0. */
export function seedOf(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 0x01000193);
  return h >>> 0 || 1;
}

/** Numbers in 0..1 from a seed (mulberry32): the same seed, the same numbers. */
export function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Variation {
  setting: Setting;
  /** Silent render quanta before the step: the noise is at another point. */
  preroll: number;
  velocity: number;
}

/** One variation of a setting from a seed: each control moved within the author's spread. */
export function variation(
  controls: readonly Control[],
  base: Setting,
  spread: Readonly<Record<string, number>>,
  velocity: number,
  seed: number,
): Variation {
  const next = random(seed);
  const preroll = 2 + Math.floor(next() * 60);
  const v = Math.min(127, Math.max(1, Math.round(velocity + (next() * 2 - 1) * 8)));
  const full = complete(controls, base);
  const setting = Object.fromEntries(
    controls.map(c => {
      const amount = (next() * 2 - 1) * (spread[c.id] ?? 0);
      return [c.id, fromUnit(c, toUnit(c, full[c.id]!) + amount)];
    }),
  );
  return { setting, preroll, velocity: v };
}

/** A name as it goes into a file name: lower case, words joined by _. */
export const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'untitled';

/** A file name from the naming pattern (a .wav name, safe on every system). */
export function fileName(
  pattern: string,
  fields: { point: string; condition: string; nn: number; version: string },
): string {
  const filled = pattern
    .replaceAll('{point}', slug(fields.point))
    .replaceAll('{condition}', slug(fields.condition))
    .replaceAll('{nn}', String(fields.nn).padStart(2, '0'))
    .replaceAll('{version}', slug(fields.version));
  const safe = filled.replace(/[^\w.-]+/g, '_').replace(/^[._]+/, '') || 'sound';
  return safe.toLowerCase().endsWith('.wav') ? safe : `${safe}.wav`;
}

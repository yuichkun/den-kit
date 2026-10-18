// ×N: one node (or part) running as several copies side by side, like Max's mc
// or SuperCollider's multichannel expansion. The copies are made when the patch
// is expanded for checking and code generation (parts.ts); this file holds the
// rules: what can be stacked, which knobs can spread, and the value each copy
// takes.
//
// A stacked node's outputs carry one signal per copy (a thick cable). Thick into
// a node with as many copies: copy k feeds copy k. Thin into copies: every copy
// gets it. Thick into one copy: the copies are summed and scaled by 1/√N (as
// SuperCollider's Splay does), gates are combined (any copy on; `all` where the
// input says so). Splay spreads a thick cable across left and right.
import { clampPortValue, type Catalog, type PortDef } from './catalog.ts';
import { MAX_COUNT, SPREAD_KINDS, type PatchNode, type Spread } from './schema.ts';

/** Kinds of node that can run as copies. */
const STACKABLE_KINDS: ReadonlySet<string> = new Set([
  'block',
  'prim',
  'codebox',
  'history',
  'part',
]);

/** Can a node of this type run as copies? */
export function stackable(catalog: Catalog, type: string): boolean {
  const def = catalog.find(type);
  return !!def && STACKABLE_KINDS.has(def.kind) && def.stack !== false;
}

/** How many copies a node runs as (1 for anything that cannot be stacked). */
export function copiesOf(catalog: Catalog, node: PatchNode | undefined): number {
  if (!node || node.count === undefined || node.count <= 1) return 1;
  return stackable(catalog, node.type) ? Math.min(MAX_COUNT, Math.floor(node.count)) : 1;
}

/** Does the patch have anything that runs as copies? */
export function hasStacks(nodes: Iterable<PatchNode>, catalog: Catalog): boolean {
  for (const n of nodes) if (copiesOf(catalog, n) > 1) return true;
  return false;
}

/** Knobs whose value can differ between copies: numeric knobs (not audio inputs, gates, note-bound or fixed inputs). */
export function spreadable(port: PortDef | undefined): boolean {
  return (
    !!port &&
    port.type === 'signal' &&
    port.role !== 'audio' &&
    !port.binding &&
    !port.constant &&
    !port.hidden
  );
}

/** Where copy k of n sits, from −1 (the first) to +1 (the last); 0 for a single copy. */
export const position = (k: number, n: number) => (n > 1 ? (2 * k) / (n - 1) - 1 : 0);

const fmix = (h: number) => {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
};
/** A number in [0, 1) fixed by a seed and a copy's place (copy numbers from the outermost stack in). More copies keep the earlier ones' values. */
export function random01(seed: number, path: readonly number[]): number {
  let h = fmix((seed | 0) ^ 0x9e3779b9);
  for (const k of path) h = fmix(h ^ Math.imul(k + 1, 0x27d4eb2d));
  return h / 4294967296;
}

/** The value copy k of n takes on a knob whose own value is `base`. */
export function spreadValue(
  base: number,
  spread: Spread,
  k: number,
  n: number,
  port: PortDef,
): number {
  let v = base;
  switch (spread.kind) {
    case 'range':
    case 'random': {
      const t = spread.kind === 'range' ? position(k, n) : 2 * random01(spread.seed ?? 1, [k]) - 1;
      const offset = (spread.amount ?? 0) * t;
      v = port.scale === 'log' && base > 0 ? base * 2 ** offset : base + offset;
      break;
    }
    case 'harmonic':
      v = base * (k + 1);
      break;
    case 'each':
      v = spread.values?.[k] ?? base;
      break;
  }
  return Number.isFinite(v) ? clampPortValue(port, v) : base;
}

/**
 * What copy k of n does to a cable (or a control) coming into a spread knob:
 * the same moves as on the knob's own value, made on what comes in — a log
 * knob (frequency, time) is multiplied (2^offset octaves; harmonics ×(k+1)),
 * any other gets the offset added; drawn values keep their distance from the
 * knob's own value `base`.
 */
export function spreadShape(
  spread: Spread,
  k: number,
  n: number,
  port: PortDef,
  base: number,
): { scale: number; offset: number } {
  const log = port.scale === 'log';
  switch (spread.kind) {
    case 'range':
    case 'random': {
      const t = spread.kind === 'range' ? position(k, n) : 2 * random01(spread.seed ?? 1, [k]) - 1;
      const offset = (spread.amount ?? 0) * t;
      return log ? { scale: 2 ** offset, offset: 0 } : { scale: 1, offset };
    }
    case 'harmonic':
      return { scale: k + 1, offset: 0 };
    case 'each': {
      const v = spread.values?.[k];
      if (v === undefined || !Number.isFinite(v)) return { scale: 1, offset: 0 };
      return log && base > 0 && v > 0
        ? { scale: v / base, offset: 0 }
        : { scale: 1, offset: v - base };
    }
  }
  return { scale: 1, offset: 0 };
}

/** The furthest a spread may reach, either way: 10 octaves on a log knob, the knob's whole range otherwise. */
export function spreadReach(port: PortDef): number {
  if (port.scale === 'log') return 10;
  const lo = port.uiMin ?? port.min,
    hi = port.uiMax ?? port.max;
  return lo !== undefined && hi !== undefined && Number.isFinite(hi - lo)
    ? Math.max(hi - lo, 1e-6)
    : 1e6;
}

/** The unit a spread's amount is in on this knob. */
export const spreadUnit = (port: PortDef) => (port.scale === 'log' ? 'oct' : (port.unit ?? ''));

/** Check a spread (from an edit or a file): a reason when it cannot be used, else the spread as kept (amounts and values pulled into range). */
export function checkSpread(raw: unknown, port: PortDef): Spread | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return 'a spread is {kind, amount?, seed?, values?}';
  const r = raw as Record<string, unknown>;
  if (!SPREAD_KINDS.includes(r.kind as Spread['kind']))
    return `kind must be one of ${SPREAD_KINDS.join(', ')}`;
  const spread: Spread = { kind: r.kind as Spread['kind'] };
  if (r.amount !== undefined) {
    if (typeof r.amount !== 'number' || !Number.isFinite(r.amount))
      return 'amount must be a finite number';
    const reach = spreadReach(port);
    spread.amount = Math.min(reach, Math.max(-reach, r.amount));
  }
  if (r.seed !== undefined) {
    if (
      typeof r.seed !== 'number' ||
      !Number.isInteger(r.seed) ||
      r.seed < 0 ||
      r.seed > 2147483647
    )
      return 'seed must be a whole number from 0 to 2147483647';
    spread.seed = r.seed;
  }
  if (r.values !== undefined) {
    if (!Array.isArray(r.values) || r.values.length > MAX_COUNT)
      return `values is a list of up to ${MAX_COUNT} numbers`;
    if (!r.values.every(v => typeof v === 'number' && Number.isFinite(v)))
      return 'values must all be finite numbers';
    spread.values = (r.values as number[]).map(v => clampPortValue(port, v));
  }
  if ((spread.kind === 'range' || spread.kind === 'random') && spread.amount === undefined)
    spread.amount = 0;
  if (spread.kind === 'random' && spread.seed === undefined) spread.seed = 1;
  if (spread.kind === 'each' && !spread.values) spread.values = [];
  return spread;
}

/** "range ±0.2 oct", "random ±300 Hz", "harmonic", "each" — for people and the AI. */
export function describeSpread(spread: Spread, port: PortDef): string {
  const unit = spreadUnit(port);
  const amount = `±${Math.round(Math.abs(spread.amount ?? 0) * 1000) / 1000}${unit ? ` ${unit}` : ''}`;
  if (spread.kind === 'range') return `range ${amount}`;
  if (spread.kind === 'random') return `random ${amount} (seed ${spread.seed ?? 1})`;
  if (spread.kind === 'each')
    return `each copy its own (${(spread.values ?? []).map(v => Math.round(v * 1000) / 1000).join(', ')})`;
  return 'harmonic (×1, ×2, ×3…)';
}

// What the usage receiver accepts (receiver/worker.ts): the body den-kit's desktop app sends
// (desktop/analytics.ts), {"records": [...]}, checked field by field. A body of any other shape
// is refused, so its sender drops it. A record of another shape, or one that happened outside
// the days the receiver still counts, is skipped, and the rest of its batch counts.
import type { UsageRecord } from '../desktop/analytics.ts';
import { USAGE_EVENTS } from '../src/host/analytics.ts';
import { KEEP_DAYS, addDays } from './days.ts';

/** The most records one body holds: the app's batch (desktop/analytics.ts, BATCH). */
export const MAX_RECORDS = 100;
/** A random ID as den-kit makes them (crypto.randomUUID). */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const VERSION = /^\d{1,5}\.\d{1,5}\.\d{1,5}(?:-[0-9A-Za-z.-]{1,32})?$/;
/** The OS's name and version (desktop/analytics.ts, osName), such as macOS 26.2. */
const OS = /^[A-Za-z0-9]{1,16} [0-9A-Za-z._+~-]{1,47}$/;
const ARCH = /^[a-z0-9_]{1,16}$/;
const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const KEYS = ['event', 'id', 'install_id', 'version', 'os', 'arch', 'at'];

export interface Batch {
  records: UsageRecord[];
  /** Records left out: of another shape, or outside the days the receiver counts. */
  skipped: number;
}

/** The records of a body received on `today`; null for a body den-kit does not send. */
export function parse(body: string, today: string): Batch | null {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isObject(value) || Object.keys(value).length !== 1 || !Array.isArray(value.records))
    return null;
  const all: unknown[] = value.records;
  if (!all.length || all.length > MAX_RECORDS) return null;
  // Events from the day the daily run counts for the last time (store.ts), to tomorrow for a
  // clock that runs ahead.
  const first = addDays(today, -(KEEP_DAYS - 1));
  const last = addDays(today, 1);
  const records = all.filter(
    (r): r is UsageRecord => isRecord(r) && r.at.slice(0, 10) >= first && r.at.slice(0, 10) <= last,
  );
  return { records, skipped: all.length - records.length };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRecord(value: unknown): value is UsageRecord {
  if (!isObject(value)) return false;
  if (Object.keys(value).length !== KEYS.length || !KEYS.every(k => typeof value[k] === 'string'))
    return false;
  const r = value as unknown as UsageRecord;
  return (
    (USAGE_EVENTS as readonly string[]).includes(r.event) &&
    UUID.test(r.id) &&
    UUID.test(r.install_id) &&
    VERSION.test(r.version) &&
    OS.test(r.os) &&
    ARCH.test(r.arch) &&
    AT.test(r.at) &&
    isTime(r.at)
  );
}

/** A time that exists, as den-kit writes it: 2026-02-30T00:00:00Z is not one. */
function isTime(at: string) {
  const time = Date.parse(at);
  return !Number.isNaN(time) && new Date(time).toISOString().replace(/\.000Z$/, 'Z') === at;
}

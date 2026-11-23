// What the recipient keeps and sends back: settings, never sound. A kept setting and
// an order sheet name the version they were made with (its id and the build's
// fingerprint), so the same steps can be made again later, by the recipient or by
// the author from a reply link. Both are read back as untrusted input: from the
// browser's storage, or from a link anyone can edit.
import type { Setting } from './sound.ts';

export type Source = 'screen' | 'map' | 'sheet';

export interface Kept {
  id: string;
  name: string;
  setting: Setting;
  version: string;
  fingerprint: string;
  from: Source;
  /** Where on the map it was kept. */
  pos?: { x: number; y: number };
}

/** A row the recipient added to the order sheet, from a kept setting. */
export interface Row {
  id: string;
  name: string;
  setting: Setting;
}

/** One cell of the order sheet: how many files, and the seed of each. */
export interface Cell {
  count: number;
  seeds: number[];
  locked: boolean[];
}

export interface Sheet {
  rows: Row[];
  /** By `${row id}|${condition}`; a point's row id is `point:${name}`. */
  cells: Record<string, Cell>;
  naming: string;
  channels: 1 | 2;
}

export interface RecipientState {
  /** The version the recipient works with now. */
  version: string;
  kept: Kept[];
  sheet: Sheet;
  name: string;
}

export interface Reply {
  work: string;
  version: string;
  fingerprint: string;
  name: string;
  message: string;
  kept: Kept[];
  sheet: Sheet | null;
}

export const MAX_KEPT = 40;
export const MAX_COUNT = 8;
const MAX_ROWS = 12;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const id = (v: unknown) => (typeof v === 'string' && /^[\w:.-]{1,60}$/.test(v) ? v : null);

/** Only the named controls, only finite numbers. */
function readSetting(v: unknown, controls: ReadonlySet<string>): Setting | null {
  if (!isRecord(v)) return null;
  const out: Setting = {};
  for (const [k, n] of Object.entries(v)) if (controls.has(k) && isNumber(n)) out[k] = n;
  return Object.keys(out).length ? out : null;
}

function readKept(v: unknown, controls: ReadonlySet<string>): Kept | null {
  if (!isRecord(v)) return null;
  const kid = id(v.id),
    version = id(v.version),
    setting = readSetting(v.setting, controls);
  const from = v.from === 'screen' || v.from === 'map' || v.from === 'sheet' ? v.from : null;
  if (!kid || !version || !setting || !from) return null;
  const pos =
    isRecord(v.pos) && isNumber(v.pos.x) && isNumber(v.pos.y)
      ? { x: Math.min(1, Math.max(0, v.pos.x)), y: Math.min(1, Math.max(0, v.pos.y)) }
      : undefined;
  return {
    id: kid,
    name: text(v.name, 60) || 'Kept',
    setting,
    version,
    fingerprint: /^[0-9a-f]{8}$/.test(String(v.fingerprint)) ? String(v.fingerprint) : '',
    from,
    ...(pos ? { pos } : {}),
  };
}

function readSheet(v: unknown, controls: ReadonlySet<string>, fallback: Sheet): Sheet {
  if (!isRecord(v)) return fallback;
  const rows: Row[] = [];
  for (const r of Array.isArray(v.rows) ? v.rows.slice(0, MAX_ROWS) : []) {
    const rid = isRecord(r) ? id(r.id) : null;
    const setting = isRecord(r) ? readSetting(r.setting, controls) : null;
    if (rid && setting) rows.push({ id: rid, name: text((r as Row).name, 40) || 'Row', setting });
  }
  const cells: Record<string, Cell> = {};
  for (const [key, c] of Object.entries(isRecord(v.cells) ? v.cells : {}).slice(0, 200)) {
    if (!isRecord(c) || !isNumber(c.count) || key.length > 120) continue;
    const count = Math.min(MAX_COUNT, Math.max(0, Math.round(c.count)));
    const seeds = (Array.isArray(c.seeds) ? c.seeds : [])
      .slice(0, MAX_COUNT)
      .map(s => (isNumber(s) ? s >>> 0 || 1 : 1));
    const locked = (Array.isArray(c.locked) ? c.locked : [])
      .slice(0, MAX_COUNT)
      .map(l => l === true);
    cells[key] = { count, seeds, locked };
  }
  const naming = text(v.naming, 120);
  return {
    rows,
    cells,
    naming: naming || fallback.naming,
    channels: v.channels === 2 ? 2 : 1,
  };
}

/** The recipient's state as kept in this browser, or a fresh one. */
export function readState(
  v: unknown,
  controls: ReadonlySet<string>,
  fresh: RecipientState,
): RecipientState {
  if (!isRecord(v)) return fresh;
  return {
    version: id(v.version) ?? fresh.version,
    kept: (Array.isArray(v.kept) ? v.kept : [])
      .slice(0, MAX_KEPT)
      .map(k => readKept(k, controls))
      .filter((k): k is Kept => !!k),
    sheet: readSheet(v.sheet, controls, fresh.sheet),
    name: text(v.name, 60),
  };
}

const KEY = (work: string) => `den-kit.delivery.${work}`;

export function loadState(work: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(KEY(work)) ?? 'null');
  } catch {
    return null;
  }
}

export function saveState(work: string, state: RecipientState) {
  try {
    localStorage.setItem(KEY(work), JSON.stringify(state));
  } catch {
    // Without storage the sketch still works; nothing is kept for the next visit.
  }
}

/** A reply as the text of a link: JSON, UTF-8, base64url. */
export function encodeReply(reply: Reply): string {
  const bytes = new TextEncoder().encode(JSON.stringify(reply));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A reply read from a link, or why it cannot be read. Nothing in it is trusted. */
export function decodeReply(
  value: string,
  controls: ReadonlySet<string>,
  emptySheet: Sheet,
): Reply | { error: string } {
  if (value.length > 60_000) return { error: 'The reply is too long.' };
  let parsed: unknown;
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0))));
  } catch {
    return { error: 'The reply link is damaged.' };
  }
  if (!isRecord(parsed)) return { error: 'The reply link is damaged.' };
  const work = id(parsed.work),
    version = id(parsed.version);
  if (!work || !version) return { error: 'The reply does not name its work and version.' };
  return {
    work,
    version,
    fingerprint: /^[0-9a-f]{8}$/.test(String(parsed.fingerprint)) ? String(parsed.fingerprint) : '',
    name: text(parsed.name, 60),
    message: text(parsed.message, 1000),
    kept: (Array.isArray(parsed.kept) ? parsed.kept : [])
      .slice(0, MAX_KEPT)
      .map(k => readKept(k, controls))
      .filter((k): k is Kept => !!k),
    sheet: isRecord(parsed.sheet) ? readSheet(parsed.sheet, controls, emptySheet) : null,
  };
}

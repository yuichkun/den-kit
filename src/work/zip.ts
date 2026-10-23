// The container of a work file: a ZIP archive whose entries are stored without
// compression (the contents are mostly pictures, audio and other files that are
// compressed already). Reading never trusts the archive: entries are checked
// against the central directory, their sizes against the caller's limits, and
// their CRC-32 against the data, and anything else (compression, encryption,
// ZIP64, paths that leave the archive) is refused with a reason.

export interface ZipEntry {
  path: string;
  data: Uint8Array;
}
export interface ZipLimits {
  /** The most bytes one entry may hold. */
  maxEntryBytes: number;
  /** The most bytes all entries may hold together. */
  maxTotalBytes: number;
  maxEntries: number;
}
export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
/** Bit 11: the path is UTF-8. */
const UTF8 = 0x0800;

/** A ZIP archive of the entries, in the given order. */
export function writeZip(entries: readonly ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const names = entries.map(e => encoder.encode(e.path));
  const crcs = entries.map(e => crc32(e.data));
  let size = 22;
  for (let i = 0; i < entries.length; i++)
    size += 30 + names[i]!.length + entries[i]!.data.length + 46 + names[i]!.length;
  if (entries.length > 0xffff || size > 0xffffffff)
    throw new ZipError('The work is too large to write as one file.');
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  const offsets: number[] = [];
  let at = 0;
  for (let i = 0; i < entries.length; i++) {
    const name = names[i]!;
    const data = entries[i]!.data;
    offsets.push(at);
    view.setUint32(at, LOCAL, true);
    view.setUint16(at + 4, 20, true);
    view.setUint16(at + 6, UTF8, true);
    view.setUint16(at + 8, 0, true);
    view.setUint32(at + 10, 0, true);
    view.setUint32(at + 14, crcs[i]!, true);
    view.setUint32(at + 18, data.length, true);
    view.setUint32(at + 22, data.length, true);
    view.setUint16(at + 26, name.length, true);
    view.setUint16(at + 28, 0, true);
    out.set(name, at + 30);
    out.set(data, at + 30 + name.length);
    at += 30 + name.length + data.length;
  }
  const central = at;
  for (let i = 0; i < entries.length; i++) {
    const name = names[i]!;
    const data = entries[i]!.data;
    view.setUint32(at, CENTRAL, true);
    view.setUint16(at + 4, 20, true);
    view.setUint16(at + 6, 20, true);
    view.setUint16(at + 8, UTF8, true);
    view.setUint16(at + 10, 0, true);
    view.setUint32(at + 12, 0, true);
    view.setUint32(at + 16, crcs[i]!, true);
    view.setUint32(at + 20, data.length, true);
    view.setUint32(at + 24, data.length, true);
    view.setUint16(at + 28, name.length, true);
    view.setUint16(at + 30, 0, true);
    view.setUint16(at + 32, 0, true);
    view.setUint16(at + 34, 0, true);
    view.setUint16(at + 36, 0, true);
    view.setUint32(at + 38, 0, true);
    view.setUint32(at + 42, offsets[i]!, true);
    out.set(name, at + 46);
    at += 46 + name.length;
  }
  view.setUint32(at, END, true);
  view.setUint16(at + 4, 0, true);
  view.setUint16(at + 6, 0, true);
  view.setUint16(at + 8, entries.length, true);
  view.setUint16(at + 10, entries.length, true);
  view.setUint32(at + 12, at - central, true);
  view.setUint32(at + 16, central, true);
  view.setUint16(at + 20, 0, true);
  return out;
}

/** The entries of a ZIP archive written by writeZip (stored, no comment, no ZIP64). */
export function readZip(bytes: Uint8Array, limits: ZipLimits): ZipEntry[] {
  if (bytes.length < 22) throw new ZipError('This is not a den-kit work file (it is too short).');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  if (view.getUint32(end, true) !== END)
    throw new ZipError('This is not a den-kit work file (no archive directory at its end).');
  const count = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const centralAt = view.getUint32(end + 16, true);
  if (view.getUint16(end + 8, true) !== count || view.getUint16(end + 20, true) !== 0)
    throw new ZipError('The work file is damaged (its directory does not add up).');
  if (count > limits.maxEntries)
    throw new ZipError(
      `The work file has ${count} files; a work holds at most ${limits.maxEntries}.`,
    );
  if (centralAt + centralSize !== end)
    throw new ZipError('The work file is damaged (its directory is not where it says).');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const entries: ZipEntry[] = [];
  const seen = new Set<string>();
  let total = 0;
  let at = centralAt;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || view.getUint32(at, true) !== CENTRAL)
      throw new ZipError('The work file is damaged (a directory entry is broken).');
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const packed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true);
    const comment = view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    if (flags & 0x0001) throw new ZipError('The work file is encrypted; den-kit cannot read it.');
    if (method !== 0 || packed !== size)
      throw new ZipError('The work file is compressed in a way den-kit does not read.');
    if (size === 0xffffffff || offset === 0xffffffff)
      throw new ZipError('The work file is too large for den-kit to read.');
    let path: string;
    try {
      path = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    } catch {
      throw new ZipError('The work file is damaged (a file name is not text).');
    }
    if (!safePath(path)) throw new ZipError(`The work file holds a file outside the work: ${path}`);
    if (seen.has(path)) throw new ZipError(`The work file holds ${path} twice.`);
    seen.add(path);
    if (size > limits.maxEntryBytes)
      throw new ZipError(
        `${path} is ${megabytes(size)}; one file may hold at most ${megabytes(limits.maxEntryBytes)}.`,
      );
    total += size;
    if (total > limits.maxTotalBytes)
      throw new ZipError(`The work's files are larger than ${megabytes(limits.maxTotalBytes)}.`);
    if (offset + 30 > centralAt || view.getUint32(offset, true) !== LOCAL)
      throw new ZipError(`The work file is damaged (${path} is not where the directory says).`);
    const start =
      offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    if (start + size > centralAt)
      throw new ZipError(`The work file is damaged (${path} runs past the end).`);
    const data = bytes.slice(start, start + size);
    if (crc32(data) !== crc)
      throw new ZipError(`The work file is damaged (${path} does not check out).`);
    entries.push({ path, data });
    at += 46 + nameLength + extra + comment;
  }
  return entries;
}

/** A relative path with plain segments: nothing absolute, no `..`, no backslashes or control characters. */
export function safePath(path: string): boolean {
  if (!path || path.length > 400 || path.startsWith('/') || path.includes('\\')) return false;
  for (let i = 0; i < path.length; i++) if (path.charCodeAt(i) < 0x20) return false;
  return path.split('/').every(s => s !== '' && s !== '.' && s !== '..');
}

export const megabytes = (bytes: number) => `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;

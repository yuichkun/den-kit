// The work's files: one tree shaped as a web project. `package.json` and `src/`
// hold the code parts, `assets/` holds the assets. The record keeps a text
// file's contents as they are and refers to any other file's contents by a
// SHA-256 hash; contents never change, and replacing a file points it at new
// content. Files people bring in are data: den-kit only reads the kinds its own
// features use (pictures, fonts and video on the screen, audio in the sound),
// and checks that such a file is what it says before it is used.
import type { Issue } from './issues.ts';

/** A text file: sources, configuration, SVG, data in text. */
export interface TextFile {
  text: string;
}
/** Where an asset came from and under which licence (kept with the work, shown when it is shared). */
export interface FileSource {
  title?: string;
  author?: string;
  url?: string;
  license?: string;
}
/** Any other file: its contents are stored once, by hash (or shipped with den-kit, at `url`). */
export interface ContentFile {
  /** `sha256-` and 64 hex digits; absent only for a file shipped with den-kit. */
  hash?: string;
  bytes: number;
  /** The media type the file is read as. */
  type: string;
  /** Pictures: their size in pixels. */
  width?: number;
  height?: number;
  /** Shipped with den-kit (served at this path); the contents are not stored in the work. */
  url?: string;
  source?: FileSource;
}
export type WorkFile = TextFile | ContentFile;
export const isText = (f: WorkFile | undefined): f is TextFile => !!f && 'text' in f;
export const isContent = (f: WorkFile | undefined): f is ContentFile => !!f && !('text' in f);

/** Size limits of a work. */
export const WORK_LIMITS = {
  /** One file's contents. */
  fileBytes: 100 * 1024 * 1024,
  /** All files of a work together. */
  workBytes: 500 * 1024 * 1024,
  files: 2000,
  /** One text file (sources are read and diffed as text). */
  textBytes: 1024 * 1024,
} as const;

export const ASSETS = 'assets/';
/** Made by den-kit from the patch on every change; never kept in the work. */
export const GENERATED_FILES: ReadonlySet<string> = new Set(['src/kit/controls.ts']);
/** den-kit's own part of the kit (the behaviors of its controls), written into the project, never kept in the work. */
export const KIT_FOLDER = 'src/kit/behaviors/';
/** A file den-kit writes into the project itself. */
export const isGenerated = (path: string) =>
  GENERATED_FILES.has(path) || path.startsWith(KIT_FOLDER);

// Plain names (dotfiles too: .gitignore, .prettierrc) joined with "/"; "." and ".." are refused below.
const PATH = /^[A-Za-z0-9_@.][A-Za-z0-9_.@+ -]*(?:\/[A-Za-z0-9_@.][A-Za-z0-9_.@+ -]*)*$/;
/** A path that may be kept in the work, or why not. */
export function checkPath(path: unknown): string | null {
  if (typeof path !== 'string' || !path)
    return 'A file path is text, relative to the work (e.g. src/parts/reels.ts).';
  if (path.length > 200) return `${path.slice(0, 40)}…: the path is too long.`;
  if (!PATH.test(path) || path.split('/').some(s => s === '..' || s === '.' || s !== s.trim()))
    return `${path}: a path is plain names joined with "/", relative to the work.`;
  const top = path.split('/')[0]!;
  if (['node_modules', '.git', 'dist'].includes(top))
    return `${path}: ${top}/ is made by the tools and is not kept in the work.`;
  if (isGenerated(path)) return `${path} is made by den-kit; it is not kept in the work.`;
  return null;
}

/** Text files are kept as text; everything else is stored by hash. */
const TEXT_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'mts',
  'cts',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'json',
  'jsonc',
  'css',
  'html',
  'htm',
  'md',
  'txt',
  'xml',
  'csv',
  'tsv',
  'yml',
  'yaml',
  'toml',
  'glsl',
  'wgsl',
  'frag',
  'vert',
  'map',
]);
export function isTextPath(path: string): boolean {
  const name = path.split('/').at(-1)!;
  if (name.startsWith('.') && !name.slice(1).includes('.')) return true; // .gitignore, .npmrc
  const ext = name.includes('.') ? name.split('.').at(-1)!.toLowerCase() : '';
  return TEXT_EXTENSIONS.has(ext);
}

/** What den-kit itself reads a file as, from its name; null: only code in the work reads it. */
export type ReadAs = 'image' | 'font' | 'audio' | 'video';
const TYPES: Record<string, { type: string; as?: ReadAs }> = {
  png: { type: 'image/png', as: 'image' },
  jpg: { type: 'image/jpeg', as: 'image' },
  jpeg: { type: 'image/jpeg', as: 'image' },
  gif: { type: 'image/gif', as: 'image' },
  webp: { type: 'image/webp', as: 'image' },
  avif: { type: 'image/avif', as: 'image' },
  svg: { type: 'image/svg+xml', as: 'image' },
  woff: { type: 'font/woff', as: 'font' },
  woff2: { type: 'font/woff2', as: 'font' },
  ttf: { type: 'font/ttf', as: 'font' },
  otf: { type: 'font/otf', as: 'font' },
  wav: { type: 'audio/wav', as: 'audio' },
  mp3: { type: 'audio/mpeg', as: 'audio' },
  ogg: { type: 'audio/ogg', as: 'audio' },
  flac: { type: 'audio/flac', as: 'audio' },
  m4a: { type: 'audio/mp4', as: 'audio' },
  mp4: { type: 'video/mp4', as: 'video' },
  webm: { type: 'video/webm', as: 'video' },
  glb: { type: 'model/gltf-binary' },
  gltf: { type: 'model/gltf+json' },
  hdr: { type: 'image/vnd.radiance' },
  exr: { type: 'image/x-exr' },
  json: { type: 'application/json' },
  mid: { type: 'audio/midi' },
  midi: { type: 'audio/midi' },
  bin: { type: 'application/octet-stream' },
};
export function typeOfPath(path: string): { type: string; as?: ReadAs } {
  const ext = path.split('/').at(-1)!.split('.').at(-1)!.toLowerCase();
  return TYPES[ext] ?? { type: isTextPath(path) ? 'text/plain' : 'application/octet-stream' };
}

const starts = (b: Uint8Array, sig: readonly number[], at = 0) =>
  b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);
const ascii = (s: string) => [...s].map(c => c.charCodeAt(0));

/** The formats the bytes are, by their signature (a file is what its first bytes say). */
export function sniff(bytes: Uint8Array): string[] {
  const out: string[] = [];
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) out.push('image/png');
  if (starts(bytes, [0xff, 0xd8, 0xff])) out.push('image/jpeg');
  if (starts(bytes, ascii('GIF87a')) || starts(bytes, ascii('GIF89a'))) out.push('image/gif');
  const riff = starts(bytes, ascii('RIFF'));
  if (riff && starts(bytes, ascii('WEBP'), 8)) out.push('image/webp');
  if (riff && starts(bytes, ascii('WAVE'), 8)) out.push('audio/wav');
  if (starts(bytes, ascii('ftyp'), 4)) {
    const brand = String.fromCharCode(...bytes.slice(8, 12));
    if (/^avi[fs]$/.test(brand)) out.push('image/avif');
    else if (/^M4A ?$/.test(brand)) out.push('audio/mp4');
    else out.push('video/mp4', 'audio/mp4');
  }
  if (starts(bytes, ascii('wOFF'))) out.push('font/woff');
  if (starts(bytes, ascii('wOF2'))) out.push('font/woff2');
  if (starts(bytes, [0x00, 0x01, 0x00, 0x00]) || starts(bytes, ascii('true'))) out.push('font/ttf');
  if (starts(bytes, ascii('OTTO'))) out.push('font/otf');
  if (starts(bytes, ascii('ID3')) || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0))
    out.push('audio/mpeg');
  if (starts(bytes, ascii('OggS'))) out.push('audio/ogg');
  if (starts(bytes, ascii('fLaC'))) out.push('audio/flac');
  if (starts(bytes, [0x1a, 0x45, 0xdf, 0xa3])) out.push('video/webm');
  const head = new TextDecoder().decode(bytes.slice(0, 512)).trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head))
    out.push('image/svg+xml');
  return out;
}

/** Text the work can keep as text: UTF-8 without NUL characters. */
export function asText(bytes: Uint8Array): string | null {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return text.includes('\u0000') ? null : text;
  } catch {
    return null;
  }
}

/**
 * Check a file before it becomes part of the work: its path, its size, and, for
 * the kinds den-kit reads itself, that the bytes are what the name says.
 * Returns the file's entry, or why it cannot be added. `content` keeps even a
 * text file by hash (an asset).
 */
export async function checkFile(
  path: string,
  bytes: Uint8Array,
  hash: (bytes: Uint8Array) => Promise<string>,
  options: Pick<ContentFile, 'width' | 'height' | 'source'> & { content?: boolean } = {},
): Promise<{ ok: true; file: WorkFile; data?: Uint8Array } | { ok: false; reason: string }> {
  const { content, ...extra } = options;
  const bad = checkPath(path);
  if (bad) return { ok: false, reason: bad };
  if (bytes.length > WORK_LIMITS.fileBytes)
    return {
      ok: false,
      reason: `${path} is ${mb(bytes.length)}; a file may hold at most ${mb(WORK_LIMITS.fileBytes)}.`,
    };
  const { type, as } = typeOfPath(path);
  if (isTextPath(path) && !content) {
    const text = asText(bytes);
    if (text === null) return { ok: false, reason: `${path} is not text (UTF-8).` };
    if (bytes.length > WORK_LIMITS.textBytes)
      return {
        ok: false,
        reason: `${path} is ${mb(bytes.length)}; a text file may hold at most ${mb(WORK_LIMITS.textBytes)}.`,
      };
    return { ok: true, file: { text } };
  }
  if (as && !sniff(bytes).includes(type))
    return {
      ok: false,
      reason: `${path} is named as ${describeType(type)}, but its contents are not; den-kit does not use it.`,
    };
  return {
    ok: true,
    file: { hash: await hash(bytes), bytes: bytes.length, type, ...extra },
    data: bytes,
  };
}

const describeType = (type: string) => {
  const [kind, format] = type.split('/');
  const name = format!.replace(/^x-|\+xml$/g, '').toUpperCase();
  return kind === 'image'
    ? `a ${name} picture`
    : kind === 'font'
      ? `a ${name} font`
      : `${kind} (${name})`;
};
const mb = (bytes: number) => `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;

/** The SHA-256 of some bytes, as a content reference. */
export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  return `sha256-${Array.from(digest, b => b.toString(16).padStart(2, '0')).join('')}`;
}
export const HASH = /^sha256-[0-9a-f]{64}$/;

/** Where a file den-kit ships is served: a path on den-kit's own origin (/showcase/wood.jpg); null for anything else, another host included. */
export function shippedPath(url: string): string | null {
  if (!/^\/?[A-Za-z0-9][A-Za-z0-9/_.-]*$/.test(url) || url.includes('..')) return null;
  return url.startsWith('/') ? url : `/${url}`;
}

/** What a work's files hold together: text by its bytes, and each contents once, as a work file keeps them. */
export function totalBytes(files: Readonly<Record<string, WorkFile>>): number {
  let n = 0;
  const seen = new Set<string>();
  for (const f of Object.values(files)) {
    if (isText(f)) n += new TextEncoder().encode(f.text).length;
    else if (f.hash && !f.url && !seen.has(f.hash)) {
      seen.add(f.hash);
      n += f.bytes;
    }
  }
  return n;
}

/** Why `files` would not fit in a work (too many, or too much together), or null. */
export function overLimits(files: Readonly<Record<string, WorkFile>>): string | null {
  if (Object.keys(files).length > WORK_LIMITS.files)
    return `A work holds at most ${WORK_LIMITS.files} files.`;
  if (totalBytes(files) > WORK_LIMITS.workBytes)
    return `A work's files hold at most ${WORK_LIMITS.workBytes / 1024 / 1024} MB.`;
  return null;
}

/** The code parts the work offers (src/parts/<name>.ts or .tsx), by name. */
export function partNames(files: Readonly<Record<string, WorkFile>>): string[] {
  const names = new Set<string>();
  for (const path of Object.keys(files)) {
    const m = /^src\/parts\/([a-z][a-z0-9-]{0,39})\.tsx?$/.exec(path);
    if (m) names.add(m[1]!);
  }
  return [...names].sort();
}
export const PART_NAME = /^[a-z][a-z0-9-]{0,39}$/;
export const partPath = (name: string) => `src/parts/${name}.ts`;

/** The work's text files (the web project's sources), path → text. */
export function textFiles(files: Readonly<Record<string, WorkFile>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, f] of Object.entries(files)) if (isText(f)) out[path] = f.text;
  return out;
}

/** Read the files of a record: bad paths, broken entries and what is over the limits are dropped with a reason. */
export function readFiles(raw: unknown, report: Issue[]): Record<string, WorkFile> {
  const out: Record<string, WorkFile> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  let total = 0;
  const counted = new Set<string>();
  const drop = (path: string, why: string) =>
    report.push({
      severity: 'warning',
      code: 'dropped-file',
      message: `${path}: ${why}; left out.`,
    });
  for (const [path, entry] of Object.entries(raw as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const bad = checkPath(path);
    if (bad) {
      drop(path, bad);
      continue;
    }
    if (Object.keys(out).length >= WORK_LIMITS.files) {
      drop(path, `a work holds at most ${WORK_LIMITS.files} files`);
      continue;
    }
    const file = readFile(entry);
    if (typeof file === 'string') {
      drop(path, file);
      continue;
    }
    // Counted as totalBytes() counts them.
    const bytes = isText(file)
      ? new TextEncoder().encode(file.text).length
      : file.url || !file.hash || counted.has(file.hash)
        ? 0
        : file.bytes;
    if (isText(file) && bytes > WORK_LIMITS.textBytes) {
      drop(path, `a text file may hold at most ${mb(WORK_LIMITS.textBytes)}`);
      continue;
    }
    if (total + bytes > WORK_LIMITS.workBytes) {
      drop(path, `the work's files may hold at most ${mb(WORK_LIMITS.workBytes)} together`);
      continue;
    }
    total += bytes;
    if (!isText(file) && file.hash) counted.add(file.hash);
    out[path] = file;
  }
  return out;
}

function readFile(entry: unknown): WorkFile | string {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return 'not a file entry';
  const e = entry as Record<string, unknown>;
  if (typeof e.text === 'string') {
    return e.text.includes('\u0000') ? 'not text' : { text: e.text };
  }
  const shipped = typeof e.url === 'string';
  if (!shipped && (typeof e.hash !== 'string' || !HASH.test(e.hash)))
    return 'its contents are missing';
  if (
    !Number.isInteger(e.bytes) ||
    (e.bytes as number) < 0 ||
    (e.bytes as number) > WORK_LIMITS.fileBytes
  )
    return `its size is not between 0 and ${mb(WORK_LIMITS.fileBytes)}`;
  if (typeof e.type !== 'string' || !/^[a-z]+\/[a-z0-9.+-]+$/.test(e.type))
    return 'its type is not a media type';
  const file: ContentFile = { bytes: e.bytes as number, type: e.type };
  if (typeof e.hash === 'string' && HASH.test(e.hash)) file.hash = e.hash;
  for (const k of ['width', 'height'] as const)
    if (Number.isInteger(e[k]) && (e[k] as number) > 0 && (e[k] as number) <= 16384)
      file[k] = e[k] as number;
  if (typeof e.url === 'string') {
    if (!shippedPath(e.url)) return 'a file shipped with den-kit is a path inside den-kit';
    file.url = e.url;
  }
  if (e.source && typeof e.source === 'object' && !Array.isArray(e.source)) {
    const s = e.source as Record<string, unknown>;
    const source: FileSource = {};
    for (const k of ['title', 'author', 'license'] as const)
      if (typeof s[k] === 'string' && (s[k] as string).length <= 200) source[k] = s[k] as string;
    if (typeof s.url === 'string' && /^https?:\/\//.test(s.url) && s.url.length <= 400)
      source.url = s.url;
    file.source = source;
  }
  return file;
}

// The work file: one file that carries a work to another computer or host. It
// is a ZIP (zip.ts) with `work.json` (the record: the document with its file
// tree), `contents/<hash>` (the contents of the files that are not text) and,
// when the work was built, `build/` (the playable build). Reading never trusts
// the file: sizes are checked before anything is read, every content must hash
// to its name, and what den-kit reads itself must be what it says; what is
// broken is dropped and reported, so the work opens without it.
import type { Catalog } from './catalog.ts';
import { HASH, WORK_LIMITS, isContent, sha256, sniff, typeOfPath } from './files.ts';
import type { Issue } from './issues.ts';
import { parseDocument, serializeDocument } from './persistence.ts';
import type { PatchDocument } from './schema.ts';
import { ZipError, readZip, writeZip, type ZipEntry } from './zip.ts';

export const WORK_FILE_FORMAT = 'den-kit/work';
export const WORK_FILE_VERSION = 1;
/** The extension of a work file. */
export const WORK_FILE_EXTENSION = '.denkit';
const RECORD = 'work.json';
const CONTENTS = 'contents/';
const BUILD = 'build/';

/** The playable build's static files, by path inside the build. */
export type PlayableBuild = Record<string, Uint8Array>;

/** Write a work file. `contents` gives the bytes of each hash the work's files refer to. */
export async function writeWorkFile(
  doc: PatchDocument,
  contents: (hash: string) => Promise<Uint8Array | null>,
  build?: PlayableBuild,
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const entries: ZipEntry[] = [
    {
      path: RECORD,
      data: encoder.encode(
        JSON.stringify({
          format: WORK_FILE_FORMAT,
          version: WORK_FILE_VERSION,
          document: JSON.parse(serializeDocument(doc)),
        }),
      ),
    },
  ];
  const written = new Set<string>();
  for (const [path, file] of Object.entries(doc.files)) {
    if (!isContent(file) || !file.hash || file.url || written.has(file.hash)) continue;
    const data = await contents(file.hash);
    if (!data) throw new Error(`The contents of ${path} are missing; the work cannot be written.`);
    entries.push({ path: CONTENTS + file.hash, data });
    written.add(file.hash);
  }
  for (const [path, data] of Object.entries(build ?? {}))
    entries.push({ path: BUILD + path, data });
  return writeZip(entries);
}

export type ReadResult =
  | {
      ok: true;
      doc: PatchDocument;
      /** The contents the work's files refer to, by hash (all checked). */
      contents: Map<string, Uint8Array>;
      build: PlayableBuild;
      /** What was repaired or left out, and why. */
      report: Issue[];
    }
  | { ok: false; error: string };

/** Read a work file. A file that is not a work file, or is damaged as a whole, is refused with a reason. */
export async function readWorkFile(bytes: Uint8Array, catalog: Catalog): Promise<ReadResult> {
  let entries: ZipEntry[];
  try {
    entries = readZip(bytes, {
      maxEntryBytes: WORK_LIMITS.fileBytes,
      // The playable build is made from the record and may add as much again.
      maxTotalBytes: WORK_LIMITS.workBytes * 2,
      maxEntries: WORK_LIMITS.files * 4,
    });
  } catch (error) {
    if (error instanceof ZipError) return { ok: false, error: error.message };
    throw error;
  }
  const record = entries.find(e => e.path === RECORD);
  if (!record)
    return { ok: false, error: 'This is not a den-kit work file (it has no work.json).' };
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(record.data));
  } catch {
    return { ok: false, error: 'The work file is damaged (its work.json is not JSON).' };
  }
  const head = data as { format?: unknown; version?: unknown; document?: unknown };
  if (!head || head.format !== WORK_FILE_FORMAT)
    return { ok: false, error: 'This is not a den-kit work file.' };
  if (typeof head.version !== 'number' || head.version > WORK_FILE_VERSION)
    return {
      ok: false,
      error: `This work was saved by a newer den-kit (work file version ${String(head.version)}); update den-kit to open it.`,
    };
  const parsed = parseDocument(head.document, catalog);
  if (!parsed.ok) return parsed;
  const report = [...parsed.report];
  const doc = parsed.doc;

  const stored = new Map<string, Uint8Array>();
  const build: PlayableBuild = {};
  for (const entry of entries) {
    if (entry.path.startsWith(CONTENTS)) {
      const hash = entry.path.slice(CONTENTS.length);
      if (!HASH.test(hash) || (await sha256(entry.data)) !== hash) {
        report.push({
          severity: 'warning',
          code: 'damaged-content',
          message: `The work file holds damaged contents (${hash.slice(0, 20)}…); the files that use them are left out.`,
        });
        continue;
      }
      stored.set(hash, entry.data);
    } else if (entry.path.startsWith(BUILD)) build[entry.path.slice(BUILD.length)] = entry.data;
  }
  const contents = new Map<string, Uint8Array>();
  const files = { ...doc.files };
  for (const [path, file] of Object.entries(doc.files)) {
    if (!isContent(file) || !file.hash || file.url) continue;
    const data = stored.get(file.hash);
    const leaveOut = (why: string) => {
      delete files[path];
      report.push({
        severity: 'warning',
        code: 'dropped-file',
        message: `${path}: ${why}; left out.`,
      });
    };
    if (!data) leaveOut('its contents are not in the work file');
    else if (data.length !== file.bytes) leaveOut('its size does not match its contents');
    else if (typeOfPath(path).as && !sniff(data).includes(file.type))
      leaveOut(`it is not ${file.type}, as it says`);
    else contents.set(file.hash, data);
  }
  return { ok: true, doc: { ...doc, files }, contents, build, report };
}

// The host's Storage (src/host) in the desktop app: files in the app's data
// folder, written by the main process. Text records live in records/ (one file a
// key; the key is den-kit's own and is percent-encoded into the file name), and
// the contents of work files in contents/ by their SHA-256. A record is written to
// a temporary file and renamed, so a quit or crash never leaves half of one; a
// content is checked against its hash before it is kept.
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const HASH = /^sha256-[0-9a-f]{64}$/;
const MAX_KEY = 512;

export class FileStorage {
  private readonly records: string;
  private readonly contents: string;

  constructor(directory: string) {
    this.records = join(directory, 'records');
    this.contents = join(directory, 'contents');
    mkdirSync(this.records, { recursive: true, mode: 0o700 });
    mkdirSync(this.contents, { recursive: true, mode: 0o700 });
  }

  private file(key: string) {
    if (typeof key !== 'string' || !key || key.length > MAX_KEY) throw new Error('Invalid key.');
    return join(this.records, `${encodeURIComponent(key)}.txt`);
  }

  read(key: string): string | null {
    try {
      return readFileSync(this.file(key), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  write(key: string, value: string) {
    if (typeof value !== 'string') throw new Error('A record is text.');
    const file = this.file(key);
    writeFileSync(`${file}.tmp`, value, { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  }

  remove(key: string) {
    rmSync(this.file(key), { force: true });
  }

  keys(prefix: string): string[] {
    return readdirSync(this.records)
      .filter(name => name.endsWith('.txt'))
      .map(name => decodeURIComponent(name.slice(0, -4)))
      .filter(key => key.startsWith(prefix));
  }

  /** The bytes of a content, or null when it is not kept here. */
  readContent(hash: string): Uint8Array | null {
    if (!HASH.test(hash)) return null;
    const file = join(this.contents, hash);
    return existsSync(file) ? new Uint8Array(readFileSync(file)) : null;
  }

  /** Keep a content under its hash; bytes that do not match the hash are refused. */
  writeContent(hash: string, bytes: Uint8Array) {
    if (!HASH.test(hash)) throw new Error('Invalid content hash.');
    const actual = `sha256-${createHash('sha256').update(bytes).digest('hex')}`;
    if (actual !== hash) throw new Error('The content does not match its hash.');
    const file = join(this.contents, hash);
    if (existsSync(file)) return;
    writeFileSync(`${file}.tmp`, bytes, { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  }
}

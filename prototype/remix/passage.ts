// A passage: one of den-kit's example works handed from person to person in a
// link. The link holds everything, so nothing is kept on a server: the work, who
// shared it first and their words, and one hop for each person after them, with
// their words, the changes they made as den-kit's own operations on the version
// they received, and a phrase they played. Each version is rebuilt by applying the
// hops' operations in order and reading the result as den-kit reads a work file,
// so every version can be heard again and compared with the one before it.
import type { Catalog } from '../../src/work/catalog.ts';
import { applyResolvedOps, type ResolvedOp } from '../../src/work/ops.ts';
import { parseDocument } from '../../src/work/persistence.ts';
import type { PatchDocument } from '../../src/work/schema.ts';
import { findWork } from '../../src/screen/showcase/index.ts';
import { formatValue } from '../../src/screen/format.ts';

export const PASSAGE_VERSION = 1;
/** The longest link text the page makes or reads: longer links are cut by chat apps, or refused. */
export const MAX_LINK_CHARS = 60_000;
const MAX_JSON_BYTES = 2_000_000;
const MAX_HOPS = 40;
const MAX_OPS = 4_000;
const MAX_PHRASE = 400;
export const MAX_NAME = 40;
export const MAX_WORDS = 600;

/** Notes played, as [milliseconds from the first note, note, velocity]; velocity 0 releases the note. */
export type Phrase = Array<[number, number, number]>;

export interface Hop {
  by: string;
  words: string;
  at: number;
  /** What they changed: den-kit's operations on the version they received. */
  ops: ResolvedOp[];
  phrase?: Phrase;
}

export interface Passage {
  v: typeof PASSAGE_VERSION;
  /** One share of a work by its author; what comes back to the author is kept under it. */
  id: string;
  /** The example work (src/screen/showcase). */
  work: string;
  author: {
    name: string;
    words: string;
    at: number;
    /** Whether people may change the inside (the patch and the screen), as the author chose when sharing. */
    allowInside: boolean;
  };
  hops: Hop[];
  /** Changes made in den-kit's editor on their way into the next hop: never in a link passed on. */
  draft?: ResolvedOp[];
}

export interface Version {
  /** 0: the author's own; n: after the nth hop. */
  index: number;
  by: string;
  words: string;
  at: number;
  doc: PatchDocument;
  hop?: Hop;
}

type Read<T> = { ok: true; value: T } | { ok: false; error: string };

// ---- the link text -------------------------------------------------------------------------

async function through(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    // A small link that unpacks into a huge text is refused before it fills the memory.
    if (size > MAX_JSON_BYTES) {
      await reader.cancel();
      throw new Error('too large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

function toBase64Url(bytes: Uint8Array) {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string) {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

/** The passage as the text after `#p=` in a link. */
export async function encodePassage(passage: Passage): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(passage));
  return toBase64Url(await through(json, new CompressionStream('deflate-raw')));
}

/** The passage a link's text holds, or why it cannot be read. */
export async function decodePassage(text: string): Promise<Read<Passage>> {
  if (text.length > MAX_LINK_CHARS) return { ok: false, error: 'This link is too long to read.' };
  let data: unknown;
  try {
    const bytes = await through(fromBase64Url(text), new DecompressionStream('deflate-raw'));
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { ok: false, error: 'This link is damaged or incomplete: ask for it again.' };
  }
  return readPassage(data);
}

/** The text after `#p=` in an address's hash ('' when there is none). */
export function passageText(hash: string): string {
  return new URLSearchParams(hash.replace(/^#/, '')).get('p') ?? '';
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function readOps(v: unknown): ResolvedOp[] | null {
  if (!Array.isArray(v)) return null;
  // Each operation is checked when the version is rebuilt and read as a work file.
  return v.every(op => isObject(op) && typeof op.op === 'string') ? (v as ResolvedOp[]) : null;
}

function readPhrase(v: unknown): Phrase | null {
  if (!Array.isArray(v) || v.length > MAX_PHRASE) return null;
  const ok = v.every(
    e =>
      Array.isArray(e) &&
      e.length === 3 &&
      e.every(n => typeof n === 'number' && Number.isFinite(n)) &&
      e[0] >= 0 &&
      e[0] <= 60_000 &&
      e[1] >= 0 &&
      e[1] <= 127 &&
      e[2] >= 0 &&
      e[2] <= 127,
  );
  return ok ? (v as Phrase) : null;
}

/** A passage read from a link's JSON: its shape is checked, and its sizes are kept to what a link can carry. */
export function readPassage(data: unknown): Read<Passage> {
  const bad = (why: string): Read<Passage> => ({
    ok: false,
    error: `This link cannot be read (${why}).`,
  });
  if (!isObject(data)) return bad('not a passage');
  if (data.v !== PASSAGE_VERSION) return bad(`made by another version of this page: ${data.v}`);
  if (!isText(data.id, 80) || !data.id) return bad('no id');
  if (typeof data.work !== 'string' || !findWork(data.work)) return bad('an unknown work');
  const author = data.author;
  if (
    !isObject(author) ||
    !isText(author.name, MAX_NAME) ||
    !isText(author.words, MAX_WORDS) ||
    !isTime(author.at) ||
    typeof author.allowInside !== 'boolean'
  )
    return bad('no author');
  if (!Array.isArray(data.hops) || data.hops.length > MAX_HOPS) return bad('too many hops');
  const hops: Hop[] = [];
  let count = 0;
  for (const h of data.hops as unknown[]) {
    if (!isObject(h) || !isText(h.by, MAX_NAME) || !isText(h.words, MAX_WORDS) || !isTime(h.at))
      return bad('a hop without its person');
    const ops = readOps(h.ops);
    if (!ops) return bad(`${h.by}'s changes`);
    count += ops.length;
    const hop: Hop = { by: h.by, words: h.words, at: h.at, ops };
    if (h.phrase !== undefined) {
      const phrase = readPhrase(h.phrase);
      if (!phrase) return bad(`${h.by}'s phrase`);
      hop.phrase = phrase;
    }
    hops.push(hop);
  }
  const passage: Passage = {
    v: PASSAGE_VERSION,
    id: data.id,
    work: data.work,
    author: {
      name: author.name,
      words: author.words,
      at: author.at,
      allowInside: author.allowInside,
    },
    hops,
  };
  if (data.draft !== undefined) {
    const draft = readOps(data.draft);
    if (!draft) return bad('changes on their way');
    count += draft.length;
    passage.draft = draft;
  }
  if (count > MAX_OPS) return bad('too many changes');
  return { ok: true, value: passage };
}

// ---- versions ------------------------------------------------------------------------------

/**
 * A rebuilt version read as den-kit reads a work file. Anything the reading would repair (a
 * cable to a module that is not there) means the version is not what its person made, so it
 * is refused, not played.
 */
function checked(doc: PatchDocument, catalog: Catalog): PatchDocument {
  const read = parseDocument(doc, catalog);
  if (!read.ok) throw new Error(read.error);
  if (read.report.length) throw new Error(read.report[0]!.message);
  return read.doc;
}

/** Apply operations to a version (what a hop or the changes on their way make of it). */
export function applyChanges(
  doc: PatchDocument,
  ops: readonly ResolvedOp[],
  catalog: Catalog,
): PatchDocument {
  return ops.length ? checked(applyResolvedOps(doc, ops), catalog) : doc;
}

/** Every version of a passage, the author's first. */
export function buildVersions(passage: Passage, catalog: Catalog): Read<Version[]> {
  const work = findWork(passage.work);
  if (!work) return { ok: false, error: 'This work is not one of the examples.' };
  let doc = work.build(catalog);
  const { author } = passage;
  const versions: Version[] = [
    { index: 0, by: author.name, words: author.words, at: author.at, doc },
  ];
  for (const [i, hop] of passage.hops.entries()) {
    try {
      doc = applyChanges(doc, hop.ops, catalog);
    } catch (error) {
      return {
        ok: false,
        error: `${hop.by || 'Someone'}'s changes cannot be applied: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    versions.push({ index: i + 1, by: hop.by, words: hop.words, at: hop.at, doc, hop });
  }
  return { ok: true, value: versions };
}

/** The setValue operations that turn `base`'s values into `next`'s, on the nodes both have. */
export function valueOps(base: PatchDocument, next: PatchDocument): ResolvedOp[] {
  const ops: ResolvedOp[] = [];
  for (const node of Object.values(next.nodes)) {
    const was = base.nodes[node.id];
    if (!was) continue;
    for (const port of new Set([...Object.keys(was.values), ...Object.keys(node.values)])) {
      const from = was.values[port],
        to = node.values[port];
      if (from !== to) ops.push({ op: 'setValue', node: node.id, port, from, to });
    }
  }
  return ops;
}

// ---- what changed, in words ----------------------------------------------------------------

export interface ChangeLine {
  /** setting: a control on the plugin; inside: the patch; screen: how the plugin looks. */
  kind: 'setting' | 'inside' | 'screen';
  text: string;
}

const AXIS: Record<string, string> = { x: 'X', y: 'Y' };

function valueText(node: { type: string; config: Record<string, unknown> }, v: unknown) {
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (typeof v !== 'number') return '–';
  const unit =
    node.type === 'ui.knob' || node.type === 'ui.slider' ? String(node.config.unit ?? '') : '';
  return formatValue(v, unit);
}

/**
 * What a hop's operations changed, in a few lines: each control's value from what it was to
 * what it became, then what was added, removed and rewired inside, then the screen.
 */
export function describeChanges(
  base: PatchDocument,
  ops: readonly ResolvedOp[],
  catalog: Catalog,
): ChangeLine[] {
  const known = new Map(Object.values(base.nodes).map(n => [n.id, n]));
  for (const op of ops) if (op.op === 'addNode') known.set(op.node.id, op.node);
  const name = (id: string) => {
    const n = known.get(id);
    return n ? (n.label ?? catalog.find(n.type)?.title ?? n.type) : id;
  };
  const isWidget = (id: string) => {
    const n = known.get(id);
    return !!n && catalog.find(n.type)?.kind === 'widget';
  };
  // One line per value that moved: from its first value to its last.
  const values = new Map<string, { node: string; port: string; from: unknown; to: unknown }>();
  const added: string[] = [],
    removed: string[] = [];
  let cables = 0,
    moved = 0,
    screen = 0,
    configs = 0,
    files = 0,
    parts = 0;
  const look = new Set<string>();
  for (const op of ops) {
    switch (op.op) {
      case 'setValue': {
        const key = `${op.node}/${op.port}`;
        const was = values.get(key);
        values.set(key, {
          node: op.node,
          port: op.port,
          from: was ? was.from : op.from,
          to: op.to,
        });
        break;
      }
      case 'addNode':
        added.push(name(op.node.id));
        break;
      case 'removeNode':
        removed.push(name(op.node.id));
        break;
      case 'addEdge':
      case 'removeEdge':
        cables++;
        break;
      case 'setConfig':
        configs++;
        break;
      case 'setField':
        if (op.field === 'pos') moved++;
        else screen++;
        break;
      case 'addElement':
      case 'removeElement':
      case 'setElement':
        screen++;
        break;
      case 'setUi':
        look.add(op.field);
        break;
      case 'setDoc':
        look.add(op.field);
        break;
      case 'setSize':
        look.add('size');
        break;
      case 'addPart':
      case 'removePart':
      case 'setPart':
        parts++;
        break;
      case 'setFile':
        files++;
        break;
    }
  }
  const lines: ChangeLine[] = [];
  for (const { node, port, from, to } of values.values()) {
    if (from === to) continue;
    const n = known.get(node);
    const what = port === 'value' ? name(node) : `${name(node)} ${AXIS[port] ?? port}`;
    const text = n ? `${what} ${valueText(n, from)} → ${valueText(n, to)}` : `${what} changed`;
    lines.push({ kind: isWidget(node) ? 'setting' : 'inside', text });
  }
  if (added.length) lines.push({ kind: 'inside', text: `Added ${added.join(', ')}` });
  if (removed.length) lines.push({ kind: 'inside', text: `Removed ${removed.join(', ')}` });
  if (cables)
    lines.push({ kind: 'inside', text: `Rewired ${cables} cable${cables > 1 ? 's' : ''}` });
  if (configs)
    lines.push({
      kind: 'inside',
      text: `Changed ${configs} module setting${configs > 1 ? 's' : ''}`,
    });
  if (parts) lines.push({ kind: 'inside', text: `Changed parts` });
  if (files) lines.push({ kind: 'inside', text: `Changed ${files} file${files > 1 ? 's' : ''}` });
  if (moved) lines.push({ kind: 'inside', text: `Moved ${moved} module${moved > 1 ? 's' : ''}` });
  if (screen)
    lines.push({
      kind: 'screen',
      text: `Changed ${screen} thing${screen > 1 ? 's' : ''} on the screen`,
    });
  if (look.size) lines.push({ kind: 'screen', text: `Changed the ${[...look].join(', ')}` });
  return lines;
}

/** The phrase's notes and length, in words. */
export function phraseText(phrase: Phrase): string {
  const notes = phrase.filter(([, , velocity]) => velocity > 0).length;
  const seconds = (phrase.at(-1)?.[0] ?? 0) / 1000;
  return `${notes} note${notes === 1 ? '' : 's'}, ${seconds.toFixed(1)} s`;
}

/** Who a version came through, for the line that names everyone before the next person. */
export function creditLine(passage: Passage, title: string): string {
  const people = passage.hops.map(h => h.by || 'Someone');
  return people.length
    ? `${title} by ${passage.author.name}, passed on by ${people.join(' → ')}`
    : `${title} by ${passage.author.name}`;
}

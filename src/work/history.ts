// Undo and redo over author-attributed transactions, and the one way to change a
// work: commit(). A step of the history can hold many operations. A drag is one
// step: consecutive transactions with the same gesture id merge. An AI request
// is one step, its sub-agents included: its transactions share a group and
// merge into one entry, which moves to the top as the request goes on, so an
// edit the person makes meanwhile stays a step of its own below it. Undo
// restores exactly the state each operation replaced, except where someone
// else changed the same thing later: that later change is kept and reported.
import type { Catalog } from './catalog.ts';
import { ChangeLog, describeKey, type Change, type ChangeKey } from './changes.ts';
import {
  applyIntents,
  applyResolvedOps,
  invert,
  isStructural,
  OpError,
  type Intent,
  type ResolvedOp,
} from './ops.ts';
import { randomId, type PatchDocument } from './schema.ts';

export type Author =
  | { kind: 'human' }
  | { kind: 'ai-llm'; take: string; trace?: string }
  /** A code part or a canvas on the plugin (its element) moved a control: by itself, or as the person played it. */
  | { kind: 'part'; element: string }
  | { kind: 'system'; reason: string };

export interface Transaction {
  id: string;
  author: Author;
  label: string;
  ops: ResolvedOp[];
  /** The revision each of `ops` landed at (a request's steps land over time). */
  stamps?: number[];
  at: number;
  gesture?: string;
  /** Steps of one request (an LLM turn and its sub-agents): they undo together. */
  group?: string;
  baseRevision: number;
  /** The whole patch was replaced (a load, a new start): nothing before it is about this patch. */
  replaced?: boolean;
  /** The transactions this step is made of, when several merged into it (a request's, a drag's). */
  merged?: string[];
}

/** The transactions a step is made of. */
const txIds = (tx: Transaction) => tx.merged ?? [tx.id];

export const authorLabel = (a: Author) =>
  a.kind === 'human'
    ? 'you'
    : a.kind === 'ai-llm'
      ? `llm:${a.take}`
      : a.kind === 'part'
        ? `part:${a.element}`
        : `system:${a.reason}`;

const sameAuthor = (a: Author, b: Author) => authorLabel(a) === authorLabel(b);
const PERSON: Author = { kind: 'human' };

/** What an undo did: the work after it, and the later changes by someone else that it kept. */
export interface Undone {
  doc: PatchDocument;
  tx: Transaction;
  kept: Array<{ key: ChangeKey; change: Change }>;
}

export class History {
  private undoStack: Transaction[] = [];
  private redoStack: Transaction[] = [];
  /** Who last changed each part of the work, and when. */
  readonly changes = new ChangeLog();
  readonly limit: number;
  readonly mergeWindowMs: number;
  constructor(limit = 500, mergeWindowMs = 1500) {
    this.limit = limit;
    this.mergeWindowMs = mergeWindowMs;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
  get size() {
    return this.undoStack.length;
  }
  peek(): Transaction | undefined {
    return this.undoStack.at(-1);
  }
  entries(): readonly Transaction[] {
    return this.undoStack;
  }

  /** Record an applied transaction; `revision` is the work's revision after it. Empty transactions are ignored. */
  record(tx: Transaction, revision = tx.baseRevision + 1) {
    if (!tx.ops.length) return;
    this.redoStack = [];
    this.changes.record(tx.ops, {
      revision,
      author: authorLabel(tx.author),
      tx: tx.id,
      label: tx.label,
    });
    const stamps = tx.ops.map(() => revision);
    if (tx.group) {
      const at = this.undoStack.findLastIndex(
        t => t.group === tx.group && sameAuthor(t.author, tx.author),
      );
      if (at >= 0) {
        const entry = this.undoStack[at]!;
        entry.stamps = [...stampsOf(entry), ...stamps];
        entry.ops = [...entry.ops, ...tx.ops];
        entry.merged = [...txIds(entry), tx.id];
        entry.at = tx.at;
        entry.label = tx.label;
        if (at !== this.undoStack.length - 1) {
          this.undoStack.splice(at, 1);
          this.undoStack.push(entry);
        }
        return;
      }
    }
    const last = this.undoStack.at(-1);
    if (
      last &&
      tx.gesture &&
      last.gesture === tx.gesture &&
      sameAuthor(last.author, tx.author) &&
      tx.at - last.at <= this.mergeWindowMs &&
      !tx.ops.some(isStructural) &&
      !last.ops.some(isStructural)
    ) {
      const merged = mergeValueOps([...last.ops, ...tx.ops], [...stampsOf(last), ...stamps]);
      last.ops = merged.ops;
      last.stamps = merged.stamps;
      last.at = tx.at;
      last.merged = [...txIds(last), tx.id];
      return;
    }
    this.undoStack.push({ ...tx, ops: [...tx.ops], stamps });
    if (this.undoStack.length > this.limit)
      this.undoStack.splice(0, this.undoStack.length - this.limit);
  }

  /**
   * Undo the last step. What someone else changed after the step changed it
   * stays as they left it (`kept`). When later changes depend on the step, it
   * cannot be undone yet: `error` says so and nothing changes.
   */
  undo(
    doc: PatchDocument,
    options: { author?: Author; check?: (doc: PatchDocument) => string | null } = {},
  ): Undone | { error: string } | null {
    const tx = this.undoStack.at(-1);
    if (!tx) return null;
    const author = authorLabel(tx.author);
    const stamps = stampsOf(tx);
    const inverse: ResolvedOp[] = [];
    const undone: ResolvedOp[] = [];
    const kept = new Map<ChangeKey, Change>();
    for (let i = tx.ops.length - 1; i >= 0; i--) {
      const op = tx.ops[i]!;
      const later = this.changes.standing([op], stamps[i]!, author);
      if (later.length) {
        for (const { key, change } of later) kept.set(key, change);
        continue;
      }
      inverse.push(invert(op));
      undone.unshift(op);
    }
    let next: PatchDocument;
    try {
      next = applyResolvedOps(doc, inverse);
    } catch {
      return { error: dependsOn(tx) };
    }
    const problem = options.check?.(next);
    if (problem) return { error: dependsOn(tx) };
    this.undoStack.pop();
    const redo = { ...tx, ops: undone, stamps: undone.map(() => next.revision) };
    this.redoStack.push(redo);
    this.changes.record(
      inverse,
      {
        revision: next.revision,
        author: authorLabel(options.author ?? PERSON),
        tx: tx.id,
        label: `Undo: ${tx.label}`,
      },
      'undo',
      txIds(tx),
    );
    return { doc: next, tx: redo, kept: [...kept].map(([key, change]) => ({ key, change })) };
  }

  redo(
    doc: PatchDocument,
    author: Author = PERSON,
  ): { doc: PatchDocument; tx: Transaction } | null {
    const tx = this.redoStack.pop();
    if (!tx) return null;
    const next = applyResolvedOps(doc, tx.ops);
    this.undoStack.push({ ...tx, stamps: tx.ops.map(() => next.revision) });
    this.changes.record(
      tx.ops,
      {
        revision: next.revision,
        author: authorLabel(author),
        tx: tx.id,
        label: `Redo: ${tx.label}`,
      },
      'redo',
      txIds(tx),
    );
    return { doc: next, tx };
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.changes.clear();
  }
}

const stampsOf = (tx: Transaction) => tx.stamps ?? tx.ops.map(() => tx.baseRevision + 1);
const dependsOn = (tx: Transaction) =>
  `“${tx.label}” cannot be undone yet: later changes depend on it. Undo those first.`;

/** Collapse repeated edits of the same target (a value, a field, an element field, the look…) to first.from → last.to. */
function mergeValueOps(
  ops: ResolvedOp[],
  stamps: number[],
): { ops: ResolvedOp[]; stamps: number[] } {
  const out: ResolvedOp[] = [];
  const outStamps: number[] = [];
  const index = new Map<string, number>();
  ops.forEach((op, i) => {
    const key =
      op.op === 'setValue'
        ? `v:${op.node}:${op.port}`
        : op.op === 'setField'
          ? `f:${op.node}:${op.field}`
          : op.op === 'setElement'
            ? `e:${op.id}:${op.field}`
            : op.op === 'setUi'
              ? `u:${op.field}`
              : op.op === 'setSize'
                ? 's'
                : null;
    if (key && index.has(key)) {
      const at = index.get(key)!;
      out[at] = { ...(out[at] as typeof op), to: (op as { to: unknown }).to } as ResolvedOp;
      outStamps[at] = stamps[i]!;
    } else {
      if (key) index.set(key, out.length);
      out.push(op);
      outStamps.push(stamps[i]!);
    }
  });
  return { ops: out, stamps: outStamps };
}

export interface CommitOptions {
  author?: Author;
  label?: string;
  /** One drag or press: its transactions undo together. */
  gesture?: string;
  /** Steps of one request (see History). */
  group?: string;
  /** Refuse when the work is not at this revision. */
  expectRevision?: number;
  /**
   * The revision of the work the author last read. What someone else changed
   * after it cannot be changed by this commit: it fails and says what changed.
   */
  seen?: number;
}
export type CommitResult =
  | {
      ok: true;
      doc: PatchDocument;
      ops: ResolvedOp[];
      created: string[];
      /** The recorded transaction; null when nothing changed. */
      tx: Transaction | null;
    }
  | { ok: false; error: OpError };

/** Change the work: apply the intents as one transaction, check it, and record it. */
export function commit(
  history: History,
  doc: PatchDocument,
  intents: Intent[],
  catalog: Catalog,
  options: CommitOptions = {},
): CommitResult {
  if (options.expectRevision !== undefined && doc.revision !== options.expectRevision)
    return {
      ok: false,
      error: new OpError(
        `The patch changed (revision ${doc.revision}, expected ${options.expectRevision}).`,
        0,
        'stale',
      ),
    };
  let result;
  try {
    result = applyIntents(doc, intents, catalog);
  } catch (error) {
    if (error instanceof OpError) return { ok: false, error };
    throw error;
  }
  if (!result.ops.length) return { ok: true, doc, ops: [], created: result.created, tx: null };
  const author = options.author ?? PERSON;
  if (options.seen !== undefined) {
    const unseen = history.changes.unseen(result.ops, options.seen, authorLabel(author));
    if (unseen.length)
      return {
        ok: false,
        error: new OpError(
          `${unseen
            .slice(0, 6)
            .map(
              ({ key, change }) =>
                `${describeKey(key)} was changed by ${change.author === 'you' ? 'the person' : change.author} (“${change.label}”)`,
            )
            .join('; ')} after you read the work. Nothing was applied.`,
          0,
          'conflict',
          'Read the work again to see the change, then decide what to do.',
        ),
      };
  }
  const tx: Transaction = {
    id: randomId('tx'),
    author,
    label: options.label ?? describeIntents(intents),
    ops: result.ops,
    at: Date.now(),
    gesture: options.gesture,
    group: options.group,
    baseRevision: doc.revision,
  };
  history.record(tx, result.doc.revision);
  return { ok: true, doc: result.doc, ops: result.ops, created: result.created, tx };
}

export function describeIntents(intents: Intent[]): string {
  if (intents.length === 1) {
    const i = intents[0]!;
    switch (i.op) {
      case 'setValue':
        return `Set ${i.node}.${i.port}`;
      case 'connect':
        return `Connect ${i.from.node} → ${i.to.node}`;
      case 'addNode':
        return `Add ${i.node.type.split('.').pop()}`;
      case 'removeNode':
        return `Delete ${i.id}`;
      case 'makePart':
        return 'Make a part';
      case 'unpackPart':
        return 'Unpack a part';
      case 'detachPart':
        return 'Own copy of a part';
      case 'addParam':
        return `Show ${i.node}.${i.port} on the part`;
      case 'removeParam':
        return `Hide ${i.id} from the part`;
      case 'updatePart':
        return i.name !== undefined ? 'Rename a part' : 'Describe a part';
      default:
        return i.op;
    }
  }
  return `${intents.length} edits`;
}

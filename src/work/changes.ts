// Who changed what, and when. Every part of the work an operation touches has a
// key ("node:osc1/value:freq", "element:title", "file:src/parts/reels.ts"), and
// the log keeps the revision and the author of each key's last change. An AI's
// operation on something a person changed after the AI read the work fails and
// says what changed (docs/principles.md, principle 3); undoing an AI request
// keeps what someone else changed after the request touched it.
import type { ResolvedOp } from './ops.ts';

export type ChangeKey = string;
export interface Change {
  revision: number;
  /** authorLabel() of whoever made it. */
  author: string;
  /** The transaction that made it. */
  tx: string;
  /** What the transaction was, in words. */
  label: string;
}

/** The parts of the work an operation changes. */
export function keysOf(op: ResolvedOp): ChangeKey[] {
  switch (op.op) {
    case 'addNode':
    case 'removeNode':
      return [`node:${op.node.id}`];
    case 'addEdge':
    case 'removeEdge':
      return [
        `edge:${op.edge.id}`,
        `node:${op.edge.from.node}/out:${op.edge.from.port}`,
        `node:${op.edge.to.node}/in:${op.edge.to.port}`,
      ];
    case 'setValue':
      return [`node:${op.node}/value:${op.port}`];
    case 'setConfig':
      return [`node:${op.node}/config:${op.key}`];
    case 'setField':
      return [`node:${op.node}/${op.field}`];
    case 'setDoc':
      return [`doc/${op.field}`];
    case 'setSize':
      return ['doc/size'];
    case 'addElement':
    case 'removeElement':
      return [`element:${op.element.id}`];
    case 'setElement':
      return [`element:${op.id}/${op.field}`];
    case 'setUi':
      return [`ui/${op.field}`];
    case 'addPart':
    case 'removePart':
      return [`part:${op.part.id}`];
    case 'setPart':
      return [`part:${op.id}`];
    case 'setFile':
      return [`file:${op.path}`];
  }
}

/** The same thing, or one contains the other (a node and one of its values). */
export const overlaps = (a: ChangeKey, b: ChangeKey) =>
  a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

/** A key in words, for people and the AI. */
export function describeKey(key: ChangeKey): string {
  const [head, ...rest] = key.split('/');
  const [kind, id] = head!.split(/:(.*)/s) as [string, string | undefined];
  const what =
    kind === 'node'
      ? `module ${id}`
      : kind === 'edge'
        ? `cable ${id}`
        : kind === 'element'
          ? `${id} on the plugin`
          : kind === 'part'
            ? `part ${id}`
            : kind === 'file'
              ? `file ${id}`
              : kind === 'doc'
                ? `the work's ${rest.join('/') || 'name'}`
                : `the plugin's ${rest.join('/')}`;
  const field = kind === 'doc' || kind === 'ui' ? '' : rest.join('/');
  return field ? `${what} (${field.replace(/^(value|config|in|out):/, '')})` : what;
}

/** One change of one key: an edit, or an undo or redo of one. */
interface Entry {
  change: Change;
  kind: 'edit' | 'undo' | 'redo';
  /** An edit that was undone (and not redone) no longer stands. */
  undone?: boolean;
}
/** How many changes of one key are kept. */
const KEPT = 64;

export class ChangeLog {
  private readonly entries = new Map<ChangeKey, Entry[]>();

  /** The ops of an edit (or its undo, or its redo, of the edits of `txs`) changed their keys. */
  record(
    ops: readonly ResolvedOp[],
    change: Change,
    kind: Entry['kind'] = 'edit',
    txs: readonly string[] = [change.tx],
  ) {
    for (const op of ops)
      for (const key of keysOf(op)) {
        const list = this.entries.get(key) ?? [];
        if (kind !== 'edit')
          for (const e of list)
            if (e.kind === 'edit' && txs.includes(e.change.tx)) e.undone = kind === 'undo';
        list.push({ change, kind });
        if (list.length > KEPT) list.splice(0, list.length - KEPT);
        this.entries.set(key, list);
      }
  }

  private around(key: ChangeKey): Array<[ChangeKey, Entry[]]> {
    const out: Array<[ChangeKey, Entry[]]> = [];
    for (const [k, list] of this.entries) if (overlaps(k, key)) out.push([k, list]);
    return out;
  }

  /**
   * What someone other than `author` changed after `revision` in what the ops
   * touch: what an author who read the work at `revision` has not seen. An undo
   * is a change too: the AI is told when the person took its edit back.
   */
  unseen(
    ops: readonly ResolvedOp[],
    revision: number,
    author: string,
  ): Array<{ key: ChangeKey; change: Change }> {
    const found = new Map<ChangeKey, Change>();
    for (const op of ops)
      for (const key of keysOf(op))
        for (const [k, list] of this.around(key)) {
          const last = list.at(-1);
          if (last && last.change.revision > revision && last.change.author !== author)
            found.set(k, last.change);
        }
    return [...found].map(([key, change]) => ({ key, change }));
  }

  /**
   * Edits by someone other than `author` after `revision` that still stand
   * (not undone): what undoing `author`'s earlier change must leave as it is.
   */
  standing(
    ops: readonly ResolvedOp[],
    revision: number,
    author: string,
  ): Array<{ key: ChangeKey; change: Change }> {
    const found = new Map<ChangeKey, Change>();
    for (const op of ops)
      for (const key of keysOf(op))
        for (const [k, list] of this.around(key))
          for (const e of list)
            if (
              e.kind !== 'undo' &&
              !e.undone &&
              e.change.revision > revision &&
              e.change.author !== author
            )
              found.set(k, e.change);
    return [...found].map(([key, change]) => ({ key, change }));
  }

  clear() {
    this.entries.clear();
  }
}

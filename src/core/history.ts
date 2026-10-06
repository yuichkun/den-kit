// Linear undo/redo over author-attributed transactions. A knob drag is one
// gesture: consecutive setValue transactions with the same gesture id merge into
// one undo step. The fast AI path commits like a human does, so "undo" right
// after an AI edit restores the exact pre-AI document.
import { applyResolvedOps, invertAll, isStructural, type ResolvedOp } from './ops.ts';
import type { PatchDocument } from './schema.ts';

export type Author =
  | { kind: 'human' }
  | { kind: 'ai-fast'; handler: string; trace?: string }
  | { kind: 'ai-llm'; take: string; trace?: string }
  | { kind: 'system'; reason: string };

export interface Transaction {
  id: string;
  author: Author;
  label: string;
  ops: ResolvedOp[];
  at: number;
  gesture?: string;
  baseRevision: number;
}

export const authorLabel = (a: Author) => a.kind === 'human' ? 'you' : a.kind === 'ai-fast' ? `fast:${a.handler}` : a.kind === 'ai-llm' ? `llm:${a.take}` : `system:${a.reason}`;

const sameAuthor = (a: Author, b: Author) => authorLabel(a) === authorLabel(b);

export class History {
  private undoStack: Transaction[] = [];
  private redoStack: Transaction[] = [];
  readonly limit: number;
  readonly mergeWindowMs: number;
  constructor(limit = 500, mergeWindowMs = 1500) { this.limit = limit; this.mergeWindowMs = mergeWindowMs; }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get size() { return this.undoStack.length; }
  peek(): Transaction | undefined { return this.undoStack.at(-1); }
  peekRedo(): Transaction | undefined { return this.redoStack.at(-1); }
  entries(): readonly Transaction[] { return this.undoStack; }

  /** Record an applied transaction. Empty transactions are ignored. */
  record(tx: Transaction) {
    if (!tx.ops.length) return;
    this.redoStack = [];
    const last = this.undoStack.at(-1);
    if (last && tx.gesture && last.gesture === tx.gesture && sameAuthor(last.author, tx.author)
      && tx.at - last.at <= this.mergeWindowMs && !tx.ops.some(isStructural) && !last.ops.some(isStructural)) {
      last.ops = mergeValueOps([...last.ops, ...tx.ops]);
      last.at = tx.at;
      return;
    }
    this.undoStack.push({ ...tx, ops: [...tx.ops] });
    if (this.undoStack.length > this.limit) this.undoStack.splice(0, this.undoStack.length - this.limit);
  }

  undo(doc: PatchDocument): { doc: PatchDocument; tx: Transaction } | null {
    const tx = this.undoStack.pop(); if (!tx) return null;
    this.redoStack.push(tx);
    return { doc: applyResolvedOps(doc, invertAll(tx.ops)), tx };
  }

  redo(doc: PatchDocument): { doc: PatchDocument; tx: Transaction } | null {
    const tx = this.redoStack.pop(); if (!tx) return null;
    this.undoStack.push(tx);
    return { doc: applyResolvedOps(doc, tx.ops), tx };
  }

  clear() { this.undoStack = []; this.redoStack = []; }
}

/** Collapse repeated setValue/move on the same target to first.from → last.to. */
function mergeValueOps(ops: ResolvedOp[]): ResolvedOp[] {
  const out: ResolvedOp[] = [];
  const index = new Map<string, number>();
  for (const op of ops) {
    const key = op.op === 'setValue' ? `v:${op.node}:${op.port}` : op.op === 'setField' ? `f:${op.node}:${op.field}` : null;
    if (key && index.has(key)) {
      const at = index.get(key)!;
      out[at] = { ...(out[at] as typeof op), to: (op as { to: unknown }).to } as ResolvedOp;
    } else {
      if (key) index.set(key, out.length);
      out.push(op);
    }
  }
  return out;
}

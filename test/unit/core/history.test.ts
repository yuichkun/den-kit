import { describe, expect, it } from 'vitest';
import { catalog } from '../../../src/blocks/index.ts';
import { History, type Author } from '../../../src/core/history.ts';
import { applyIntents, type Intent } from '../../../src/core/ops.ts';
import { starter } from '../../../src/core/starters.ts';
import type { PatchDocument } from '../../../src/core/schema.ts';

const human: Author = { kind: 'human' };
function commit(history: History, doc: PatchDocument, intents: Intent[], author: Author = human, extra: { gesture?: string; group?: string; at?: number } = {}) {
  const r = applyIntents(doc, intents, catalog);
  history.record({ id: String(Math.random()), author, label: 'x', ops: r.ops, at: extra.at ?? 0, gesture: extra.gesture, group: extra.group, baseRevision: doc.revision });
  return r.doc;
}

describe('history', () => {
  it('A12 a knob drag is one undo step', () => {
    const h = new History(); const start = starter('bass', catalog); let doc = start;
    for (let k = 0; k < 200; k++) doc = commit(h, doc, [{ op: 'setValue', node: 'filter1', port: 'resonance', value: 0.5 + k * 0.01 }], human, { gesture: 'g1', at: k * 5 });
    expect(h.size).toBe(1);
    doc = h.undo(doc)!.doc;
    expect(doc.nodes.filter1!.values.resonance).toBe(start.nodes.filter1!.values.resonance);
  });
  it('does not merge across authors, structural edits or a long pause', () => {
    const h = new History(); let doc = starter('bass', catalog);
    doc = commit(h, doc, [{ op: 'setValue', node: 'filter1', port: 'resonance', value: 1 }], human, { gesture: 'g', at: 0 });
    doc = commit(h, doc, [{ op: 'setValue', node: 'filter1', port: 'resonance', value: 2 }], { kind: 'ai-fast', handler: 'intent' }, { gesture: 'g', at: 10 });
    doc = commit(h, doc, [{ op: 'setValue', node: 'filter1', port: 'resonance', value: 3 }], human, { gesture: 'g', at: 5000 });
    doc = commit(h, doc, [{ op: 'addNode', node: { type: 'kit.value' } }], human, { gesture: 'g', at: 5001 });
    expect(h.size).toBe(4);
  });
  it('A14 undo after an AI edit restores the exact pre-AI document; a new edit clears redo', () => {
    const h = new History(); let doc = starter('bass', catalog);
    const before = doc;
    doc = commit(h, doc, [{ op: 'setValue', node: 'cut1', port: 'hz', value: 2000 }, { op: 'addNode', node: { type: 'den.drive' } }], { kind: 'ai-fast', handler: 'brighter' });
    const undone = h.undo(doc)!;
    expect(undone.tx.author.kind).toBe('ai-fast');
    expect({ ...undone.doc, revision: 0 }).toEqual({ ...before, revision: 0 });
    expect(h.canRedo).toBe(true);
    commit(h, undone.doc, [{ op: 'move', node: 'osc1', pos: { x: 1, y: 1 } }]);
    expect(h.canRedo).toBe(false);
  });
  it('redo re-applies and the limit trims the oldest entries', () => {
    const h = new History(3); let doc = starter('bass', catalog);
    for (let k = 0; k < 5; k++) doc = commit(h, doc, [{ op: 'move', node: 'osc1', pos: { x: k, y: 0 } }]);
    expect(h.size).toBe(3);
    const u = h.undo(doc)!; const r = h.redo(u.doc)!;
    expect(r.doc.nodes.osc1!.pos).toEqual({ x: 4, y: 0 });
    expect(h.redo(r.doc)).toBeNull();
    expect(new History().undo(doc)).toBeNull();
  });
  it('the steps of one LLM request undo together, structural or not; an edit by someone else splits them', () => {
    const h = new History(); const start = starter('bass', catalog); let doc = start;
    const llm: Author = { kind: 'ai-llm', take: 'rq1' };
    doc = commit(h, doc, [{ op: 'addNode', node: { id: 'lfo2', type: 'den.lfo' } }], llm, { group: 'rq1', at: 0 });
    doc = commit(h, doc, [{ op: 'connect', from: { node: 'lfo2', port: 'out' }, to: { node: 'cut1', port: 'octaves' }, replace: true }], llm, { group: 'rq1', at: 60000 });
    expect(h.size).toBe(1);
    const once = h.undo(doc)!;
    expect({ ...once.doc, revision: 0 }).toEqual({ ...start, revision: 0 });
    doc = h.redo(once.doc)!.doc;
    doc = commit(h, doc, [{ op: 'setValue', node: 'filter1', port: 'resonance', value: 2 }]);
    doc = commit(h, doc, [{ op: 'setValue', node: 'lfo2', port: 'rate', value: 3 }], llm, { group: 'rq1', at: 60001 });
    doc = commit(h, doc, [{ op: 'setValue', node: 'lfo2', port: 'rate', value: 4 }], { kind: 'ai-llm', take: 'rq2' }, { group: 'rq2', at: 60002 });
    expect(h.size).toBe(4);
  });
});
